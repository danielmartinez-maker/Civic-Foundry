import type { EntityRegistry } from '../../entities/EntityRegistry.ts';
import { PersonPopulationProjection } from './PersonPopulationProjection.ts';
import type { PersonStore } from './PersonStore.ts';
import { personSequence } from './PersonTypes.ts';

export function validatePersonState(store: PersonStore, registry: EntityRegistry): void {
  const people = store.list();
  const storeIds = new Set(people.map((person) => person.id));

  for (const person of people) {
    try {
      personSequence(person.id);
    } catch {
      throw new Error(`invalid living person id: ${person.id}`);
    }

    const registryHandle = registry.resolve('person', person.id);
    if (!registryHandle) throw new Error(`registry missing person: ${person.id}`);

    if (!person.alive && person.resident) {
      throw new Error(`deceased person cannot remain resident: ${person.id}`);
    }

    if (person.householdId !== null && !registry.resolve('household', person.householdId)) {
      throw new Error(`missing household registry identity: ${person.householdId} for ${person.id}`);
    }
  }

  for (const handle of registry.listActive('person')) {
    if (!storeIds.has(handle.legacyId as never)) {
      throw new Error(`store missing registry person: ${handle.legacyId}`);
    }
  }

  const projectionPopulation = new PersonPopulationProjection(store).snapshot().population;
  const livingResidentCount = store.livingResidents().length;
  if (projectionPopulation !== livingResidentCount) {
    throw new Error(
      `person population projection mismatch: projection=${projectionPopulation} livingResidents=${livingResidentCount}`,
    );
  }
}
