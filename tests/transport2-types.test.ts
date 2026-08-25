import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROAD_CLASSES,
  LEGACY_LANE_COUNT,
  VEHICLE_PERMISSION,
  permissionMask,
  hasPermission,
  intersectPermissions,
} from '../src/simulation/transportation/TransportNetworkTypes.ts';

test('3R hierarchy contains all six classes', () => {
  assert.deepEqual(ROAD_CLASSES, ['local', 'collector', 'arterial', 'avenue', 'expressway', 'highway']);
});

test('legacy lane counts are fixed', () => {
  assert.deepEqual(LEGACY_LANE_COUNT, { local: 1, collector: 2, arterial: 3 });
});

test('permission masks compose deterministically', () => {
  const mask = permissionMask('privateCar', 'bus');
  assert.equal(hasPermission(mask, 'privateCar'), true);
  assert.equal(hasPermission(mask, 'heavyFreight'), false);
  assert.equal(intersectPermissions(mask, VEHICLE_PERMISSION.bus), VEHICLE_PERMISSION.bus);
});
