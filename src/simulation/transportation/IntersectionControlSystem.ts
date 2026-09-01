import {
  roadClassRank,
  type Carriageway,
  type Junction,
  type JunctionId,
  type RoadSegment,
  type TransportNetworkAuthority,
  type TurnMovement,
  type TurnMovementId,
} from './TransportNetworkTypes.ts';

export type IntersectionControlType = 'stop' | 'signal';
export type MovementPermission = 'protected' | 'permissive' | 'stop' | 'prohibited';
export type MovementQueuePriority = 'normal' | 'emergency';

export type MovementQueueEntry = Readonly<{
  vehicleId: string;
  travelerWeight: number;
  queuedTick: number;
  priority?: MovementQueuePriority;
}>;

type MutableMovementQueueEntry = {
  vehicleId: string;
  travelerWeight: number;
  queuedTick: number;
  priority: MovementQueuePriority;
};

export type IntersectionCapacityContext = Readonly<{
  capacityMultiplierBySegment?: Readonly<Record<string, number>>;
}>;

export type IntersectionControlSnapshot = Readonly<{
  controls: readonly Readonly<{ junctionId: JunctionId; controlType: IntersectionControlType }>[];
  queues: readonly Readonly<{ movementId: TurnMovementId; entries: readonly MovementQueueEntry[] }>[];
  pendingReleased: readonly Readonly<{
    junctionId: JunctionId;
    releases: readonly Readonly<{ vehicleId: string; movementId: TurnMovementId }>[];
  }>[];
  serviceCredits: readonly Readonly<{ movementId: TurnMovementId; credit: number }>[];
  lastSteppedTicks: readonly Readonly<{ junctionId: JunctionId; tick: number }>[];
}>;

const SIGNAL_CYCLE_TICKS = 80;
const HORIZONTAL_THROUGH_END = 30;
const HORIZONTAL_LEFT_END = 40;
const VERTICAL_THROUGH_END = 70;
const SIMULATION_TICKS_PER_MINUTE = 600;

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
}

function entryOrder(a: MutableMovementQueueEntry, b: MutableMovementQueueEntry): number {
  const priority = (a.priority === 'emergency' ? 0 : 1) - (b.priority === 'emergency' ? 0 : 1);
  return priority || a.queuedTick - b.queuedTick || a.vehicleId.localeCompare(b.vehicleId);
}

function axisForApproach(
  movement: TurnMovement,
  junctionById: ReadonlyMap<JunctionId, Junction>,
  carriagewayById: ReadonlyMap<string, Carriageway>,
): 'horizontal' | 'vertical' {
  const incoming = carriagewayById.get(movement.fromCarriagewayId);
  const junction = junctionById.get(movement.junctionId);
  const origin = incoming ? junctionById.get(incoming.fromJunctionId) : undefined;
  if (!incoming || !junction || !origin) return 'horizontal';
  return Math.abs(origin.x - junction.x) >= Math.abs(origin.y - junction.y) ? 'horizontal' : 'vertical';
}

export class IntersectionControlSystem {
  private authority: TransportNetworkAuthority = {
    junctions: [],
    segments: [],
    carriageways: [],
    lanes: [],
    movements: [],
  };
  private junctionById = new Map<JunctionId, Junction>();
  private carriagewayById = new Map<string, Carriageway>();
  private segmentById = new Map<string, RoadSegment>();
  private movementById = new Map<TurnMovementId, TurnMovement>();
  private readonly controlOverrides = new Map<JunctionId, IntersectionControlType>();
  private readonly queues = new Map<TurnMovementId, MutableMovementQueueEntry[]>();
  private readonly pendingReleased = new Map<JunctionId, Map<string, TurnMovementId>>();
  private readonly serviceCredits = new Map<TurnMovementId, number>();
  private readonly lastSteppedTicks = new Map<JunctionId, number>();

  configure(authority: TransportNetworkAuthority): void {
    this.authority = authority;
    this.junctionById = new Map(authority.junctions.map((junction) => [junction.id, junction]));
    this.carriagewayById = new Map(authority.carriageways.map((carriageway) => [carriageway.id, carriageway]));
    this.segmentById = new Map(authority.segments.map((segment) => [segment.id, segment]));
    this.movementById = new Map(authority.movements.map((movement) => [movement.id, movement]));

    for (const movementId of [...this.queues.keys()]) {
      if (!this.movementById.has(movementId)) this.queues.delete(movementId);
    }
    for (const movementId of [...this.serviceCredits.keys()]) {
      if (!this.movementById.has(movementId)) this.serviceCredits.delete(movementId);
    }
    for (const junctionId of [...this.controlOverrides.keys()]) {
      if (!this.junctionById.has(junctionId)) this.controlOverrides.delete(junctionId);
    }
    for (const [junctionId, releases] of [...this.pendingReleased.entries()]) {
      for (const [vehicleId, movementId] of [...releases.entries()]) {
        if (!this.movementById.has(movementId)) releases.delete(vehicleId);
      }
      if (releases.size === 0 || !this.junctionById.has(junctionId)) this.pendingReleased.delete(junctionId);
    }
  }

  setControlType(junctionId: JunctionId, controlType: IntersectionControlType): void {
    if (!this.junctionById.has(junctionId)) throw new Error(`unknown junction ${junctionId}`);
    this.controlOverrides.set(junctionId, controlType);
  }

  controlType(junctionId: JunctionId): IntersectionControlType {
    const override = this.controlOverrides.get(junctionId);
    if (override) return override;
    const incoming = this.authority.carriageways.filter((carriageway) => carriageway.toJunctionId === junctionId);
    const signalWarrant = incoming.some((carriageway) => roadClassRank(carriageway.operatingClass) >= roadClassRank('arterial'));
    return signalWarrant ? 'signal' : 'stop';
  }

  movementPermission(movementId: TurnMovementId, tick: number): MovementPermission {
    const movement = this.requireMovement(movementId);
    if (!movement.allowed) return 'prohibited';
    if (this.controlType(movement.junctionId) === 'stop') return 'stop';

    const phase = ((Math.floor(tick) % SIGNAL_CYCLE_TICKS) + SIGNAL_CYCLE_TICKS) % SIGNAL_CYCLE_TICKS;
    const axis = axisForApproach(movement, this.junctionById, this.carriagewayById);
    const throughGreen = axis === 'horizontal'
      ? phase < HORIZONTAL_THROUGH_END
      : phase >= HORIZONTAL_LEFT_END && phase < VERTICAL_THROUGH_END;
    const protectedLeft = axis === 'horizontal'
      ? phase >= HORIZONTAL_THROUGH_END && phase < HORIZONTAL_LEFT_END
      : phase >= VERTICAL_THROUGH_END;

    if (movement.turnKind === 'u-turn') return 'prohibited';
    if (movement.turnKind === 'left') return protectedLeft ? 'protected' : 'prohibited';
    if (movement.turnKind === 'right') return throughGreen ? 'protected' : 'permissive';
    return throughGreen ? 'protected' : 'prohibited';
  }

  enqueue(movementId: TurnMovementId, entry: MovementQueueEntry): void {
    const movement = this.requireMovement(movementId);
    if (!movement.allowed) throw new Error(`movement ${movementId} is not allowed`);
    if (!entry.vehicleId) throw new Error('vehicleId must not be empty');
    if (!Number.isFinite(entry.travelerWeight) || entry.travelerWeight <= 0) throw new Error('invalid traveler weight');
    requireFiniteNonNegative(entry.queuedTick, 'queuedTick');
    if (this.hasVehicle(entry.vehicleId)) return;

    const queue = this.queues.get(movementId) ?? [];
    queue.push({
      vehicleId: entry.vehicleId,
      travelerWeight: entry.travelerWeight,
      queuedTick: entry.queuedTick,
      priority: entry.priority ?? 'normal',
    });
    queue.sort(entryOrder);
    this.queues.set(movementId, queue);
  }

  queueDemand(movementId: TurnMovementId): number {
    return (this.queues.get(movementId) ?? []).reduce((sum, entry) => sum + entry.travelerWeight, 0);
  }

  queueLength(junctionId?: JunctionId): number {
    let total = 0;
    for (const [movementId, entries] of this.queues) {
      if (junctionId !== undefined && this.movementById.get(movementId)?.junctionId !== junctionId) continue;
      total += entries.length;
    }
    return total;
  }

  stepJunction(junctionId: JunctionId, tick: number, context: IntersectionCapacityContext = {}): string[] {
    requireFiniteNonNegative(tick, 'tick');
    const pending = this.pendingReleased.get(junctionId);
    if (pending && pending.size > 0) return [...pending.keys()].sort((a, b) => a.localeCompare(b));
    const previousTick = this.lastSteppedTicks.get(junctionId);
    if (previousTick === tick) return [];
    const elapsedTicks = previousTick === undefined ? 1 : Math.max(1, tick - previousTick);
    this.lastSteppedTicks.set(junctionId, tick);

    const movementIds = this.authority.movements
      .filter((movement) => movement.junctionId === junctionId && movement.allowed && (this.queues.get(movement.id)?.length ?? 0) > 0)
      .map((movement) => movement.id)
      .sort((a, b) => a.localeCompare(b));
    if (movementIds.length === 0) return [];

    for (const movementId of movementIds) {
      const permission = this.movementPermission(movementId, tick);
      if (permission === 'prohibited') continue;
      const perTick = this.serviceCapacityPerTick(movementId, context);
      const credit = this.serviceCredits.get(movementId) ?? 0;
      const cap = Math.max(1, perTick * 10);
      this.serviceCredits.set(movementId, Math.min(cap, credit + perTick * elapsedTicks));
    }

    const control = this.controlType(junctionId);
    const protectedIds = movementIds.filter((movementId) => this.movementPermission(movementId, tick) === 'protected');
    const permissiveIds = movementIds.filter((movementId) => this.movementPermission(movementId, tick) === 'permissive');
    const stopIds = movementIds.filter((movementId) => this.movementPermission(movementId, tick) === 'stop');
    let releases: Array<{ vehicleId: string; movementId: TurnMovementId }> = [];

    if (control === 'stop') {
      const movementId = this.selectHeadMovement(stopIds);
      if (movementId) releases = this.dischargeMovement(movementId);
    } else {
      for (const movementId of protectedIds) releases.push(...this.dischargeMovement(movementId));
      if (releases.length === 0) {
        const movementId = this.selectHeadMovement(permissiveIds);
        if (movementId) releases = this.dischargeMovement(movementId);
      }
    }

    if (releases.length === 0) return [];
    releases.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
    this.pendingReleased.set(junctionId, new Map(releases.map((release) => [release.vehicleId, release.movementId])));
    return releases.map((release) => release.vehicleId);
  }

  removeVehicle(vehicleId: string): void {
    for (const [movementId, queue] of [...this.queues.entries()]) {
      const next = queue.filter((entry) => entry.vehicleId !== vehicleId);
      if (next.length === 0) this.queues.delete(movementId);
      else if (next.length !== queue.length) this.queues.set(movementId, next);
    }
    for (const [junctionId, releases] of [...this.pendingReleased.entries()]) {
      releases.delete(vehicleId);
      if (releases.size === 0) this.pendingReleased.delete(junctionId);
    }
  }

  snapshot(): IntersectionControlSnapshot {
    return Object.freeze({
      controls: Object.freeze([...this.controlOverrides.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([junctionId, controlType]) => Object.freeze({ junctionId, controlType }))),
      queues: Object.freeze([...this.queues.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([movementId, entries]) => Object.freeze({
          movementId,
          entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
        }))),
      pendingReleased: Object.freeze([...this.pendingReleased.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([junctionId, releases]) => Object.freeze({
          junctionId,
          releases: Object.freeze([...releases.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([vehicleId, movementId]) => Object.freeze({ vehicleId, movementId }))),
        }))),
      serviceCredits: Object.freeze([...this.serviceCredits.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([movementId, credit]) => Object.freeze({ movementId, credit }))),
      lastSteppedTicks: Object.freeze([...this.lastSteppedTicks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([junctionId, tick]) => Object.freeze({ junctionId, tick }))),
    });
  }

  restore(snapshot: IntersectionControlSnapshot): void {
    this.controlOverrides.clear();
    this.queues.clear();
    this.pendingReleased.clear();
    this.serviceCredits.clear();
    this.lastSteppedTicks.clear();

    for (const item of snapshot.controls) this.setControlType(item.junctionId, item.controlType);
    for (const item of snapshot.queues) {
      for (const entry of item.entries) this.enqueue(item.movementId, entry);
    }
    for (const item of snapshot.pendingReleased) {
      if (!this.junctionById.has(item.junctionId)) throw new Error(`unknown junction ${item.junctionId}`);
      const releases = new Map<string, TurnMovementId>();
      for (const release of item.releases) {
        const movement = this.requireMovement(release.movementId);
        if (movement.junctionId !== item.junctionId) throw new Error('released movement belongs to the wrong junction');
        if (this.hasVehicle(release.vehicleId)) throw new Error(`duplicate intersection vehicle ${release.vehicleId}`);
        releases.set(release.vehicleId, release.movementId);
      }
      if (releases.size > 0) this.pendingReleased.set(item.junctionId, releases);
    }
    for (const item of snapshot.serviceCredits) {
      this.requireMovement(item.movementId);
      requireFiniteNonNegative(item.credit, 'service credit');
      this.serviceCredits.set(item.movementId, item.credit);
    }
    for (const item of snapshot.lastSteppedTicks) {
      if (!this.junctionById.has(item.junctionId)) throw new Error(`unknown junction ${item.junctionId}`);
      requireFiniteNonNegative(item.tick, 'last stepped tick');
      this.lastSteppedTicks.set(item.junctionId, item.tick);
    }
  }

  private requireMovement(movementId: TurnMovementId): TurnMovement {
    const movement = this.movementById.get(movementId);
    if (!movement) throw new Error(`unknown movement ${movementId}`);
    return movement;
  }

  private hasVehicle(vehicleId: string): boolean {
    for (const entries of this.queues.values()) if (entries.some((entry) => entry.vehicleId === vehicleId)) return true;
    for (const releases of this.pendingReleased.values()) if (releases.has(vehicleId)) return true;
    return false;
  }

  private selectHeadMovement(movementIds: readonly TurnMovementId[]): TurnMovementId | undefined {
    return movementIds
      .map((movementId) => ({ movementId, entry: this.queues.get(movementId)?.[0] }))
      .filter((candidate): candidate is { movementId: TurnMovementId; entry: MutableMovementQueueEntry } => candidate.entry !== undefined)
      .sort((a, b) => entryOrder(a.entry, b.entry) || a.movementId.localeCompare(b.movementId))[0]?.movementId;
  }

  private dischargeMovement(movementId: TurnMovementId): Array<{ vehicleId: string; movementId: TurnMovementId }> {
    const queue = this.queues.get(movementId);
    if (!queue || queue.length === 0) return [];
    let credit = this.serviceCredits.get(movementId) ?? 0;
    const released: Array<{ vehicleId: string; movementId: TurnMovementId }> = [];
    while (queue.length > 0 && credit > 1e-9) {
      const entry = queue[0];
      if (!entry) break;
      if (entry.travelerWeight > credit + 1e-9) {
        entry.travelerWeight -= credit;
        credit = 0;
        break;
      }
      credit -= entry.travelerWeight;
      queue.shift();
      released.push({ vehicleId: entry.vehicleId, movementId });
    }
    this.serviceCredits.set(movementId, credit);
    if (queue.length === 0) this.queues.delete(movementId);
    return released;
  }

  private serviceCapacityPerTick(movementId: TurnMovementId, context: IntersectionCapacityContext): number {
    const movement = this.requireMovement(movementId);
    const incoming = this.carriagewayById.get(movement.fromCarriagewayId);
    if (!incoming) return 0;
    const segment = this.segmentById.get(incoming.segmentId);
    const multiplierRaw = segment ? context.capacityMultiplierBySegment?.[segment.id] ?? 1 : 1;
    const multiplier = Number.isFinite(multiplierRaw) ? Math.max(0, Math.min(1, multiplierRaw)) : 0;
    const lanes = new Set(movement.fromLaneIds);
    const capacityPerMinute = this.authority.lanes
      .filter((lane) => lanes.has(lane.id) && lane.operatingState === 'open')
      .reduce((sum, lane) => sum + lane.baseCapacityPerMinute, 0);
    return (capacityPerMinute * multiplier) / SIMULATION_TICKS_PER_MINUTE;
  }
}
