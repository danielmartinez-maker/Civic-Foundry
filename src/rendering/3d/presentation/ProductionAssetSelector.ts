import type { AssetId, AssetManifestV2Entry } from '../assets/AssetManifestV2.ts';
import { deterministicVisualSeed } from './VisualDeterminism.ts';

export function selectProductionAssetId(
  stableEntityId: string,
  semanticFamily: string,
  candidates: readonly AssetManifestV2Entry[],
  visualChannel: string,
): AssetId | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const seed = deterministicVisualSeed(stableEntityId, semanticFamily, visualChannel);
  return sorted[seed % sorted.length]!.assetId;
}
