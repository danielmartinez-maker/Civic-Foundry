import type { PersonEntityBridge } from './PersonEntityBridge.ts';
import type { PersonStore } from './PersonStore.ts';
import {
  normalizePersonCreateInput,
  type PersonCreateInput,
  type PersonLifeStage,
  type PersonHistoryProvenance,
  type PersonLocationState,
  type PersonRecord,
} from './PersonTypes.ts';

export type PersonSavePayload = Readonly<{
  people: readonly PersonRecord[];
}>;

const LIFE_STAGES = new Set<PersonLifeStage>(['child', 'teen', 'adult', 'senior']);
const PROVENANCE = new Set<PersonHistoryProvenance>([
  'bootstrap_background',
  'simulated_event',
  'imported_fact',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLocation(value: unknown): PersonLocationState {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('person location must be an object');
  if (value.kind === 'unknown') return Object.freeze({ kind: 'unknown' });
  if ((value.kind === 'building' || value.kind === 'network') && typeof value.entityId === 'string') {
    return Object.freeze({ kind: value.kind, entityId: value.entityId });
  }
  throw new Error('invalid person location');
}

function parsePerson(value: unknown): PersonRecord {
  if (!isRecord(value)) throw new Error('person must be an object');
  if (typeof value.id !== 'string') throw new Error('invalid person id');
  if (typeof value.displayName !== 'string') throw new Error('displayName must be a string');
  if (typeof value.birthTick !== 'number') throw new Error('birthTick must be a number');
  if (typeof value.alive !== 'boolean') throw new Error('alive must be boolean');
  if (typeof value.resident !== 'boolean') throw new Error('resident must be boolean');
  if (value.householdId !== null && typeof value.householdId !== 'string') throw new Error('householdId must be string or null');
  if (value.homeEntityId !== null && typeof value.homeEntityId !== 'string') throw new Error('homeEntityId must be string or null');
  if (typeof value.lifeStage !== 'string' || !LIFE_STAGES.has(value.lifeStage as PersonLifeStage)) throw new Error('invalid lifeStage');
  if (typeof value.provenance !== 'string' || !PROVENANCE.has(value.provenance as PersonHistoryProvenance)) throw new Error('invalid provenance');

  return normalizePersonCreateInput({
    id: value.id as PersonCreateInput['id'],
    displayName: value.displayName,
    birthTick: value.birthTick,
    alive: value.alive,
    resident: value.resident,
    householdId: value.householdId as PersonCreateInput['householdId'],
    homeEntityId: value.homeEntityId,
    location: parseLocation(value.location),
    lifeStage: value.lifeStage as PersonLifeStage,
    provenance: value.provenance as PersonHistoryProvenance,
  });
}

function clonePerson(person: PersonRecord): PersonRecord {
  return Object.freeze({
    ...person,
    location: Object.freeze({ ...person.location }),
  });
}

export function serializePeople(store: PersonStore): PersonSavePayload {
  const people = Object.freeze(store.list().map(clonePerson));
  return Object.freeze({ people });
}

export function restorePeople(input: unknown, bridge: PersonEntityBridge): readonly PersonRecord[] {
  if (!isRecord(input)) throw new Error('person save payload must be an object');
  if (!Array.isArray(input.people)) throw new Error('people must be an array');

  const people = input.people.map(parsePerson);
  const ids = new Set<string>();
  for (const person of people) {
    if (ids.has(person.id)) throw new Error(`duplicate person: ${person.id}`);
    ids.add(person.id);
  }

  return bridge.createPeople(people);
}
