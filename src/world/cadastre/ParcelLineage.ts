import type {
  CadastralSnapshot,
  ParcelLineageEvent,
  ParcelLineageKind,
} from './CadastralTypes.ts';

export function createParcelLineageEvent(
  snapshot: CadastralSnapshot,
  kind: ParcelLineageKind,
  sourceParcelIds: readonly string[],
  resultingParcelIds: readonly string[],
): ParcelLineageEvent {
  const sources = canonicalIds(sourceParcelIds);
  const results = canonicalIds(resultingParcelIds);
  if (sources.length === 0) throw new Error('lineage event requires at least one source parcel');
  if (results.length === 0) throw new Error('lineage event requires at least one resulting parcel');

  const tick = snapshot.lineage.reduce((maximum, event) => Math.max(maximum, event.tick), 0) + 1;
  const existingIds = new Set(snapshot.lineage.map((event) => event.id));
  const base = `lineage:${tick}:${kind}`;
  let id = base;
  let suffix = 1;
  while (existingIds.has(id)) {
    id = `${base}:${suffix}`;
    suffix += 1;
  }

  return Object.freeze({
    id,
    tick,
    kind,
    sourceParcelIds: Object.freeze(sources),
    resultingParcelIds: Object.freeze(results),
  });
}

export function lineageParents(
  sourceParcelIds: readonly string[],
  inheritedParentIds: readonly string[] = [],
): readonly string[] {
  return Object.freeze(canonicalIds([...sourceParcelIds, ...inheritedParentIds]));
}

function canonicalIds(ids: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim().length === 0) throw new Error('parcel lineage ids must be non-empty');
    unique.add(id);
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
}
