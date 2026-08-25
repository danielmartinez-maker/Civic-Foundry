import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssetManifest } from '../src/rendering/assets/AssetManifestValidation.ts';
import type { AssetManifest } from '../src/rendering/assets/AssetTypes.ts';

function validManifest(): AssetManifest {
  return {
    schemaVersion: 1,
    atlases: [{ atlasId: 'a', url: './a.png', width: 128, height: 64 }],
    entries: [{
      assetId: 'terrain_grass_01', variantKey: 'terrain_grass_01', atlasId: 'a',
      sourceRect: { x: 0, y: 0, width: 128, height: 64 },
      footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 32 },
      category: 'terrain', subcategory: 'grass', orientation: 0, weight: 1,
      tags: ['symmetric'],
    }],
  };
}

test('valid manifest has no validation errors', () => {
  assert.deepEqual(validateAssetManifest(validManifest()), []);
});

test('manifest validation reports duplicate IDs and invalid geometry', () => {
  const base = validManifest();
  const entry = base.entries[0]!;
  const manifest: AssetManifest = {
    ...base,
    entries: [entry, { ...entry, sourceRect: { x: 120, y: 0, width: 128, height: 64 }, weight: 0 }],
  };
  const errors = validateAssetManifest(manifest).join('\n');
  assert.match(errors, /duplicate assetId/);
  assert.match(errors, /sourceRect exceeds atlas/);
  assert.match(errors, /weight must be positive/);
});

test('manifest validation rejects missing atlas and night variant targets', () => {
  const base = validManifest();
  const entry = base.entries[0]!;
  const manifest: AssetManifest = {
    ...base,
    entries: [{ ...entry, atlasId: 'missing', nightVariantAssetId: 'night_missing' }],
  };
  const errors = validateAssetManifest(manifest).join('\n');
  assert.match(errors, /unknown atlas/);
  assert.match(errors, /missing night variant/);
});
