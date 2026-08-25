import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydrateCore,
  hydrateCoreV8,
  serializeCore,
  serializeCoreV7,
  serializeCoreV8,
} from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { flatTerrain } from './support/kernelParity.ts';

function coreWithPopulation(population: number, seed = 811): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(16, 10), seed, startingFunds: 1_000_000 });
  core.population.restore(population);
  return core;
}

test('default save upgrades an enabled Personhood core to canonical Save V8', () => {
  const core = coreWithPopulation(25);
  core.enablePersonhoodAuthority();

  const save = serializeCore(core);

  assert.equal(save.saveVersion, 8);
  assert.equal(save.gameVersion, '0.8.0-personhood');
  assert.ok('personhood' in save);
  if (!('personhood' in save)) throw new Error('expected personhood payload');
  assert.deepEqual(save.personhood.people, core.getPersonSnapshot().people);
});

test('Save V8 restores exact people without rerunning bootstrap', () => {
  const core = coreWithPopulation(40);
  core.enablePersonhoodAuthority();
  const save = serializeCoreV8(core);

  const loaded = hydrateCore(structuredClone(save));

  assert.deepEqual(loaded.getPersonSnapshot(), core.getPersonSnapshot());
  assert.equal(loaded.population.population, 40);
  assert.equal(loaded.entityRegistry.listActive('person').length, 40);
  assert.equal(loaded.kernel.random.listNames().includes('demographics/person-bootstrap'), false);
  assert.deepEqual(serializeCoreV8(loaded), save);
});

test('explicit V7 to V8 migration materializes legacy residents exactly once', () => {
  const legacy = coreWithPopulation(17);
  const v7 = serializeCoreV7(legacy);

  const migrated = hydrateCoreV8(structuredClone(v7));
  const first = migrated.getPersonSnapshot();
  const v8 = serializeCoreV8(migrated);
  const restored = hydrateCoreV8(structuredClone(v8));

  assert.equal(first.population, 17);
  assert.equal(first.people.length, 17);
  assert.equal(first.people.every((person) => person.provenance === 'bootstrap_background'), true);
  assert.deepEqual(restored.getPersonSnapshot(), first);
  assert.equal(restored.kernel.random.listNames().includes('demographics/person-bootstrap'), false);
});

test('Save V8 rejects a person payload that disagrees with the authoritative population envelope', () => {
  const core = coreWithPopulation(8);
  core.enablePersonhoodAuthority();
  const corrupt = structuredClone(serializeCoreV8(core)) as any;
  corrupt.personhood.people.pop();

  assert.throws(() => hydrateCore(corrupt), /person.*population|population.*person/i);
});
