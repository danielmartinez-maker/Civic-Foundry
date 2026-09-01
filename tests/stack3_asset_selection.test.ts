import assert from 'node:assert/strict';
import test from 'node:test';
import { AssetCatalogV2 } from '../src/rendering/3d/assets/AssetCatalogV2.ts';
import type { AssetManifestV2Entry } from '../src/rendering/3d/assets/AssetManifestV2.ts';
import { selectProductionAssetId } from '../src/rendering/3d/presentation/ProductionAssetSelector.ts';

function entry(assetId: string, family: string): AssetManifestV2Entry {
  return {
    assetId: assetId as AssetManifestV2Entry['assetId'],
    revision: 1,
    category: 'building',
    semanticFamily: family,
    geometry: { lod0: `assets/models/${assetId}_lod0.glb` },
    dimensions: { widthM: 8, depthM: 10, heightM: 6 },
    pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
    placement: { snapMode: 'parcel' },
    sockets: [],
    materials: [{ id: 'wall', family: 'stucco' }],
    stateChannels: {},
    runtime: {
      instancing: 'thin', streamingClass: 'normal', memoryClass: 'small',
      estimatedCpuGeometryBytes: 1000, estimatedGpuGeometryBytes: 2000, estimatedGpuMaterialBytes: 500,
    },
    art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
  };
}

const a = entry('cf_bld_res_test_a_v01', 'residential-test');
const b = entry('cf_bld_res_test_b_v01', 'residential-test');
const c = entry('cf_bld_com_test_a_v01', 'commercial-test');

const catalog = new AssetCatalogV2({ schemaVersion: 2, entries: [b, c, a] });

test('semantic family catalog queries are asset-id sorted', () => {
  assert.deepEqual(catalog.listBySemanticFamily('residential-test').map((item) => item.assetId), [a.assetId, b.assetId]);
  assert.deepEqual(catalog.listBySemanticFamily('missing'), []);
});

test('production selection is stable and candidate-input-order independent', () => {
  const forward = selectProductionAssetId('building:42', 'residential-test', [a, b], 'base');
  const reverse = selectProductionAssetId('building:42', 'residential-test', [b, a], 'base');
  assert.equal(forward, reverse);
  assert.equal(forward, selectProductionAssetId('building:42', 'residential-test', [a, b], 'base'));
});

test('production selection changes only from stable inputs and handles empty candidates', () => {
  assert.equal(selectProductionAssetId('building:42', 'residential-test', [], 'base'), null);
  const selected = new Set(Array.from({ length: 64 }, (_, index) =>
    selectProductionAssetId(`building:${index}`, 'residential-test', [a, b], 'base')));
  assert.deepEqual([...selected].sort(), [a.assetId, b.assetId].sort());
});
