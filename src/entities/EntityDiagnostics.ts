import {
  canonicalHandleKey,
  canonicalLegacyKey,
  ordinalCompare,
  type EntityKind,
  type UnresolvedEntityReference,
} from './EntityTypes.ts';
import type { EntityRegistry } from './EntityRegistry.ts';
import type { EntityReferenceGraph } from './EntityReferenceGraph.ts';

export type EntityDiagnosticsSnapshot = Readonly<{
  activeEntities: number;
  historicalEntities: number;
  references: number;
  unresolvedReferences: number;
  activeByKind: Readonly<Record<string, number>>;
  historicalByKind: Readonly<Record<string, number>>;
  unresolved: readonly UnresolvedEntityReference[];
}>;

type IntegrityCache = Readonly<{
  graph: EntityReferenceGraph;
  registryRevision: number;
  graphRevision: number;
}>;

const integrityCache = new WeakMap<EntityRegistry, IntegrityCache>();

function cloneUnresolved(reference: UnresolvedEntityReference): UnresolvedEntityReference {
  return Object.freeze({
    source: Object.freeze({ ...reference.source }),
    target: Object.freeze({ ...reference.target }),
    semantics: reference.semantics,
    relation: reference.relation,
    reason: reference.reason,
  });
}

function compareUnresolved(a: UnresolvedEntityReference, b: UnresolvedEntityReference): number {
  return ordinalCompare(canonicalLegacyKey(a.source), canonicalLegacyKey(b.source))
    || ordinalCompare(a.relation, b.relation)
    || ordinalCompare(a.semantics, b.semantics)
    || ordinalCompare(canonicalLegacyKey(a.target), canonicalLegacyKey(b.target))
    || ordinalCompare(a.reason, b.reason);
}

function countsByKind(handles: readonly Readonly<{ kind: EntityKind }>[]): Readonly<Record<string, number>> {
  const mutable = new Map<string, number>();
  for (const handle of handles) mutable.set(handle.kind, (mutable.get(handle.kind) ?? 0) + 1);
  const result: Record<string, number> = {};
  for (const key of [...mutable.keys()].sort(ordinalCompare)) result[key] = mutable.get(key) ?? 0;
  return Object.freeze(result);
}

export function buildEntityDiagnostics(
  registry: EntityRegistry,
  graph: EntityReferenceGraph,
  unresolved: readonly UnresolvedEntityReference[] = [],
): EntityDiagnosticsSnapshot {
  const active = registry.listActive();
  const historical = registry.listHistorical();
  const sortedUnresolved = unresolved.map(cloneUnresolved).sort(compareUnresolved);
  return Object.freeze({
    activeEntities: active.length,
    historicalEntities: historical.length,
    references: graph.list().length,
    unresolvedReferences: sortedUnresolved.length,
    activeByKind: countsByKind(active),
    historicalByKind: countsByKind(historical),
    unresolved: Object.freeze(sortedUnresolved),
  });
}

export function assertEntityIntegrity(registry: EntityRegistry, graph: EntityReferenceGraph): void {
  const cached = integrityCache.get(registry);
  if (cached
    && cached.graph === graph
    && cached.registryRevision === registry.commitRevision
    && cached.graphRevision === graph.commitRevision) {
    return;
  }

  const active = registry.listActive();
  const activeLegacyKeys = new Set<string>();

  for (const handle of active) {
    if (!Number.isInteger(handle.generation) || handle.generation < 1) {
      throw new Error(`invalid entity generation: ${handle.generation}`);
    }
    const legacyKey = canonicalLegacyKey(handle);
    if (activeLegacyKeys.has(legacyKey)) throw new Error(`duplicate active entity identity: ${legacyKey}`);
    activeLegacyKeys.add(legacyKey);
    if (!registry.isKnown(handle)) {
      throw new Error(`active entity is not present in known registry: ${canonicalHandleKey(handle)}`);
    }
  }

  for (const reference of graph.list()) {
    if (!registry.isActive(reference.source)) {
      throw new Error(`entity reference source is not active: ${canonicalHandleKey(reference.source)}`);
    }
    if (!registry.isKnown(reference.target)) {
      throw new Error(`entity reference target is unknown: ${canonicalHandleKey(reference.target)}`);
    }
    if ((reference.semantics === 'strong' || reference.semantics === 'owned') && !registry.isActive(reference.target)) {
      throw new Error(`${reference.semantics} entity reference target is not active: ${canonicalHandleKey(reference.target)}`);
    }
    if (reference.semantics === 'external') {
      throw new Error('external entity reference must not be stored in the entity reference graph');
    }
  }

  integrityCache.set(registry, Object.freeze({
    graph,
    registryRevision: registry.commitRevision,
    graphRevision: graph.commitRevision,
  }));
}