import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonPopulationProjection } from '../src/simulation/people/PersonPopulationProjection.ts';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { createPersonId, type PersonCreateInput } from '../src/simulation/people/PersonTypes.ts';
import { PopulationSystem } from '../src/simulation/population/PopulationSystem.ts';

function add(store: PersonStore, n: number, patch: Partial<PersonCreateInput> = {}): void {
  store.create({
    id: createPersonId(n),
    displayName: `P${n}`,
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
    ...patch,
  });
}

test('population projection counts only living resident people and reports retained identities', () => {
  const store = new PersonStore();
  add(store, 1);
  add(store, 2);
  add(store, 3, { resident: false });
  add(store, 4, { alive: false, resident: false });

  const snapshot = new PersonPopulationProjection(store).snapshot();
  assert.deepEqual(snapshot, {
    population: 2,
    totalPersonRecords: 4,
    nonresidentLiving: 1,
    deceased: 1,
  });
});

test('population compatibility facade remains scalar before person authority is attached', () => {
  const population = new PopulationSystem(10);
  population.update(20, 1);
  assert.equal(population.population, 12);
  population.restore(7);
  assert.equal(population.population, 7);
});

test('attached person projection becomes authoritative while legacy tick updates are inert', () => {
  const store = new PersonStore();
  add(store, 1);
  add(store, 2);
  const projection = new PersonPopulationProjection(store);
  const population = new PopulationSystem(99);

  population.attachPersonProjection(projection);
  assert.equal(population.population, 2);

  population.update(500, 1);
  assert.equal(population.population, 2);
  assert.throws(() => population.restore(500), /person-derived/i);

  store.markDead(createPersonId(2));
  assert.equal(population.population, 1);
});
