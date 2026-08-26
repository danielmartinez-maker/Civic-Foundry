import test from 'node:test';
import assert from 'node:assert/strict';
import { listMobilityModes } from '../src/simulation/mobility/MobilityModeRegistry.ts';
import { buildMobilityCost } from '../src/simulation/mobility/MobilityCost.ts';
import { MobilityChoiceSystem } from '../src/simulation/mobility/MobilityChoiceSystem.ts';
import {
  MobilityProviderRegistry,
  type MobilityAlternativeProvider,
  type MobilityRuntimeContext,
} from '../src/simulation/mobility/MobilityProvider.ts';
import { MobilityOrchestrator } from '../src/simulation/mobility/MobilityOrchestrator.ts';
import type { MobilityModeId } from '../src/simulation/mobility/MobilityTypes.ts';
import {
  mobilityAlternative,
  mobilityRequest,
} from './support/mobility14rFixtures.ts';

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

test('arbitrary alternatives use cost, provider priority, mode id, then alternative id', () => {
  const choice = new MobilityChoiceSystem().choose([
    mobilityAlternative('z-provider', 20, 'metro', 'z', 80),
    mobilityAlternative('a-provider', 10, 'car', 'a', 80),
    mobilityAlternative('b-provider', 10, 'bus', 'b', 80),
  ]);
  assert.equal(choice.outcome, 'bus');
  assert.equal(choice.alternative?.id, 'b');
  assert.equal(new MobilityChoiceSystem().choose([]).outcome, 'unmet');
});

type ProviderState = { builds: number; executes: number };

function syntheticProvider(
  id: string,
  priority: number,
  mode: MobilityModeId,
  cost: number,
  state: ProviderState,
  failExecutions = 0,
): MobilityAlternativeProvider {
  return {
    id,
    priority,
    modes: Object.freeze([mode]),
    buildAlternatives: () => {
      state.builds++;
      return Object.freeze([mobilityAlternative(id, priority, mode, `${id}:alternative`, cost)]);
    },
    execute: () => {
      state.executes++;
      return state.executes > failExecutions;
    },
  };
}

const EMPTY_RUNTIME = Object.freeze({}) as MobilityRuntimeContext;

test('provider registry ordering is deterministic and only the winning provider executes', () => {
  const a = { builds: 0, executes: 0 };
  const b = { builds: 0, executes: 0 };
  const z = { builds: 0, executes: 0 };
  const registry = new MobilityProviderRegistry([
    syntheticProvider('z-provider', 20, 'metro', 90, z),
    syntheticProvider('b-provider', 10, 'bus', 70, b),
    syntheticProvider('a-provider', 10, 'car', 80, a),
  ]);

  assert.deepEqual(registry.list().map((provider) => provider.id), [
    'a-provider', 'b-provider', 'z-provider',
  ]);

  const outcome = new MobilityOrchestrator(registry).resolveAndExecute(mobilityRequest(), EMPTY_RUNTIME);
  assert.equal(outcome.outcome, 'bus');
  assert.deepEqual([a.executes, b.executes, z.executes], [0, 1, 0]);
  assert.deepEqual([a.builds, b.builds, z.builds], [1, 1, 1]);
});

test('provider registry rejects duplicate ids and duplicate executable mode ownership', () => {
  const state = { builds: 0, executes: 0 };
  const car = syntheticProvider('car-a', 10, 'car', 20, state);
  assert.throws(() => new MobilityProviderRegistry([car, { ...car }]), /duplicate provider/i);
  assert.throws(() => new MobilityProviderRegistry([
    car,
    syntheticProvider('car-b', 20, 'car', 10, { builds: 0, executes: 0 }),
  ]), /mode.*car|car.*mode/i);
});

test('stale execution replans exactly once and can then succeed', () => {
  const state = { builds: 0, executes: 0 };
  const registry = new MobilityProviderRegistry([
    syntheticProvider('car-provider', 10, 'car', 50, state, 1),
  ]);
  const outcome = new MobilityOrchestrator(registry).resolveAndExecute(mobilityRequest(), EMPTY_RUNTIME);
  assert.equal(outcome.outcome, 'car');
  assert.equal(state.builds, 2);
  assert.equal(state.executes, 2);
});

test('two stale executions stop after the bounded retry and become unmet', () => {
  const state = { builds: 0, executes: 0 };
  const registry = new MobilityProviderRegistry([
    syntheticProvider('car-provider', 10, 'car', 50, state, 2),
  ]);
  const outcome = new MobilityOrchestrator(registry).resolveAndExecute(mobilityRequest(), EMPTY_RUNTIME);
  assert.equal(outcome.outcome, 'unmet');
  assert.equal(outcome.alternative, null);
  assert.equal(state.builds, 2);
  assert.equal(state.executes, 2);
});
