export type EntityKind =
  | 'lot'
  | 'building'
  | 'firm'
  | 'utility-facility'
  | 'service-facility'
  | 'transit-stop'
  | 'transit-line'
  | 'traffic-vehicle'
  | 'service-vehicle'
  | 'freight-vehicle'
  | 'incident'
  | 'project'
  | 'person'
  | 'cohort'
  | 'household'
  | 'parcel'
  | 'unit'
  | 'facility'
  | 'contract'
  | 'network-node'
  | 'network-edge'
  | 'government-body';

export type LegacyEntityKey<K extends EntityKind = EntityKind> = Readonly<{
  kind: K;
  legacyId: string;
}>;

export type EntityHandle<K extends EntityKind = EntityKind> = Readonly<{
  kind: K;
  legacyId: string;
  generation: number;
}>;

export type EntityMetadataValue = string | number | boolean | null;
export type EntityMetadata = Readonly<Record<string, EntityMetadataValue>>;

export type ProjectedEntity = Readonly<{
  kind: EntityKind;
  legacyId: string;
  incarnationToken: string;
  metadata?: EntityMetadata;
}>;

export type EntityReferenceSemantics = 'strong' | 'owned' | 'weak' | 'external';

export type ProjectedReferenceIntent = Readonly<{
  source: LegacyEntityKey;
  target: LegacyEntityKey;
  semantics: EntityReferenceSemantics;
  relation: string;
  targetIncarnationToken?: string;
}>;

export type UnresolvedEntityReference = Readonly<{
  source: LegacyEntityKey;
  target: LegacyEntityKey;
  semantics: 'weak' | 'external';
  relation: string;
  reason: string;
}>;

export function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty`);
  return value;
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

export function canonicalLegacyKey(key: LegacyEntityKey): string {
  const kind = requireNonEmpty(key.kind, 'entity kind');
  const legacyId = requireNonEmpty(key.legacyId, 'legacy entity id');
  return `${encodePart(kind)}|${encodePart(legacyId)}`;
}

export function canonicalHandleKey(handle: EntityHandle): string {
  if (!Number.isInteger(handle.generation) || handle.generation < 1) {
    throw new Error('entity generation must be a positive integer');
  }
  return `${canonicalLegacyKey(handle)}|g${handle.generation}`;
}
