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
  constructor(
    private readonly store: PersonStore,
    private readonly registry: EntityRegistry,
  ) {}

  createPerson(input: PersonCreateInput): PersonRecord {
    const normalized = normalizePersonCreateInput(input);
    if (this.store.get(normalized.id)) throw new Error(`duplicate person: ${normalized.id}`);

    const projectedPeople = [...this.store.list(), normalized].map(projectPerson);
    const prepared = this.registry.preparePartitionProjection(['person'], projectedPeople);
    this.registry.commitPreparedPartitions([prepared]);
    return this.store.create(normalized);
  }

  sync(): void {
    const prepared = this.registry.preparePartitionProjection(
      ['person'],
      this.store.list().map(projectPerson),
    );
    this.registry.commitPreparedPartitions([prepared]);
  }
}
