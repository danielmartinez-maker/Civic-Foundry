import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionMask, type LaneGroup, type TransportNetworkAuthority } from '../src/simulation/transportation/TransportNetworkTypes.ts';

async function loadSystem() {
  return import('../src/simulation/transportation/IntersectionControlSystem.ts');
}

const PERMISSIONS = permissionMask('privateCar');
const EMPTY_DEMAND = Object.freeze({});

function plusFixture(): Readonly<{ authority: TransportNetworkAuthority; laneGroups: readonly LaneGroup[] }> {
  const junctions = [
    { id: 'j:center', x: 0, y: 0 },
    { id: 'j:n', x: 0, y: -100 },
    { id: 'j:e', x: 100, y: 0 },
    { id: 'j:s', x: 0, y: 100 },
    { id: 'j:w', x: -100, y: 0 },
  ];
  const legs = [
    ['n', 'j:n'],
    ['e', 'j:e'],
    ['s', 'j:s'],
    ['w', 'j:w'],
  ] as const;

  const segments = legs.map(([name, neighbor]) => ({
    id: `s:${name}`,
    roadClass: 'local' as const,
    geometryRef: `geometry:${name}`,
    startJunctionId: neighbor,
    endJunctionId: 'j:center',
    lengthMeters: 100,
    speedLimitKph: 40,
    condition: 1,
    accessPolicyId: 'access:default',
    carriagewayIds: [`cw:${name}:in`, `cw:${name}:out`],
  }));
  const carriageways = legs.flatMap(([name, neighbor]) => ([
    {
      id: `cw:${name}:in`, segmentId: `s:${name}`, direction: 'forward' as const,
      fromJunctionId: neighbor, toJunctionId: 'j:center', operatingClass: 'local' as const,
      laneIds: [`lane:${name}:in`],
    },
    {
      id: `cw:${name}:out`, segmentId: `s:${name}`, direction: 'backward' as const,
      fromJunctionId: 'j:center', toJunctionId: neighbor, operatingClass: 'local' as const,
      laneIds: [`lane:${name}:out`],
    },
  ]));
  const lanes = carriageways.map((carriageway) => ({
    id: carriageway.laneIds[0]!,
    carriagewayId: carriageway.id,
    ordinal: 0,
    kind: 'through' as const,
    permissions: PERMISSIONS,
    operatingState: 'open' as const,
    baseCapacityPerMinute: 600,
    freeFlowSpeedKph: 40,
  }));
  const movements = [
    { id: 'm:n-s', from: 'n', to: 's' },
    { id: 'm:s-n', from: 's', to: 'n' },
    { id: 'm:w-e', from: 'w', to: 'e' },
    { id: 'm:e-w', from: 'e', to: 'w' },
  ].map(({ id, from, to }) => ({
    id,
    junctionId: 'j:center',
    fromCarriagewayId: `cw:${from}:in`,
    toCarriagewayId: `cw:${to}:out`,
    fromLaneIds: [`lane:${from}:in`],
    toLaneIds: [`lane:${to}:out`],
    turnKind: 'through' as const,
    permissions: PERMISSIONS,
    allowed: true,
    basePenaltyTicks: 0,
  }));
  const laneGroups: LaneGroup[] = movements.map((movement) => {
    const leg = movement.id.slice(2, 3);
    return {
      id: `lg:${leg}`,
      carriagewayId: movement.fromCarriagewayId,
      laneIds: movement.fromLaneIds,
      movementIds: [movement.id],
      permissions: PERMISSIONS,
      capacityPerMinute: 600,
      freeFlowSpeedKph: 40,
    };
  });

  return {
    authority: { junctions, segments, carriageways, lanes, movements },
    laneGroups,
  };
}

function straightFixture(): Readonly<{ authority: TransportNetworkAuthority; laneGroups: readonly LaneGroup[] }> {
  const plus = plusFixture();
  const keepJunctions = new Set(['j:center', 'j:n', 'j:s']);
  const keepCarriageways = new Set(['cw:n:in', 'cw:n:out', 'cw:s:in', 'cw:s:out']);
  const keepMovements = new Set(['m:n-s', 'm:s-n']);
  return {
    authority: {
      junctions: plus.authority.junctions.filter((value) => keepJunctions.has(value.id)),
      segments: plus.authority.segments.filter((value) => value.id === 's:n' || value.id === 's:s'),
      carriageways: plus.authority.carriageways.filter((value) => keepCarriageways.has(value.id)),
      lanes: plus.authority.lanes.filter((value) => keepCarriageways.has(value.carriagewayId)),
      movements: plus.authority.movements.filter((value) => keepMovements.has(value.id)),
    },
    laneGroups: plus.laneGroups.filter((value) => value.id === 'lg:n' || value.id === 'lg:s'),
  };
}

function queueEntry(vehicleId: string, movementId: string, laneGroupId: string, queuedTick = 0) {
  return {
    vehicleId,
    movementId,
    laneGroupIds: [laneGroupId],
    travelerWeight: 1,
    queuedTick,
    priority: 'normal' as const,
  };
}

function shuffled<T>(values: readonly T[]): readonly T[] {
  return [...values].reverse();
}

test('control state gates service and all-way STOP does not release before minimum dwell', async () => {
  const { IntersectionControlSystem } = await loadSystem();
  const fixture = plusFixture();
  const controls = new IntersectionControlSystem();
  controls.syncNetwork(fixture.authority, fixture.laneGroups, EMPTY_DEMAND, 0);
  controls.setOverride({ junctionId: 'j:center', controlType: 'allWayStop' });
  assert.equal(controls.enqueue(queueEntry('v:stop', 'm:n-s', 'lg:n')), true);

  assert.deepEqual(controls.step(5), []);
  assert.deepEqual(controls.step(40), ['v:stop']);
});

test('physical conflict prevents incompatible same-window release and same-tick step cannot double-spend', async () => {
  const { IntersectionControlSystem } = await loadSystem();
  const fixture = plusFixture();
  const controls = new IntersectionControlSystem();
  controls.syncNetwork(fixture.authority, fixture.laneGroups, EMPTY_DEMAND, 0);
  controls.enqueue(queueEntry('v:n', 'm:n-s', 'lg:n'));
  controls.enqueue(queueEntry('v:w', 'm:w-e', 'lg:w'));

  assert.deepEqual(controls.step(1), ['v:n']);
  assert.deepEqual(controls.step(1), ['v:n']);
  assert.equal(controls.queueLength(), 1);
  assert.deepEqual(controls.step(2), ['v:n', 'v:w']);
});

test('no-op sync preserves control-plan revision while overrides rebuild deterministically', async () => {
  const { IntersectionControlSystem } = await loadSystem();
  const fixture = plusFixture();
  const controls = new IntersectionControlSystem();
  controls.syncNetwork(fixture.authority, fixture.laneGroups, EMPTY_DEMAND, 0);
  const initialRevision = controls.snapshot().controlPlanRevision;
  assert.equal(initialRevision, 1);
  assert.equal(controls.planFor('j:center')?.controlType, 'uncontrolled');

  controls.syncNetwork({
    junctions: shuffled(fixture.authority.junctions),
    segments: shuffled(fixture.authority.segments),
    carriageways: shuffled(fixture.authority.carriageways),
    lanes: shuffled(fixture.authority.lanes),
    movements: shuffled(fixture.authority.movements),
  }, shuffled(fixture.laneGroups), EMPTY_DEMAND, 1);
  assert.equal(controls.snapshot().controlPlanRevision, initialRevision);

  controls.setOverride({ junctionId: 'j:center', controlType: 'allWayStop' });
  assert.equal(controls.planFor('j:center')?.controlType, 'allWayStop');
  assert.equal(controls.planFor('j:center')?.source, 'override');
  assert.equal(controls.snapshot().controlPlanRevision, initialRevision + 1);

  controls.clearOverride('j:center');
  assert.equal(controls.planFor('j:center')?.controlType, 'uncontrolled');
  assert.equal(controls.planFor('j:center')?.source, 'automatic');
  assert.equal(controls.snapshot().controlPlanRevision, initialRevision + 2);
});

test('simple degree-2 non-conflicting uncontrolled continuation bypasses the queue', async () => {
  const { IntersectionControlSystem } = await loadSystem();
  const fixture = straightFixture();
  const controls = new IntersectionControlSystem();
  controls.syncNetwork(fixture.authority, fixture.laneGroups, EMPTY_DEMAND, 0);

  assert.equal(controls.planFor('j:center')?.controlType, 'uncontrolled');
  assert.equal(controls.requiresQueue('m:n-s'), false);
  assert.equal(controls.requiresQueue('m:s-n'), false);
});

test('shared incoming lane-group budget is conserved across otherwise compatible movements', async () => {
  const { IntersectionControlSystem } = await loadSystem();
  const fixture = plusFixture();
  const shared: LaneGroup = {
    id: 'lg:shared',
    carriagewayId: 'cw:n:in',
    laneIds: ['lane:n:in', 'lane:s:in'],
    movementIds: ['m:n-s', 'm:s-n'],
    permissions: PERMISSIONS,
    capacityPerMinute: 600,
    freeFlowSpeedKph: 40,
  };
  const groups = [...fixture.laneGroups.filter((group) => group.id !== 'lg:n' && group.id !== 'lg:s'), shared];
  const controls = new IntersectionControlSystem();
  controls.syncNetwork(fixture.authority, groups, EMPTY_DEMAND, 0);
  controls.enqueue(queueEntry('v:n', 'm:n-s', 'lg:shared'));
  controls.enqueue(queueEntry('v:s', 'm:s-n', 'lg:shared'));

  const firstTick = controls.step(1);
  assert.equal(firstTick.length, 1);
  assert.equal(controls.queueLength(), 1);
  const secondTick = controls.step(2);
  assert.equal(secondTick.length, 2);
});
