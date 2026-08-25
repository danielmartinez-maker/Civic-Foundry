import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { PersonEntityBridge } from '../src/simulation/people/PersonEntityBridge.ts';
import { restorePeople, serializePeople } from '../src/simulation/people/PersonPersistence.ts';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { createPersonId, type PersonCreateInput } from '../src/simulation/people/PersonTypes.ts';

function fixture() {
  const store = new PersonStore();
  const registry = new EntityRegistry();
  const bridge = new PersonEntityBridge(store, registry);
  return { store, registry, bridge };
}

function person(n: number, patch: Partial<PersonCreateInput> = {}): PersonCreateInput {
  return {
    id: createPersonId(n),
    displayName: `Person ${n}`,
    birthTick: -n,
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

test('person save payload is canonical, deeply isolated, and round-trips', () => {
  const source = fixture();
  source.bridge.createPerson(person(10));
  source.bridge.createPerson(person(2, { location: { kind: 'building', entityId: 'building:5' } }));
  source.bridge.createPerson(person(1, { resident: false }));

  const payload = serializePeople(source.store);
  assert.deepEqual(payload.people.map((value) => value.id), ['person:1', 'person:2', 'person:10']);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.people), true);
  assert.equal(Object.isFrozen(payload.people[1]?.location), true);

  const target = fixture();
  restorePeople(payload, target.bridge);
  assert.deepEqual(serializePeople(target.store), payload);
  assert.equal(target.registry.listActive('person').length, 3);
});

test('restore rejects duplicate payload identities without partial mutation', () => {
  const target = fixture();
  const payload = {
    people: [person(2), person(1), person(2)],
  };

  assert.throws(() => restorePeople(payload, target.bridge), /duplicate person/i);
  assert.equal(target.store.size(), 0);
  assert.equal(target.registry.listActive('person').length, 0);
});

test('restore is atomic when target already owns one incoming identity', () => {
  const target = fixture();
  target.bridge.createPerson(person(2));
  const beforeStore = serializePeople(target.store);
  const beforeRegistry = target.registry.snapshot();

  assert.throws(() => restorePeople({ people: [person(1), person(2)] }, target.bridge), /duplicate person/i);
  assert.deepEqual(serializePeople(target.store), beforeStore);
  assert.deepEqual(target.registry.snapshot(), beforeRegistry);
});

test('restore rejects malformed person payloads before mutation', () => {
  const target = fixture();
  assert.throws(() => restorePeople({ people: [{ ...person(1), id: 'building:1' }] }, target.bridge), /person id/i);
  assert.throws(() => restorePeople({ people: 'not-an-array' }, target.bridge), /people.*array/i);
  assert.equal(target.store.size(), 0);
});
