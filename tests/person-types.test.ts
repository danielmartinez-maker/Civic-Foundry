import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonId, normalizePersonCreateInput } from '../src/simulation/people/PersonTypes.ts';

test('person identity and create input normalize deterministically', () => {
  const id = createPersonId(42);
  assert.equal(id, 'person:42');
  const value = normalizePersonCreateInput({
    id,
    displayName: '  Ana Torres  ',
    birthTick: 100,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  });
  assert.equal(value.id, 'person:42');
  assert.equal(value.displayName, 'Ana Torres');
  assert.equal(value.provenance, 'bootstrap_background');
});

test('invalid person identifiers are rejected', () => {
  assert.throws(() => normalizePersonCreateInput({
    id: 'building:42' as never,
    displayName: 'Bad Id',
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  }), /person id/i);
});

test('invalid birth tick and blank names are rejected', () => {
  const id = createPersonId(1);
  assert.throws(() => normalizePersonCreateInput({
    id,
    displayName: '   ',
    birthTick: 0,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  }), /displayName/i);
  assert.throws(() => normalizePersonCreateInput({
    id,
    displayName: 'Ana',
    birthTick: Number.NaN,
    alive: true,
    resident: true,
    householdId: null,
    homeEntityId: null,
    location: { kind: 'unknown' },
    lifeStage: 'adult',
    provenance: 'bootstrap_background',
  }), /birthTick/i);
});
