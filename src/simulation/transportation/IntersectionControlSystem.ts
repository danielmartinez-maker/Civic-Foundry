import {
  US_INTERSECTION_POLICY,
  type IntersectionControlSnapshot,
  type IntersectionPriorityRequest,
  type JunctionControlOverride,
  type JunctionControlPlan,
  type MovementQueueEntry,
  type PedestrianCrossing,
  type PedestrianCrossingId,
  type SignalCoordinationGroup,
  type SignalTimingPlan,
} from './IntersectionControlTypes.ts';
import {
  reviewControlPlans,
  type JunctionControlPlanningInput,
} from './ControlPlanBuilder.ts';
import {
  buildConflictMatrices,
  type JunctionConflictMatrix,
} from './ConflictMatrixBuilder.ts';
import { MovementQueueStore } from './MovementQueueStore.ts';
import { buildPedestrianCrossings } from './PedestrianCrossingBuilder.ts';
import { PedestrianController } from './PedestrianController.ts';
import { PriorityController } from './PriorityController.ts';
import { SignalController } from './SignalController.ts';
import { buildSignalCoordinationGroups } from './SignalCoordinationBuilder.ts';
import { buildFixedSignalPlan } from './SignalPlanBuilder.ts';
import {
  eligibleUnsignalizedHeads,
  type CardinalApproachHeading,
  type UnsignalizedHead,
} from './UnsignalizedController.ts';
import type {
  Carriageway,
  CarriagewayId,
  Junction,
  JunctionId,
  LaneGroup,
  LaneGroupId,
  TransportNetworkAuthority,
  TurnMovement,
  TurnMovementId,
} from './TransportNetworkTypes.ts';

export type IntersectionControlDemandSnapshot = Readonly<{
  approachDemandPerMinute?: Readonly<Record<CarriagewayId, number>>;
  movementDemandPerMinute?: Readonly<Record<TurnMovementId, number>>;
  pedestrianDemandPerMinute?: Readonly<Record<JunctionId, number>>;
  pedestrianDemandByCrossing?: Readonly<Record<PedestrianCrossingId, number>>;
  crashRiskScore?: Readonly<Record<JunctionId, number>>;
  facilityTypeByJunction?: Readonly<Record<JunctionId, 'surface' | 'merge' | 'diverge' | 'rampTerminal'>>;
  protectedOnlyMovementIdsByJunction?: Readonly<Record<JunctionId, readonly TurnMovementId[]>>;
}>;

const DEFAULT_SIGNAL_CYCLE_TICKS = 600;
const DEFAULT_JUNCTION_CLEARANCE_METERS = 15;
const EPSILON = 1e-9;

function requireIntegerNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function canonicalIds(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort((a, b) => a.localeCompare(b)));
}

function topologyFingerprint(
  authority: TransportNetworkAuthority,
  laneGroups: readonly LaneGroup[],
): string {
  return JSON.stringify({
    junctions: [...authority.junctions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => [value.id, value.x, value.y, value.sourceLegacyCell ?? null]),
    segments: [...authority.segments]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => [
        value.id, value.roadClass, value.geometryRef, value.startJunctionId, value.endJunctionId,
        value.lengthMeters, value.speedLimitKph, value.condition, value.accessPolicyId,
        value.tollPolicyId ?? null, [...value.carriagewayIds].sort(),
      ]),
    carriageways: [...authority.carriageways]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => [
        value.id, value.segmentId, value.direction, value.fromJunctionId, value.toJunctionId,
        value.operatingClass, [...value.laneIds].sort(),
      ]),
    lanes: [...authority.lanes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => [
        value.id, value.carriagewayId, value.ordinal, value.kind, value.permissions,
        value.operatingState, value.baseCapacityPerMinute, value.freeFlowSpeedKph,
      ]),
    movements: [...authority.movements]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => [
        value.id, value.junctionId, value.fromCarriagewayId, value.toCarriagewayId,
        [...value.fromLaneIds].sort(), [...value.toLaneIds].sort(), value.turnKind,
        value.permissions, value.allowed, value.basePenaltyTicks,
      ]),
    laneGroups: [...laneGroups]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => [
        value.id, value.carriagewayId, [...value.laneIds].sort(), [...value.movementIds].sort(),
        value.permissions, value.capacityPerMinute, value.freeFlowSpeedKph,
      ]),
  });
}

function samePlans(a: readonly JunctionControlPlan[], b: readonly JunctionControlPlan[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cardinalHeading(junction: Junction, origin: Junction): CardinalApproachHeading {
  const dx = origin.x - junction.x;
  const dy = origin.y - junction.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function conflictCount(matrix: JunctionConflictMatrix | undefined): number {
  if (!matrix) return 0;
  let count = 0;
  for (let i = 0; i < matrix.participants.length; i += 1) {
    const a = matrix.participants[i];
    if (!a) continue;
    for (let j = i + 1; j < matrix.participants.length; j += 1) {
      const b = matrix.participants[j];
      if (b && matrix.conflicts(a, b)) count += 1;
    }
  }
  return count;
}

function canonicalPlans(plans: readonly JunctionControlPlan[]): readonly JunctionControlPlan[] {
  return Object.freeze([...plans].sort((a, b) => a.junctionId.localeCompare(b.junctionId)));
}

export class IntersectionControlSystem {
  private readonly queueStore = new MovementQueueStore();
  private readonly overridesByJunction = new Map<JunctionId, JunctionControlOverride>();
  private readonly plansByJunction = new Map<JunctionId, JunctionControlPlan>();
  private readonly movementsById = new Map<TurnMovementId, TurnMovement>();
  private readonly movementsByJunction = new Map<JunctionId, TurnMovement[]>();
  private readonly carriagewaysById = new Map<CarriagewayId, Carriageway>();
  private readonly incomingByJunction = new Map<JunctionId, Carriageway[]>();
  private readonly laneGroupsById = new Map<LaneGroupId, LaneGroup>();
  private readonly conflictByJunction = new Map<JunctionId, JunctionConflictMatrix>();
  private readonly crossingById = new Map<PedestrianCrossingId, PedestrianCrossing>();
  private readonly priorityByJunction = new Map<JunctionId, PriorityController>();
  private readonly signalByJunction = new Map<JunctionId, SignalController>();
  private readonly lastConflictReleaseTick = new Map<JunctionId, number>();

  private authority: TransportNetworkAuthority | undefined;
  private laneGroups: readonly LaneGroup[] = Object.freeze([]);
  private demand: IntersectionControlDemandSnapshot = Object.freeze({});
  private crossings: readonly PedestrianCrossing[] = Object.freeze([]);
  private coordinationGroups: readonly SignalCoordinationGroup[] = Object.freeze([]);
  private pedestrianController: PedestrianController | undefined;
  private networkFingerprint = '';
  private controlPlanRevision = 0;
  private controlRuntimeEpoch = 0;
  private lastPlanReviewTick = 0;
  private lastSyncTick = 0;
  private lastRuntimeTick: number | undefined;
  private lastServiceTick: number | undefined;

  syncNetwork(
    authority: TransportNetworkAuthority,
    laneGroups: readonly LaneGroup[],
    demand: IntersectionControlDemandSnapshot,
    tick: number,
  ): void {
    requireIntegerNonNegative(tick, 'tick');
    this.validateDemand(demand);
    const fingerprint = topologyFingerprint(authority, laneGroups);
    const topologyChanged = fingerprint !== this.networkFingerprint;

    this.authority = authority;
    this.laneGroups = Object.freeze([...laneGroups].sort((a, b) => a.id.localeCompare(b.id)));
    this.demand = demand;
    this.lastSyncTick = tick;

    if (topologyChanged) {
      this.networkFingerprint = fingerprint;
      this.reindex(authority, this.laneGroups);
      this.removeInvalidQueuedVehicles();
    }

    this.rebuildPlans(tick, topologyChanged, false);
  }

  enqueue(entry: MovementQueueEntry): boolean {
    const movement = this.movementsById.get(entry.movementId);
    if (!movement || !movement.allowed) throw new Error(`unknown or prohibited movement ${entry.movementId}`);
    for (const laneGroupId of entry.laneGroupIds) {
      const group = this.laneGroupsById.get(laneGroupId);
      if (!group) throw new Error(`unknown lane group ${laneGroupId}`);
      if (!group.movementIds.includes(entry.movementId)) {
        throw new Error(`lane group ${laneGroupId} does not serve movement ${entry.movementId}`);
      }
    }

    const plan = this.plansByJunction.get(movement.junctionId);
    const mustStop = plan?.controlType === 'allWayStop'
      || (plan?.controlType === 'twoWayStop' && plan.controlledApproachIds.includes(movement.fromCarriagewayId));
    const signalRightTurn = plan?.controlType === 'signal' && movement.turnKind === 'right';
    const stoppedSinceTick = entry.stoppedSinceTick
      ?? (mustStop || signalRightTurn ? entry.queuedTick : undefined);
    const enriched = stoppedSinceTick === undefined ? entry : Object.freeze({ ...entry, stoppedSinceTick });
    return this.queueStore.enqueue(enriched);
  }

  requiresQueue(movementId: TurnMovementId): boolean {
    const movement = this.movementsById.get(movementId);
    if (!movement || !movement.allowed) throw new Error(`unknown or prohibited movement ${movementId}`);
    const plan = this.plansByJunction.get(movement.junctionId);
    if (!plan || plan.controlType !== 'uncontrolled') return true;
    const incomingCount = this.incomingByJunction.get(movement.junctionId)?.length ?? 0;
    if (incomingCount !== 2) return true;
    const matrix = this.conflictByJunction.get(movement.junctionId);
    const peers = this.movementsByJunction.get(movement.junctionId) ?? [];
    return peers.some((peer) => peer.id !== movementId && matrix?.conflicts(movementId, peer.id) === true);
  }

  step(tick: number): readonly string[] {
    requireIntegerNonNegative(tick, 'tick');
    if (!this.authority) throw new Error('intersection control network has not been synchronized');
    if (this.lastServiceTick === tick) return this.queueStore.pendingReleasedIds();
    if (this.lastServiceTick !== undefined && tick < this.lastServiceTick) {
      throw new Error('intersection control tick cannot move backward');
    }

    this.advanceRuntimeTo(tick);
    const laneBudget = new Map<LaneGroupId, number>();
    for (const group of this.laneGroups) {
      requireFiniteNonNegative(group.capacityPerMinute, `capacityPerMinute ${group.id}`);
      laneBudget.set(group.id, group.capacityPerMinute / 600);
    }

    const entriesByJunction = new Map<JunctionId, MovementQueueEntry[]>();
    for (const entry of this.queueStore.entries()) {
      const movement = this.movementsById.get(entry.movementId);
      if (!movement) continue;
      const entries = entriesByJunction.get(movement.junctionId) ?? [];
      entries.push(entry);
      entriesByJunction.set(movement.junctionId, entries);
    }

    for (const junctionId of [...entriesByJunction.keys()].sort((a, b) => a.localeCompare(b))) {
      const entries = entriesByJunction.get(junctionId) ?? [];
      const candidates = this.eligibleEntries(junctionId, entries, tick);
      const matrix = this.conflictByJunction.get(junctionId);
      const servedMovements: TurnMovementId[] = [];

      for (const candidate of candidates) {
        if (servedMovements.some((served) => matrix?.conflicts(candidate.movementId, served) === true)) continue;
        const head = this.queueStore.peek(candidate.movementId);
        if (!head || head.vehicleId !== candidate.vehicleId) continue;
        const movementBudget = Math.min(...head.laneGroupIds.map((id) => laneBudget.get(id) ?? 0));
        const capacity = Math.min(movementBudget, head.travelerWeight);
        if (!Number.isFinite(capacity) || capacity <= EPSILON) continue;

        this.queueStore.serve(candidate.movementId, capacity);
        for (const laneGroupId of head.laneGroupIds) {
          laneBudget.set(laneGroupId, Math.max(0, (laneBudget.get(laneGroupId) ?? 0) - capacity));
        }
        servedMovements.push(candidate.movementId);
        this.lastConflictReleaseTick.set(junctionId, tick);
      }
    }

    this.lastServiceTick = tick;
    return this.queueStore.pendingReleasedIds();
  }

  acknowledge(vehicleId: string): void {
    this.queueStore.acknowledge(vehicleId);
  }

  removeVehicle(vehicleId: string): void {
    this.queueStore.removeVehicle(vehicleId);
  }

  submitPriorityRequest(request: IntersectionPriorityRequest): void {
    const movement = this.movementsById.get(request.movementId);
    if (!movement || movement.junctionId !== request.junctionId) {
      throw new Error(`priority request ${request.id} references invalid junction/movement`);
    }
    const controller = this.priorityByJunction.get(request.junctionId) ?? new PriorityController();
    controller.submit(request);
    this.priorityByJunction.set(request.junctionId, controller);
    this.controlRuntimeEpoch += 1;
  }

  setOverride(override: JunctionControlOverride): void {
    if (!this.authority) {
      this.overridesByJunction.set(override.junctionId, override);
      return;
    }
    if (!this.authority.junctions.some((junction) => junction.id === override.junctionId)) {
      throw new Error(`unknown override junction ${override.junctionId}`);
    }
    const previous = this.overridesByJunction.get(override.junctionId);
    if (previous && JSON.stringify(previous) === JSON.stringify(override)) return;
    this.overridesByJunction.set(override.junctionId, override);
    this.rebuildPlans(this.lastSyncTick, false, true);
  }

  clearOverride(junctionId: JunctionId): void {
    if (!this.overridesByJunction.delete(junctionId)) return;
    if (this.authority) this.rebuildPlans(this.lastSyncTick, false, true);
  }

  planFor(junctionId: JunctionId): JunctionControlPlan | undefined {
    return this.plansByJunction.get(junctionId);
  }

  queueLength(junctionId?: JunctionId): number {
    if (junctionId === undefined) return this.queueStore.entries().length;
    return this.queueStore.entries().filter((entry) => (
      this.movementsById.get(entry.movementId)?.junctionId === junctionId
    )).length;
  }

  snapshot(): IntersectionControlSnapshot {
    const plans = canonicalPlans([...this.plansByJunction.values()]);
    const signalStates = Object.freeze([...this.signalByJunction.values()]
      .map((controller) => controller.snapshot())
      .sort((a, b) => a.junctionId.localeCompare(b.junctionId)));
    const priorityRequests = Object.freeze([...this.priorityByJunction.values()]
      .flatMap((controller) => [...controller.snapshot()])
      .sort((a, b) => a.kind.localeCompare(b.kind)
        || a.requestedTick - b.requestedTick
        || a.id.localeCompare(b.id)));
    const overrides = Object.freeze([...this.overridesByJunction.values()]
      .sort((a, b) => a.junctionId.localeCompare(b.junctionId)));

    return Object.freeze({
      controlPlanRevision: this.controlPlanRevision,
      controlRuntimeEpoch: this.controlRuntimeEpoch,
      lastPlanReviewTick: this.lastPlanReviewTick,
      plans,
      queues: this.queueStore.snapshot(),
      signalStates,
      pedestrianStates: this.pedestrianController?.snapshot() ?? Object.freeze([]),
      priorityRequests,
      coordinationGroups: this.coordinationGroups,
      overrides,
    });
  }

  restore(
    snapshot: IntersectionControlSnapshot,
    authority: TransportNetworkAuthority,
    laneGroups: readonly LaneGroup[],
  ): void {
    requireIntegerNonNegative(snapshot.controlPlanRevision, 'controlPlanRevision');
    requireIntegerNonNegative(snapshot.controlRuntimeEpoch, 'controlRuntimeEpoch');
    requireIntegerNonNegative(snapshot.lastPlanReviewTick, 'lastPlanReviewTick');
    this.authority = authority;
    this.laneGroups = Object.freeze([...laneGroups].sort((a, b) => a.id.localeCompare(b.id)));
    this.demand = Object.freeze({});
    this.networkFingerprint = topologyFingerprint(authority, this.laneGroups);
    this.reindex(authority, this.laneGroups);

    this.plansByJunction.clear();
    for (const plan of canonicalPlans(snapshot.plans)) {
      if (!authority.junctions.some((junction) => junction.id === plan.junctionId)) {
        throw new Error(`persisted plan references unknown junction ${plan.junctionId}`);
      }
      this.validatePersistedPlan(plan);
      this.plansByJunction.set(plan.junctionId, plan);
    }

    this.overridesByJunction.clear();
    for (const override of snapshot.overrides) {
      if (!this.plansByJunction.has(override.junctionId)) {
        throw new Error(`persisted override references unknown controlled junction ${override.junctionId}`);
      }
      this.overridesByJunction.set(override.junctionId, override);
    }

    const validMovementIds = new Set(authority.movements.map((movement) => movement.id));
    const validLaneGroupIds = new Set(this.laneGroups.map((group) => group.id));
    this.queueStore.restore(snapshot.queues, validMovementIds, validLaneGroupIds);

    this.priorityByJunction.clear();
    for (const request of snapshot.priorityRequests) {
      const movement = this.movementsById.get(request.movementId);
      if (!movement || movement.junctionId !== request.junctionId) {
        throw new Error(`persisted priority request ${request.id} references invalid movement`);
      }
      const controller = this.priorityByJunction.get(request.junctionId) ?? new PriorityController();
      controller.submit(request);
      this.priorityByJunction.set(request.junctionId, controller);
    }

    for (const group of snapshot.coordinationGroups) {
      for (const junctionId of group.junctionIds) {
        if (!this.plansByJunction.has(junctionId)) {
          throw new Error(`persisted coordination group ${group.id} references unknown plan ${junctionId}`);
        }
      }
    }
    this.coordinationGroups = Object.freeze([...snapshot.coordinationGroups].sort((a, b) => a.id.localeCompare(b.id)));
    this.controlPlanRevision = snapshot.controlPlanRevision;
    this.controlRuntimeEpoch = snapshot.controlRuntimeEpoch;
    this.lastPlanReviewTick = snapshot.lastPlanReviewTick;
    this.lastSyncTick = snapshot.lastPlanReviewTick;
    this.rebuildRuntimeControllers(0);

    const signalStateByJunction = new Map(snapshot.signalStates.map((state) => [state.junctionId, state]));
    for (const [junctionId, controller] of this.signalByJunction) {
      const state = signalStateByJunction.get(junctionId);
      if (!state) throw new Error(`missing persisted signal runtime for ${junctionId}`);
      controller.restore(state);
    }
    if (signalStateByJunction.size !== this.signalByJunction.size) {
      throw new Error('persisted signal runtime contains an unknown signal controller');
    }

    if (this.pedestrianController) this.pedestrianController.restore(snapshot.pedestrianStates);
    this.lastRuntimeTick = undefined;
    this.lastServiceTick = undefined;
  }

  private validateDemand(demand: IntersectionControlDemandSnapshot): void {
    const collections = [
      demand.approachDemandPerMinute,
      demand.movementDemandPerMinute,
      demand.pedestrianDemandPerMinute,
      demand.pedestrianDemandByCrossing,
      demand.crashRiskScore,
    ];
    for (const collection of collections) {
      if (!collection) continue;
      for (const [id, value] of Object.entries(collection)) {
        requireFiniteNonNegative(value, `demand ${id}`);
      }
    }
  }

  private reindex(authority: TransportNetworkAuthority, laneGroups: readonly LaneGroup[]): void {
    this.movementsById.clear();
    this.movementsByJunction.clear();
    this.carriagewaysById.clear();
    this.incomingByJunction.clear();
    this.laneGroupsById.clear();
    this.conflictByJunction.clear();
    this.crossingById.clear();

    for (const carriageway of authority.carriageways) {
      if (this.carriagewaysById.has(carriageway.id)) throw new Error(`duplicate carriageway ${carriageway.id}`);
      this.carriagewaysById.set(carriageway.id, carriageway);
      const incoming = this.incomingByJunction.get(carriageway.toJunctionId) ?? [];
      incoming.push(carriageway);
      this.incomingByJunction.set(carriageway.toJunctionId, incoming);
    }
    for (const incoming of this.incomingByJunction.values()) incoming.sort((a, b) => a.id.localeCompare(b.id));

    for (const movement of authority.movements) {
      if (this.movementsById.has(movement.id)) throw new Error(`duplicate movement ${movement.id}`);
      this.movementsById.set(movement.id, movement);
      if (!movement.allowed) continue;
      const movements = this.movementsByJunction.get(movement.junctionId) ?? [];
      movements.push(movement);
      this.movementsByJunction.set(movement.junctionId, movements);
    }
    for (const movements of this.movementsByJunction.values()) movements.sort((a, b) => a.id.localeCompare(b.id));

    for (const group of laneGroups) {
      if (this.laneGroupsById.has(group.id)) throw new Error(`duplicate lane group ${group.id}`);
      this.laneGroupsById.set(group.id, group);
    }

    this.crossings = buildPedestrianCrossings(authority, laneGroups);
    for (const crossing of this.crossings) this.crossingById.set(crossing.id, crossing);
    for (const matrix of buildConflictMatrices(authority, this.crossings)) {
      this.conflictByJunction.set(matrix.junctionId, matrix);
    }

    for (const junctionId of [...this.priorityByJunction.keys()]) {
      if (!authority.junctions.some((junction) => junction.id === junctionId)) {
        this.priorityByJunction.delete(junctionId);
      }
    }
  }

  private removeInvalidQueuedVehicles(): void {
    for (const entry of this.queueStore.snapshot()) {
      const movement = this.movementsById.get(entry.movementId);
      const groupsValid = entry.laneGroupIds.every((id) => this.laneGroupsById.has(id));
      if (!movement || !movement.allowed || !groupsValid) this.queueStore.removeVehicle(entry.vehicleId);
    }
  }

  private planningInputs(): readonly JunctionControlPlanningInput[] {
    if (!this.authority) return Object.freeze([]);
    const inputs: JunctionControlPlanningInput[] = [];
    for (const junction of [...this.authority.junctions].sort((a, b) => a.id.localeCompare(b.id))) {
      const incoming = this.incomingByJunction.get(junction.id) ?? [];
      if (incoming.length < 2) continue;
      const movements = this.movementsByJunction.get(junction.id) ?? [];
      if (movements.length === 0) continue;

      const approaches = incoming.map((carriageway) => ({
        carriagewayId: carriageway.id,
        roadClass: carriageway.operatingClass,
        demandPerMinute: this.approachDemand(carriageway.id, movements),
      }));
      const leftTurnDemandPerMinute = movements
        .filter((movement) => movement.turnKind === 'left')
        .reduce((sum, movement) => sum + (this.demand.movementDemandPerMinute?.[movement.id] ?? 0), 0);
      inputs.push({
        junctionId: junction.id,
        approaches,
        pedestrianDemandPerMinute: this.demand.pedestrianDemandPerMinute?.[junction.id] ?? 0,
        leftTurnDemandPerMinute,
        conflictCount: conflictCount(this.conflictByJunction.get(junction.id)),
        crashRiskScore: this.demand.crashRiskScore?.[junction.id] ?? 0,
        facilityType: this.demand.facilityTypeByJunction?.[junction.id] ?? 'surface',
        ...(this.plansByJunction.get(junction.id)?.controlType === undefined
          ? {}
          : { previousControlType: this.plansByJunction.get(junction.id)!.controlType }),
        ...(this.overridesByJunction.get(junction.id) === undefined
          ? {}
          : { override: this.overridesByJunction.get(junction.id)! }),
      });
    }
    return Object.freeze(inputs);
  }

  private approachDemand(carriagewayId: CarriagewayId, movements: readonly TurnMovement[]): number {
    const direct = this.demand.approachDemandPerMinute?.[carriagewayId];
    if (direct !== undefined) return direct;
    return movements
      .filter((movement) => movement.fromCarriagewayId === carriagewayId)
      .reduce((sum, movement) => sum + (this.demand.movementDemandPerMinute?.[movement.id] ?? 0), 0);
  }

  private rebuildPlans(tick: number, topologyChanged: boolean, overrideChanged: boolean): void {
    if (!this.authority) return;
    const previous = canonicalPlans([...this.plansByJunction.values()]);
    const review = reviewControlPlans({
      tick,
      lastPlanReviewTick: this.lastPlanReviewTick,
      topologyChanged,
      overrideChanged,
      previousPlans: previous,
      inputs: this.planningInputs(),
      policy: US_INTERSECTION_POLICY,
    });
    this.lastPlanReviewTick = review.reviewedAtTick;
    const next = canonicalPlans(review.plans.map((plan) => this.ensureSignalPlan(plan)));
    const planChanged = !samePlans(previous, next);
    if (planChanged) this.controlPlanRevision += 1;

    this.plansByJunction.clear();
    for (const plan of next) this.plansByJunction.set(plan.junctionId, plan);
    this.coordinationGroups = buildSignalCoordinationGroups(
      this.authority,
      next,
      this.controlPlanRevision,
    );

    if (topologyChanged || planChanged || this.pedestrianController === undefined) {
      this.rebuildRuntimeControllers(tick);
    }
  }

  private ensureSignalPlan(plan: JunctionControlPlan): JunctionControlPlan {
    if (plan.controlType !== 'signal' || plan.phasePlan || !this.authority) return plan;
    const movements = this.movementsByJunction.get(plan.junctionId) ?? [];
    const matrix = this.conflictByJunction.get(plan.junctionId);
    if (!matrix || movements.length === 0) throw new Error(`signal junction ${plan.junctionId} lacks movement conflict authority`);
    const crossingIds = this.crossings
      .filter((crossing) => crossing.junctionId === plan.junctionId)
      .map((crossing) => crossing.id);
    const movementDemandPerMinute: Record<TurnMovementId, number> = {};
    for (const movement of movements) {
      movementDemandPerMinute[movement.id] = this.demand.movementDemandPerMinute?.[movement.id] ?? 0;
    }
    const incoming = this.incomingByJunction.get(plan.junctionId) ?? [];
    const speeds = incoming.flatMap((carriageway) => this.laneGroups
      .filter((group) => group.carriagewayId === carriageway.id)
      .map((group) => group.freeFlowSpeedKph));
    const speedKph = speeds.length === 0 ? 40 : Math.max(...speeds);
    const phasePlan = buildFixedSignalPlan({
      junctionId: plan.junctionId,
      movements,
      conflicts: matrix,
      pedestrianCrossingIds: crossingIds,
      movementDemandPerMinute,
      protectedOnlyMovementIds: this.demand.protectedOnlyMovementIdsByJunction?.[plan.junctionId],
      speedKph,
      junctionClearanceMeters: DEFAULT_JUNCTION_CLEARANCE_METERS,
      cycleTicks: DEFAULT_SIGNAL_CYCLE_TICKS,
    });
    return Object.freeze({ ...plan, phasePlan });
  }

  private rebuildRuntimeControllers(tick: number): void {
    this.signalByJunction.clear();
    this.pedestrianController = new PedestrianController(this.crossings, US_INTERSECTION_POLICY);
    const coordinationOffset = new Map<JunctionId, number>();
    for (const group of this.coordinationGroups) {
      for (const junctionId of group.junctionIds) {
        coordinationOffset.set(junctionId, group.offsetsByJunction[junctionId] ?? 0);
      }
    }

    for (const plan of canonicalPlans([...this.plansByJunction.values()])) {
      if (plan.controlType !== 'signal' || !plan.phasePlan) continue;
      const phasePlan: SignalTimingPlan = Object.freeze({
        ...plan.phasePlan,
        offsetTicks: coordinationOffset.get(plan.junctionId) ?? plan.phasePlan.offsetTicks,
      });
      const controller = new SignalController(
        plan.junctionId,
        phasePlan,
        this.movementsByJunction.get(plan.junctionId) ?? [],
        plan.policy,
      );
      controller.step(tick);
      this.signalByJunction.set(plan.junctionId, controller);
    }
    this.lastRuntimeTick = tick;
  }

  private advanceRuntimeTo(tick: number): void {
    if (this.lastRuntimeTick === undefined) {
      this.lastRuntimeTick = tick;
      return;
    }
    if (tick < this.lastRuntimeTick) throw new Error('intersection runtime tick cannot move backward');
    for (let runtimeTick = this.lastRuntimeTick + 1; runtimeTick <= tick; runtimeTick += 1) {
      for (const controller of this.signalByJunction.values()) controller.step(1);
      if (this.pedestrianController) {
        const walkCrossingIds = new Set<PedestrianCrossingId>();
        for (const controller of this.signalByJunction.values()) {
          if (controller.runtimeMode() !== 'green') continue;
          for (const crossingId of controller.activePhase().pedestrianCrossingIds) walkCrossingIds.add(crossingId);
        }
        const demandByCrossing: Record<string, number> = {};
        for (const crossingId of this.crossingById.keys()) {
          const direct = this.demand.pedestrianDemandByCrossing?.[crossingId];
          if (direct !== undefined) {
            demandByCrossing[crossingId] = direct;
            continue;
          }
          const crossing = this.crossingById.get(crossingId);
          if (!crossing) continue;
          const junctionDemand = this.demand.pedestrianDemandPerMinute?.[crossing.junctionId] ?? 0;
          const crossingCount = this.crossings.filter((value) => value.junctionId === crossing.junctionId).length;
          demandByCrossing[crossingId] = crossingCount === 0 ? 0 : junctionDemand / crossingCount / 600;
        }
        this.pedestrianController.step({ walkCrossingIds, demandByCrossing });
      }
    }
    this.lastRuntimeTick = tick;
  }

  private eligibleEntries(
    junctionId: JunctionId,
    entries: readonly MovementQueueEntry[],
    tick: number,
  ): readonly MovementQueueEntry[] {
    const plan = this.plansByJunction.get(junctionId);
    const matrix = this.conflictByJunction.get(junctionId);
    if (!plan || !matrix) return Object.freeze([]);
    let result: MovementQueueEntry[];

    if (plan.controlType === 'uncontrolled'
      || plan.controlType === 'yield'
      || plan.controlType === 'twoWayStop'
      || plan.controlType === 'allWayStop') {
      const heads: UnsignalizedHead[] = [];
      for (const entry of entries) {
        const movement = this.movementsById.get(entry.movementId);
        if (!movement) continue;
        const carriageway = this.carriagewaysById.get(movement.fromCarriagewayId);
        const junction = this.authority?.junctions.find((value) => value.id === junctionId);
        const origin = carriageway === undefined
          ? undefined
          : this.authority?.junctions.find((value) => value.id === carriageway.fromJunctionId);
        if (!carriageway || !junction || !origin) continue;
        const groupSpeeds = entry.laneGroupIds
          .map((id) => this.laneGroupsById.get(id)?.freeFlowSpeedKph)
          .filter((value): value is number => value !== undefined);
        heads.push({
          entry,
          movement,
          approachCarriagewayId: movement.fromCarriagewayId,
          approachHeading: cardinalHeading(junction, origin),
          approachSpeedKph: groupSpeeds.length === 0 ? 40 : Math.min(...groupSpeeds),
          isHeavyFreight: false,
          lastConflictReleaseTick: this.lastConflictReleaseTick.get(junctionId) ?? 0,
        });
      }
      const activePedestrianCrossingIds = new Set(this.pedestrianController?.activeCrossingIds() ?? []);
      result = eligibleUnsignalizedHeads({
        tick,
        plan,
        heads,
        conflicts: matrix,
        activePedestrianCrossingIds,
      }).map((head) => head.entry);
    } else if (plan.controlType === 'signal') {
      const controller = this.signalByJunction.get(junctionId);
      if (!controller) return Object.freeze([]);
      const activeCrossings = new Set(this.pedestrianController?.activeCrossingIds() ?? []);
      result = entries.flatMap((entry) => {
        const movement = this.movementsById.get(entry.movementId);
        if (!movement) return [];
        const pedestrianConflictOccupied = [...activeCrossings].some(
          (crossingId) => matrix.conflicts(entry.movementId, crossingId),
        );
        const stoppedTicks = entry.stoppedSinceTick === undefined ? 0 : Math.max(0, tick - entry.stoppedSinceTick);
        const state = controller.serviceStateFor(entry.movementId, { stoppedTicks, pedestrianConflictOccupied });
        const rank = state === 'protected' ? 0 : state === 'permissive' ? 1 : state === 'yield' ? 2 : -1;
        return rank < 0 ? [] : [{ entry, rank }];
      }).sort((a, b) => a.rank - b.rank
        || a.entry.queuedTick - b.entry.queuedTick
        || a.entry.movementId.localeCompare(b.entry.movementId)
        || a.entry.vehicleId.localeCompare(b.entry.vehicleId))
        .map((value) => value.entry);
    } else {
      result = [...entries].sort((a, b) => a.queuedTick - b.queuedTick
        || a.movementId.localeCompare(b.movementId)
        || a.vehicleId.localeCompare(b.vehicleId));
    }

    const priority = this.priorityByJunction.get(junctionId);
    const selected = priority?.select(tick);
    if (!priority || !selected) return Object.freeze(result);
    const signal = this.signalByJunction.get(junctionId);
    const activeMovementIds = new Set<TurnMovementId>();
    if (signal?.runtimeMode() === 'green') {
      for (const id of signal.activePhase().protectedMovementIds) activeMovementIds.add(id);
      for (const id of signal.activePhase().permissiveMovementIds) activeMovementIds.add(id);
    }
    const decision = priority.decide(tick, {
      activeMovementIds,
      conflicts: (a, b) => matrix.conflicts(a, b),
      clearanceComplete: signal === undefined || signal.runtimeMode() === 'allRed',
      requestedMovementIsActivePhase: activeMovementIds.has(selected.movementId),
      ticksUntilRequestedPhase: activeMovementIds.has(selected.movementId) ? 0 : 20,
    });
    if (decision.action === 'transition') return Object.freeze([]);
    if (decision.action === 'grant') {
      return Object.freeze(result.filter((entry) => entry.movementId === selected.movementId));
    }
    if (decision.action === 'transitAdjust') {
      result.sort((a, b) => Number(b.movementId === selected.movementId) - Number(a.movementId === selected.movementId)
        || a.queuedTick - b.queuedTick
        || a.movementId.localeCompare(b.movementId)
        || a.vehicleId.localeCompare(b.vehicleId));
    }
    return Object.freeze(result);
  }

  private validatePersistedPlan(plan: JunctionControlPlan): void {
    if (plan.controlType !== 'signal') return;
    if (!plan.phasePlan) throw new Error(`persisted signal plan ${plan.id} lacks phase timing`);
    for (const phase of plan.phasePlan.phases) {
      for (const movementId of [...phase.protectedMovementIds, ...phase.permissiveMovementIds]) {
        const movement = this.movementsById.get(movementId);
        if (!movement || movement.junctionId !== plan.junctionId) {
          throw new Error(`persisted signal phase ${phase.id} references invalid movement ${movementId}`);
        }
      }
    }
  }
}
