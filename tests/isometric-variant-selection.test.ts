import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVariantEntry, selectWeightedVariantKey, stableHash32 } from '../src/rendering/assets/VariantSelector.ts';
import type { AssetManifestEntry } from '../src/rendering/assets/AssetTypes.ts';

const variants = [
  { variantKey: 'house-a', weight: 1 },
  { variantKey: 'house-b', weight: 1 },
  { variantKey: 'house-c', weight: 1 },
] as const;

test('stable hash and weighted choice are deterministic', () => {
  assert.equal(stableHash32('building:lot-8'), stableHash32('building:lot-8'));
  const chosen = selectWeightedVariantKey('building:lot-8', variants);
  assert.equal(chosen, selectWeightedVariantKey('building:lot-8', variants));
});

test('stable choices distribute across variant families', () => {
  const selected = new Set(Array.from({ length: 100 }, (_, i) => selectWeightedVariantKey(`building:${i}`, variants)));
  assert.deepEqual([...selected].sort(), ['house-a', 'house-b', 'house-c']);
});

test('orientation resolution preserves the selected family', () => {
  const entries: AssetManifestEntry[] = [0, 1, 2, 3].map((orientation) => ({
    assetId: `house-a-o${orientation}`,
    variantKey: 'house-a',
    atlasId: 'buildings',
    sourceRect: { x: 0, y: 0, width: 128, height: 128 },
    footprint: { width: 1, height: 1 },
    anchor: { x: 64, y: 96 },
    category: 'building',
    orientation: orientation as 0 | 1 | 2 | 3,
  }));
  for (const orientation of [0, 1, 2, 3] as const) {
    assert.equal(resolveVariantEntry(entries, 'house-a', orientation)?.variantKey, 'house-a');
  }
});

test('symmetric variants may reuse orientation zero', () => {
  const entry: AssetManifestEntry = {
    assetId: 'tree-a-o0', variantKey: 'tree-a', atlasId: 'vegetation',
    sourceRect: { x: 0, y: 0, width: 128, height: 128 }, footprint: { width: 1, height: 1 },
    anchor: { x: 64, y: 96 }, category: 'vegetation', orientation: 0, tags: ['symmetric'],
  };
  assert.equal(resolveVariantEntry([entry], 'tree-a', 3)?.assetId, 'tree-a-o0');
});
