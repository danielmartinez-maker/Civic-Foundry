import { EntityRegistry } from '../../entities/EntityRegistry.ts';
import type { ProjectedEntity } from '../../entities/EntityTypes.ts';
import { PersonStore } from './PersonStore.ts';
import {
  normalizePersonCreateInput,
  type PersonCreateInput,
  type PersonRecord,
} from './PersonTypes.ts';

function projectPerson(person: PersonRecord): ProjectedEntity {
  return Object.freeze({
    kind: 'person',
    legacyId: person.id,
    incarnationToken: `person-identity:${person.id}`,
    metadata: Object.freeze({
      alive: person.alive,
      resident: person.resident,
      lifeStage: person.lifeStage,
      householdId: person.householdId,
      homeEntityId: person.homeEntityId,
    }),
  });
}

export class PersonEntityBridge {
  private readonly store: PersonStore;
  private readonly registry: EntityRegistry;

  constructor(store: PersonStore, registry: EntityRegistry) {
    this.store = store;
    this.registry = registry;
  }

  createPerson(input: PersonCreateInput): PersonRecord {
    const created = this.createPeople([input]);
    const person = created[0];
    if (!person) throw new Error('person batch creation returned no person');
    return person;
  }

  createPeople(inputs: readonly PersonCreateInput[]): readonly PersonRecord[] {
    const normalized = inputs.map((input) => normalizePersonCreateInput(input));
    const incomingIds = new Set<string>();

    for (const person of normalized) {
      if (incomingIds.has(person.id)) throw new Error(`duplicate person: ${person.id}`);
      incomingIds.add(person.id);
      if (this.store.get(person.id)) throw new Error(`duplicate person: ${person.id}`);
    }

    if (normalized.length === 0) return Object.freeze([]);

    const projectedPeople = [...this.store.list(), ...normalized].map(projectPerson);
    const prepared = this.registry.preparePartitionProjection(['person'], projectedPeople);
    this.registry.commitPreparedPartitions([prepared]);

    const created = normalized.map((person) => this.store.create(person));
    return Object.freeze(created);
  }

  sync(): void {
    const prepared = this.registry.preparePartitionProjection(
      ['person'],
      this.store.list().map(projectPerson),
    );
    this.registry.commitPreparedPartitions([prepared]);
  }
}
