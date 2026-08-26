import {
  isControlledAccessRoadClass,
  type IntersectionControlPolicy,
  type JunctionControlOverride,
  type JunctionControlPlan,
  type JunctionControlType,
} from './IntersectionControlTypes.ts';
import type {
  CarriagewayId,
  JunctionId,
  RoadClass,
} from './TransportNetworkTypes.ts';

export type JunctionApproachPlanningInput = Readonly<{
  carriagewayId: CarriagewayId;
  roadClass: RoadClass;
  demandPerMinute: number;
}>;

export type JunctionControlPlanningInput = Readonly<{
  junctionId: JunctionId;
  approaches: readonly JunctionApproachPlanningInput[];
  pedestrianDemandPerMinute: number;
  leftTurnDemandPerMinute: number;
  conflictCount: number;
  crashRiskScore: number;
  facilityType: 'surface' | 'merge' | 'diverge' | 'rampTerminal';
  previousControlType?: JunctionControlType;
  override?: JunctionControlOverride;
}>;

export type ControlPlanReviewInput = Readonly<{
  tick: number;
  lastPlanReviewTick: number;
  topologyChanged: boolean;
  overrideChanged: boolean;
  previousPlans: readonly JunctionControlPlan[];
  inputs: readonly JunctionControlPlanningInput[];
  policy: IntersectionControlPolicy;
}>;

export type ControlPlanReviewResult = Readonly<{
  plans: readonly JunctionControlPlan[];
  changed: boolean;
  reviewedAtTick: number;
}>;

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function normalizedSurfaceRank(roadClass: RoadClass): number {
  switch (roadClass) {
    case 'local': return 0;
    case 'collector': return 1;
    case 'arterial':
    case 'avenue': return 2;
    case 'expressway': return 3;
    case 'highway': return 4;
  }
}

function normalizedSurfaceClass(roadClass: RoadClass): 'local' | 'collector' | 'arterial' {
  if (roadClass === 'local') return 'local';
  if (roadClass === 'collector') return 'collector';
  return 'arterial';
}

function validatePlanningInput(input: JunctionControlPlanningInput): void {
  if (input.junctionId.length === 0) throw new Error('junctionId must not be empty');
  if (input.approaches.length < 2) throw new Error('intersection control requires at least two approaches');

  const ids = new Set<string>();
  for (const approach of input.approaches) {
    if (approach.carriagewayId.length === 0) throw new Error('carriagewayId must not be empty');
    if (ids.has(approach.carriagewayId)) throw new Error(`duplicate approach ${approach.carriagewayId}`);
    ids.add(approach.carriagewayId);
    requireFiniteNonNegative(approach.demandPerMinute, `approach demand ${approach.carriagewayId}`);
  }

  requireFiniteNonNegative(input.pedestrianDemandPerMinute, 'pedestrianDemandPerMinute');
  requireFiniteNonNegative(input.leftTurnDemandPerMinute, 'leftTurnDemandPerMinute');
  requireFiniteNonNegative(input.conflictCount, 'conflictCount');
  requireFiniteNonNegative(input.crashRiskScore, 'crashRiskScore');
}

function signalSuitabilityScore(input: JunctionControlPlanningInput, hierarchyBase: number): number {
  const totalDemand = input.approaches.reduce((sum, approach) => sum + approach.demandPerMinute, 0);
  return hierarchyBase
    + Math.min(40, totalDemand * 0.25)
    + Math.min(20, input.pedestrianDemandPerMinute * 0.5)
    + Math.min(20, input.leftTurnDemandPerMinute * 0.5)
    + Math.min(20, input.conflictCount * 2)
    + Math.min(20, input.crashRiskScore * 20);
}

function majorApproach(input: JunctionControlPlanningInput): JunctionApproachPlanningInput {
  const ranked = [...input.approaches].sort((a, b) => {
    const hierarchyDelta = normalizedSurfaceRank(b.roadClass) - normalizedSurfaceRank(a.roadClass);
    if (hierarchyDelta !== 0) return hierarchyDelta;
    const demandDelta = b.demandPerMinute - a.demandPerMinute;
    if (demandDelta !== 0) return demandDelta;
    return a.carriagewayId.localeCompare(b.carriagewayId);
  });
  const first = ranked[0];
  if (!first) throw new Error('intersection control requires at least one approach');
  return first;
}

function controlledMinorApproaches(input: JunctionControlPlanningInput): readonly CarriagewayId[] {
  const highestRank = Math.max(...input.approaches.map((approach) => normalizedSurfaceRank(approach.roadClass)));
  const lowestRank = Math.min(...input.approaches.map((approach) => normalizedSurfaceRank(approach.roadClass)));

  if (highestRank !== lowestRank) {
    return Object.freeze(input.approaches
      .filter((approach) => normalizedSurfaceRank(approach.roadClass) === lowestRank)
      .map((approach) => approach.carriagewayId)
      .sort((a, b) => a.localeCompare(b)));
  }

  const major = majorApproach(input).carriagewayId;
  return Object.freeze(input.approaches
    .filter((approach) => approach.carriagewayId !== major)
    .map((approach) => approach.carriagewayId)
    .sort((a, b) => a.localeCompare(b)));
}

function allApproachIds(input: JunctionControlPlanningInput): readonly CarriagewayId[] {
  return Object.freeze(input.approaches
    .map((approach) => approach.carriagewayId)
    .sort((a, b) => a.localeCompare(b)));
}

function controlledApproachesFor(
  controlType: JunctionControlType,
  input: JunctionControlPlanningInput,
): readonly CarriagewayId[] {
  switch (controlType) {
    case 'uncontrolled': return Object.freeze([]);
    case 'yield':
    case 'twoWayStop': return controlledMinorApproaches(input);
    case 'allWayStop':
    case 'signal':
    case 'merge':
    case 'diverge':
    case 'rampTerminal': return allApproachIds(input);
  }
}

function classPair(input: JunctionControlPlanningInput): readonly ['local' | 'collector' | 'arterial', 'local' | 'collector' | 'arterial'] {
  const ordered = input.approaches
    .map((approach) => normalizedSurfaceClass(approach.roadClass))
    .sort((a, b) => {
      const ranks = { local: 0, collector: 1, arterial: 2 } as const;
      return ranks[a] - ranks[b];
    });
  const low = ordered[0];
  const high = ordered[ordered.length - 1];
  if (!low || !high) throw new Error('intersection control requires approaches');
  return [low, high];
}

function automaticSurfaceControlType(
  input: JunctionControlPlanningInput,
  policy: IntersectionControlPolicy,
): JunctionControlType {
  const [low, high] = classPair(input);
  const totalDemand = input.approaches.reduce((sum, approach) => sum + approach.demandPerMinute, 0);

  if (low === 'local' && high === 'local') {
    return totalDemand < 20 ? 'uncontrolled' : 'yield';
  }

  if (low === 'local' && high === 'collector') {
    const minorDemand = input.approaches
      .filter((approach) => normalizedSurfaceClass(approach.roadClass) === 'local')
      .reduce((sum, approach) => sum + approach.demandPerMinute, 0);
    return minorDemand < 20 ? 'yield' : 'twoWayStop';
  }

  if (low === 'local' && high === 'arterial') return 'twoWayStop';

  if (low === 'collector' && high === 'collector') {
    const score = signalSuitabilityScore(input, 50);
    if (input.previousControlType === 'allWayStop' && score >= policy.allWayStopExitScore) {
      return 'allWayStop';
    }
    return score >= policy.allWayStopEnterScore ? 'allWayStop' : 'twoWayStop';
  }

  if (low === 'collector' && high === 'arterial') {
    const score = signalSuitabilityScore(input, 65);
    if (input.previousControlType === 'signal' && score >= policy.signalExitScore) return 'signal';
    return score >= policy.signalEnterScore ? 'signal' : 'twoWayStop';
  }

  if (low === 'arterial' && high === 'arterial') {
    const score = signalSuitabilityScore(input, 80);
    if (input.previousControlType === 'signal' && score >= policy.signalExitScore) return 'signal';
    return score >= policy.signalEnterScore ? 'signal' : 'twoWayStop';
  }

  return 'twoWayStop';
}

function withOverridePolicy(
  policy: IntersectionControlPolicy,
  override: JunctionControlOverride | undefined,
): IntersectionControlPolicy {
  if (override?.rightTurnOnRed === undefined) return policy;
  return Object.freeze({ ...policy, rightTurnOnRed: override.rightTurnOnRed });
}

export function buildJunctionControlPlan(
  input: JunctionControlPlanningInput,
  policy: IntersectionControlPolicy,
): JunctionControlPlan {
  validatePlanningInput(input);

  const hasControlledAccess = input.approaches.some((approach) => isControlledAccessRoadClass(approach.roadClass));
  if (input.facilityType === 'surface' && hasControlledAccess) {
    throw new Error('controlled-access highway/expressway cannot use ordinary at-grade surface intersection control');
  }

  if (input.override && input.override.junctionId !== input.junctionId) {
    throw new Error(`override junction ${input.override.junctionId} does not match ${input.junctionId}`);
  }

  let controlType: JunctionControlType;
  let source: JunctionControlPlan['source'] = 'automatic';

  if (input.facilityType !== 'surface') {
    if (input.override && input.override.controlType !== input.facilityType) {
      throw new Error(`override ${input.override.controlType} is illegal for ${input.facilityType} facility`);
    }
    controlType = input.facilityType;
    source = input.override ? 'override' : 'automatic';
  } else if (input.override) {
    if (input.override.controlType === 'merge'
      || input.override.controlType === 'diverge'
      || input.override.controlType === 'rampTerminal') {
      throw new Error(`${input.override.controlType} override requires corresponding facility geometry`);
    }
    controlType = input.override.controlType;
    source = 'override';
  } else {
    controlType = automaticSurfaceControlType(input, policy);
  }

  return Object.freeze({
    id: `icp:${input.junctionId}`,
    junctionId: input.junctionId,
    controlType,
    source,
    controlledApproachIds: controlledApproachesFor(controlType, input),
    ...(input.override?.phasePlan ? { phasePlan: input.override.phasePlan } : {}),
    policy: withOverridePolicy(policy, input.override),
  });
}

function canonicalPlans(plans: readonly JunctionControlPlan[]): readonly JunctionControlPlan[] {
  return Object.freeze([...plans].sort((a, b) => a.id.localeCompare(b.id)));
}

function samePlans(a: readonly JunctionControlPlan[], b: readonly JunctionControlPlan[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function reviewControlPlans(input: ControlPlanReviewInput): ControlPlanReviewResult {
  requireFiniteNonNegative(input.tick, 'tick');
  requireFiniteNonNegative(input.lastPlanReviewTick, 'lastPlanReviewTick');
  if (input.tick < input.lastPlanReviewTick) {
    throw new Error('tick must be greater than or equal to lastPlanReviewTick');
  }

  const previous = canonicalPlans(input.previousPlans);
  const due = input.topologyChanged
    || input.overrideChanged
    || input.tick - input.lastPlanReviewTick >= input.policy.controlReviewTicks;

  if (!due) {
    return Object.freeze({
      plans: previous,
      changed: false,
      reviewedAtTick: input.lastPlanReviewTick,
    });
  }

  const previousByJunction = new Map(previous.map((plan) => [plan.junctionId, plan]));
  const next = canonicalPlans(input.inputs.map((planningInput) => {
    const previousPlan = previousByJunction.get(planningInput.junctionId);
    const previousControlType = planningInput.previousControlType ?? previousPlan?.controlType;
    return buildJunctionControlPlan({
      ...planningInput,
      ...(previousControlType === undefined ? {} : { previousControlType }),
    }, input.policy);
  }));

  return Object.freeze({
    plans: next,
    changed: !samePlans(previous, next),
    reviewedAtTick: input.tick,
  });
}
