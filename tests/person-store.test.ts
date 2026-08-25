import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { createPersonId, type PersonCreateInput } from '../src/simulation/people/PersonTypes.ts';

function person(n: number): PersonCreateInput {
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
  };
}

test('store owns stable unique people and lists in numeric person sequence order', () => {
  const store = new PersonStore();
  store.create(person(10));
  store.create(person(2));
  store.create(person(1));
  assert.deepEqual(store.list().map((value) => value.id), ['person:1', 'person:2', 'person:10']);
  assert.throws(() => store.create(person(1)), /duplicate/i);
});

test('livingResidents excludes deceased and nonresident people', () => {
  const store = new PersonStore();
  store.create(person(1));
  store.create({ ...person(2), resident: false });
  store.create({ ...person(3), alive: false });
  assert.deepEqual(store.livingResidents().map((value) => value.id), ['person:1']);
});

test('updates preserve identity and markDead removes a person from living residents without deleting identity', () => {
  const store = new PersonStore();
  store.create(person(1));
  const renamed = store.update(createPersonId(1), { displayName: 'Updated Person' });
  assert.equal(renamed.id, 'person:1');
  assert.equal(renamed.displayName, 'Updated Person');

  const deceased = store.markDead(createPersonId(1));
  assert.equal(deceased.alive, false);
  assert.equal(deceased.resident, false);
  assert.equal(store.size(), 1);
  assert.equal(store.livingResidents().length, 0);
  assert.equal(store.require(createPersonId(1)).id, 'person:1');
});

test('missing people fail explicitly', () => {
  const store = new PersonStore();
  assert.equal(store.get(createPersonId(1)), undefined);
  assert.throws(() => store.require(createPersonId(1)), /missing person/i);
});
