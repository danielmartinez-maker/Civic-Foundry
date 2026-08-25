import {
  canonicalHandleKey,
  canonicalLegacyKey,
  ordinalCompare,
  type EntityHandle,
  type EntityKind,
  type EntityMetadata,
  type ProjectedEntity,
} from './EntityTypes.ts';

export type EntityRecord = Readonly<{
  handle: EntityHandle;
  incarnationToken: string;
  metadata: EntityMetadata;
  active: boolean;
}>;

export type EntityRegistrySnapshot = Readonly<{
  active: readonly EntityRecord[];
  known: readonly EntityRecord[];
  highestGeneration: readonly Readonly<{ legacyKey: string; generation: number }>[];
}>;

export type PreparedEntityProjection = Readonly<{
  activeByLegacyKey: ReadonlyMap<string, EntityRecord>;
  knownUpdatesByHandleKey: ReadonlyMap<string, EntityRecord>;
  highestGenerationUpdatesByLegacyKey: ReadonlyMap<string, number>;
  baseKnownByHandleKey: ReadonlyMap<string, EntityRecord>;
  baseRevision: number;
}>;

export type KnownEntityView = Readonly<{
  resolve<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> | undefined;
  resolveKnownByToken(kind: EntityKind, legacyId: string, incarnationToken: string): EntityHandle | undefined;
  isActive(handle: EntityHandle): boolean;
  isKnown(handle: EntityHandle): boolean;
}>;

function requireToken(token: string): string {
  if (token.trim().length === 0) throw new Error('entity incarnation token must not be empty');
  return token;
}

function cloneMetadata(metadata: EntityMetadata | undefined): EntityMetadata {
  const next: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(metadata ?? {}).sort(ordinalCompare)) {
    next[key] = metadata?.[key] ?? null;
  }
  return Object.freeze(next);
}

function cloneHandle<K extends EntityKind = EntityKind>(handle: EntityHandle<K>): EntityHandle<K> {
  return Object.freeze({ ...handle });
}

function cloneRecord(record: EntityRecord, active = record.active): EntityRecord {
  return Object.freeze({
    handle: cloneHandle(record.handle),
    incarnationToken: record.incarnationToken,
    metadata: cloneMetadata(record.metadata),
    active,
  });
}

function recordFrom(entity: ProjectedEntity, generation: number): EntityRecord {
  return Object.freeze({
    handle: Object.freeze({ kind: entity.kind, legacyId: entity.legacyId, generation }),
    incarnationToken: entity.incarnationToken,
    metadata: cloneMetadata(entity.metadata),
    active: true,
  });
}

function sortedEntries<V>(map: ReadonlyMap<string, V>): readonly [string, V][] {
  return [...map.entries()].sort(([a], [b]) => ordinalCompare(a, b));
}

function resolveActiveFrom(
  activeByLegacyKey: ReadonlyMap<string, EntityRecord>,
  kind: EntityKind,
  legacyId: string,
): EntityHandle | undefined {
  const record = activeByLegacyKey.get(canonicalLegacyKey({ kind, legacyId }));
  return record ? cloneHandle(record.handle) : undefined;
}

function isActiveIn(activeByLegacyKey: ReadonlyMap<string, EntityRecord>, handle: EntityHandle): boolean {
  const current = activeByLegacyKey.get(canonicalLegacyKey(handle));
  return current !== undefined && canonicalHandleKey(current.handle) === canonicalHandleKey(handle);
}

function isKnownIn(knownByHandleKey: ReadonlyMap<string, EntityRecord>, handle: EntityHandle): boolean {
  return knownByHandleKey.has(canonicalHandleKey(handle));
}

function resolveKnownTokenFrom(
  knownByHandleKey: ReadonlyMap<string, EntityRecord>,
  kind: EntityKind,
  legacyId: string,
  incarnationToken: string,
): EntityHandle | undefined {
  requireToken(incarnationToken);
  const matches = [...knownByHandleKey.values()]
    .filter((record) => record.handle.kind === kind
      && record.handle.legacyId === legacyId
      && record.incarnationToken === incarnationToken)
    .sort((a, b) => ordinalCompare(canonicalHandleKey(a.handle), canonicalHandleKey(b.handle)));
  if (matches.length !== 1) return undefined;
  return cloneHandle(matches[0]!.handle);
}

function resolvePreparedKnownToken(
  prepared: PreparedEntityProjection,
  kind: EntityKind,
  legacyId: string,
  incarnationToken: string,
): EntityHandle | undefined {
  requireToken(incarnationToken);
  const matches = new Map<string, EntityRecord>();
  for (const record of prepared.baseKnownByHandleKey.values()) {
    if (record.handle.kind === kind
      && record.handle.legacyId === legacyId
      && record.incarnationToken === incarnationToken) {
      matches.set(canonicalHandleKey(record.handle), record);
    }
  }
  for (const record of prepared.knownUpdatesByHandleKey.values()) {
    const handleKey = canonicalHandleKey(record.handle);
    if (record.handle.kind === kind
      && record.handle.legacyId === legacyId
      && record.incarnationToken === incarnationToken) {
      matches.set(handleKey, record);
    } else {
      matches.delete(handleKey);
    }
  }
  if (matches.size !== 1) return undefined;
  return cloneHandle(matches.values().next().value!.handle);
}

export function preparedEntityView(prepared: PreparedEntityProjection): KnownEntityView {
  return Object.freeze({
    resolve<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> | undefined {
      return resolveActiveFrom(prepared.activeByLegacyKey, kind, legacyId) as EntityHandle<K> | undefined;
    },
    resolveKnownByToken(kind: EntityKind, legacyId: string, incarnationToken: string): EntityHandle | undefined {
      return resolvePreparedKnownToken(prepared, kind, legacyId, incarnationToken);
    },
    isActive(handle: EntityHandle): boolean {
      return isActiveIn(prepared.activeByLegacyKey, handle);
    },
    isKnown(handle: EntityHandle): boolean {
      const handleKey = canonicalHandleKey(handle);
      return prepared.knownUpdatesByHandleKey.has(handleKey) || prepared.baseKnownByHandleKey.has(handleKey);
    },
  });
}

export class EntityRegistry implements KnownEntityView {
  private activeByLegacyKey = new Map<string, EntityRecord>();
  private knownByHandleKey = new Map<string, EntityRecord>();
  private highestGenerationByLegacyKey = new Map<string, number>();
  private revision = 0;

  get commitRevision(): number {
    return this.revision;
  }

  resolve<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> | undefined {
    return resolveActiveFrom(this.activeByLegacyKey, kind, legacyId) as EntityHandle<K> | undefined;
  }

  require<K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> {
    const handle = this.resolve(kind, legacyId);
    if (!handle) throw new Error(`unknown active entity: ${kind}:${legacyId}`);
    return handle;
  }

  isActive(handle: EntityHandle): boolean {
    return isActiveIn(this.activeByLegacyKey, handle);
  }

  isKnown(handle: EntityHandle): boolean {
    return isKnownIn(this.knownByHandleKey, handle);
  }

  currentGeneration(kind: EntityKind, legacyId: string): number | undefined {
    return this.resolve(kind, legacyId)?.generation;
  }

  resolveKnownByToken(kind: EntityKind, legacyId: string, incarnationToken: string): EntityHandle | undefined {
    return resolveKnownTokenFrom(this.knownByHandleKey, kind, legacyId, incarnationToken);
  }

  listActive(kind?: EntityKind): readonly EntityHandle[] {
    const handles = [...this.activeByLegacyKey.values()]
      .filter((record) => kind === undefined || record.handle.kind === kind)
      .map((record) => cloneHandle(record.handle))
      .sort((a, b) => ordinalCompare(canonicalHandleKey(a), canonicalHandleKey(b)));
    return Object.freeze(handles);
  }

  listHistorical(kind?: EntityKind): readonly EntityHandle[] {
    const handles = [...this.knownByHandleKey.values()]
      .filter((record) => !record.active && (kind === undefined || record.handle.kind === kind))
      .map((record) => cloneHandle(record.handle))
      .sort((a, b) => ordinalCompare(canonicalHandleKey(a), canonicalHandleKey(b)));
    return Object.freeze(handles);
  }

  prepareProjection(entities: readonly ProjectedEntity[]): PreparedEntityProjection {
    const normalized = entities.map((entity) => {
      canonicalLegacyKey(entity);
      requireToken(entity.incarnationToken);
      return Object.freeze({ ...entity, metadata: cloneMetadata(entity.metadata) });
    }).sort((a, b) => ordinalCompare(canonicalLegacyKey(a), canonicalLegacyKey(b)));

    for (let i = 1; i < normalized.length; i++) {
      if (canonicalLegacyKey(normalized[i - 1]!) === canonicalLegacyKey(normalized[i]!)) {
        throw new Error(`duplicate projected entity identity: ${canonicalLegacyKey(normalized[i]!)}`);
      }
    }

    const normalizedByLegacyKey = new Map<string, ProjectedEntity>();
    for (const entity of normalized) normalizedByLegacyKey.set(canonicalLegacyKey(entity), entity);

    const nextActive = new Map<string, EntityRecord>();
    const knownUpdates = new Map<string, EntityRecord>();
    const highestUpdates = new Map<string, number>();

    for (const [legacyKey, current] of this.activeByLegacyKey) {
      const incoming = normalizedByLegacyKey.get(legacyKey);
      if (!incoming || incoming.incarnationToken !== current.incarnationToken) {
        const historical = cloneRecord(current, false);
        knownUpdates.set(canonicalHandleKey(historical.handle), historical);
      }
    }

    for (const entity of normalized) {
      const legacyKey = canonicalLegacyKey(entity);
      const current = this.activeByLegacyKey.get(legacyKey);
      let record: EntityRecord;
      if (current && current.incarnationToken === entity.incarnationToken) {
        record = recordFrom(entity, current.handle.generation);
      } else {
        const generation = (this.highestGenerationByLegacyKey.get(legacyKey) ?? 0) + 1;
        record = recordFrom(entity, generation);
        highestUpdates.set(legacyKey, generation);
      }
      nextActive.set(legacyKey, record);
      knownUpdates.set(canonicalHandleKey(record.handle), record);
    }

    return Object.freeze({
      activeByLegacyKey: nextActive,
      knownUpdatesByHandleKey: knownUpdates,
      highestGenerationUpdatesByLegacyKey: highestUpdates,
      baseKnownByHandleKey: this.knownByHandleKey,
      baseRevision: this.revision,
    });
  }

  commitPrepared(prepared: PreparedEntityProjection): void {
    if (prepared.baseRevision !== this.revision || prepared.baseKnownByHandleKey !== this.knownByHandleKey) {
      throw new Error('stale prepared entity projection');
    }

    this.activeByLegacyKey = new Map(
      sortedEntries(prepared.activeByLegacyKey).map(([key, record]) => [key, cloneRecord(record, true)]),
    );
    for (const [key, record] of sortedEntries(prepared.knownUpdatesByHandleKey)) {
      this.knownByHandleKey.set(key, cloneRecord(record));
    }
    for (const [key, generation] of sortedEntries(prepared.highestGenerationUpdatesByLegacyKey)) {
      this.highestGenerationByLegacyKey.set(key, generation);
    }
    this.revision += 1;
  }

  snapshot(): EntityRegistrySnapshot {
    const active = [...this.activeByLegacyKey.values()]
      .map((record) => cloneRecord(record, true))
      .sort((a, b) => ordinalCompare(canonicalHandleKey(a.handle), canonicalHandleKey(b.handle)));
    const known = [...this.knownByHandleKey.values()]
      .map((record) => cloneRecord(record))
      .sort((a, b) => ordinalCompare(canonicalHandleKey(a.handle), canonicalHandleKey(b.handle)));
    const highestGeneration = sortedEntries(this.highestGenerationByLegacyKey)
      .map(([legacyKey, generation]) => Object.freeze({ legacyKey, generation }));
    return Object.freeze({
      active: Object.freeze(active),
      known: Object.freeze(known),
      highestGeneration: Object.freeze(highestGeneration),
    });
  }
}