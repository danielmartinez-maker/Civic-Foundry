import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PedestrianController,
  crossingClearanceTicks,
} from '../src/simulation/transportation/PedestrianController.ts';
import { US_INTERSECTION_POLICY } from '../src/simulation/transportation/IntersectionControlTypes.ts';

function crossing(id = 'pc:j:1:north', crossingLengthMeters = 11) {
  return {
    id,
    junctionId: 'j:1',
    crossedCarriagewayIds: ['c:north:in', 'c:north:out'],
    conflictingMovementIds: ['m:right'],
    crossingLengthMeters,
  };
}

function step(
  controller: PedestrianController,
  walkCrossingIds: readonly string[],
  demandByCrossing: Readonly<Record<string, number>> = {},
): void {
  controller.step({
    walkCrossingIds: new Set(walkCrossingIds),
    demandByCrossing,
  });
}

test('crossing clearance duration derives exactly from length and walking-speed policy', () => {
  assert.equal(crossingClearanceTicks(11, US_INTERSECTION_POLICY), 100);
  assert.equal(crossingClearanceTicks(7.2, US_INTERSECTION_POLICY), 66);
});

test('WALK admits aggregate demand and exposes active pedestrian occupancy', () => {
  const definition = crossing();
  const controller = new PedestrianController([definition], US_INTERSECTION_POLICY);

  step(controller, [definition.id], { [definition.id]: 3.5 });

  assert.deepEqual(controller.stateFor(definition.id), {
    crossingId: definition.id,
    interval: 'walk',
    elapsedTicks: 1,
    occupancyWeight: 3.5,
  });
  assert.equal(controller.isOccupied(definition.id), true);
  assert.deepEqual(controller.activeCrossingIds(), [definition.id]);
});

test('change interval admits no new demand and residual occupancy lasts exact crossing duration', () => {
  const definition = crossing('pc:j:1:east', 11);
  const controller = new PedestrianController([definition], US_INTERSECTION_POLICY);
  const clearanceTicks = crossingClearanceTicks(definition.crossingLengthMeters, US_INTERSECTION_POLICY);

  step(controller, [definition.id], { [definition.id]: 2 });
  step(controller, [], { [definition.id]: 100 });
  assert.deepEqual(controller.stateFor(definition.id), {
    crossingId: definition.id,
    interval: 'change',
    elapsedTicks: 1,
    occupancyWeight: 2,
  });

  for (let elapsed = 2; elapsed <= clearanceTicks; elapsed += 1) {
    step(controller, [], { [definition.id]: 100 });
    const state = controller.stateFor(definition.id);
    assert.ok(state);
    assert.equal(state.occupancyWeight, 2);
    assert.equal(state.interval, 'clearance');
    assert.equal(state.elapsedTicks, elapsed);
  }

  assert.equal(controller.isOccupied(definition.id), true);
  step(controller, [], { [definition.id]: 100 });
  assert.deepEqual(controller.stateFor(definition.id), {
    crossingId: definition.id,
    interval: 'hold',
    elapsedTicks: 1,
    occupancyWeight: 0,
  });
  assert.equal(controller.isOccupied(definition.id), false);
});

test('no-demand WALK remains unoccupied and HOLD does not fabricate occupancy', () => {
  const definition = crossing('pc:j:1:south');
  const controller = new PedestrianController([definition], US_INTERSECTION_POLICY);

  step(controller, [definition.id]);
  assert.equal(controller.stateFor(definition.id)?.interval, 'walk');
  assert.equal(controller.isOccupied(definition.id), false);

  step(controller, []);
  assert.deepEqual(controller.stateFor(definition.id), {
    crossingId: definition.id,
    interval: 'hold',
    elapsedTicks: 1,
    occupancyWeight: 0,
  });
});

test('active crossing occupancy is available to conflicting permissive-turn control', () => {
  const definition = crossing('pc:j:1:west');
  const controller = new PedestrianController([definition], US_INTERSECTION_POLICY);

  step(controller, [definition.id], { [definition.id]: 1 });
  step(controller, []);

  assert.equal(definition.conflictingMovementIds.includes('m:right'), true);
  assert.equal(controller.isOccupied(definition.id), true);
  assert.deepEqual(controller.activeCrossingIds(), [definition.id]);
});

test('snapshot restore is exact mid-clearance and deterministic continuation matches', () => {
  const a = crossing('pc:j:1:a', 8.8);
  const b = crossing('pc:j:1:b', 11);
  const controller = new PedestrianController([b, a], US_INTERSECTION_POLICY);

  step(controller, [a.id, b.id], { [a.id]: 2, [b.id]: 1 });
  step(controller, []);
  step(controller, []);
  const snapshot = controller.snapshot();

  assert.deepEqual(snapshot.map((state) => state.crossingId), [a.id, b.id]);
  assert.equal(snapshot.every((state) => state.interval === 'clearance'), true);

  const restored = new PedestrianController([a, b], US_INTERSECTION_POLICY);
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);

  step(controller, []);
  step(restored, []);
  assert.deepEqual(restored.snapshot(), controller.snapshot());
});
