import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_INTERSECTION_POLICY,
  type JunctionControlPlan,
  type JunctionControlOverride,
} from '../src/simulation/transportation/IntersectionControlTypes.ts';
import {
  buildJunctionControlPlan,
  reviewControlPlans,
  type JunctionControlPlanningInput,
} from '../src/simulation/transportation/ControlPlanBuilder.ts';
import { buildFixedSignalPlan } from '../src/simulation/transportation/SignalPlanBuilder.ts';
import type { JunctionConflictMatrix } from '../src/simulation/transportation/ConflictMatrixBuilder.ts';
import type { RoadClass, TurnMovement } from '../src/simulation/transportation/TransportNetworkTypes.ts';

function planningInput(
  classes: readonly RoadClass[],
  demands: readonly number[],
  extra: Partial<JunctionControlPlanningInput> = {},
): JunctionControlPlanningInput {
  return {
    junctionId: 'j:test',
    approaches: classes.map((roadClass, index) => ({
      carriagewayId: `cw:${String(index).padStart(2, '0')}`,
      roadClass,
      demandPerMinute: demands[index] ?? 0,
    })),
    pedestrianDemandPerMinute: 0,
    leftTurnDemandPerMinute: 0,
    conflictCount: 0,
    crashRiskScore: 0,
    facilityType: 'surface',
    ...extra,
  };
}

function controlType(input: JunctionControlPlanningInput): string {
  return buildJunctionControlPlan(input, US_INTERSECTION_POLICY).controlType;
}

test('automatic U.S. hierarchy rules use the exact local and collector demand thresholds', () => {
  assert.equal(controlType(planningInput(['local', 'local'], [10, 9])), 'uncontrolled');

  const busyLocal = buildJunctionControlPlan(planningInput(['local', 'local'], [12, 8]), US_INTERSECTION_POLICY);
  assert.equal(busyLocal.controlType, 'yield');
  assert.deepEqual(busyLocal.controlledApproachIds, ['cw:01']);

  assert.equal(controlType(planningInput(['local', 'collector'], [19, 5])), 'yield');
  assert.equal(controlType(planningInput(['local', 'collector'], [20, 5])), 'twoWayStop');
  assert.equal(controlType(planningInput(['local', 'arterial'], [1, 1])), 'twoWayStop');

  assert.equal(controlType(planningInput(['collector', 'collector'], [39, 40])), 'twoWayStop');
  assert.equal(controlType(planningInput(['collector', 'collector'], [40, 40])), 'allWayStop');
});

test('collector-arterial and arterial-arterial signals enter only at score 100', () => {
  assert.equal(controlType(planningInput(['collector', 'arterial'], [69, 70])), 'twoWayStop');
  assert.equal(controlType(planningInput(['collector', 'arterial'], [70, 70])), 'signal');

  assert.equal(controlType(planningInput(['arterial', 'arterial'], [39, 40])), 'twoWayStop');
  assert.equal(controlType(planningInput(['arterial', 'arterial'], [40, 40])), 'signal');
});

test('equal hierarchy chooses greater demand as major and stable carriageway id breaks exact ties', () => {
  const unequal = buildJunctionControlPlan(planningInput(['local', 'local'], [8, 12]), US_INTERSECTION_POLICY);
  assert.deepEqual(unequal.controlledApproachIds, ['cw:00']);

  const tied = buildJunctionControlPlan(planningInput(['local', 'local'], [10, 10]), US_INTERSECTION_POLICY);
  assert.deepEqual(tied.controlledApproachIds, ['cw:01']);
});

test('signal and all-way-stop hysteresis use exit thresholds only at review', () => {
  assert.equal(controlType(planningInput(['collector', 'arterial'], [45, 55], { previousControlType: 'signal' })), 'signal');
  assert.equal(controlType(planningInput(['collector', 'arterial'], [29, 30], { previousControlType: 'signal' })), 'twoWayStop');

  assert.equal(controlType(planningInput(['collector', 'collector'], [10, 10], {
    previousControlType: 'allWayStop',
    conflictCount: 3,
  })), 'allWayStop');
  assert.equal(controlType(planningInput(['collector', 'collector'], [5, 5], {
    previousControlType: 'allWayStop',
  })), 'twoWayStop');
});

test('plan review obeys the 6000-tick cadence and reports no-op reviews without revision-worthy change', () => {
  const previous: JunctionControlPlan = buildJunctionControlPlan(
    planningInput(['local', 'local'], [5, 5]),
    US_INTERSECTION_POLICY,
  );
  const busy = planningInput(['local', 'local'], [15, 15]);

  const early = reviewControlPlans({
    tick: 5999,
    lastPlanReviewTick: 0,
    topologyChanged: false,
    overrideChanged: false,
    previousPlans: [previous],
    inputs: [busy],
    policy: US_INTERSECTION_POLICY,
  });
  assert.equal(early.plans[0]?.controlType, 'uncontrolled');
  assert.equal(early.changed, false);
  assert.equal(early.reviewedAtTick, 0);

  const due = reviewControlPlans({
    tick: 6000,
    lastPlanReviewTick: 0,
    topologyChanged: false,
    overrideChanged: false,
    previousPlans: [previous],
    inputs: [busy],
    policy: US_INTERSECTION_POLICY,
  });
  assert.equal(due.plans[0]?.controlType, 'yield');
  assert.equal(due.changed, true);
  assert.equal(due.reviewedAtTick, 6000);

  const noOp = reviewControlPlans({
    tick: 6000,
    lastPlanReviewTick: 0,
    topologyChanged: false,
    overrideChanged: false,
    previousPlans: [previous],
    inputs: [planningInput(['local', 'local'], [5, 5])],
    policy: US_INTERSECTION_POLICY,
  });
  assert.equal(noOp.changed, false);
  assert.equal(noOp.reviewedAtTick, 6000);
});

test('valid overrides persist while illegal controlled-access at-grade control is rejected', () => {
  const override: JunctionControlOverride = { junctionId: 'j:test', controlType: 'allWayStop' };
  const plan = buildJunctionControlPlan(
    planningInput(['local', 'collector'], [5, 30], { override }),
    US_INTERSECTION_POLICY,
  );
  assert.equal(plan.controlType, 'allWayStop');
  assert.equal(plan.source, 'override');

  assert.throws(
    () => buildJunctionControlPlan(
      planningInput(['highway', 'arterial'], [20, 20], {
        override: { junctionId: 'j:test', controlType: 'signal' },
      }),
      US_INTERSECTION_POLICY,
    ),
    /controlled-access|highway|at-grade/i,
  );

  for (const facilityType of ['merge', 'diverge', 'rampTerminal'] as const) {
    const controlledAccess = buildJunctionControlPlan(
      planningInput(['highway', 'arterial'], [20, 20], { facilityType }),
      US_INTERSECTION_POLICY,
    );
    assert.equal(controlledAccess.controlType, facilityType);
  }
});

function turn(
  id: string,
  from: string,
  to: string,
  turnKind: TurnMovement['turnKind'],
): TurnMovement {
  return {
    id,
    junctionId: 'j:test',
    fromCarriagewayId: from,
    toCarriagewayId: to,
    fromLaneIds: [`lane:${from}:${id}`],
    toLaneIds: [`lane:${to}:${id}`],
    turnKind,
    permissions: 1,
    allowed: true,
    basePenaltyTicks: 0,
  };
}

function conflictMatrix(conflictingPairs: readonly (readonly [string, string])[]): JunctionConflictMatrix {
  const keys = new Set(conflictingPairs.map(([a, b]) => [a, b].sort().join('|')));
  const participants = [...new Set(conflictingPairs.flat())];
  return {
    junctionId: 'j:test',
    participants,
    conflicts(a, b) {
      if (a === b) return false;
      return keys.has([a, b].sort().join('|'));
    },
  };
}

test('fixed signal plan uses exact yellow/all-red formulas, minimum greens, and deterministic demand allocation', () => {
  const movements = [
    turn('m:n:through', 'cw:n-in', 'cw:s-out', 'through'),
    turn('m:s:through', 'cw:s-in', 'cw:n-out', 'through'),
    turn('m:e:through', 'cw:e-in', 'cw:w-out', 'through'),
    turn('m:w:through', 'cw:w-in', 'cw:e-out', 'through'),
    turn('m:n:left', 'cw:n-in', 'cw:e-out', 'left'),
  ];
  const matrix = conflictMatrix([
    ['m:n:through', 'm:e:through'],
    ['m:n:through', 'm:w:through'],
    ['m:s:through', 'm:e:through'],
    ['m:s:through', 'm:w:through'],
    ['m:n:left', 'm:s:through'],
    ['m:n:left', 'm:e:through'],
    ['m:n:left', 'm:w:through'],
  ]);

  const plan = buildFixedSignalPlan({
    junctionId: 'j:test',
    movements,
    conflicts: matrix,
    pedestrianCrossingIds: [],
    movementDemandPerMinute: {
      'm:n:through': 15,
      'm:s:through': 15,
      'm:e:through': 5,
      'm:w:through': 5,
      'm:n:left': 4,
    },
    speedKph: 40,
    junctionClearanceMeters: 12,
    cycleTicks: 260,
  });

  assert.equal(plan.cycleTicks, 260);
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases.reduce((sum, phase) => sum + phase.greenTicks + phase.yellowTicks + phase.allRedTicks, 0), 260);
  for (const phase of plan.phases) {
    assert.equal(phase.yellowTicks, 35);
    assert.equal(phase.allRedTicks, 11);
    assert.equal(phase.greenTicks >= 80, true);
  }
  assert.equal(plan.phases.some((phase) => phase.permissiveMovementIds.includes('m:n:left')), true);
  assert.equal(plan.phases.some((phase) => phase.protectedMovementIds.includes('m:n:left')), false);
  assert.equal(plan.phases[0]?.greenTicks > (plan.phases[1]?.greenTicks ?? 0), true);
});

test('protected-only lefts receive protected service and conflicting protected-left pairs are rejected', () => {
  const northLeft = turn('m:n:left', 'cw:n-in', 'cw:e-out', 'left');
  const southLeft = turn('m:s:left', 'cw:s-in', 'cw:w-out', 'left');
  const through = turn('m:n:through', 'cw:n-in-2', 'cw:s-out', 'through');
  const compatible = conflictMatrix([]);

  const protectedPlan = buildFixedSignalPlan({
    junctionId: 'j:test',
    movements: [northLeft, through],
    conflicts: compatible,
    pedestrianCrossingIds: [],
    movementDemandPerMinute: { 'm:n:left': 10, 'm:n:through': 10 },
    protectedOnlyMovementIds: ['m:n:left'],
    speedKph: 40,
    junctionClearanceMeters: 12,
    cycleTicks: 260,
  });
  assert.equal(protectedPlan.phases.some((phase) => phase.protectedMovementIds.includes('m:n:left')), true);

  assert.throws(
    () => buildFixedSignalPlan({
      junctionId: 'j:test',
      movements: [northLeft, southLeft],
      conflicts: conflictMatrix([['m:n:left', 'm:s:left']]),
      pedestrianCrossingIds: [],
      movementDemandPerMinute: { 'm:n:left': 10, 'm:s:left': 10 },
      protectedOnlyMovementIds: ['m:n:left', 'm:s:left'],
      speedKph: 40,
      junctionClearanceMeters: 12,
      cycleTicks: 260,
    }),
    /protected.*conflict/i,
  );
});
