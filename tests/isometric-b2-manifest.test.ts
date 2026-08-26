import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_A_ASSET_MANIFEST } from '../src/rendering/assets/PassAAssetManifest.ts';
import { PASS_B1_ASSET_MANIFEST, PASS_B1_COMPOSED_ASSET_MANIFEST } from '../src/rendering/assets/PassB1AssetManifest.ts';
import { PASS_B2_ASSET_MANIFEST, PASS_B2_COMPOSED_ASSET_MANIFEST } from '../src/rendering/assets/PassB2AssetManifest.ts';

const DIRECTIONAL = [
  'realm_curb_standard_01','realm_curb_ramp_01','realm_driveway_cut_01','realm_service_apron_01','realm_loading_apron_01','realm_parking_lot_entrance_01',
  'realm_bench_01',
  'realm_parking_surface_01','realm_parking_landscaped_edge_01','realm_garage_structured_entry_01','realm_garage_podium_entry_01','realm_curbside_cars_01',
] as const;

const SYMMETRIC = [
  'realm_sidewalk_concrete_01','realm_sidewalk_paver_01','realm_plaza_stone_01','realm_plaza_concrete_01','realm_permeable_pavers_01','realm_grass_verge_01',
  'realm_ped_lamp_01','realm_road_lamp_01','realm_bollards_01','realm_planter_01','realm_bin_01','realm_hydrant_01',
  'realm_tree_pit_01','realm_tree_pit_02','realm_tree_young_01','realm_tree_young_02','realm_tree_young_03','realm_tree_mature_01','realm_tree_mature_02','realm_tree_mature_03','realm_tree_mature_04','realm_tree_ornamental_01','realm_tree_ornamental_02','realm_tree_ornamental_03','realm_hedge_01','realm_hedge_02','realm_median_planting_01','realm_median_planting_02','realm_median_planting_03',
  'realm_pocket_plaza_01','realm_pocket_plaza_02','realm_civic_forecourt_01','realm_civic_forecourt_02','realm_commercial_forecourt_01','realm_commercial_forecourt_02','realm_small_square_01','realm_small_square_02','realm_cafe_market_01','realm_cafe_market_02','realm_cafe_market_03','realm_fountain_plinth_01','realm_fountain_plinth_02',
] as const;

test('B2 composition preserves prior cardinalities', () => {
  assert.equal(PASS_A_ASSET_MANIFEST.entries.length, 161);
  assert.equal(PASS_B1_ASSET_MANIFEST.entries.length, 138);
  assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length, 299);
  assert.equal(PASS_B1_COMPOSED_ASSET_MANIFEST.atlases.length, 9);
  assert.equal(PASS_B2_ASSET_MANIFEST.entries.length, 90);
  assert.equal(PASS_B2_ASSET_MANIFEST.atlases.length, 1);
  assert.equal(PASS_B2_COMPOSED_ASSET_MANIFEST.entries.length, 389);
  assert.equal(PASS_B2_COMPOSED_ASSET_MANIFEST.atlases.length, 10);
});

test('B2 rectangles are in bounds and asset ids are unique', () => {
  const ids = new Set<string>();
  for (const entry of PASS_B2_ASSET_MANIFEST.entries) {
    assert.equal(ids.has(entry.assetId), false); ids.add(entry.assetId);
    assert.equal(entry.category, 'public-realm');
    assert.ok(entry.tags?.includes('north-american'));
    assert.ok(entry.tags?.includes('pass-b2'));
    assert.ok(entry.sourceRect.x >= 0 && entry.sourceRect.y >= 0);
    assert.ok(entry.sourceRect.x + entry.sourceRect.width <= 2048);
    assert.ok(entry.sourceRect.y + entry.sourceRect.height <= 1152);
  }
});

test('B2 symmetric and directional families have exact orientation coverage', () => {
  for (const family of DIRECTIONAL) {
    const entries = PASS_B2_ASSET_MANIFEST.entries.filter((entry) => entry.variantKey === family);
    assert.deepEqual(entries.map((entry) => entry.orientation), [0,1,2,3], family);
    assert.equal(entries.some((entry) => entry.tags?.includes('symmetric')), false, family);
  }
  for (const family of SYMMETRIC) {
    const entries = PASS_B2_ASSET_MANIFEST.entries.filter((entry) => entry.variantKey === family);
    assert.equal(entries.length, 1, family);
    assert.equal(entries[0]?.orientation, 0, family);
    assert.ok(entries[0]?.tags?.includes('symmetric'), family);
  }
});
