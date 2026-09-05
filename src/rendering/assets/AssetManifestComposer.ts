import type { AssetManifest, AssetManifestEntry, AtlasDescriptor } from './AssetTypes.ts';

export function composeAssetManifests(...manifests: readonly AssetManifest[]): AssetManifest {
  const atlases: AtlasDescriptor[] = [];
  const entries: AssetManifestEntry[] = [];
  const atlasIds = new Set<string>();
  const assetIds = new Set<string>();

  for (const manifest of manifests) {
    if (manifest.schemaVersion !== 1) {
      throw new Error(`unsupported asset manifest schema: ${String(manifest.schemaVersion)}`);
    }
    for (const atlas of manifest.atlases) {
      if (atlasIds.has(atlas.atlasId)) throw new Error(`duplicate atlasId: ${atlas.atlasId}`);
      atlasIds.add(atlas.atlasId);
      atlases.push(atlas);
    }
    for (const entry of manifest.entries) {
      if (assetIds.has(entry.assetId)) throw new Error(`duplicate assetId: ${entry.assetId}`);
      assetIds.add(entry.assetId);
      entries.push(entry);
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    atlases: Object.freeze(atlases),
    entries: Object.freeze(entries),
  });
}
