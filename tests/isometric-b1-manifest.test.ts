import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAssetManifest } from '../src/rendering/assets/AssetManifestValidation.ts';
import { PASS_A_ASSET_MANIFEST, PASS_A_BUILDING_VARIANTS } from '../src/rendering/assets/PassAAssetManifest.ts';
import type { AssetManifest } from '../src/rendering/assets/AssetTypes.ts';

async function loadB1() {
  return import('../src/rendering/assets/PassB1AssetManifest.ts');
}

async function loadComposer() {
  return import('../src/rendering/assets/AssetManifestComposer.ts');
}

test('Pass B1 manifest modules are available', async () => {
  await assert.doesNotReject(async () => {
    const b1 = await loadB1();
    const composer = await loadComposer();
    assert.ok(b1.PASS_B1_ASSET_MANIFEST);
    assert.ok(b1.PASS_B1_COMPOSED_ASSET_MANIFEST);
    assert.equal(typeof composer.composeAssetManifests, 'function');
  });
});

test('Pass B1 preserves Pass A and composes exactly 299 presentation entries', async () => {
  const { PASS_B1_ASSET_MANIFEST, PASS_B1_COMPOSED_ASSET_MANIFEST } = await loadB1();
  assert.equal(PASS_A_ASSET_MANIFEST.entries.length, 161);
  assert.equal(PASS_B1_ASSET_MANIFEST.entries.length, 138);
  assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length, 299);
  assert.deepEqual(validateAssetManifest(PASS_B1_ASSET_MANIFEST), []);
  assert.deepEqual(validateAssetManifest(PASS_B1_COMPOSED_ASSET_MANIFEST), []);
});

test('every Pass A building family receives exactly four additional condition frames', async () => {
  const { PASS_B1_ASSET_MANIFEST } = await loadB1();
  const expectedConditions = ['new', 'aging', 'neglected', 'abandoned'];
  for (const [baseVariant] of PASS_A_BUILDING_VARIANTS) {
    const frames = PASS_B1_ASSET_MANIFEST.entries
      .filter((entry) => entry.category === 'building' && entry.tags?.includes(`base-family:${baseVariant}`));
    assert.equal(frames.length, 4, `${baseVariant} has ${frames.length} B1 condition frames`);
    assert.deepEqual(frames.map((entry) => entry.condition).sort(), [...expectedConditions].sort());
    assert.ok(frames.every((entry) => entry.variantKey.startsWith(`${baseVariant}__`)));
  }
});

test('all six mixed-use families receive five condition frames', async () => {
  const { PASS_B1_ASSET_MANIFEST, PASS_B1_MIXED_USE_FAMILIES } = await loadB1();
  assert.equal(PASS_B1_MIXED_USE_FAMILIES.length, 6);
  const expectedConditions = ['new', 'maintained', 'aging', 'neglected', 'abandoned'];
  for (const [family, typologyId] of PASS_B1_MIXED_USE_FAMILIES) {
    const frames = PASS_B1_ASSET_MANIFEST.entries
      .filter((entry) => entry.category === 'building' && entry.tags?.includes(`base-family:${family}`));
    assert.equal(frames.length, 5, `${family} has ${frames.length} condition frames`);
    assert.deepEqual(frames.map((entry) => entry.condition).sort(), [...expectedConditions].sort());
    assert.ok(frames.every((entry) => entry.tags?.includes(`typology:${typologyId}`)));
  }
});

test('Pass B1 asset and atlas IDs are unique after composition', async () => {
  const { PASS_B1_COMPOSED_ASSET_MANIFEST } = await loadB1();
  const assetIds = PASS_B1_COMPOSED_ASSET_MANIFEST.entries.map((entry) => entry.assetId);
  const atlasIds = PASS_B1_COMPOSED_ASSET_MANIFEST.atlases.map((atlas) => atlas.atlasId);
  assert.equal(new Set(assetIds).size, assetIds.length);
  assert.equal(new Set(atlasIds).size, atlasIds.length);
});

test('Pass B1 source atlas contract exists at exact manifest dimensions', async () => {
  const { PASS_B1_ASSET_MANIFEST } = await loadB1();
  const atlas = PASS_B1_ASSET_MANIFEST.atlases[0]!;
  const source = readFileSync('assets/source/urban_depth_buildings.svg', 'utf8');
  assert.match(source, new RegExp(`<svg\\b[^>]*width=["']${atlas.width}["'][^>]*height=["']${atlas.height}["']`, 'i'));
  for (const entry of PASS_B1_ASSET_MANIFEST.entries) {
    assert.ok(entry.sourceRect.x + entry.sourceRect.width <= atlas.width, entry.assetId);
    assert.ok(entry.sourceRect.y + entry.sourceRect.height <= atlas.height, entry.assetId);
  }
});

test('manifest composer rejects duplicate atlas and asset identities', async () => {
  const { composeAssetManifests } = await loadComposer();
  const base: AssetManifest = {
    schemaVersion: 1,
    atlases: [{ atlasId: 'a', url: './a.png', width: 128, height: 192 }],
    entries: [{ assetId: 'one', variantKey: 'one', atlasId: 'a', sourceRect: { x: 0, y: 0, width: 128, height: 192 }, footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 160 }, category: 'building' }],
  };
  assert.throws(() => composeAssetManifests(base, base), /duplicate atlasId|duplicate assetId/);
});
