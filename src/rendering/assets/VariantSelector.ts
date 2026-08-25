import type { AssetManifestEntry, AssetOrientation } from './AssetTypes.ts';

export type WeightedVariant = Readonly<{ variantKey: string; weight?: number }>;

export function stableHash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function selectWeightedVariantKey(stableKey: string, candidates: readonly WeightedVariant[]): string {
  if (candidates.length === 0) throw new Error('variant selection requires at least one candidate');
  const sorted = [...candidates].sort((a, b) => a.variantKey.localeCompare(b.variantKey));
  const weighted = sorted.map((candidate) => ({ ...candidate, weight: candidate.weight ?? 1 }));
  const total = weighted.reduce((sum, candidate) => sum + Math.max(0, candidate.weight), 0);
  if (!(total > 0)) throw new Error('variant selection requires positive total weight');
  let target = (stableHash32(stableKey) / 0x1_0000_0000) * total;
  for (const candidate of weighted) {
    target -= Math.max(0, candidate.weight);
    if (target < 0) return candidate.variantKey;
  }
  return weighted[weighted.length - 1]!.variantKey;
}

export function selectVariantFamily(
  stableKey: string,
  entries: readonly AssetManifestEntry[],
): string {
  const byVariant = new Map<string, number>();
  for (const entry of entries) {
    if (byVariant.has(entry.variantKey)) continue;
    byVariant.set(entry.variantKey, entry.weight ?? 1);
  }
  return selectWeightedVariantKey(stableKey, [...byVariant].map(([variantKey, weight]) => ({ variantKey, weight })));
}

export function resolveVariantEntry(
  entries: readonly AssetManifestEntry[],
  variantKey: string,
  orientation: AssetOrientation,
): AssetManifestEntry | undefined {
  const family = entries.filter((entry) => entry.variantKey === variantKey);
  const oriented = family.find((entry) => entry.orientation === orientation);
  if (oriented) return oriented;
  const symmetric = family.find((entry) => entry.orientation === 0 && entry.tags?.includes('symmetric'));
  return symmetric;
}
