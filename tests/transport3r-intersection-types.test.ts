import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  US_INTERSECTION_POLICY,
  isControlledAccessRoadClass,
  validateIntersectionPolicy,
  validateMovementQueueEntry,
  type IntersectionControlSnapshot,
} from '../src/simulation/transportation/IntersectionControlTypes.ts';

function controlTypesSource(): string {
  return readFileSync(
    new URL('../src/simulation/transportation/IntersectionControlTypes.ts', import.meta.url),
    'utf8',
  );
}

test('3R-B U.S. intersection policy defaults are locked', () => {
  assert.deepEqual(US_INTERSECTION_POLICY, {
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
});

test('controlled-access classification is limited to expressway and highway', () => {
  assert.equal(isControlledAccessRoadClass('local'), false);
  assert.equal(isControlledAccessRoadClass('collector'), false);
  assert.equal(isControlledAccessRoadClass('arterial'), false);
  assert.equal(isControlledAccessRoadClass('avenue'), false);
  assert.equal(isControlledAccessRoadClass('expressway'), true);
  assert.equal(isControlledAccessRoadClass('highway'), true);
});

test('intersection policy validator rejects negative or non-finite timing values', () => {
  assert.doesNotThrow(() => validateIntersectionPolicy(US_INTERSECTION_POLICY));
  assert.throws(
    () => validateIntersectionPolicy({ ...US_INTERSECTION_POLICY, minimumStopTicks: -1 }),
    /minimumStopTicks/,
  );
  assert.throws(
    () => validateIntersectionPolicy({ ...US_INTERSECTION_POLICY, controlReviewTicks: Number.NaN }),
    /controlReviewTicks/,
  );
  assert.throws(
    () => validateIntersectionPolicy({ ...US_INTERSECTION_POLICY, pedestrianWalkingSpeedMps: Number.POSITIVE_INFINITY }),
    /pedestrianWalkingSpeedMps/,
  );
});

test('movement queue validator rejects invalid timing and traveler weight', () => {
  const valid = {
    vehicleId: 'vehicle:1',
    movementId: 'movement:1',
    laneGroupIds: ['lane-group:1'],
    travelerWeight: 1,
    queuedTick: 42,
    priority: 'normal' as const,
    stoppedSinceTick: 40,
  };

  assert.doesNotThrow(() => validateMovementQueueEntry(valid));
  assert.throws(() => validateMovementQueueEntry({ ...valid, travelerWeight: -0.1 }), /travelerWeight/);
  assert.throws(() => validateMovementQueueEntry({ ...valid, travelerWeight: Number.NaN }), /travelerWeight/);
  assert.throws(() => validateMovementQueueEntry({ ...valid, queuedTick: -1 }), /queuedTick/);
  assert.throws(() => validateMovementQueueEntry({ ...valid, stoppedSinceTick: Number.POSITIVE_INFINITY }), /stoppedSinceTick/);
});

test('intersection snapshot carries canonical plan/runtime revision epochs', () => {
  const snapshot = {
    controlPlanRevision: 3,
    controlRuntimeEpoch: 7,
    lastPlanReviewTick: 6000,
    plans: [],
    queues: [],
    signalStates: [],
    pedestrianStates: [],
    priorityRequests: [],
    coordinationGroups: [],
    overrides: [],
  } satisfies IntersectionControlSnapshot;

  assert.equal(snapshot.controlPlanRevision, 3);
  assert.equal(snapshot.controlRuntimeEpoch, 7);
  assert.equal(snapshot.lastPlanReviewTick, 6000);
});

test('IntersectionControlSnapshot declares the exact roadmap epoch field names', () => {
  const source = controlTypesSource();
  const match = source.match(/export type IntersectionControlSnapshot = Readonly<\{([\s\S]*?)\n\}>;/);
  assert.ok(match, 'IntersectionControlSnapshot declaration must exist');
  const body = match[1] ?? '';

  assert.match(body, /\bcontrolPlanRevision:\s*number;/);
  assert.match(body, /\bcontrolRuntimeEpoch:\s*number;/);
  assert.match(body, /\blastPlanReviewTick:\s*number;/);
  assert.doesNotMatch(body, /\blastReviewTick:\s*number;/);
});

test('Task 8 priority requests persist stable identity, kind, and expiry', () => {
  const source = controlTypesSource();
  const match = source.match(/export type IntersectionPriorityRequest = Readonly<\{([\s\S]*?)\n\}>;/);
  assert.ok(match, 'IntersectionPriorityRequest declaration must exist');
  const body = match[1] ?? '';

  assert.match(body, /\bid:\s*string;/);
  assert.match(body, /\bjunctionId:\s*JunctionId;/);
  assert.match(body, /\bmovementId:\s*TurnMovementId;/);
  assert.match(body, /\bkind:\s*'emergencyPreemption'\s*\|\s*'transitPriority';/);
  assert.match(body, /\brequestedTick:\s*number;/);
  assert.match(body, /\bexpiresTick:\s*number;/);

  const snapshot = source.match(/export type IntersectionControlSnapshot = Readonly<\{([\s\S]*?)\n\}>;/);
  assert.ok(snapshot);
  assert.match(snapshot[1] ?? '', /priorityRequests:\s*readonly IntersectionPriorityRequest\[\];/);
});

test('Task 8 coordination groups persist direction and structural plan revision', () => {
  const source = controlTypesSource();
  const match = source.match(/export type SignalCoordinationGroup = Readonly<\{([\s\S]*?)\n\}>;/);
  assert.ok(match, 'SignalCoordinationGroup declaration must exist');
  const body = match[1] ?? '';

  assert.match(body, /\bid:\s*CoordinationGroupId;/);
  assert.match(body, /\bjunctionIds:\s*readonly JunctionId\[\];/);
  assert.match(body, /\bcycleTicks:\s*number;/);
  assert.match(body, /\boffsetsByJunction:\s*Readonly<Record<JunctionId, number>>;/);
  assert.match(body, /\bprogressionFromJunctionId:\s*JunctionId;/);
  assert.match(body, /\bprogressionToJunctionId:\s*JunctionId;/);
  assert.match(body, /\bplanRevision:\s*number;/);

  const snapshot = source.match(/export type IntersectionControlSnapshot = Readonly<\{([\s\S]*?)\n\}>;/);
  assert.ok(snapshot);
  assert.match(snapshot[1] ?? '', /coordinationGroups:\s*readonly SignalCoordinationGroup\[\];/);
});
