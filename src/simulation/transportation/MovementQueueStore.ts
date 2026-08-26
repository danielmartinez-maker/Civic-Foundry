import {
  validateMovementQueueEntry,
  type IntersectionPriority,
  type MovementQueueEntry,
} from './IntersectionControlTypes.ts';
import type { LaneGroupId, TurnMovementId } from './TransportNetworkTypes.ts';

export type MovementQueueSnapshot = readonly MovementQueueEntry[];

type MutableEntry = {
  vehicleId: string;
  movementId: TurnMovementId;
  laneGroupIds: LaneGroupId[];
  travelerWeight: number;
  queuedTick: number;
  priority: IntersectionPriority;
  stoppedSinceTick?: number;
};

type PendingRelease = MutableEntry;

const EPSILON = 1e-9;

function compareQueueEntries(a: MutableEntry, b: MutableEntry): number {
  return a.queuedTick - b.queuedTick || a.vehicleId.localeCompare(b.vehicleId);
}

function compareSnapshotEntries(a: MovementQueueEntry, b: MovementQueueEntry): number {
  return a.movementId.localeCompare(b.movementId)
    || a.queuedTick - b.queuedTick
    || a.vehicleId.localeCompare(b.vehicleId);
}

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function canonicalLaneGroupIds(ids: readonly LaneGroupId[]): LaneGroupId[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function toMutable(entry: MovementQueueEntry, travelerWeight = entry.travelerWeight): MutableEntry {
  const base = {
    vehicleId: entry.vehicleId,
    movementId: entry.movementId,
    laneGroupIds: canonicalLaneGroupIds(entry.laneGroupIds),
    travelerWeight,
    queuedTick: entry.queuedTick,
    priority: entry.priority,
  };
  return entry.stoppedSinceTick === undefined
    ? base
    : { ...base, stoppedSinceTick: entry.stoppedSinceTick };
}

function cloneEntry(entry: MutableEntry, released = false): MovementQueueEntry {
  const base = {
    vehicleId: entry.vehicleId,
    movementId: entry.movementId,
    laneGroupIds: Object.freeze(canonicalLaneGroupIds(entry.laneGroupIds)),
    travelerWeight: released ? 0 : entry.travelerWeight,
    queuedTick: entry.queuedTick,
    priority: entry.priority,
  };

  if (entry.stoppedSinceTick === undefined) {
    return Object.freeze(released ? { ...base, released: true } : base);
  }
  return Object.freeze(released
    ? { ...base, stoppedSinceTick: entry.stoppedSinceTick, released: true }
    : { ...base, stoppedSinceTick: entry.stoppedSinceTick });
}

export class MovementQueueStore {
  private readonly queuesByMovement = new Map<TurnMovementId, MutableEntry[]>();
  private readonly vehicleLocation = new Map<string, TurnMovementId>();
  private readonly pendingReleased = new Map<string, PendingRelease>();

  enqueue(entry: MovementQueueEntry): boolean {
    if (entry.released) throw new Error('released movement queue entries are snapshot-only');
    validateMovementQueueEntry(entry);
    if (entry.travelerWeight <= 0) throw new Error('travelerWeight must be greater than zero when queued');
    if (this.hasVehicle(entry.vehicleId)) return false;

    const mutable = toMutable(entry);
    const queue = this.queuesByMovement.get(entry.movementId) ?? [];
    queue.push(mutable);
    queue.sort(compareQueueEntries);
    this.queuesByMovement.set(entry.movementId, queue);
    this.vehicleLocation.set(entry.vehicleId, entry.movementId);
    return true;
  }

  peek(movementId: TurnMovementId): MovementQueueEntry | undefined {
    const head = this.queuesByMovement.get(movementId)?.[0];
    return head === undefined ? undefined : cloneEntry(head);
  }

  entries(movementId?: TurnMovementId): readonly MovementQueueEntry[] {
    if (movementId !== undefined) {
      const queue = this.queuesByMovement.get(movementId) ?? [];
      return Object.freeze(queue.map((entry) => cloneEntry(entry)));
    }

    const result: MovementQueueEntry[] = [];
    for (const id of [...this.queuesByMovement.keys()].sort((a, b) => a.localeCompare(b))) {
      const queue = this.queuesByMovement.get(id) ?? [];
      for (const entry of queue) result.push(cloneEntry(entry));
    }
    return Object.freeze(result);
  }

  serve(movementId: TurnMovementId, capacityWeight: number): readonly string[] {
    requireFiniteNonNegative(capacityWeight, 'capacityWeight');
    if (capacityWeight <= EPSILON) return Object.freeze([]);

    const queue = this.queuesByMovement.get(movementId);
    if (!queue || queue.length === 0) return Object.freeze([]);

    let remaining = capacityWeight;
    const releasedIds: string[] = [];
    while (queue.length > 0 && remaining > EPSILON) {
      const head = queue[0];
      if (!head) break;

      if (head.travelerWeight > remaining + EPSILON) {
        head.travelerWeight -= remaining;
        remaining = 0;
        break;
      }

      remaining -= head.travelerWeight;
      queue.shift();
      this.vehicleLocation.delete(head.vehicleId);
      this.pendingReleased.set(head.vehicleId, { ...head, laneGroupIds: [...head.laneGroupIds], travelerWeight: 0 });
      releasedIds.push(head.vehicleId);
    }

    if (queue.length === 0) this.queuesByMovement.delete(movementId);
    return Object.freeze(releasedIds);
  }

  acknowledge(vehicleId: string): void {
    this.pendingReleased.delete(vehicleId);
  }

  removeVehicle(vehicleId: string): void {
    const movementId = this.vehicleLocation.get(vehicleId);
    if (movementId !== undefined) {
      const queue = this.queuesByMovement.get(movementId);
      if (queue) {
        const index = queue.findIndex((entry) => entry.vehicleId === vehicleId);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) this.queuesByMovement.delete(movementId);
      }
      this.vehicleLocation.delete(vehicleId);
    }
    this.pendingReleased.delete(vehicleId);
  }

  hasVehicle(vehicleId: string): boolean {
    return this.vehicleLocation.has(vehicleId) || this.pendingReleased.has(vehicleId);
  }

  pendingReleasedIds(): readonly string[] {
    return Object.freeze([...this.pendingReleased.keys()].sort((a, b) => a.localeCompare(b)));
  }

  snapshot(): MovementQueueSnapshot {
    const result: MovementQueueEntry[] = [];
    for (const queue of this.queuesByMovement.values()) {
      for (const entry of queue) result.push(cloneEntry(entry));
    }
    for (const entry of this.pendingReleased.values()) result.push(cloneEntry(entry, true));
    result.sort(compareSnapshotEntries);
    return Object.freeze(result);
  }

  restore(
    snapshot: MovementQueueSnapshot,
    validMovementIds: ReadonlySet<string>,
    validLaneGroupIds: ReadonlySet<string>,
  ): void {
    const nextQueues = new Map<TurnMovementId, MutableEntry[]>();
    const nextVehicleLocation = new Map<string, TurnMovementId>();
    const nextPendingReleased = new Map<string, PendingRelease>();
    const seenVehicles = new Set<string>();

    for (const entry of snapshot) {
      validateMovementQueueEntry(entry);
      if (seenVehicles.has(entry.vehicleId)) {
        throw new Error(`duplicate movement queue vehicle ${entry.vehicleId}`);
      }
      seenVehicles.add(entry.vehicleId);

      if (!validMovementIds.has(entry.movementId)) {
        throw new Error(`unknown movement ${entry.movementId}`);
      }
      for (const laneGroupId of entry.laneGroupIds) {
        if (!validLaneGroupIds.has(laneGroupId)) {
          throw new Error(`unknown lane group ${laneGroupId}`);
        }
      }

      if (entry.released) {
        if (entry.travelerWeight !== 0) {
          throw new Error(`released vehicle ${entry.vehicleId} must have zero travelerWeight`);
        }
        nextPendingReleased.set(entry.vehicleId, toMutable(entry, 0));
        continue;
      }

      if (entry.travelerWeight <= 0) {
        throw new Error(`queued vehicle ${entry.vehicleId} must have positive travelerWeight`);
      }
      const mutable = toMutable(entry);
      const queue = nextQueues.get(entry.movementId) ?? [];
      queue.push(mutable);
      nextQueues.set(entry.movementId, queue);
      nextVehicleLocation.set(entry.vehicleId, entry.movementId);
    }

    for (const queue of nextQueues.values()) queue.sort(compareQueueEntries);

    this.queuesByMovement.clear();
    this.vehicleLocation.clear();
    this.pendingReleased.clear();
    for (const [movementId, queue] of nextQueues) this.queuesByMovement.set(movementId, queue);
    for (const [vehicleId, movementId] of nextVehicleLocation) this.vehicleLocation.set(vehicleId, movementId);
    for (const [vehicleId, entry] of nextPendingReleased) this.pendingReleased.set(vehicleId, entry);
  }
}
