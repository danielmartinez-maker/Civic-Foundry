import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_A_ASSET_MANIFEST } from '../src/rendering/assets/PassAAssetManifest.ts';
import { resolveVariantEntry, selectBuildingVariantEntry, selectWeightedVariantKey, stableHash32 } from '../src/rendering/assets/VariantSelector.ts';
import type { AssetManifestEntry } from '../src/rendering/assets/AssetTypes.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

const variants = [{ variantKey: 'house-a', weight: 1 }, { variantKey: 'house-b', weight: 1 }, { variantKey: 'house-c', weight: 1 }] as const;

test('stable hash and weighted choice are deterministic and distributed', () => {
  assert.equal(stableHash32('building:lot-8'), stableHash32('building:lot-8'));
  const chosen = selectWeightedVariantKey('building:lot-8', variants);
  assert.equal(chosen, selectWeightedVariantKey('building:lot-8', variants));
  const selected = new Set(Array.from({ length: 100 }, (_, i) => selectWeightedVariantKey(`building:${i}`, variants)));
  assert.deepEqual([...selected].sort(), ['house-a', 'house-b', 'house-c']);
});

test('orientation resolution preserves a selected family and symmetric fallback', () => {
  const entries: AssetManifestEntry[] = [0,1,2,3].map((orientation) => ({ assetId: `house-a-o${orientation}`, variantKey: 'house-a', atlasId: 'buildings', sourceRect: { x: 0, y: 0, width: 128, height: 128 }, footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 96 }, category: 'building', orientation: orientation as 0|1|2|3 }));
  for (const orientation of [0,1,2,3] as const) assert.equal(resolveVariantEntry(entries, 'house-a', orientation)?.variantKey, 'house-a');
  const symmetric: AssetManifestEntry = { ...entries[0]!, assetId: 'tree-a-o0', variantKey: 'tree-a', tags: ['symmetric'] };
  assert.equal(resolveVariantEntry([symmetric], 'tree-a', 3)?.assetId, 'tree-a-o0');
});

test('building visual identity is stable across camera rotation', () => {
  const entries = PASS_A_ASSET_MANIFEST.entries.filter((e) => e.category === 'building');
  const building: Building = { id: 'building:lot:8', lotId: 'lot:8', x: 8, y: 4, zone: 'residential', definitionId: 'residential_rowhouse', status: 'occupied', constructionStartedTick: 0, completionTick: 70 };
  const keys = ([0,1,2,3] as const).map((orientation) => selectBuildingVariantEntry(building, orientation, entries)?.variantKey);
  assert.ok(keys[0]);
  assert.deepEqual(keys, [keys[0], keys[0], keys[0], keys[0]]);
});

test('dense residential selection uses all three variants and remains repeatable', () => {
  const entries = PASS_A_ASSET_MANIFEST.entries.filter((e) => e.category === 'building');
  const run = () => Array.from({ length: 144 }, (_, i) => {
    const building: Building = { id: `building:lot:${i}`, lotId: `lot:${i}`, x: i % 12, y: Math.floor(i / 12), zone: 'residential', definitionId: 'residential_cottage', status: 'occupied', constructionStartedTick: 0, completionTick: 50 };
    return selectBuildingVariantEntry(building, 0, entries)?.variantKey;
  });
  const first = run(); const second = run();
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 3);
});
