import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementQueueStore } from '../src/simulation/transportation/MovementQueueStore.ts';

function entry(
  vehicleId: string,
  movementId: string,
  queuedTick: number,
  travelerWeight = 1,
  priority: 'normal' | 'transit' | 'emergency' = 'normal',
  laneGroupIds: readonly string[] = ['lg:a'],
) {
  return {
    vehicleId,
    movementId,
    laneGroupIds,
    travelerWeight,
    queuedTick,
    priority,
  };
}

test('one vehicle occupies at most one active queue and queue order ignores priority', () => {
  const store = new MovementQueueStore();

  assert.equal(store.enqueue(entry('v:b', 'm:1', 5, 1, 'normal')), true);
  assert.equal(store.enqueue(entry('v:a', 'm:1', 5, 1, 'emergency')), true);
  assert.equal(store.enqueue(entry('v:c', 'm:1', 4, 1, 'transit')), true);
  assert.equal(store.enqueue(entry('v:c', 'm:2', 1)), false);

  assert.equal(store.peek('m:1')?.vehicleId, 'v:c');
  assert.deepEqual(store.entries('m:1').map((item) => item.vehicleId), ['v:c', 'v:a', 'v:b']);
  assert.equal(store.hasVehicle('v:c'), true);
  assert.deepEqual(store.entries('m:2'), []);
});

test('weighted service is partial and released travelers stay pending without being charged twice', () => {
  const store = new MovementQueueStore();
  store.enqueue(entry('v:1', 'm:1', 1, 1.5));
  store.enqueue(entry('v:2', 'm:1', 2, 1));

  assert.deepEqual(store.serve('m:1', 1), []);
  assert.equal(store.peek('m:1')?.travelerWeight, 0.5);

  assert.deepEqual(store.serve('m:1', 0.5), ['v:1']);
  assert.deepEqual(store.pendingReleasedIds(), ['v:1']);
  assert.equal(store.hasVehicle('v:1'), true);
  assert.equal(store.peek('m:1')?.vehicleId, 'v:2');

  assert.deepEqual(store.serve('m:1', 0.25), []);
  assert.equal(store.peek('m:1')?.travelerWeight, 0.75);
  assert.deepEqual(store.pendingReleasedIds(), ['v:1']);

  store.acknowledge('v:1');
  assert.equal(store.hasVehicle('v:1'), false);
  assert.deepEqual(store.pendingReleasedIds(), []);
});

test('acknowledge and remove clean pending and queued vehicles without scanning unrelated queues semantically', () => {
  const store = new MovementQueueStore();
  store.enqueue(entry('v:queued', 'm:a', 1));
  store.enqueue(entry('v:released', 'm:b', 1));

  assert.deepEqual(store.serve('m:b', 1), ['v:released']);
  assert.equal(store.hasVehicle('v:released'), true);
  store.removeVehicle('v:released');
  assert.equal(store.hasVehicle('v:released'), false);

  store.removeVehicle('v:queued');
  assert.equal(store.hasVehicle('v:queued'), false);
  assert.deepEqual(store.entries(), []);
});

test('snapshot order and lane-group order are canonical independent of enqueue order', () => {
  const store = new MovementQueueStore();
  store.enqueue(entry('v:z', 'm:b', 9, 2, 'normal', ['lg:b', 'lg:a']));
  store.enqueue(entry('v:c', 'm:a', 4, 1, 'transit', ['lg:b']));
  store.enqueue(entry('v:a', 'm:a', 4, 1, 'emergency', ['lg:a']));
  assert.deepEqual(store.serve('m:a', 1), ['v:a']);

  assert.deepEqual(store.snapshot(), [
    {
      vehicleId: 'v:a',
      movementId: 'm:a',
      laneGroupIds: ['lg:a'],
      travelerWeight: 0,
      queuedTick: 4,
      priority: 'emergency',
      released: true,
    },
    {
      vehicleId: 'v:c',
      movementId: 'm:a',
      laneGroupIds: ['lg:b'],
      travelerWeight: 1,
      queuedTick: 4,
      priority: 'transit',
    },
    {
      vehicleId: 'v:z',
      movementId: 'm:b',
      laneGroupIds: ['lg:a', 'lg:b'],
      travelerWeight: 2,
      queuedTick: 9,
      priority: 'normal',
    },
  ]);
});

test('restore validates duplicate and unknown references atomically and restores pending releases', () => {
  const store = new MovementQueueStore();
  store.enqueue(entry('v:original', 'm:a', 3));
  const before = store.snapshot();
  const validMovementIds = new Set(['m:a', 'm:b']);
  const validLaneGroupIds = new Set(['lg:a', 'lg:b']);

  assert.throws(() => store.restore([
    entry('v:dup', 'm:a', 1),
    entry('v:dup', 'm:b', 2),
  ], validMovementIds, validLaneGroupIds), /duplicate/i);
  assert.deepEqual(store.snapshot(), before);

  assert.throws(() => store.restore([
    entry('v:unknown-movement', 'm:missing', 1),
  ], validMovementIds, validLaneGroupIds), /movement/i);
  assert.deepEqual(store.snapshot(), before);

  assert.throws(() => store.restore([
    entry('v:unknown-lane', 'm:a', 1, 1, 'normal', ['lg:missing']),
  ], validMovementIds, validLaneGroupIds), /lane group/i);
  assert.deepEqual(store.snapshot(), before);

  store.restore([
    entry('v:active', 'm:a', 2, 0.5, 'normal', ['lg:a']),
    {
      ...entry('v:pending', 'm:b', 1, 0, 'emergency', ['lg:b']),
      released: true,
    },
  ], validMovementIds, validLaneGroupIds);

  assert.deepEqual(store.entries().map((item) => item.vehicleId), ['v:active']);
  assert.deepEqual(store.pendingReleasedIds(), ['v:pending']);
  assert.equal(store.hasVehicle('v:pending'), true);
  assert.deepEqual(store.snapshot().map((item) => item.vehicleId), ['v:active', 'v:pending']);
});
