import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { SimulationClock } from '../src/simulation/core/SimulationClock.ts';
import { SimulationKernel } from '../src/simulation/kernel/SimulationKernel.ts';
import { PersonEntityBridge } from '../src/simulation/people/PersonEntityBridge.ts';
import { validatePersonState } from '../src/simulation/people/PersonInvariantSystem.ts';
import { buildPersonSnapshot } from '../src/simulation/people/PersonSnapshot.ts';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { createPersonId, type PersonCreateInput } from '../src/simulation/people/PersonTypes.ts';

function person(n: number, patch: Partial<PersonCreateInput> = {}): PersonCreateInput {
  return {
    id: createPersonId(n),
    displayName: `Person ${n}`,
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
    ...patch,
  };
}

function makeFixture() {
  const store = new PersonStore();
  const registry = new EntityRegistry();
  const bridge = new PersonEntityBridge(store, registry);
  return { store, registry, bridge };
}

test('person invariant rejects store record without matching registry identity', () => {
  const { store, registry } = makeFixture();
  store.create(person(1));
  assert.throws(() => validatePersonState(store, registry), /registry.*person:1/i);
});

test('person invariant rejects registry person without matching store record', () => {
  const { store, registry } = makeFixture();
  registry.commitPrepared(registry.prepareProjection([
    { kind: 'person', legacyId: 'person:9', incarnationToken: 'person-identity:person:9' },
  ]));
  assert.throws(() => validatePersonState(store, registry), /store.*person:9/i);
});

test('person invariant rejects deceased resident and missing household reference', () => {
  const deceased = makeFixture();
  deceased.bridge.createPerson(person(1, { alive: false, resident: true }));
  assert.throws(() => validatePersonState(deceased.store, deceased.registry), /deceased.*resident/i);

  const household = makeFixture();
  household.bridge.createPerson(person(2, { householdId: 'household:1' }));
  assert.throws(() => validatePersonState(household.store, household.registry), /household:1/i);
});

test('person snapshot sorts numerically and exposes stable aggregate counts', () => {
  const { store, bridge } = makeFixture();
  bridge.createPerson(person(10));
  bridge.createPerson(person(2));
  bridge.createPerson(person(1, { resident: false }));

  const snapshot = buildPersonSnapshot(store);
  assert.deepEqual(snapshot.people.map((value) => value.id), ['person:1', 'person:2', 'person:10']);
  assert.equal(snapshot.population, 2);
  assert.equal(snapshot.totalPersonRecords, 3);
  assert.equal(snapshot.nonresidentLiving, 1);
  assert.equal(snapshot.deceased, 0);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.people), true);
});

test('kernel registers person invariant and snapshot exactly once for the same domain', () => {
  const { store, registry, bridge } = makeFixture();
  bridge.createPerson(person(1));
  const kernel = new SimulationKernel({ clock: new SimulationClock(), seed: 5 });

  kernel.registerPersonDiagnostics(store, registry);
  kernel.registerPersonDiagnostics(store, registry);

  assert.ok(kernel.invariants.list().some((invariant) => invariant.id === 'person-state-valid'));
  assert.ok(kernel.snapshots.listIds().includes('people'));
  const snapshot = kernel.snapshots.capture('people') as { population: number };
  assert.equal(snapshot.population, 1);
  kernel.step(1);
});
