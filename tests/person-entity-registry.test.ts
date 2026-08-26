import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { PersonEntityBridge } from '../src/simulation/people/PersonEntityBridge.ts';
import { PersonStore } from '../src/simulation/people/PersonStore.ts';
import { createPersonId } from '../src/simulation/people/PersonTypes.ts';

function personInput(n: number) {
  return {
    id: createPersonId(n),
    displayName: `Person ${n}`,
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' as const },
    lifeStage: 'adult' as const,
    provenance: 'bootstrap_background' as const,
  };
}

test('creating a person registers one stable person entity without disturbing unrelated registry partitions', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'building:1:v1' },
  ]));
  const building = registry.require('building', 'building:1');

  const store = new PersonStore();
  const bridge = new PersonEntityBridge(store, registry);
  const person = bridge.createPerson(personInput(1));

  assert.equal(person.id, 'person:1');
  const handle = registry.require('person', 'person:1');
  assert.equal(handle.generation, 1);
  assert.deepEqual(registry.require('building', 'building:1'), building);
  assert.equal(registry.listActive('person').length, 1);
});

test('synchronizing death updates metadata without deleting or reincarnating the person entity', () => {
  const registry = new EntityRegistry();
  const store = new PersonStore();
  const bridge = new PersonEntityBridge(store, registry);
  bridge.createPerson(personInput(1));
  const before = registry.require('person', 'person:1');

  store.markDead(createPersonId(1));
  bridge.sync();

  const after = registry.require('person', 'person:1');
  assert.deepEqual(after, before);
  assert.equal(registry.listHistorical('person').length, 0);
});

test('duplicate person creation fails without advancing registry identity', () => {
  const registry = new EntityRegistry();
  const store = new PersonStore();
  const bridge = new PersonEntityBridge(store, registry);
  bridge.createPerson(personInput(1));
  const before = registry.snapshot();

  assert.throws(() => bridge.createPerson(personInput(1)), /duplicate person/i);
  assert.deepEqual(registry.snapshot(), before);
  assert.equal(store.size(), 1);
});
