import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_INTERSECTION_POLICY,
  type IntersectionControlPolicy,
  type SignalTimingPlan,
} from '../src/simulation/transportation/IntersectionControlTypes.ts';
import {
  permissionMask,
  type TurnMovement,
} from '../src/simulation/transportation/TransportNetworkTypes.ts';

async function loadSignalController() {
  return import('../src/simulation/transportation/SignalController.ts');
}

function movement(id: string, turnKind: TurnMovement['turnKind']): TurnMovement {
  return Object.freeze({
    id,
    junctionId: 'j:signal',
    fromCarriagewayId: `cw:in:${id}`,
    toCarriagewayId: `cw:out:${id}`,
    fromLaneIds: Object.freeze([`lane:in:${id}`]),
    toLaneIds: Object.freeze([`lane:out:${id}`]),
    turnKind,
    permissions: permissionMask('privateCar'),
    allowed: true,
    basePenaltyTicks: 0,
  });
}

const THROUGH = movement('m:through', 'through');
const LEFT_PP = movement('m:left:pp', 'left');
const LEFT_PROTECTED = movement('m:left:protected', 'left');
const RIGHT = movement('m:right', 'right');
const OPPOSING = movement('m:opposing', 'through');
const MOVEMENTS = Object.freeze([THROUGH, LEFT_PP, LEFT_PROTECTED, RIGHT, OPPOSING]);

const PLAN: SignalTimingPlan = Object.freeze({
  cycleTicks: 13,
  offsetTicks: 0,
  phases: Object.freeze([
    Object.freeze({
      id: 'sp:j:signal:0',
      protectedMovementIds: Object.freeze([THROUGH.id, LEFT_PROTECTED.id, RIGHT.id]),
      permissiveMovementIds: Object.freeze([LEFT_PP.id]),
      pedestrianCrossingIds: Object.freeze(['pc:a']),
      greenTicks: 4,
      yellowTicks: 2,
      allRedTicks: 1,
    }),
    Object.freeze({
      id: 'sp:j:signal:1',
      protectedMovementIds: Object.freeze([OPPOSING.id, LEFT_PP.id]),
      permissiveMovementIds: Object.freeze([]),
      pedestrianCrossingIds: Object.freeze(['pc:b']),
      greenTicks: 3,
      yellowTicks: 2,
      allRedTicks: 1,
    }),
  ]),
});

function withoutRtor(): IntersectionControlPolicy {
  return Object.freeze({ ...US_INTERSECTION_POLICY, rightTurnOnRed: false });
}

test('green service distinguishes protected, permissive, and protected-only left movements', async () => {
  const { SignalController } = await loadSignalController();
  const controller = new SignalController('j:signal', PLAN, MOVEMENTS, US_INTERSECTION_POLICY);

  assert.equal(controller.runtimeMode(), 'green');
  assert.equal(controller.activePhase().id, 'sp:j:signal:0');
  assert.equal(controller.serviceStateFor(THROUGH.id), 'protected');
  assert.equal(controller.serviceStateFor(LEFT_PP.id), 'permissive');
  assert.equal(controller.serviceStateFor(LEFT_PROTECTED.id), 'protected');

  controller.step(7);
  assert.equal(controller.runtimeMode(), 'green');
  assert.equal(controller.activePhase().id, 'sp:j:signal:1');
  assert.equal(controller.serviceStateFor(LEFT_PP.id), 'protected');
  assert.equal(controller.serviceStateFor(LEFT_PROTECTED.id), 'prohibited');
});

test('yellow and all-red are explicit clearance intervals with no new protected service', async () => {
  const { SignalController } = await loadSignalController();
  const controller = new SignalController('j:signal', PLAN, MOVEMENTS, US_INTERSECTION_POLICY);

  controller.step(4);
  assert.equal(controller.runtimeMode(), 'yellow');
  assert.equal(controller.serviceStateFor(THROUGH.id), 'clearance');
  assert.equal(controller.serviceStateFor(RIGHT.id, { stoppedTicks: 100 }), 'clearance');

  controller.step(2);
  assert.equal(controller.runtimeMode(), 'allRed');
  assert.equal(controller.serviceStateFor(THROUGH.id), 'clearance');
  assert.equal(controller.serviceStateFor(RIGHT.id, { stoppedTicks: 100 }), 'clearance');
});

test('right turn on red exposes exact STOP dwell then YIELD and respects policy disablement', async () => {
  const { SignalController } = await loadSignalController();
  const enabled = new SignalController('j:signal', PLAN, MOVEMENTS, US_INTERSECTION_POLICY);
  enabled.step(7);

  assert.equal(enabled.serviceStateFor(RIGHT.id, { stoppedTicks: 9 }), 'stop');
  assert.equal(enabled.serviceStateFor(RIGHT.id, { stoppedTicks: 10 }), 'yield');
  assert.equal(enabled.serviceStateFor(RIGHT.id, { stoppedTicks: 100 }), 'yield');

  const disabled = new SignalController('j:signal', PLAN, MOVEMENTS, withoutRtor());
  disabled.step(7);
  assert.equal(disabled.serviceStateFor(RIGHT.id, { stoppedTicks: 100 }), 'prohibited');
});

test('active pedestrian conflict blocks permissive/protected entry and right turn on red', async () => {
  const { SignalController } = await loadSignalController();
  const controller = new SignalController('j:signal', PLAN, MOVEMENTS, US_INTERSECTION_POLICY);

  assert.equal(
    controller.serviceStateFor(THROUGH.id, { pedestrianConflictOccupied: true }),
    'clearance',
  );
  assert.equal(
    controller.serviceStateFor(LEFT_PP.id, { pedestrianConflictOccupied: true }),
    'clearance',
  );

  controller.step(7);
  assert.equal(
    controller.serviceStateFor(RIGHT.id, { stoppedTicks: 10, pedestrianConflictOccupied: true }),
    'stop',
  );
});

test('mid-phase snapshot restore is exact and continuation remains deterministic', async () => {
  const { SignalController } = await loadSignalController();
  const uninterrupted = new SignalController('j:signal', PLAN, MOVEMENTS, US_INTERSECTION_POLICY);
  uninterrupted.step(9);
  const saved = uninterrupted.snapshot();

  assert.deepEqual(saved, {
    junctionId: 'j:signal',
    phaseId: 'sp:j:signal:1',
    phaseElapsedTicks: 2,
    cyclePositionTicks: 9,
  });

  const restored = new SignalController('j:signal', PLAN, MOVEMENTS, US_INTERSECTION_POLICY);
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);

  uninterrupted.step(17);
  restored.step(17);
  assert.deepEqual(restored.snapshot(), uninterrupted.snapshot());
  assert.equal(restored.runtimeMode(), uninterrupted.runtimeMode());
  assert.equal(restored.activePhase().id, uninterrupted.activePhase().id);
});
