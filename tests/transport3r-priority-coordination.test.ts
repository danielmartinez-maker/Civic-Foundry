import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_INTERSECTION_POLICY,
  type IntersectionPriorityRequest,
  type JunctionControlPlan,
} from '../src/simulation/transportation/IntersectionControlTypes.ts';
import type {
  RoadSegment,
  TransportNetworkAuthority,
} from '../src/simulation/transportation/TransportNetworkTypes.ts';

async function loadCoordinationBuilder() {
  return import('../src/simulation/transportation/SignalCoordinationBuilder.ts');
}

async function loadPriorityController() {
  return import('../src/simulation/transportation/PriorityController.ts');
}

function segment(
  id: string,
  startJunctionId: string,
  endJunctionId: string,
  roadClass: RoadSegment['roadClass'] = 'arterial',
): RoadSegment {
  return Object.freeze({
    id,
    roadClass,
    geometryRef: `geometry:${id}`,
    startJunctionId,
    endJunctionId,
    lengthMeters: 100,
    speedLimitKph: 36,
    condition: 1,
    accessPolicyId: 'access:default',
    carriagewayIds: Object.freeze([]),
  });
}

function coordinationAuthority(shuffled = false): TransportNetworkAuthority {
  const junctions = [
    { id: 'j:a', x: 0, y: 0 },
    { id: 'j:b', x: 100, y: 0 },
    { id: 'j:c', x: 200, y: 0 },
    { id: 'j:local', x: 100, y: 100 },
  ];
  const segments = [
    segment('s:a-b', 'j:a', 'j:b'),
    segment('s:b-c', 'j:b', 'j:c'),
    segment('s:b-local', 'j:b', 'j:local', 'local'),
  ];
  return Object.freeze({
    junctions: Object.freeze(shuffled ? [...junctions].reverse() : junctions),
    segments: Object.freeze(shuffled ? [...segments].reverse() : segments),
    carriageways: Object.freeze([]),
    lanes: Object.freeze([]),
    movements: Object.freeze([]),
  });
}

function signalPlan(junctionId: string): JunctionControlPlan {
  return Object.freeze({
    id: `icp:${junctionId}`,
    junctionId,
    controlType: 'signal',
    source: 'automatic',
    controlledApproachIds: Object.freeze([]),
    policy: US_INTERSECTION_POLICY,
    phasePlan: Object.freeze({
      cycleTicks: 300,
      offsetTicks: 0,
      phases: Object.freeze([
        Object.freeze({
          id: `sp:${junctionId}:0`,
          protectedMovementIds: Object.freeze([]),
          permissiveMovementIds: Object.freeze([]),
          pedestrianCrossingIds: Object.freeze([]),
          greenTicks: 280,
          yellowTicks: 10,
          allRedTicks: 10,
        }),
      ]),
    }),
  });
}

function coordinationPlans(shuffled = false): readonly JunctionControlPlan[] {
  const plans = ['j:a', 'j:b', 'j:c', 'j:local'].map(signalPlan);
  return Object.freeze(shuffled ? plans.reverse() : plans);
}

function request(
  id: string,
  kind: IntersectionPriorityRequest['kind'],
  requestedTick: number,
  expiresTick = requestedTick + 100,
  movementId = `m:${id}`,
): IntersectionPriorityRequest {
  return Object.freeze({
    id,
    junctionId: 'j:priority',
    movementId,
    kind,
    requestedTick,
    expiresTick,
  });
}

test('three contiguous arterial signals form one stable coordinated corridor with free-flow offsets', async () => {
  const { buildSignalCoordinationGroups } = await loadCoordinationBuilder();
  const groups = buildSignalCoordinationGroups(coordinationAuthority(), coordinationPlans(), 7);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    id: 'scg:j:a>j:b>j:c',
    junctionIds: ['j:a', 'j:b', 'j:c'],
    cycleTicks: 300,
    offsetsByJunction: {
      'j:a': 0,
      'j:b': 100,
      'j:c': 200,
    },
    progressionFromJunctionId: 'j:a',
    progressionToJunctionId: 'j:c',
    planRevision: 7,
  });
  assert.equal(groups[0]?.junctionIds.includes('j:local'), false);
});

test('coordination output is canonical under shuffled authority and control-plan arrays', async () => {
  const { buildSignalCoordinationGroups } = await loadCoordinationBuilder();
  const canonical = buildSignalCoordinationGroups(coordinationAuthority(), coordinationPlans(), 7);
  const shuffled = buildSignalCoordinationGroups(coordinationAuthority(true), coordinationPlans(true), 7);
  assert.deepEqual(shuffled, canonical);
});

test('priority ordering is kind then requested tick then stable request id, with expiry', async () => {
  const { PriorityController } = await loadPriorityController();
  const controller = new PriorityController();
  controller.submit(request('transit-old', 'transitPriority', 1, 200));
  controller.submit(request('emergency-b', 'emergencyPreemption', 20, 200));
  controller.submit(request('emergency-a', 'emergencyPreemption', 20, 200));

  assert.equal(controller.select(20)?.id, 'emergency-a');
  assert.equal(controller.select(201), undefined);
  assert.deepEqual(controller.snapshot(), []);
});

test('same-id refresh replaces prior request and snapshot restore remains canonical', async () => {
  const { PriorityController } = await loadPriorityController();
  const controller = new PriorityController();
  controller.submit(request('b', 'transitPriority', 30, 80, 'm:old'));
  controller.submit(request('a', 'transitPriority', 20, 90));
  controller.submit(request('b', 'emergencyPreemption', 10, 120, 'm:refreshed'));

  assert.deepEqual(controller.snapshot().map((entry: IntersectionPriorityRequest) => entry.id), ['b', 'a']);
  assert.equal(controller.snapshot()[0]?.movementId, 'm:refreshed');

  const restored = new PriorityController();
  restored.restore([...controller.snapshot()].reverse());
  assert.deepEqual(restored.snapshot(), controller.snapshot());
});

test('incompatible emergency preemption requires safe clearance before grant', async () => {
  const { PriorityController } = await loadPriorityController();
  const controller = new PriorityController();
  controller.submit(request('ems', 'emergencyPreemption', 10, 100, 'm:emergency'));

  const transition = controller.decide(20, {
    activeMovementIds: new Set(['m:conflicting']),
    conflicts: (a: string, b: string) => a !== b,
    clearanceComplete: false,
  });
  assert.equal(transition.action, 'transition');
  assert.equal(transition.request?.id, 'ems');

  const stillClearing = controller.decide(21, {
    activeMovementIds: new Set(),
    conflicts: () => false,
    clearanceComplete: false,
  });
  assert.equal(stillClearing.action, 'transition');
  assert.equal(stillClearing.request?.id, 'ems');

  const grant = controller.decide(22, {
    activeMovementIds: new Set(),
    conflicts: () => false,
    clearanceComplete: true,
  });
  assert.equal(grant.action, 'grant');
  assert.equal(grant.request?.id, 'ems');
});

test('transit priority only adjusts a compatible phase and is bounded', async () => {
  const { MAX_TRANSIT_PRIORITY_TICKS, PriorityController } = await loadPriorityController();
  const controller = new PriorityController();
  controller.submit(request('bus', 'transitPriority', 10, 100, 'm:bus'));

  const advance = controller.decide(20, {
    activeMovementIds: new Set(['m:compatible']),
    conflicts: () => false,
    clearanceComplete: false,
    requestedMovementIsActivePhase: false,
    ticksUntilRequestedPhase: 100,
  });
  assert.equal(advance.action, 'transitAdjust');
  assert.equal(advance.advanceTicks, MAX_TRANSIT_PRIORITY_TICKS);
  assert.equal(advance.extendTicks, 0);

  const extend = controller.decide(21, {
    activeMovementIds: new Set(['m:bus']),
    conflicts: () => false,
    clearanceComplete: false,
    requestedMovementIsActivePhase: true,
    ticksUntilRequestedPhase: 0,
  });
  assert.equal(extend.action, 'transitAdjust');
  assert.equal(extend.advanceTicks, 0);
  assert.equal(extend.extendTicks, MAX_TRANSIT_PRIORITY_TICKS);

  const blocked = controller.decide(22, {
    activeMovementIds: new Set(['m:conflicting']),
    conflicts: () => true,
    clearanceComplete: false,
    requestedMovementIsActivePhase: false,
    ticksUntilRequestedPhase: 5,
  });
  assert.equal(blocked.action, 'none');
});
