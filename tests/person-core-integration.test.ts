import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { flatTerrain } from './support/kernelParity.ts';

function legacyCoreWithPopulation(population: number, seed = 301): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(16, 10), seed, startingFunds: 1_000_000 });
  core.population.restore(population);
  return core;
}

test('personhood cutover preserves the exact legacy population as persistent people', () => {
  const core = legacyCoreWithPopulation(250);

  core.enablePersonhoodAuthority();

  const snapshot = core.getPersonSnapshot();
  assert.equal(core.population.population, 250);
  assert.equal(snapshot.population, 250);
  assert.equal(snapshot.people.length, 250);
  assert.equal(core.entityRegistry.listActive('person').length, 250);
  assert.equal(snapshot.people.every((person) => person.provenance === 'bootstrap_background'), true);
});

test('personhood cutover is idempotent and does not consume bootstrap RNG twice', () => {
  const core = legacyCoreWithPopulation(25);

  core.enablePersonhoodAuthority();
  const firstSnapshot = core.getPersonSnapshot();
  const firstRandom = core.kernel.random.snapshot();
  core.enablePersonhoodAuthority();

  assert.deepEqual(core.getPersonSnapshot(), firstSnapshot);
  assert.deepEqual(core.kernel.random.snapshot(), firstRandom);
});

test('personhood bootstrap uses an isolated named RNG stream', () => {
  const core = legacyCoreWithPopulation(10);
  const unrelated = core.kernel.random.stream('traffic/test-isolation');
  unrelated.next();
  const unrelatedState = unrelated.getState();

  core.enablePersonhoodAuthority();

  assert.equal(core.kernel.random.stream('traffic/test-isolation').getState(), unrelatedState);
  assert.equal(core.kernel.random.listNames().includes('demographics/person-bootstrap'), true);
});

test('legacy city stepping remains valid after personhood authority cutover', () => {
  const core = legacyCoreWithPopulation(10);
  core.enablePersonhoodAuthority();

  core.step(1);

  assert.equal(core.population.population, 10);
  assert.equal(core.getPersonSnapshot().population, 10);
});
