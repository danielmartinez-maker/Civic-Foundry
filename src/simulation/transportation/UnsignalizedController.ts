import type {
  JunctionControlPlan,
  MovementQueueEntry,
  PedestrianCrossingId,
} from './IntersectionControlTypes.ts';
import type { JunctionConflictMatrix } from './ConflictMatrixBuilder.ts';
import type {
  CarriagewayId,
  TurnKind,
  TurnMovement,
} from './TransportNetworkTypes.ts';

export type CardinalApproachHeading = 'north' | 'east' | 'south' | 'west';

export type UnsignalizedHead = Readonly<{
  entry: MovementQueueEntry;
  movement: TurnMovement;
  approachCarriagewayId: CarriagewayId;
  approachHeading: CardinalApproachHeading;
  approachSpeedKph: number;
  isHeavyFreight: boolean;
  lastConflictReleaseTick: number;
}>;

export type UnsignalizedControlContext = Readonly<{
  tick: number;
  plan: JunctionControlPlan;
  heads: readonly UnsignalizedHead[];
  conflicts: JunctionConflictMatrix;
  activePedestrianCrossingIds: ReadonlySet<PedestrianCrossingId>;
}>;

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

export function requiredGapTicks(
  turnKind: TurnKind,
  approachSpeedKph: number,
  isHeavyFreight: boolean,
): number {
  requireFiniteNonNegative(approachSpeedKph, 'approachSpeedKph');
  const baseGapTicks = turnKind === 'right' ? 20 : turnKind === 'through' ? 30 : 40;
  const speedPenalty = Math.max(0, Math.round((approachSpeedKph - 40) / 10)) * 5;
  const heavyPenalty = isHeavyFreight ? 10 : 0;
  return baseGapTicks + speedPenalty + heavyPenalty;
}

function isSupportedControlType(plan: JunctionControlPlan): boolean {
  return plan.controlType === 'uncontrolled'
    || plan.controlType === 'yield'
    || plan.controlType === 'twoWayStop'
    || plan.controlType === 'allWayStop';
}

function requiresStop(plan: JunctionControlPlan, head: UnsignalizedHead, controlled: ReadonlySet<string>): boolean {
  return plan.controlType === 'allWayStop'
    || (plan.controlType === 'twoWayStop' && controlled.has(head.approachCarriagewayId));
}

function requiresGap(plan: JunctionControlPlan, head: UnsignalizedHead, controlled: ReadonlySet<string>): boolean {
  if (plan.controlType === 'allWayStop') return true;
  return (plan.controlType === 'yield' || plan.controlType === 'twoWayStop')
    && controlled.has(head.approachCarriagewayId);
}

function pedestrianBlocks(
  head: UnsignalizedHead,
  conflicts: JunctionConflictMatrix,
  activePedestrianCrossingIds: ReadonlySet<PedestrianCrossingId>,
): boolean {
  for (const crossingId of activePedestrianCrossingIds) {
    if (conflicts.conflicts(head.movement.id, crossingId)) return true;
  }
  return false;
}

function validateHead(head: UnsignalizedHead): void {
  requireFiniteNonNegative(head.entry.queuedTick, `queuedTick ${head.entry.vehicleId}`);
  requireFiniteNonNegative(head.approachSpeedKph, `approachSpeedKph ${head.entry.vehicleId}`);
  requireFiniteNonNegative(head.lastConflictReleaseTick, `lastConflictReleaseTick ${head.entry.vehicleId}`);
  if (head.entry.stoppedSinceTick !== undefined) {
    requireFiniteNonNegative(head.entry.stoppedSinceTick, `stoppedSinceTick ${head.entry.vehicleId}`);
  }
  if (head.entry.movementId !== head.movement.id) {
    throw new Error(`queue movement ${head.entry.movementId} does not match ${head.movement.id}`);
  }
  if (head.approachCarriagewayId !== head.movement.fromCarriagewayId) {
    throw new Error(`approach ${head.approachCarriagewayId} does not match movement ${head.movement.id}`);
  }
}

function intrinsicallyReady(
  tick: number,
  plan: JunctionControlPlan,
  head: UnsignalizedHead,
  controlled: ReadonlySet<string>,
  conflicts: JunctionConflictMatrix,
  activePedestrianCrossingIds: ReadonlySet<PedestrianCrossingId>,
): boolean {
  if (requiresStop(plan, head, controlled)) {
    const stoppedSinceTick = head.entry.stoppedSinceTick;
    if (stoppedSinceTick === undefined || tick - stoppedSinceTick < plan.policy.minimumStopTicks) return false;
  }

  if (requiresGap(plan, head, controlled)) {
    const gap = requiredGapTicks(head.movement.turnKind, head.approachSpeedKph, head.isHeavyFreight);
    if (tick - head.lastConflictReleaseTick < gap) return false;
  }

  return !pedestrianBlocks(head, conflicts, activePedestrianCrossingIds);
}

function stableHeadCompare(a: UnsignalizedHead, b: UnsignalizedHead): number {
  return a.entry.queuedTick - b.entry.queuedTick
    || a.movement.id.localeCompare(b.movement.id)
    || a.entry.vehicleId.localeCompare(b.entry.vehicleId);
}

const RIGHT_SIDE_HEADING: Readonly<Record<CardinalApproachHeading, CardinalApproachHeading>> = Object.freeze({
  north: 'west',
  east: 'north',
  south: 'east',
  west: 'south',
});

function geometricRightConflictCount(
  candidate: UnsignalizedHead,
  candidates: readonly UnsignalizedHead[],
  conflicts: JunctionConflictMatrix,
): number {
  const rightHeading = RIGHT_SIDE_HEADING[candidate.approachHeading];
  let count = 0;
  for (const other of candidates) {
    if (other.entry.vehicleId === candidate.entry.vehicleId) continue;
    if (other.approachHeading !== rightHeading) continue;
    if (conflicts.conflicts(candidate.movement.id, other.movement.id)) count += 1;
  }
  return count;
}

function turnYieldRank(turnKind: TurnKind): number {
  return turnKind === 'left' || turnKind === 'u-turn' ? 1 : 0;
}

function allWayStopCompare(
  a: UnsignalizedHead,
  b: UnsignalizedHead,
  candidates: readonly UnsignalizedHead[],
  conflicts: JunctionConflictMatrix,
  minimumStopTicks: number,
): number {
  const aCompletedStopTick = (a.entry.stoppedSinceTick ?? Number.POSITIVE_INFINITY) + minimumStopTicks;
  const bCompletedStopTick = (b.entry.stoppedSinceTick ?? Number.POSITIVE_INFINITY) + minimumStopTicks;
  return aCompletedStopTick - bCompletedStopTick
    || geometricRightConflictCount(a, candidates, conflicts) - geometricRightConflictCount(b, candidates, conflicts)
    || turnYieldRank(a.movement.turnKind) - turnYieldRank(b.movement.turnKind)
    || a.movement.id.localeCompare(b.movement.id)
    || a.entry.vehicleId.localeCompare(b.entry.vehicleId);
}

function priorityCompare(
  plan: JunctionControlPlan,
  controlled: ReadonlySet<string>,
  candidates: readonly UnsignalizedHead[],
  conflicts: JunctionConflictMatrix,
  a: UnsignalizedHead,
  b: UnsignalizedHead,
): number {
  if (plan.controlType === 'allWayStop') {
    return allWayStopCompare(a, b, candidates, conflicts, plan.policy.minimumStopTicks);
  }

  if (plan.controlType === 'yield' || plan.controlType === 'twoWayStop') {
    const aControlled = controlled.has(a.approachCarriagewayId) ? 1 : 0;
    const bControlled = controlled.has(b.approachCarriagewayId) ? 1 : 0;
    if (aControlled !== bControlled) return aControlled - bControlled;
  }

  return stableHeadCompare(a, b);
}

export function eligibleUnsignalizedHeads(context: UnsignalizedControlContext): readonly UnsignalizedHead[] {
  requireFiniteNonNegative(context.tick, 'tick');
  if (!isSupportedControlType(context.plan)) {
    throw new Error(`UnsignalizedController cannot serve ${context.plan.controlType} control`);
  }
  if (context.conflicts.junctionId !== context.plan.junctionId) {
    throw new Error(`conflict matrix ${context.conflicts.junctionId} does not match ${context.plan.junctionId}`);
  }

  const controlled = new Set<string>(context.plan.controlledApproachIds);
  for (const head of context.heads) validateHead(head);

  const candidates = context.heads.filter((head) => intrinsicallyReady(
    context.tick,
    context.plan,
    head,
    controlled,
    context.conflicts,
    context.activePedestrianCrossingIds,
  ));

  candidates.sort((a, b) => priorityCompare(
    context.plan,
    controlled,
    candidates,
    context.conflicts,
    a,
    b,
  ));

  const eligible: UnsignalizedHead[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;

    let blocked = false;
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex += 1) {
      const higherPriority = candidates[earlierIndex];
      if (!higherPriority) continue;
      if (context.conflicts.conflicts(candidate.movement.id, higherPriority.movement.id)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) eligible.push(candidate);
  }

  return Object.freeze(eligible);
}
