import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydrateCore,
  hydrateCoreV8,
  serializeCore,
  serializeCoreV7,
  serializeCoreV8,
  serializeCoreV9,
} from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { flatTerrain } from './support/kernelParity.ts';

function coreWithPopulation(population: number, seed = 811): SimulationCore {
  const core = new SimulationCore({
    terrain: flatTerrain(16, 10),
    seed,
    startingFunds: 1_000_000,
  });
  core.population.restore(population);
  return core;
}

test('World Foundation keeps exclusive Save V8 ownership', () => {
  const v8 = serializeCoreV8(coreWithPopulation(8));
  assert.equal(v8.saveVersion, 8);
  assert.equal(v8.gameVersion, '0.8.0-world-foundation');
  assert.ok('world' in v8);
  assert.equal('personhood' in v8, false);
});

test('direct hydrateCoreV8 remains Personhood-free', () => {
  const v8 = serializeCoreV8(coreWithPopulation(11));
  const loaded = hydrateCoreV8(structuredClone(v8));
  assert.equal(loaded.isPersonhoodAuthorityEnabled(), false);
  assert.equal(loaded.entityRegistry.listActive('person').length, 0);
});

test('canonical hydration migrates V8 to Personhood exactly once', () => {
  const v8 = serializeCoreV8(coreWithPopulation(17));
  const migrated = hydrateCore(structuredClone(v8));
  assert.equal(migrated.isPersonhoodAuthorityEnabled(), true);
  assert.equal(migrated.getPersonSnapshot().population, 17);
  assert.equal(migrated.entityRegistry.listActive('person').length, 17);
  assert.equal(
    migrated.kernel.random.listNames().includes('demographics/person-bootstrap'),
    true,
  );

  const first = migrated.getPersonSnapshot();
  const v9 = serializeCore(migrated);
  assert.equal(v9.saveVersion, 9);

  const restored = hydrateCore(structuredClone(v9));
  assert.deepEqual(restored.getPersonSnapshot(), first);
  assert.equal(
    restored.kernel.random.listNames().includes('demographics/person-bootstrap'),
    false,
  );
});

test('canonical V7 migration passes through World Foundation before Personhood', () => {
  const v7 = serializeCoreV7(coreWithPopulation(13));
  const migrated = hydrateCore(structuredClone(v7));
  assert.equal(migrated.isPersonhoodAuthorityEnabled(), true);
  assert.equal(migrated.world.diagnosticSnapshot().mode, 'legacy-flat');
  assert.equal(migrated.getPersonSnapshot().population, 13);
  assert.equal(
    migrated.getPersonSnapshot().people.every(
      (person) => person.provenance === 'bootstrap_background',
    ),
    true,
  );
  assert.equal(serializeCore(migrated).saveVersion, 9);
});

test('enabled Personhood serializes as V9 with the V8 world envelope', () => {
  const core = coreWithPopulation(25);
  core.enablePersonhoodAuthority();
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 9);
  assert.equal(save.gameVersion, '0.9.0-personhood');
  assert.ok('world' in save);
  assert.ok('personhood' in save);
});

test('V9 exact restore rejects population mismatch before authority activation', () => {
  const core = coreWithPopulation(8);
  core.enablePersonhoodAuthority();
  const corrupt = structuredClone(serializeCoreV9(core)) as any;
  corrupt.personhood.people.pop();
  assert.throws(
    () => hydrateCore(corrupt),
    /person.*population|population.*person/i,
  );
});
