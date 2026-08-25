import type { AssetManifest } from './AssetTypes.ts';

export function validateAssetManifest(manifest: AssetManifest): string[] {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${String(manifest.schemaVersion)}`);

  const atlasById = new Map<string, (typeof manifest.atlases)[number]>();
  for (const atlas of manifest.atlases) {
    if (!atlas.atlasId) errors.push('atlasId must be non-empty');
    if (atlasById.has(atlas.atlasId)) errors.push(`duplicate atlasId: ${atlas.atlasId}`);
    if (!(atlas.width > 0) || !(atlas.height > 0)) errors.push(`atlas ${atlas.atlasId} dimensions must be positive`);
    atlasById.set(atlas.atlasId, atlas);
  }

  const entryById = new Map<string, (typeof manifest.entries)[number]>();
  for (const entry of manifest.entries) {
    if (!entry.assetId) errors.push('assetId must be non-empty');
    if (!entry.variantKey) errors.push(`asset ${entry.assetId || '<unknown>'} variantKey must be non-empty`);
    if (entryById.has(entry.assetId)) errors.push(`duplicate assetId: ${entry.assetId}`);
    entryById.set(entry.assetId, entry);

    const atlas = atlasById.get(entry.atlasId);
    if (!atlas) {
      errors.push(`asset ${entry.assetId} references unknown atlas: ${entry.atlasId}`);
    } else {
      const r = entry.sourceRect;
      if (!(r.width > 0) || !(r.height > 0) || r.x < 0 || r.y < 0) {
        errors.push(`asset ${entry.assetId} has invalid sourceRect`);
      } else if (r.x + r.width > atlas.width || r.y + r.height > atlas.height) {
        errors.push(`asset ${entry.assetId} sourceRect exceeds atlas ${atlas.atlasId}`);
      }
    }

    if (!(entry.footprint.width > 0) || !(entry.footprint.height > 0)) {
      errors.push(`asset ${entry.assetId} footprint must be positive`);
    }
    if (!Number.isFinite(entry.anchor.x) || !Number.isFinite(entry.anchor.y)) {
      errors.push(`asset ${entry.assetId} anchor must be finite`);
    }
    if (entry.weight !== undefined && (!(entry.weight > 0) || !Number.isFinite(entry.weight))) {
      errors.push(`asset ${entry.assetId} weight must be positive`);
    }
    if (entry.orientation !== undefined && ![0, 1, 2, 3].includes(entry.orientation)) {
      errors.push(`asset ${entry.assetId} orientation must be 0..3`);
    }
    if (entry.animation && (!Number.isInteger(entry.animation.frames) || entry.animation.frames < 1
      || !Number.isInteger(entry.animation.frameTicks) || entry.animation.frameTicks < 1)) {
      errors.push(`asset ${entry.assetId} animation must use positive integer frames/frameTicks`);
    }
  }

  for (const entry of manifest.entries) {
    if (entry.nightVariantAssetId && !entryById.has(entry.nightVariantAssetId)) {
      errors.push(`asset ${entry.assetId} references missing night variant: ${entry.nightVariantAssetId}`);
    }
  }

  return errors;
}
