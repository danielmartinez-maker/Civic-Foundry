import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleUnsignalizedHeads,
  requiredGapTicks,
} from '../src/simulation/transportation/UnsignalizedController.ts';
import { US_INTERSECTION_POLICY } from '../src/simulation/transportation/IntersectionControlTypes.ts';

function movement(id: string, turnKind: 'left' | 'through' | 'right' = 'through') {
  return {
    id,
    junctionId: 'j:1',
    fromCarriagewayId: `c:${id}:in`,
    toCarriagewayId: `c:${id}:out`,
    fromLaneIds: [`l:${id}:in`],
    toLaneIds: [`l:${id}:out`],
    turnKind,
    permissions: 1,
    allowed: true,
    basePenaltyTicks: 0,
  };
}

function head(options: {
  vehicleId: string;
  movementId: string;
  carriagewayId: string;
  heading: 'north' | 'east' | 'south' | 'west';
  turnKind?: 'left' | 'through' | 'right';
  queuedTick?: number;
  stoppedSinceTick?: number;
  lastConflictReleaseTick?: number;
  approachSpeedKph?: number;
  heavy?: boolean;
}) {
  const entryBase = {
    vehicleId: options.vehicleId,
    movementId: options.movementId,
    laneGroupIds: [`lg:${options.movementId}`],
    travelerWeight: 1,
    queuedTick: options.queuedTick ?? 0,
    priority: 'normal' as const,
  };
  const entry = options.stoppedSinceTick === undefined
    ? entryBase
    : { ...entryBase, stoppedSinceTick: options.stoppedSinceTick };
  return {
    entry,
    movement: {
      ...movement(options.movementId, options.turnKind),
      fromCarriagewayId: options.carriagewayId,
    },
    approachCarriagewayId: options.carriagewayId,
    approachHeading: options.heading,
    approachSpeedKph: options.approachSpeedKph ?? 40,
    isHeavyFreight: options.heavy ?? false,
    lastConflictReleaseTick: options.lastConflictReleaseTick ?? 0,
  };
}

function plan(
  controlType: 'uncontrolled' | 'yield' | 'twoWayStop' | 'allWayStop',
  controlledApproachIds: readonly string[],
) {
  return {
    id: 'icp:j:1',
    junctionId: 'j:1',
    controlType,
    source: 'automatic' as const,
    controlledApproachIds,
    policy: US_INTERSECTION_POLICY,
  };
}

function matrix(conflictingPairs: readonly (readonly [string, string])[] = []) {
  const keys = new Set(conflictingPairs.map(([a, b]) => [a, b].sort().join('|')));
  return {
    junctionId: 'j:1',
    participants: [],
    conflicts(a: string, b: string) {
      return a !== b && keys.has([a, b].sort().join('|'));
    },
  };
}

function eligibleIds(input: Parameters<typeof eligibleUnsignalizedHeads>[0]): string[] {
  return eligibleUnsignalizedHeads(input).map((candidate) => candidate.entry.vehicleId);
}

test('two-way STOP requires the exact 10-tick minimum stop dwell', () => {
  const candidate = head({
    vehicleId: 'v:minor',
    movementId: 'm:minor',
    carriagewayId: 'c:minor',
    heading: 'south',
    stoppedSinceTick: 100,
  });
  const base = {
    plan: plan('twoWayStop', ['c:minor']),
    heads: [candidate],
    conflicts: matrix(),
    activePedestrianCrossingIds: new Set<string>(),
  };

  assert.deepEqual(eligibleIds({ ...base, tick: 109 }), []);
  assert.deepEqual(eligibleIds({ ...base, tick: 110 }), ['v:minor']);
});

test('YIELD has no mandatory stop but requires the exact deterministic conflict gap', () => {
  const candidate = head({
    vehicleId: 'v:yield',
    movementId: 'm:yield',
    carriagewayId: 'c:minor',
    heading: 'west',
    turnKind: 'right',
    lastConflictReleaseTick: 80,
  });
  const base = {
    plan: plan('yield', ['c:minor']),
    heads: [candidate],
    conflicts: matrix(),
    activePedestrianCrossingIds: new Set<string>(),
  };

  assert.deepEqual(eligibleIds({ ...base, tick: 99 }), []);
  assert.deepEqual(eligibleIds({ ...base, tick: 100 }), ['v:yield']);
});

test('gap acceptance uses movement kind, approach speed, and heavy-freight penalty exactly', () => {
  assert.equal(requiredGapTicks('right', 40, false), 20);
  assert.equal(requiredGapTicks('through', 55, false), 40);
  assert.equal(requiredGapTicks('left', 80, true), 70);
});

test('major-street conflicting head blocks a stopped minor-street vehicle', () => {
  const major = head({
    vehicleId: 'v:major',
    movementId: 'm:major',
    carriagewayId: 'c:major',
    heading: 'north',
    queuedTick: 5,
  });
  const minor = head({
    vehicleId: 'v:minor',
    movementId: 'm:minor',
    carriagewayId: 'c:minor',
    heading: 'east',
    queuedTick: 1,
    stoppedSinceTick: 0,
  });

  assert.deepEqual(eligibleIds({
    tick: 100,
    plan: plan('twoWayStop', ['c:minor']),
    heads: [minor, major],
    conflicts: matrix([['m:major', 'm:minor']]),
    activePedestrianCrossingIds: new Set<string>(),
  }), ['v:major']);
});

test('all-way STOP orders conflicting heads by completed-stop arrival time', () => {
  const early = head({
    vehicleId: 'v:early',
    movementId: 'm:early',
    carriagewayId: 'c:north',
    heading: 'north',
    stoppedSinceTick: 0,
  });
  const late = head({
    vehicleId: 'v:late',
    movementId: 'm:late',
    carriagewayId: 'c:east',
    heading: 'east',
    stoppedSinceTick: 2,
  });

  assert.deepEqual(eligibleIds({
    tick: 100,
    plan: plan('allWayStop', ['c:north', 'c:east']),
    heads: [late, early],
    conflicts: matrix([['m:early', 'm:late']]),
    activePedestrianCrossingIds: new Set<string>(),
  }), ['v:early']);
});

test('simultaneous all-way STOP arrivals use right-hand geometry then movement and vehicle IDs', () => {
  const north = head({
    vehicleId: 'v:north',
    movementId: 'm:north',
    carriagewayId: 'c:north',
    heading: 'north',
    stoppedSinceTick: 0,
  });
  const east = head({
    vehicleId: 'v:east',
    movementId: 'm:east',
    carriagewayId: 'c:east',
    heading: 'east',
    stoppedSinceTick: 0,
  });

  assert.deepEqual(eligibleIds({
    tick: 100,
    plan: plan('allWayStop', ['c:north', 'c:east']),
    heads: [east, north],
    conflicts: matrix([['m:north', 'm:east']]),
    activePedestrianCrossingIds: new Set<string>(),
  }), ['v:north']);

  const b = head({
    vehicleId: 'v:b',
    movementId: 'm:b',
    carriagewayId: 'c:north',
    heading: 'north',
    stoppedSinceTick: 0,
  });
  const a = head({
    vehicleId: 'v:a',
    movementId: 'm:a',
    carriagewayId: 'c:north',
    heading: 'north',
    stoppedSinceTick: 0,
  });
  assert.deepEqual(eligibleIds({
    tick: 100,
    plan: plan('allWayStop', ['c:north']),
    heads: [b, a],
    conflicts: matrix(),
    activePedestrianCrossingIds: new Set<string>(),
  }), ['v:a', 'v:b']);

  const z = head({
    vehicleId: 'v:z',
    movementId: 'm:same',
    carriagewayId: 'c:north',
    heading: 'north',
    stoppedSinceTick: 0,
  });
  const aa = head({
    vehicleId: 'v:aa',
    movementId: 'm:same',
    carriagewayId: 'c:north',
    heading: 'north',
    stoppedSinceTick: 0,
  });
  assert.deepEqual(eligibleIds({
    tick: 100,
    plan: plan('allWayStop', ['c:north']),
    heads: [z, aa],
    conflicts: matrix(),
    activePedestrianCrossingIds: new Set<string>(),
  }), ['v:aa', 'v:z']);
});

test('active conflicting pedestrian occupancy blocks unsignalized service', () => {
  const candidate = head({
    vehicleId: 'v:turn',
    movementId: 'm:turn',
    carriagewayId: 'c:minor',
    heading: 'south',
    turnKind: 'right',
  });

  assert.deepEqual(eligibleIds({
    tick: 100,
    plan: plan('yield', ['c:minor']),
    heads: [candidate],
    conflicts: matrix([['m:turn', 'pc:cross']]),
    activePedestrianCrossingIds: new Set(['pc:cross']),
  }), []);
});
