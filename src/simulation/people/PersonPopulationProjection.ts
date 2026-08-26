import { PersonStore } from './PersonStore.ts';

export type PersonPopulationSnapshot = Readonly<{
  population: number;
  totalPersonRecords: number;
  nonresidentLiving: number;
  deceased: number;
}>;

export class PersonPopulationProjection {
  private readonly store: PersonStore;

  constructor(store: PersonStore) {
    this.store = store;
  }

  snapshot(): PersonPopulationSnapshot {
    const all = this.store.list();
    let population = 0;
    let nonresidentLiving = 0;
    let deceased = 0;

    for (const person of all) {
      if (!person.alive) {
        deceased += 1;
      } else if (person.resident) {
        population += 1;
      } else {
        nonresidentLiving += 1;
      }
    }

    return Object.freeze({
      population,
      totalPersonRecords: all.length,
      nonresidentLiving,
      deceased,
    });
  }
}
