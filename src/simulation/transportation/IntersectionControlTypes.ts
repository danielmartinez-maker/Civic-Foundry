import type {
  CarriagewayId,
  JunctionId,
  LaneGroupId,
  RoadClass,
  TurnMovementId,
} from './TransportNetworkTypes.ts';

export type JunctionControlType =
  | 'uncontrolled'
  | 'yield'
  | 'twoWayStop'
  | 'allWayStop'
  | 'signal'
  | 'merge'
  | 'diverge'
  | 'rampTerminal';

export type MovementServiceState =
  | 'prohibited'
  | 'stop'
  | 'yield'
  | 'permissive'
  | 'protected'
  | 'clearance';

export type IntersectionPriority = 'normal' | 'transit' | 'emergency';
export type PedestrianSignalState = 'dontWalk' | 'walk' | 'change' | 'clearance';
export type SignalPhaseId = string;
export type PedestrianCrossingId = string;
export type CoordinationGroupId = string;

export type IntersectionControlPolicy = Readonly<{
  rightTurnOnRed: boolean;
  minimumStopTicks: number;
  controlReviewTicks: number;
  signalEnterScore: number;
  signalExitScore: number;
  allWayStopEnterScore: number;
  allWayStopExitScore: number;
  pedestrianWalkTicks: number;
  pedestrianWalkingSpeedMps: number;
}>;

export const US_INTERSECTION_POLICY: IntersectionControlPolicy = Object.freeze({
  rightTurnOnRed: true,
  minimumStopTicks: 10,
  controlReviewTicks: 6000,
  signalEnterScore: 100,
  signalExitScore: 80,
  allWayStopEnterScore: 70,
  allWayStopExitScore: 55,
  pedestrianWalkTicks: 70,
  pedestrianWalkingSpeedMps: 1.1,
});

export type MovementQueueEntry = Readonly<{
  vehicleId: string;
  movementId: TurnMovementId;
  laneGroupIds: readonly LaneGroupId[];
  travelerWeight: number;
  queuedTick: number;
  priority: IntersectionPriority;
  stoppedSinceTick?: number;
  released?: boolean;
}>;

export type SignalPhase = Readonly<{
  id: SignalPhaseId;
  protectedMovementIds: readonly TurnMovementId[];
  permissiveMovementIds: readonly TurnMovementId[];
  pedestrianCrossingIds: readonly PedestrianCrossingId[];
  greenTicks: number;
  yellowTicks: number;
  allRedTicks: number;
}>;

export type SignalTimingPlan = Readonly<{
  cycleTicks: number;
  offsetTicks: number;
  phases: readonly SignalPhase[];
}>;

export type SignalRuntimeState = Readonly<{
  junctionId: JunctionId;
  phaseId: SignalPhaseId;
  phaseElapsedTicks: number;
  cyclePositionTicks: number;
}>;

export type PedestrianCrossing = Readonly<{
  id: PedestrianCrossingId;
  junctionId: JunctionId;
  crossedCarriagewayIds: readonly CarriagewayId[];
  conflictingMovementIds: readonly TurnMovementId[];
  lengthMeters: number;
}>;

export type PedestrianRuntimeState = Readonly<{
  crossingId: PedestrianCrossingId;
  state: PedestrianSignalState;
  stateElapsedTicks: number;
}>;

export type JunctionControlPlan = Readonly<{
  id: string;
  junctionId: JunctionId;
  controlType: JunctionControlType;
  source: 'automatic' | 'override';
  controlledApproachIds: readonly CarriagewayId[];
  phasePlan?: SignalTimingPlan;
  policy: IntersectionControlPolicy;
}>;

export type JunctionPlanningMetrics = Readonly<{
  junctionId: JunctionId;
  approachDemand: number;
  queuedDelayTicks: number;
  pedestrianDemand: number;
  leftTurnDemand: number;
  averageApproachSpeedMps: number;
  crashHistoryScore?: number;
}>;

export type ControlPlanningMetricsSnapshot = Readonly<{
  tick: number;
  junctions: readonly JunctionPlanningMetrics[];
}>;

export type JunctionControlOverride = Readonly<{
  junctionId: JunctionId;
  controlType: JunctionControlType;
  phasePlan?: SignalTimingPlan;
  rightTurnOnRed?: boolean;
}>;

export type CoordinationGroup = Readonly<{
  id: CoordinationGroupId;
  junctionIds: readonly JunctionId[];
  cycleTicks: number;
  offsetsByJunction: Readonly<Record<JunctionId, number>>;
}>;

export type PriorityRequest = Readonly<{
  vehicleId: string;
  junctionId: JunctionId;
  movementId: TurnMovementId;
  priority: 'transit' | 'emergency';
  requestedTick: number;
}>;

export type IntersectionControlSnapshot = Readonly<{
  lastReviewTick: number;
  plans: readonly JunctionControlPlan[];
  queues: readonly MovementQueueEntry[];
  signalStates: readonly SignalRuntimeState[];
  pedestrianStates: readonly PedestrianRuntimeState[];
  overrides: readonly JunctionControlOverride[];
  coordinationGroups: readonly CoordinationGroup[];
  priorityRequests: readonly PriorityRequest[];
}>;

export function isControlledAccessRoadClass(roadClass: RoadClass): boolean {
  return roadClass === 'expressway' || roadClass === 'highway';
}

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function requireNonEmpty(value: string, name: string): void {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

export function validateIntersectionPolicy(policy: IntersectionControlPolicy): void {
  requireFiniteNonNegative(policy.minimumStopTicks, 'minimumStopTicks');
  requireFiniteNonNegative(policy.controlReviewTicks, 'controlReviewTicks');
  requireFiniteNonNegative(policy.signalEnterScore, 'signalEnterScore');
  requireFiniteNonNegative(policy.signalExitScore, 'signalExitScore');
  requireFiniteNonNegative(policy.allWayStopEnterScore, 'allWayStopEnterScore');
  requireFiniteNonNegative(policy.allWayStopExitScore, 'allWayStopExitScore');
  requireFiniteNonNegative(policy.pedestrianWalkTicks, 'pedestrianWalkTicks');
  requireFiniteNonNegative(policy.pedestrianWalkingSpeedMps, 'pedestrianWalkingSpeedMps');
}

export function validateMovementQueueEntry(entry: MovementQueueEntry): void {
  requireNonEmpty(entry.vehicleId, 'vehicleId');
  requireNonEmpty(entry.movementId, 'movementId');
  if (entry.laneGroupIds.length === 0) {
    throw new Error('laneGroupIds must contain at least one lane group');
  }
  for (const laneGroupId of entry.laneGroupIds) {
    requireNonEmpty(laneGroupId, 'laneGroupId');
  }
  requireFiniteNonNegative(entry.travelerWeight, 'travelerWeight');
  requireFiniteNonNegative(entry.queuedTick, 'queuedTick');
  if (entry.stoppedSinceTick !== undefined) {
    requireFiniteNonNegative(entry.stoppedSinceTick, 'stoppedSinceTick');
  }
}
