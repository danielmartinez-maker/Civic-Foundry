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

export type PreparedEntityPartitionProjection = Readonly<{
  ownedKinds: readonly EntityKind[];
  activeUpdatesByLegacyKey: ReadonlyMap<string, EntityRecord>;
  removedLegacyKeys: readonly string[];
  knownUpdatesByHandleKey: ReadonlyMap<string, EntityRecord>;
  highestGenerationUpdatesByLegacyKey: ReadonlyMap<string, number>;
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

function metadataMatches(current: EntityMetadata, incoming: EntityMetadata | undefined): boolean {
  const incomingKeys = Object.keys(incoming ?? {}).sort(ordinalCompare);
  const currentKeys = Object.keys(current);
  if (incomingKeys.length !== currentKeys.length) return false;
  for (let i = 0; i < currentKeys.length; i++) {
    const key = currentKeys[i]!;
    if (incomingKeys[i] !== key || current[key] !== incoming?.[key]) return false;
  }
  return true;
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

function normalizeKinds(ownedKinds: readonly EntityKind[]): readonly EntityKind[] {
  if (ownedKinds.length === 0) throw new Error('entity partition must own at least one entity kind');
  const normalized = [...ownedKinds].sort(ordinalCompare);
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i - 1] === normalized[i]) throw new Error(`duplicate entity partition kind: ${normalized[i]}`);
  }
  return Object.freeze(normalized);
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

export function preparedEntityPartitionView(
  registry: EntityRegistry,
  preparedPartitions: readonly PreparedEntityPartitionProjection[],
): KnownEntityView {
  const activeUpdates = new Map<string, EntityRecord>();
  const removed = new Set<string>();
  const knownUpdates = new Map<string, EntityRecord>();

  for (const prepared of preparedPartitions) {
    for (const key of prepared.removedLegacyKeys) {
      removed.add(key);
      activeUpdates.delete(key);
    }
    for (const [key, record] of prepared.activeUpdatesByLegacyKey) {
      activeUpdates.set(key, record);
      removed.delete(key);
    }
    for (const [key, record] of prepared.knownUpdatesByHandleKey) knownUpdates.set(key, record);
  }

  const resolve = <K extends EntityKind>(kind: K, legacyId: string): EntityHandle<K> | undefined => {
    const legacyKey = canonicalLegacyKey({ kind, legacyId });
    const staged = activeUpdates.get(legacyKey);
    if (staged) return cloneHandle(staged.handle) as EntityHandle<K>;
    if (removed.has(legacyKey)) return undefined;
    return registry.resolve(kind, legacyId);
  };

  return Object.freeze({
    resolve,
    resolveKnownByToken(kind: EntityKind, legacyId: string, incarnationToken: string): EntityHandle | undefined {
      requireToken(incarnationToken);
      const matches = new Map<string, EntityHandle>();
      const committed = registry.resolveKnownByToken(kind, legacyId, incarnationToken);
      if (committed) matches.set(canonicalHandleKey(committed), committed);
      for (const record of knownUpdates.values()) {
        if (record.handle.kind === kind
          && record.handle.legacyId === legacyId
          && record.incarnationToken === incarnationToken) {
          matches.set(canonicalHandleKey(record.handle), record.handle);
        }
      }
      for (const record of activeUpdates.values()) {
        if (record.handle.kind === kind
          && record.handle.legacyId === legacyId
          && record.incarnationToken === incarnationToken) {
          matches.set(canonicalHandleKey(record.handle), record.handle);
        }
      }
      if (matches.size !== 1) return undefined;
      return cloneHandle(matches.values().next().value!);
    },
    isActive(handle: EntityHandle): boolean {
      const current = resolve(handle.kind, handle.legacyId);
      return current !== undefined && canonicalHandleKey(current) === canonicalHandleKey(handle);
    },
    isKnown(handle: EntityHandle): boolean {
      const handleKey = canonicalHandleKey(handle);
      return knownUpdates.has(handleKey) || activeUpdates.has(canonicalLegacyKey(handle)) || registry.isKnown(handle);
    },
  });
}

export class EntityRegistry implements KnownEntityView {
  private activeByLegacyKey = new Map<string, EntityRecord>();
  private knownByHandleKey = new Map<string, EntityRecord>();
  private highestGenerationByLegacyKey = new Map<string, number>();
  private activeLegacyKeysByKind = new Map<EntityKind, Set<string>>();
  private revision = 0;

  get commitRevision(): number {
    return this.revision;
  }

  get activeCount(): number {
    return this.activeByLegacyKey.size;
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
    const records = kind === undefined
      ? [...this.activeByLegacyKey.values()]
      : [...(this.activeLegacyKeysByKind.get(kind) ?? [])]
        .map((key) => this.activeByLegacyKey.get(key))
        .filter((record): record is EntityRecord => record !== undefined);
    const handles = records
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

  assertPartitionIndexIntegrity(): void {
    const indexed = new Set<string>();
    const kinds = [...this.activeLegacyKeysByKind.keys()].sort(ordinalCompare);
    for (const kind of kinds) {
      const keys = [...(this.activeLegacyKeysByKind.get(kind) ?? [])].sort(ordinalCompare);
      for (const legacyKey of keys) {
        if (indexed.has(legacyKey)) {
          throw new Error(`registry kind index duplicates active entity ${kind}: ${legacyKey}`);
        }
        indexed.add(legacyKey);
        const record = this.activeByLegacyKey.get(legacyKey);
        if (!record) {
          throw new Error(`registry kind index ${kind} references missing active entity: ${legacyKey}`);
        }
        if (record.handle.kind !== kind) {
          throw new Error(`registry kind index ${kind} references active entity of kind ${record.handle.kind}: ${legacyKey}`);
        }
      }
    }

    for (const [legacyKey, record] of sortedEntries(this.activeByLegacyKey)) {
      if (!this.activeLegacyKeysByKind.get(record.handle.kind)?.has(legacyKey)) {
        throw new Error(`registry kind index missing active ${record.handle.kind}: ${legacyKey}`);
      }
    }
  }

  prepareProjection(entities: readonly ProjectedEntity[]): PreparedEntityProjection {
    const normalized = entities.map((entity) => {
      const legacyKey = canonicalLegacyKey(entity);
      requireToken(entity.incarnationToken);
      return { entity, legacyKey } as const;
    }).sort((a, b) => ordinalCompare(a.legacyKey, b.legacyKey));

    for (let i = 1; i < normalized.length; i++) {
      if (normalized[i - 1]!.legacyKey === normalized[i]!.legacyKey) {
        throw new Error(`duplicate projected entity identity: ${normalized[i]!.legacyKey}`);
      }
    }

    const normalizedByLegacyKey = new Map<string, ProjectedEntity>();
    for (const item of normalized) normalizedByLegacyKey.set(item.legacyKey, item.entity);

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

    for (const { entity, legacyKey } of normalized) {
      const current = this.activeByLegacyKey.get(legacyKey);
      let record: EntityRecord;
      if (current && current.incarnationToken === entity.incarnationToken) {
        record = metadataMatches(current.metadata, entity.metadata)
          ? current
          : recordFrom(entity, current.handle.generation);
      } else {
        const generation = (this.highestGenerationByLegacyKey.get(legacyKey) ?? 0) + 1;
        record = recordFrom(entity, generation);
        highestUpdates.set(legacyKey, generation);
      }
      nextActive.set(legacyKey, record);
      if (record !== current) knownUpdates.set(canonicalHandleKey(record.handle), record);
    }

    return Object.freeze({
      activeByLegacyKey: nextActive,
      knownUpdatesByHandleKey: knownUpdates,
      highestGenerationUpdatesByLegacyKey: highestUpdates,
      baseKnownByHandleKey: this.knownByHandleKey,
      baseRevision: this.revision,
    });
  }

  preparePartitionProjection(
    ownedKinds: readonly EntityKind[],
    entities: readonly ProjectedEntity[],
  ): PreparedEntityPartitionProjection {
    const normalizedKinds = normalizeKinds(ownedKinds);
    const kindSet = new Set<EntityKind>(normalizedKinds);
    const normalized = entities.map((entity) => {
      if (!kindSet.has(entity.kind)) {
        throw new Error(`projected entity kind ${entity.kind} is outside partition ownership`);
      }
      const legacyKey = canonicalLegacyKey(entity);
      requireToken(entity.incarnationToken);
      return { entity, legacyKey } as const;
    }).sort((a, b) => ordinalCompare(a.legacyKey, b.legacyKey));

    for (let i = 1; i < normalized.length; i++) {
      if (normalized[i - 1]!.legacyKey === normalized[i]!.legacyKey) {
        throw new Error(`duplicate projected entity identity: ${normalized[i]!.legacyKey}`);
      }
    }

    const incomingByLegacyKey = new Map<string, ProjectedEntity>();
    for (const item of normalized) incomingByLegacyKey.set(item.legacyKey, item.entity);

    const currentKeys: string[] = [];
    for (const kind of normalizedKinds) {
      for (const key of this.activeLegacyKeysByKind.get(kind) ?? []) currentKeys.push(key);
    }
    currentKeys.sort(ordinalCompare);

    const activeUpdates = new Map<string, EntityRecord>();
    const removedLegacyKeys: string[] = [];
    const knownUpdates = new Map<string, EntityRecord>();
    const highestUpdates = new Map<string, number>();

    for (const legacyKey of currentKeys) {
      const current = this.activeByLegacyKey.get(legacyKey);
      if (!current) throw new Error(`entity kind index references missing active entity: ${legacyKey}`);
      const incoming = incomingByLegacyKey.get(legacyKey);
      if (!incoming || incoming.incarnationToken !== current.incarnationToken) {
        const historical = cloneRecord(current, false);
        knownUpdates.set(canonicalHandleKey(historical.handle), historical);
        removedLegacyKeys.push(legacyKey);
      }
    }

    for (const { entity, legacyKey } of normalized) {
      const current = this.activeByLegacyKey.get(legacyKey);
      let record: EntityRecord;
      if (current && current.incarnationToken === entity.incarnationToken) {
        record = metadataMatches(current.metadata, entity.metadata)
          ? current
          : recordFrom(entity, current.handle.generation);
      } else {
        const generation = (this.highestGenerationByLegacyKey.get(legacyKey) ?? 0) + 1;
        record = recordFrom(entity, generation);
        highestUpdates.set(legacyKey, generation);
      }
      activeUpdates.set(legacyKey, record);
      if (record !== current) knownUpdates.set(canonicalHandleKey(record.handle), record);
    }

    return Object.freeze({
      ownedKinds: normalizedKinds,
      activeUpdatesByLegacyKey: activeUpdates,
      removedLegacyKeys: Object.freeze(removedLegacyKeys.sort(ordinalCompare)),
      knownUpdatesByHandleKey: knownUpdates,
      highestGenerationUpdatesByLegacyKey: highestUpdates,
      baseRevision: this.revision,
    });
  }

  commitPrepared(prepared: PreparedEntityProjection): void {
    if (prepared.baseRevision !== this.revision || prepared.baseKnownByHandleKey !== this.knownByHandleKey) {
      throw new Error('stale prepared entity projection');
    }

    this.activeByLegacyKey = new Map(sortedEntries(prepared.activeByLegacyKey));
    this.activeLegacyKeysByKind = new Map();
    for (const [key, record] of this.activeByLegacyKey) {
      let keys = this.activeLegacyKeysByKind.get(record.handle.kind);
      if (!keys) {
        keys = new Set<string>();
        this.activeLegacyKeysByKind.set(record.handle.kind, keys);
      }
      keys.add(key);
    }
    for (const [key, record] of sortedEntries(prepared.knownUpdatesByHandleKey)) {
      this.knownByHandleKey.set(key, record);
    }
    for (const [key, generation] of sortedEntries(prepared.highestGenerationUpdatesByLegacyKey)) {
      this.highestGenerationByLegacyKey.set(key, generation);
    }
    this.revision += 1;
  }

  commitPreparedPartitions(preparedPartitions: readonly PreparedEntityPartitionProjection[]): void {
    for (const prepared of preparedPartitions) {
      if (prepared.baseRevision !== this.revision) throw new Error('stale prepared entity partition projection');
    }

    for (const prepared of preparedPartitions) {
      for (const legacyKey of prepared.removedLegacyKeys) {
        const current = this.activeByLegacyKey.get(legacyKey);
        if (current) {
          this.activeByLegacyKey.delete(legacyKey);
          this.activeLegacyKeysByKind.get(current.handle.kind)?.delete(legacyKey);
        }
      }
      for (const [legacyKey, record] of prepared.activeUpdatesByLegacyKey) {
        const prior = this.activeByLegacyKey.get(legacyKey);
        if (prior && prior.handle.kind !== record.handle.kind) {
          this.activeLegacyKeysByKind.get(prior.handle.kind)?.delete(legacyKey);
        }
        this.activeByLegacyKey.set(legacyKey, record);
        let keys = this.activeLegacyKeysByKind.get(record.handle.kind);
        if (!keys) {
          keys = new Set<string>();
          this.activeLegacyKeysByKind.set(record.handle.kind, keys);
        }
        keys.add(legacyKey);
      }
      for (const [key, record] of prepared.knownUpdatesByHandleKey) this.knownByHandleKey.set(key, record);
      for (const [key, generation] of prepared.highestGenerationUpdatesByLegacyKey) {
        this.highestGenerationByLegacyKey.set(key, generation);
      }
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
