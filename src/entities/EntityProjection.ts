import {
  canonicalLegacyKey,
  ordinalCompare,
  type ProjectedEntity,
  type ProjectedReferenceIntent,
  type UnresolvedEntityReference,
} from './EntityTypes.ts';
import {
  EntityRegistry,
  preparedEntityView,
} from './EntityRegistry.ts';
import {
  EntityReferenceGraph,
  type EntityReference,
} from './EntityReferenceGraph.ts';

export type EntityProjectionData = Readonly<{
  entities: readonly ProjectedEntity[];
  references: readonly ProjectedReferenceIntent[];
  unresolved: readonly UnresolvedEntityReference[];
}>;

export type EntityProjectionCommitResult = Readonly<{
  activeEntities: number;
  references: number;
  unresolved: readonly UnresolvedEntityReference[];
}>;

function cloneEntity(entity: ProjectedEntity): ProjectedEntity {
  const metadata = entity.metadata === undefined ? undefined : Object.freeze({ ...entity.metadata });
  return metadata === undefined
    ? Object.freeze({ kind: entity.kind, legacyId: entity.legacyId, incarnationToken: entity.incarnationToken })
    : Object.freeze({ kind: entity.kind, legacyId: entity.legacyId, incarnationToken: entity.incarnationToken, metadata });
}

function cloneIntent(intent: ProjectedReferenceIntent): ProjectedReferenceIntent {
  const base = {
    source: Object.freeze({ ...intent.source }),
    target: Object.freeze({ ...intent.target }),
    semantics: intent.semantics,
    relation: intent.relation,
  } as const;
  return intent.targetIncarnationToken === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, targetIncarnationToken: intent.targetIncarnationToken });
}

function cloneUnresolved(reference: UnresolvedEntityReference): UnresolvedEntityReference {
  return Object.freeze({
    source: Object.freeze({ ...reference.source }),
    target: Object.freeze({ ...reference.target }),
    semantics: reference.semantics,
    relation: reference.relation,
    reason: reference.reason,
  });
}

function compareIntent(a: ProjectedReferenceIntent, b: ProjectedReferenceIntent): number {
  return ordinalCompare(canonicalLegacyKey(a.source), canonicalLegacyKey(b.source))
    || ordinalCompare(a.relation, b.relation)
    || ordinalCompare(a.semantics, b.semantics)
    || ordinalCompare(canonicalLegacyKey(a.target), canonicalLegacyKey(b.target))
    || ordinalCompare(a.targetIncarnationToken ?? '', b.targetIncarnationToken ?? '');
}

function compareUnresolved(a: UnresolvedEntityReference, b: UnresolvedEntityReference): number {
  return ordinalCompare(canonicalLegacyKey(a.source), canonicalLegacyKey(b.source))
    || ordinalCompare(a.relation, b.relation)
    || ordinalCompare(a.semantics, b.semantics)
    || ordinalCompare(canonicalLegacyKey(a.target), canonicalLegacyKey(b.target))
    || ordinalCompare(a.reason, b.reason);
}

export class EntityProjectionBuilder {
  private readonly entities: ProjectedEntity[] = [];
  private readonly references: ProjectedReferenceIntent[] = [];
  private readonly unresolvedReferences: UnresolvedEntityReference[] = [];

  entity(entity: ProjectedEntity): this {
    this.entities.push(cloneEntity(entity));
    return this;
  }

  reference(reference: ProjectedReferenceIntent): this {
    this.references.push(cloneIntent(reference));
    return this;
  }

  unresolved(reference: UnresolvedEntityReference): this {
    this.unresolvedReferences.push(cloneUnresolved(reference));
    return this;
  }

  build(): EntityProjectionData {
    return Object.freeze({
      entities: Object.freeze(this.entities.map(cloneEntity)),
      references: Object.freeze(this.references.map(cloneIntent)),
      unresolved: Object.freeze(this.unresolvedReferences.map(cloneUnresolved).sort(compareUnresolved)),
    });
  }
}

function requireNonEmptyRelation(relation: string): void {
  if (relation.trim().length === 0) throw new Error('entity reference relation must not be empty');
}

export function commitEntityProjection(
  registry: EntityRegistry,
  graph: EntityReferenceGraph,
  projection: EntityProjectionData,
): EntityProjectionCommitResult {
  const preparedRegistry = registry.prepareProjection(projection.entities);
  const view = preparedEntityView(preparedRegistry);
  const resolved: EntityReference[] = [];
  const unresolved: UnresolvedEntityReference[] = projection.unresolved.map(cloneUnresolved);

  const intents = projection.references.map(cloneIntent).sort(compareIntent);
  for (const intent of intents) {
    requireNonEmptyRelation(intent.relation);
    const source = view.resolve(intent.source.kind, intent.source.legacyId);
    if (!source) {
      throw new Error(`entity reference source is not active: ${canonicalLegacyKey(intent.source)}`);
    }

    if (intent.semantics === 'external') {
      unresolved.push(cloneUnresolved({
        source: intent.source,
        target: intent.target,
        semantics: 'external',
        relation: intent.relation,
        reason: 'external target is outside the active entity registry',
      }));
      continue;
    }

    if (intent.semantics === 'strong' || intent.semantics === 'owned') {
      const target = view.resolve(intent.target.kind, intent.target.legacyId);
      if (!target) {
        throw new Error(`${intent.semantics} entity reference target is not active: ${canonicalLegacyKey(intent.target)}`);
      }
      resolved.push(Object.freeze({ source, target, semantics: intent.semantics, relation: intent.relation }));
      continue;
    }

    const target = intent.targetIncarnationToken === undefined
      ? view.resolve(intent.target.kind, intent.target.legacyId)
      : view.resolveKnownByToken(intent.target.kind, intent.target.legacyId, intent.targetIncarnationToken);
    if (!target) {
      unresolved.push(cloneUnresolved({
        source: intent.source,
        target: intent.target,
        semantics: 'weak',
        relation: intent.relation,
        reason: intent.targetIncarnationToken === undefined
          ? 'weak target has no active known incarnation'
          : 'could not resolve exact known target incarnation',
      }));
      continue;
    }
    resolved.push(Object.freeze({ source, target, semantics: 'weak', relation: intent.relation }));
  }

  const preparedGraph = graph.prepare(resolved, view);
  const sortedUnresolved = Object.freeze(unresolved.map(cloneUnresolved).sort(compareUnresolved));

  registry.commitPrepared(preparedRegistry);
  graph.commitPrepared(preparedGraph);

  return Object.freeze({
    activeEntities: registry.listActive().length,
    references: graph.list().length,
    unresolved: sortedUnresolved,
  });
}
