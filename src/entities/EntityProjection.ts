import {
  canonicalLegacyKey,
  ordinalCompare,
  type EntityKind,
  type ProjectedEntity,
  type ProjectedReferenceIntent,
  type UnresolvedEntityReference,
} from './EntityTypes.ts';
import {
  EntityRegistry,
  preparedEntityPartitionView,
  preparedEntityView,
  type KnownEntityView,
  type PreparedEntityPartitionProjection,
} from './EntityRegistry.ts';
import {
  EntityReferenceGraph,
  type EntityReference,
  type PreparedReferencePartition,
} from './EntityReferenceGraph.ts';

export type EntityProjectionData = Readonly<{
  entities: readonly ProjectedEntity[];
  references: readonly ProjectedReferenceIntent[];
  unresolved: readonly UnresolvedEntityReference[];
}>;

export type EntityProjectionPartition = Readonly<{
  id: string;
  ownedKinds: readonly EntityKind[];
  revisionKey: string;
  projection: EntityProjectionData;
}>;

export type EntityProjectionCommitResult = Readonly<{
  activeEntities: number;
  references: number;
  unresolved: readonly UnresolvedEntityReference[];
}>;

type ProjectionCommitCache = Readonly<{
  graph: EntityReferenceGraph;
  projection: EntityProjectionData;
  registryRevision: number;
  graphRevision: number;
  result: EntityProjectionCommitResult;
}>;

const projectionCommitCache = new WeakMap<EntityRegistry, ProjectionCommitCache>();

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

function resolveReferences(
  projection: EntityProjectionData,
  view: KnownEntityView,
): Readonly<{ resolved: readonly EntityReference[]; unresolved: readonly UnresolvedEntityReference[] }> {
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

  return Object.freeze({
    resolved: Object.freeze(resolved),
    unresolved: Object.freeze(unresolved.map(cloneUnresolved).sort(compareUnresolved)),
  });
}

function validatePartitions(partitions: readonly EntityProjectionPartition[]): readonly EntityProjectionPartition[] {
  const normalized = [...partitions].sort((a, b) => ordinalCompare(a.id, b.id));
  const ids = new Set<string>();
  const kindOwner = new Map<EntityKind, string>();

  for (const partition of normalized) {
    if (partition.id.trim().length === 0) throw new Error('entity projection partition id must not be empty');
    if (ids.has(partition.id)) throw new Error(`duplicate entity projection partition id: ${partition.id}`);
    ids.add(partition.id);
    if (partition.ownedKinds.length === 0) {
      throw new Error(`entity projection partition ${partition.id} must own at least one entity kind`);
    }

    const ownedKinds = new Set<EntityKind>();
    for (const kind of partition.ownedKinds) {
      if (ownedKinds.has(kind)) throw new Error(`duplicate owned entity kind ${kind} in partition ${partition.id}`);
      ownedKinds.add(kind);
      const existingOwner = kindOwner.get(kind);
      if (existingOwner) throw new Error(`entity kind ${kind} is owned by both ${existingOwner} and ${partition.id}`);
      kindOwner.set(kind, partition.id);
    }

    for (const entity of partition.projection.entities) {
      if (!ownedKinds.has(entity.kind)) {
        throw new Error(`partition ${partition.id} projected unowned entity kind ${entity.kind}`);
      }
    }
    for (const reference of partition.projection.references) {
      if (!ownedKinds.has(reference.source.kind)) {
        throw new Error(`partition ${partition.id} projected reference from unowned source kind ${reference.source.kind}`);
      }
    }
    for (const reference of partition.projection.unresolved) {
      if (!ownedKinds.has(reference.source.kind)) {
        throw new Error(`partition ${partition.id} projected unresolved reference from unowned source kind ${reference.source.kind}`);
      }
    }
  }

  return Object.freeze(normalized);
}

export function commitEntityProjection(
  registry: EntityRegistry,
  graph: EntityReferenceGraph,
  projection: EntityProjectionData,
): EntityProjectionCommitResult {
  const cached = projectionCommitCache.get(registry);
  if (cached
    && cached.graph === graph
    && cached.projection === projection
    && cached.registryRevision === registry.commitRevision
    && cached.graphRevision === graph.commitRevision) {
    return cached.result;
  }

  const preparedRegistry = registry.prepareProjection(projection.entities);
  const view = preparedEntityView(preparedRegistry);
  const resolved = resolveReferences(projection, view);
  const preparedGraph = graph.prepare(resolved.resolved, view);

  registry.commitPrepared(preparedRegistry);
  graph.commitPrepared(preparedGraph);

  const result = Object.freeze({
    activeEntities: registry.activeCount,
    references: graph.count,
    unresolved: resolved.unresolved,
  });
  projectionCommitCache.set(registry, Object.freeze({
    graph,
    projection,
    registryRevision: registry.commitRevision,
    graphRevision: graph.commitRevision,
    result,
  }));
  return result;
}

export function commitEntityProjectionPartitions(
  registry: EntityRegistry,
  graph: EntityReferenceGraph,
  partitions: readonly EntityProjectionPartition[],
): EntityProjectionCommitResult {
  const normalized = validatePartitions(partitions);
  const preparedRegistryPartitions: PreparedEntityPartitionProjection[] = normalized.map((partition) =>
    registry.preparePartitionProjection(partition.ownedKinds, partition.projection.entities));
  const view = preparedEntityPartitionView(registry, preparedRegistryPartitions);

  const preparedGraphPartitions: PreparedReferencePartition[] = [];
  const unresolved: UnresolvedEntityReference[] = [];
  for (const partition of normalized) {
    const resolved = resolveReferences(partition.projection, view);
    preparedGraphPartitions.push(graph.preparePartition(partition.ownedKinds, resolved.resolved, view));
    unresolved.push(...resolved.unresolved.map(cloneUnresolved));
  }

  registry.commitPreparedPartitions(preparedRegistryPartitions);
  graph.commitPreparedPartitions(preparedGraphPartitions);

  return Object.freeze({
    activeEntities: registry.activeCount,
    references: graph.count,
    unresolved: Object.freeze(unresolved.sort(compareUnresolved)),
  });
}