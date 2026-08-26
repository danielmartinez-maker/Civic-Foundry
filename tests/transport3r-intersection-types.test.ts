import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_INTERSECTION_POLICY,
  isControlledAccessRoadClass,
  validateIntersectionPolicy,
  validateMovementQueueEntry,
} from '../src/simulation/transportation/IntersectionControlTypes.ts';

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
