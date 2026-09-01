import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  checkAssetSources,
  compileAssetSource,
  listAssetSourceFiles,
} from '../tools/3d/CivicAssetCompiler.mjs';

const expectedIds = [
  'cf_bld_res_detached_house_a_low_v01',
  'cf_bld_res_rowhouse_a_med_v01',
  'cf_bld_com_corner_shop_a_low_v01',
  'cf_bld_mix_mainstreet_a_med_v01',
  'cf_bld_ind_light_workshop_a_low_v01',
  'cf_fac_fire_station_a_v01',
  'cf_prop_street_furniture_a_v01',
  'cf_veh_compact_car_a_v01',
  'cf_transit_bus_stop_a_v01',
  'cf_veg_deciduous_tree_a_v01',
  'cf_prop_pocket_park_a_v01',
  'cf_construction_basic_kit_a_v01',
  'cf_condition_basic_kit_a_v01',
  'cf_landmark_water_tower_a_v01',
] as const;

const requiredCategories = new Set([
  'building',
  'vehicle',
  'vegetation',
  'civic',
  'industrial',
  'transit',
  'construction',
  'public_realm',
]);

test('Stack 3 first production wave contains exactly the approved 14 asset families', async () => {
  const files = await listAssetSourceFiles();
  const sources = await Promise.all(files.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const ids = sources.map((source) => source.assetId).sort();
  assert.deepEqual(ids, [...expectedIds].sort());
  assert.equal(new Set(ids).size, expectedIds.length);
});

test('Stack 3 first production wave covers every required production category and canonical contract', async () => {
  const files = await listAssetSourceFiles();
  const sources = await Promise.all(files.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const categories = new Set(sources.map((source) => source.category));
  for (const category of requiredCategories) {
    assert.ok(categories.has(category), `missing category ${category}`);
  }

  for (const source of sources) {
    assert.equal(source.pivot.convention, 'ground-center', basename(source.assetId));
    assert.equal(source.pivot.forward, '-Z', source.assetId);
    assert.equal(source.pivot.up, '+Y', source.assetId);
    assert.deepEqual(source.lods.map((lod) => lod.id).sort(), ['lod0', 'lod1', 'lod2']);
    assert.equal(typeof source.semanticFamily, 'string', source.assetId);
    assert.ok(source.semanticFamily.length > 0, source.assetId);
    for (const key of ['estimatedCpuGeometryBytes', 'estimatedGpuGeometryBytes', 'estimatedGpuMaterialBytes']) {
      assert.ok(Number.isInteger(source.runtime[key]) && source.runtime[key] > 0, `${source.assetId}:${key}`);
    }
  }
});

test('Stack 3 compiler output is deterministic across the entire production wave', async () => {
  const files = await listAssetSourceFiles();
  for (const path of files) {
    const source = JSON.parse(await readFile(path, 'utf8'));
    const first = await compileAssetSource(source);
    const second = await compileAssetSource(source);
    assert.equal(first.contentHash, second.contentHash, source.assetId);
    assert.deepEqual(first.manifest, second.manifest, source.assetId);
  }

  const checked = await checkAssetSources();
  assert.equal(checked.catalog.entries.length, expectedIds.length);
});
