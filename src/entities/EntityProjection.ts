import {
  canonicalHandleKey,
  canonicalLegacyKey,
  ordinalCompare,
  type EntityHandle,
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
import { markEntityIntegrityValidated } from './EntityDiagnostics.ts';

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

type PartitionProjectionCommitCache = Readonly<{
  graph: EntityReferenceGraph;
  manifestSignature: string;
  revisionByPartitionId: ReadonlyMap<string, string>;
  partitionById: ReadonlyMap<string, EntityProjectionPartition>;
  unresolvedByPartitionId: ReadonlyMap<string, readonly UnresolvedEntityReference[]>;
  registryRevision: number;
  graphRevision: number;
  result: EntityProjectionCommitResult;
}>;

const projectionCommitCache = new WeakMap<EntityRegistry, ProjectionCommitCache>();
const partitionProjectionCommitCache = new WeakMap<EntityRegistry, PartitionProjectionCommitCache>();

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

function encodePart(value: string): string {
  return `${value.length}:${value}`;
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

function partitionManifestSignature(partitions: readonly EntityProjectionPartition[]): string {
  return partitions.map((partition) => {
    const kinds = [...partition.ownedKinds].sort(ordinalCompare).map(encodePart).join('');
    return `${encodePart(partition.id)}|${encodePart(kinds)}`;
  }).join('|');
}

function copyUnresolvedByPartition(
  source: ReadonlyMap<string, readonly UnresolvedEntityReference[]> | undefined,
): Map<string, readonly UnresolvedEntityReference[]> {
  const result = new Map<string, readonly UnresolvedEntityReference[]>();
  for (const [id, unresolved] of source ?? []) {
    result.set(id, Object.freeze(unresolved.map(cloneUnresolved).sort(compareUnresolved)));
  }
  return result;
}

function validatePartitionLifecycle(
  graph: EntityReferenceGraph,
  preparedRegistryPartitions: readonly PreparedEntityPartitionProjection[],
  preparedGraphPartitions: readonly PreparedReferencePartition[],
): void {
  const reconciledSourceKeys = new Set<string>();
  for (const prepared of preparedGraphPartitions) {
    for (const sourceKey of prepared.replacementsBySourceKey.keys()) reconciledSourceKeys.add(sourceKey);
    for (const sourceKey of prepared.removedSourceKeys) reconciledSourceKeys.add(sourceKey);
  }

  const deactivated = new Map<string, EntityHandle>();
  for (const prepared of preparedRegistryPartitions) {
    for (const record of prepared.knownUpdatesByHandleKey.values()) {
      if (!record.active) deactivated.set(canonicalHandleKey(record.handle), record.handle);
    }
  }

  for (const [targetKey, target] of [...deactivated.entries()].sort(([a], [b]) => ordinalCompare(a, b))) {
    for (const reference of graph.incoming(target)) {
      if (reference.semantics !== 'strong' && reference.semantics !== 'owned') continue;
      if (reconciledSourceKeys.has(canonicalHandleKey(reference.source))) continue;
      throw new Error(
        `${reference.semantics} inbound entity reference prevents target replacement or deletion: ${targetKey}`,
      );
    }
  }
}

function changedHandleKindsFor(
  registry: EntityRegistry,
  preparedRegistryPartitions: readonly PreparedEntityPartitionProjection[],
): ReadonlySet<EntityKind> {
  const changedKinds = new Set<EntityKind>();
  for (const prepared of preparedRegistryPartitions) {
    for (const record of prepared.activeUpdatesByLegacyKey.values()) {
      const current = registry.resolve(record.handle.kind, record.handle.legacyId);
      if (!current || canonicalHandleKey(current) !== canonicalHandleKey(record.handle)) {
        changedKinds.add(record.handle.kind);
      }
    }
    if (prepared.removedLegacyKeys.length > 0) {
      for (const kind of prepared.ownedKinds) changedKinds.add(kind);
    }
  }
  return changedKinds;
}

function requiresFullReferenceResolution(
  partition: EntityProjectionPartition,
  changedHandleKinds: ReadonlySet<EntityKind>,
): boolean {
  return partition.projection.references.some((intent) => changedHandleKinds.has(intent.target.kind))
    || partition.projection.unresolved.some((reference) => changedHandleKinds.has(reference.target.kind));
}

function previousEntitiesByLegacyKey(
  partition: EntityProjectionPartition | undefined,
): ReadonlyMap<string, ProjectedEntity> {
  const result = new Map<string, ProjectedEntity>();
  for (const entity of partition?.projection.entities ?? []) result.set(canonicalLegacyKey(entity), entity);
  return result;
}

function removedSourceHandleKeys(
  registry: EntityRegistry,
  prepared: PreparedEntityPartitionProjection,
  previousPartition: EntityProjectionPartition | undefined,
): readonly string[] {
  const removed = new Set<string>();
  const previousEntities = previousEntitiesByLegacyKey(previousPartition);

  for (const legacyKey of prepared.removedLegacyKeys) {
    const previous = previousEntities.get(legacyKey);
    if (!previous) continue;
    const current = registry.resolve(previous.kind, previous.legacyId);
    if (current) removed.add(canonicalHandleKey(current));
  }

  for (const record of prepared.activeUpdatesByLegacyKey.values()) {
    const current = registry.resolve(record.handle.kind, record.handle.legacyId);
    if (current && canonicalHandleKey(current) !== canonicalHandleKey(record.handle)) {
      removed.add(canonicalHandleKey(current));
    }
  }

  return Object.freeze([...removed].sort(ordinalCompare));
}

function deltaProjectionFor(
  partition: EntityProjectionPartition,
  prepared: PreparedEntityPartitionProjection,
): Readonly<{
  projection: EntityProjectionData;
  reconciledLegacyKeys: ReadonlySet<string>;
}> {
  const changedSourceLegacyKeys = new Set<string>(prepared.activeUpdatesByLegacyKey.keys());
  const reconciledLegacyKeys = new Set<string>(changedSourceLegacyKeys);
  for (const key of prepared.removedLegacyKeys) reconciledLegacyKeys.add(key);

  return Object.freeze({
    projection: Object.freeze({
      entities: Object.freeze([]),
      references: Object.freeze(
        partition.projection.references.filter((intent) => changedSourceLegacyKeys.has(canonicalLegacyKey(intent.source))),
      ),
      unresolved: Object.freeze(
        partition.projection.unresolved.filter((reference) => changedSourceLegacyKeys.has(canonicalLegacyKey(reference.source))),
      ),
    }),
    reconciledLegacyKeys,
  });
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
  const manifestSignature = partitionManifestSignature(normalized);
  const cached = partitionProjectionCommitCache.get(registry);
  const revisionsMatch = cached !== undefined
    && cached.graph === graph
    && cached.registryRevision === registry.commitRevision
    && cached.graphRevision === graph.commitRevision;

  if (revisionsMatch && cached.manifestSignature !== manifestSignature) {
    throw new Error('entity projection partition manifest changed for committed registry');
  }

  const cacheUsable = revisionsMatch && cached.manifestSignature === manifestSignature;
  const changedPartitions = cacheUsable
    ? normalized.filter((partition) => cached.revisionByPartitionId.get(partition.id) !== partition.revisionKey)
    : normalized;

  if (cacheUsable && changedPartitions.length === 0) return cached.result;

  const preparedRegistryPartitions: PreparedEntityPartitionProjection[] = changedPartitions.map((partition) =>
    registry.preparePartitionProjection(partition.ownedKinds, partition.projection.entities));
  const view = preparedEntityPartitionView(registry, preparedRegistryPartitions);
  const changedHandleKinds = changedHandleKindsFor(registry, preparedRegistryPartitions);

  const preparedGraphPartitions: PreparedReferencePartition[] = [];
  const unresolvedByPartitionId = copyUnresolvedByPartition(cacheUsable ? cached.unresolvedByPartitionId : undefined);
  for (let index = 0; index < changedPartitions.length; index++) {
    const partition = changedPartitions[index]!;
    const preparedRegistry = preparedRegistryPartitions[index]!;

    if (!cacheUsable || requiresFullReferenceResolution(partition, changedHandleKinds)) {
      const resolved = resolveReferences(partition.projection, view);
      preparedGraphPartitions.push(graph.preparePartition(partition.ownedKinds, resolved.resolved, view));
      unresolvedByPartitionId.set(
        partition.id,
        Object.freeze(resolved.unresolved.map(cloneUnresolved).sort(compareUnresolved)),
      );
      continue;
    }

    const delta = deltaProjectionFor(partition, preparedRegistry);
    const resolved = resolveReferences(delta.projection, view);
    const previousPartition = cached.partitionById.get(partition.id);
    preparedGraphPartitions.push(graph.prepareSourceDelta(
      partition.ownedKinds,
      resolved.resolved,
      removedSourceHandleKeys(registry, preparedRegistry, previousPartition),
      view,
    ));

    const previousUnresolved = unresolvedByPartitionId.get(partition.id) ?? [];
    unresolvedByPartitionId.set(
      partition.id,
      Object.freeze([
        ...previousUnresolved.filter(
          (reference) => !delta.reconciledLegacyKeys.has(canonicalLegacyKey(reference.source)),
        ),
        ...resolved.unresolved,
      ].map(cloneUnresolved).sort(compareUnresolved)),
    );
  }

  validatePartitionLifecycle(graph, preparedRegistryPartitions, preparedGraphPartitions);
  registry.commitPreparedPartitions(preparedRegistryPartitions);
  graph.commitPreparedPartitions(preparedGraphPartitions);
  markEntityIntegrityValidated(registry, graph);

  const unresolved = Object.freeze(
    normalized
      .flatMap((partition) => unresolvedByPartitionId.get(partition.id) ?? [])
      .map(cloneUnresolved)
      .sort(compareUnresolved),
  );
  const result = Object.freeze({
    activeEntities: registry.activeCount,
    references: graph.count,
    unresolved,
  });
  const revisionByPartitionId = new Map<string, string>();
  const partitionById = new Map<string, EntityProjectionPartition>();
  for (const partition of normalized) {
    revisionByPartitionId.set(partition.id, partition.revisionKey);
    partitionById.set(partition.id, partition);
  }

  partitionProjectionCommitCache.set(registry, Object.freeze({
    graph,
    manifestSignature,
    revisionByPartitionId,
    partitionById,
    unresolvedByPartitionId,
    registryRevision: registry.commitRevision,
    graphRevision: graph.commitRevision,
    result,
  }));
  return result;
}
