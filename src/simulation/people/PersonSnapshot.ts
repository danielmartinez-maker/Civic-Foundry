import { PersonPopulationProjection } from './PersonPopulationProjection.ts';
import type { PersonStore } from './PersonStore.ts';
import type { PersonRecord } from './PersonTypes.ts';

export type PersonSnapshotRecord = PersonRecord;

export type PersonSnapshot = Readonly<{
  population: number;
  totalPersonRecords: number;
  nonresidentLiving: number;
  deceased: number;
  people: readonly PersonSnapshotRecord[];
}>;

export function buildPersonSnapshot(store: PersonStore): PersonSnapshot {
  const counts = new PersonPopulationProjection(store).snapshot();
  const people = Object.freeze(
    store.list().map((person) => Object.freeze({
      ...person,
      location: Object.freeze({ ...person.location }),
    })),
  );

  return Object.freeze({
    ...counts,
    people,
  });
}
