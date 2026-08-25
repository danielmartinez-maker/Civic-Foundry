import {
  canonicalHandleKey,
  ordinalCompare,
  type EntityHandle,
  type EntityKind,
  type EntityReferenceSemantics,
} from './EntityTypes.ts';
import type { KnownEntityView } from './EntityRegistry.ts';

export type EntityReference = Readonly<{
  source: EntityHandle;
  target: EntityHandle;
  semantics: EntityReferenceSemantics;
  relation: string;
}>;

export type PreparedReferenceGraph = Readonly<{
  references: readonly EntityReference[];
}>;

export type PreparedReferencePartition = Readonly<{
  ownedSourceKinds: readonly EntityKind[];
  replacementsBySourceKey: ReadonlyMap<string, readonly EntityReference[]>;
  removedSourceKeys: readonly string[];
  baseRevision: number;
}>;

export type EntityReferenceGraphSnapshot = Readonly<{
  references: readonly EntityReference[];
}>;

function cloneHandle(handle: EntityHandle): EntityHandle {
  return Object.freeze({ ...handle });
}

function cloneReference(reference: EntityReference): EntityReference {
  return Object.freeze({
    source: cloneHandle(reference.source),
    target: cloneHandle(reference.target),
    semantics: reference.semantics,
    relation: reference.relation,
  });
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

function requireRelation(relation: string): string {
  if (relation.trim().length === 0) throw new Error('entity reference relation must not be empty');
  return relation;
}

function canonicalReferenceKey(reference: EntityReference): string {
  return [
    encodePart(canonicalHandleKey(reference.source)),
    encodePart(reference.relation),
    encodePart(reference.semantics),
    encodePart(canonicalHandleKey(reference.target)),
  ].join('|');
}

function compareReference(a: EntityReference, b: EntityReference): number {
  return ordinalCompare(canonicalHandleKey(a.source), canonicalHandleKey(b.source))
    || ordinalCompare(a.relation, b.relation)
    || ordinalCompare(a.semantics, b.semantics)
    || ordinalCompare(canonicalHandleKey(a.target), canonicalHandleKey(b.target));
}

function referencesEqual(a: readonly EntityReference[], b: readonly EntityReference[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (canonicalReferenceKey(a[i]!) !== canonicalReferenceKey(b[i]!)) return false;
  }
  return true;
}

function normalizeKinds(ownedKinds: readonly EntityKind[]): readonly EntityKind[] {
  if (ownedKinds.length === 0) throw new Error('reference partition must own at least one source kind');
  const normalized = [...ownedKinds].sort(ordinalCompare);
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i - 1] === normalized[i]) {
      throw new Error(`duplicate reference partition source kind: ${normalized[i]}`);
    }
  }
  return Object.freeze(normalized);
}

function normalizeAndValidateReferences(
  references: readonly EntityReference[],
  view: KnownEntityView,
  ownedKinds?: ReadonlySet<EntityKind>,
): readonly EntityReference[] {
  const normalized = references.map((reference) => {
    requireRelation(reference.relation);
    if (ownedKinds && !ownedKinds.has(reference.source.kind)) {
      throw new Error(`entity reference source kind ${reference.source.kind} is outside partition ownership`);
    }
    if (!view.isActive(reference.source)) {
      throw new Error(`entity reference source is not active: ${canonicalHandleKey(reference.source)}`);
    }
    if (reference.semantics === 'strong' || reference.semantics === 'owned') {
      if (!view.isActive(reference.target)) {
        throw new Error(`${reference.semantics} entity reference target is not active: ${canonicalHandleKey(reference.target)}`);
      }
    } else if (reference.semantics === 'weak') {
      if (!view.isKnown(reference.target)) {
        throw new Error(`weak entity reference target is not known: ${canonicalHandleKey(reference.target)}`);
      }
    } else {
      throw new Error('external entity references are diagnostic intents and cannot enter the entity reference graph');
    }
    return cloneReference(reference);
  }).sort(compareReference);

  for (let i = 1; i < normalized.length; i++) {
    if (canonicalReferenceKey(normalized[i - 1]!) === canonicalReferenceKey(normalized[i]!)) {
      throw new Error(`duplicate entity reference: ${canonicalReferenceKey(normalized[i]!)}`);
    }
  }
  return Object.freeze(normalized);
}

function groupBySource(references: readonly EntityReference[]): Map<string, readonly EntityReference[]> {
  const grouped = new Map<string, EntityReference[]>();
  for (const reference of references) {
    const sourceKey = canonicalHandleKey(reference.source);
    let bucket = grouped.get(sourceKey);
    if (!bucket) {
      bucket = [];
      grouped.set(sourceKey, bucket);
    }
    bucket.push(reference);
  }
  return new Map([...grouped.entries()]
    .sort(([a], [b]) => ordinalCompare(a, b))
    .map(([key, bucket]) => [key, Object.freeze(bucket.map(cloneReference).sort(compareReference))]));
}

export class EntityReferenceGraph {
  private referencesBySourceKey = new Map<string, readonly EntityReference[]>();
  private sourceKeysByKind = new Map<EntityKind, Set<string>>();
  private sourceKeysByTargetKey = new Map<string, Set<string>>();
  private referenceCount = 0;
  private flattenedCache: readonly EntityReference[] | undefined;
  private revision = 0;

  get commitRevision(): number {
    return this.revision;
  }

  get count(): number {
    return this.referenceCount;
  }

  private removeTargetIndex(sourceKey: string, bucket: readonly EntityReference[]): void {
    for (const reference of bucket) {
      const targetKey = canonicalHandleKey(reference.target);
      const sourceKeys = this.sourceKeysByTargetKey.get(targetKey);
      sourceKeys?.delete(sourceKey);
      if (sourceKeys?.size === 0) this.sourceKeysByTargetKey.delete(targetKey);
    }
  }

  private addTargetIndex(sourceKey: string, bucket: readonly EntityReference[]): void {
    for (const reference of bucket) {
      const targetKey = canonicalHandleKey(reference.target);
      let sourceKeys = this.sourceKeysByTargetKey.get(targetKey);
      if (!sourceKeys) {
        sourceKeys = new Set<string>();
        this.sourceKeysByTargetKey.set(targetKey, sourceKeys);
      }
      sourceKeys.add(sourceKey);
    }
  }

  prepare(references: readonly EntityReference[], view: KnownEntityView): PreparedReferenceGraph {
    return Object.freeze({ references: normalizeAndValidateReferences(references, view) });
  }

  preparePartition(
    ownedSourceKinds: readonly EntityKind[],
    references: readonly EntityReference[],
    view: KnownEntityView,
  ): PreparedReferencePartition {
    const normalizedKinds = normalizeKinds(ownedSourceKinds);
    const kindSet = new Set<EntityKind>(normalizedKinds);
    const normalizedReferences = normalizeAndValidateReferences(references, view, kindSet);
    const incomingBySourceKey = groupBySource(normalizedReferences);
    const replacementsBySourceKey = new Map<string, readonly EntityReference[]>();
    for (const [sourceKey, bucket] of incomingBySourceKey) {
      const current = this.referencesBySourceKey.get(sourceKey);
      if (!current || !referencesEqual(current, bucket)) replacementsBySourceKey.set(sourceKey, bucket);
    }

    const existingSourceKeys: string[] = [];
    for (const kind of normalizedKinds) {
      for (const sourceKey of this.sourceKeysByKind.get(kind) ?? []) existingSourceKeys.push(sourceKey);
    }
    existingSourceKeys.sort(ordinalCompare);
    const removedSourceKeys = existingSourceKeys.filter((sourceKey) => !incomingBySourceKey.has(sourceKey));

    return Object.freeze({
      ownedSourceKinds: normalizedKinds,
      replacementsBySourceKey,
      removedSourceKeys: Object.freeze(removedSourceKeys),
      baseRevision: this.revision,
    });
  }

  commitPrepared(prepared: PreparedReferenceGraph): void {
    const nextBySource = groupBySource(prepared.references);
    const nextKindIndex = new Map<EntityKind, Set<string>>();
    const nextTargetIndex = new Map<string, Set<string>>();
    for (const [sourceKey, bucket] of nextBySource) {
      const kind = bucket[0]?.source.kind;
      if (kind) {
        let sourceKeys = nextKindIndex.get(kind);
        if (!sourceKeys) {
          sourceKeys = new Set<string>();
          nextKindIndex.set(kind, sourceKeys);
        }
        sourceKeys.add(sourceKey);
      }
      for (const reference of bucket) {
        const targetKey = canonicalHandleKey(reference.target);
        let sourceKeys = nextTargetIndex.get(targetKey);
        if (!sourceKeys) {
          sourceKeys = new Set<string>();
          nextTargetIndex.set(targetKey, sourceKeys);
        }
        sourceKeys.add(sourceKey);
      }
    }
    this.referencesBySourceKey = nextBySource;
    this.sourceKeysByKind = nextKindIndex;
    this.sourceKeysByTargetKey = nextTargetIndex;
    this.referenceCount = prepared.references.length;
    this.flattenedCache = undefined;
    this.revision++;
  }

  commitPreparedPartition(prepared: PreparedReferencePartition): void {
    this.commitPreparedPartitions([prepared]);
  }

  commitPreparedPartitions(preparedPartitions: readonly PreparedReferencePartition[]): void {
    for (const prepared of preparedPartitions) {
      if (prepared.baseRevision !== this.revision) throw new Error('stale prepared reference partition');
    }

    for (const prepared of preparedPartitions) {
      for (const sourceKey of prepared.removedSourceKeys) {
        const existing = this.referencesBySourceKey.get(sourceKey);
        if (!existing) continue;
        this.removeTargetIndex(sourceKey, existing);
        this.referencesBySourceKey.delete(sourceKey);
        this.referenceCount -= existing.length;
        const kind = existing[0]?.source.kind;
        if (kind) this.sourceKeysByKind.get(kind)?.delete(sourceKey);
      }

      for (const [sourceKey, bucket] of prepared.replacementsBySourceKey) {
        const existing = this.referencesBySourceKey.get(sourceKey);
        if (existing) {
          this.removeTargetIndex(sourceKey, existing);
          this.referenceCount -= existing.length;
          const existingKind = existing[0]?.source.kind;
          if (existingKind && existingKind !== bucket[0]?.source.kind) {
            this.sourceKeysByKind.get(existingKind)?.delete(sourceKey);
          }
        }
        const frozenBucket = Object.freeze(bucket.map(cloneReference).sort(compareReference));
        this.referencesBySourceKey.set(sourceKey, frozenBucket);
        this.addTargetIndex(sourceKey, frozenBucket);
        this.referenceCount += frozenBucket.length;
        const kind = frozenBucket[0]?.source.kind;
        if (kind) {
          let sourceKeys = this.sourceKeysByKind.get(kind);
          if (!sourceKeys) {
            sourceKeys = new Set<string>();
            this.sourceKeysByKind.set(kind, sourceKeys);
          }
          sourceKeys.add(sourceKey);
        }
      }
    }

    this.flattenedCache = undefined;
    this.revision++;
  }

  assertPartitionIndexIntegrity(): void {
    const indexed = new Set<string>();
    const kinds = [...this.sourceKeysByKind.keys()].sort(ordinalCompare);
    for (const kind of kinds) {
      const sourceKeys = [...(this.sourceKeysByKind.get(kind) ?? [])].sort(ordinalCompare);
      for (const sourceKey of sourceKeys) {
        if (indexed.has(sourceKey)) {
          throw new Error(`reference source-kind index duplicates source ${kind}: ${sourceKey}`);
        }
        indexed.add(sourceKey);
        const bucket = this.referencesBySourceKey.get(sourceKey);
        if (!bucket || bucket.length === 0) {
          throw new Error(`reference source-kind index ${kind} references missing source bucket: ${sourceKey}`);
        }
        for (const reference of bucket) {
          if (reference.source.kind !== kind || canonicalHandleKey(reference.source) !== sourceKey) {
            throw new Error(`reference source-kind index ${kind} disagrees with source bucket: ${sourceKey}`);
          }
        }
      }
    }

    let countedReferences = 0;
    const buckets = [...this.referencesBySourceKey.entries()].sort(([a], [b]) => ordinalCompare(a, b));
    for (const [sourceKey, bucket] of buckets) {
      if (bucket.length === 0) throw new Error(`reference source bucket is empty: ${sourceKey}`);
      const kind = bucket[0]!.source.kind;
      if (!this.sourceKeysByKind.get(kind)?.has(sourceKey)) {
        throw new Error(`reference source-kind index missing source ${kind}: ${sourceKey}`);
      }
      for (const reference of bucket) {
        if (canonicalHandleKey(reference.source) !== sourceKey) {
          throw new Error(`reference source bucket contains mismatched source: ${sourceKey}`);
        }
        const targetKey = canonicalHandleKey(reference.target);
        if (!this.sourceKeysByTargetKey.get(targetKey)?.has(sourceKey)) {
          throw new Error(`reference target index missing source ${sourceKey} for target ${targetKey}`);
        }
      }
      countedReferences += bucket.length;
    }
    if (countedReferences !== this.referenceCount) {
      throw new Error(`reference source-kind index count mismatch: expected ${this.referenceCount}, found ${countedReferences}`);
    }

    for (const [targetKey, sourceKeys] of [...this.sourceKeysByTargetKey.entries()].sort(([a], [b]) => ordinalCompare(a, b))) {
      for (const sourceKey of [...sourceKeys].sort(ordinalCompare)) {
        const bucket = this.referencesBySourceKey.get(sourceKey);
        if (!bucket?.some((reference) => canonicalHandleKey(reference.target) === targetKey)) {
          throw new Error(`reference target index ${targetKey} contains stale source ${sourceKey}`);
        }
      }
    }
  }

  outgoing(source: EntityHandle): readonly EntityReference[] {
    const sourceKey = canonicalHandleKey(source);
    return Object.freeze((this.referencesBySourceKey.get(sourceKey) ?? []).map(cloneReference));
  }

  incoming(target: EntityHandle): readonly EntityReference[] {
    const targetKey = canonicalHandleKey(target);
    const sourceKeys = [...(this.sourceKeysByTargetKey.get(targetKey) ?? [])].sort(ordinalCompare);
    const references = sourceKeys.flatMap((sourceKey) =>
      (this.referencesBySourceKey.get(sourceKey) ?? [])
        .filter((reference) => canonicalHandleKey(reference.target) === targetKey));
    return Object.freeze(references.map(cloneReference).sort(compareReference));
  }

  list(): readonly EntityReference[] {
    if (!this.flattenedCache) {
      this.flattenedCache = Object.freeze(
        [...this.referencesBySourceKey.values()]
          .flatMap((bucket) => bucket)
          .map(cloneReference)
          .sort(compareReference),
      );
    }
    return Object.freeze(this.flattenedCache.map(cloneReference));
  }

  snapshot(): EntityReferenceGraphSnapshot {
    return Object.freeze({ references: this.list() });
  }
}
