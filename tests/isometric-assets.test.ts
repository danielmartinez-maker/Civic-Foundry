import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssetManifest } from '../src/rendering/assets/AssetManifestValidation.ts';
import { PASS_A_ASSET_MANIFEST, PASS_A_BUILDING_VARIANTS, PASS_A_VEHICLE_FAMILIES } from '../src/rendering/assets/PassAAssetManifest.ts';
import type { AssetManifest } from '../src/rendering/assets/AssetTypes.ts';

function validManifest(): AssetManifest {
  return {
    schemaVersion: 1,
    atlases: [{ atlasId: 'a', url: './a.png', width: 128, height: 64 }],
    entries: [{ assetId: 'terrain_grass_01', variantKey: 'terrain_grass_01', atlasId: 'a', sourceRect: { x: 0, y: 0, width: 128, height: 64 }, footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 32 }, category: 'terrain', subcategory: 'grass', orientation: 0, weight: 1, tags: ['symmetric'] }],
  };
}

test('valid manifest has no validation errors', () => assert.deepEqual(validateAssetManifest(validManifest()), []));

test('manifest validation reports duplicate IDs and invalid geometry', () => {
  const base = validManifest(); const entry = base.entries[0]!;
  const manifest: AssetManifest = { ...base, entries: [entry, { ...entry, sourceRect: { x: 120, y: 0, width: 128, height: 64 }, weight: 0 }] };
  const errors = validateAssetManifest(manifest).join('\n');
  assert.match(errors, /duplicate assetId/); assert.match(errors, /sourceRect exceeds atlas/); assert.match(errors, /weight must be positive/);
});

test('Pass A manifest validates and contains complete Tier 1 coverage', () => {
  assert.deepEqual(validateAssetManifest(PASS_A_ASSET_MANIFEST), []);
  const entries = PASS_A_ASSET_MANIFEST.entries;
  assert.equal(entries.filter((e) => e.category === 'terrain').length, 8);
  assert.equal(entries.filter((e) => e.category === 'road').length, 48);
  assert.equal(new Set(entries.filter((e) => e.category === 'building').map((e) => e.variantKey)).size, 27);
  assert.equal(PASS_A_BUILDING_VARIANTS.length, 27);
  assert.equal(entries.filter((e) => e.category === 'construction').length, 12);
  assert.equal(entries.filter((e) => e.category === 'civic').length, 6);
  assert.equal(entries.filter((e) => e.category === 'utility').length, 3);
  assert.equal(entries.filter((e) => e.category === 'vegetation').length, 9);
  assert.equal(entries.filter((e) => e.category === 'vehicle').length, PASS_A_VEHICLE_FAMILIES.length * 4);
});

test('each zone and intensity has at least three building variant families', () => {
  for (const zone of ['residential','commercial','industrial'] as const) {
    for (const intensity of ['low','medium','high'] as const) {
      const keys = new Set(PASS_A_ASSET_MANIFEST.entries.filter((e) => e.category === 'building' && e.zone === zone && e.intensity === intensity).map((e) => e.variantKey));
      assert.ok(keys.size >= 3, `${zone}/${intensity} has ${keys.size} variants`);
    }
  }
});

test('all 16 road masks exist exactly once for each current class', () => {
  for (const roadType of ['local','collector','arterial']) {
    const entries = PASS_A_ASSET_MANIFEST.entries.filter((e) => e.category === 'road' && e.subcategory === roadType);
    assert.equal(entries.length, 16);
    assert.deepEqual(entries.map((e) => Number(e.tags?.find((tag) => tag.startsWith('mask:'))?.split(':')[1])).sort((a,b) => a-b), Array.from({length:16},(_,i)=>i));
  }
});

test('required civic, utility, and vehicle families resolve in the manifest', () => {
  for (const type of ['fire_station','police_station','clinic','elementary_school','landfill','recycling_center']) assert.ok(PASS_A_ASSET_MANIFEST.entries.some((e) => e.category === 'civic' && e.subcategory === type));
  for (const type of ['power','water','landfill']) assert.ok(PASS_A_ASSET_MANIFEST.entries.some((e) => e.category === 'utility' && e.subcategory === type));
  for (const variantKey of PASS_A_VEHICLE_FAMILIES) {
    const orientations = PASS_A_ASSET_MANIFEST.entries.filter((e) => e.variantKey === variantKey).map((e) => e.orientation).sort();
    assert.deepEqual(orientations, [0,1,2,3]);
  }
});
