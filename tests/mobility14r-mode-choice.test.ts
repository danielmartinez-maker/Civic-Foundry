import test from 'node:test';
import assert from 'node:assert/strict';
import { listMobilityModes } from '../src/simulation/mobility/MobilityModeRegistry.ts';
import { buildMobilityCost } from '../src/simulation/mobility/MobilityCost.ts';

test('14R-A exposes exactly twelve canonical modes', () => {
  assert.deepEqual(listMobilityModes().map((mode) => mode.id), [
    'walk', 'bicycle', 'car', 'ride_hail', 'bus', 'trolleybus',
    'brt', 'tram', 'metro', 'commuter_rail', 'regional_rail', 'ferry',
  ]);
});

test('generalized cost rejects invalid components and sums valid ones', () => {
  const cost = buildMobilityCost({
    accessEgressTicks: 1,
    expectedWaitTicks: 2,
    movementTicks: 3,
    transferPenaltyTicks: 4,
    fareImpedanceTicks: 5,
    parkingImpedanceTicks: 6,
    congestionDelayTicks: 7,
    crowdingPenaltyTicks: 8,
    reliabilityPenaltyTicks: 9,
    switchingPenaltyTicks: 10,
  });
  assert.equal(cost?.generalizedCost, 55);

  assert.equal(buildMobilityCost({
    accessEgressTicks: -1,
    expectedWaitTicks: 0,
    movementTicks: 0,
    transferPenaltyTicks: 0,
    fareImpedanceTicks: 0,
    parkingImpedanceTicks: 0,
    congestionDelayTicks: 0,
    crowdingPenaltyTicks: 0,
    reliabilityPenaltyTicks: 0,
    switchingPenaltyTicks: 0,
  }), null);
});
