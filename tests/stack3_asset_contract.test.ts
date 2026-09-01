import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAssetSource } from '../tools/3d/CivicAssetCompiler.mjs';
import { validateAssetManifestV2 } from '../src/rendering/3d/assets/AssetManifestV2Validation.ts';

const baseSource = {
  schemaVersion: 1,
  assetId: 'cf_bld_res_test_a_low_v01',
  category: 'building',
  semanticFamily: 'residential-detached-low',
  dimensions: { widthM: 8, depthM: 10, heightM: 6 },
  pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
  placement: { snapMode: 'parcel', zoneCompatibility: ['residential'], density: ['low'] },
  materials: [{ id: 'wall', family: 'stucco', baseColor: '#d8ceb7', roughness: 0.8, metallic: 0 }],
  sockets: [],
  stateChannels: { condition: ['good', 'worn'] },
  runtime: {
    instancing: 'thin',
    streamingClass: 'normal',
    memoryClass: 'small',
    estimatedCpuGeometryBytes: 12000,
    estimatedGpuGeometryBytes: 18000,
    estimatedGpuMaterialBytes: 4096,
  },
  art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
  lods: [
    { id: 'lod0', maxTriangles: 24, parts: [{ id: 'body', primitive: 'box', size: { x: 6, y: 4, z: 8 }, center: { x: 0, y: 2, z: 0 }, material: 'wall' }] },
    { id: 'lod1', maxTriangles: 24, parts: [{ id: 'body', primitive: 'box', size: { x: 6, y: 4, z: 8 }, center: { x: 0, y: 2, z: 0 }, material: 'wall' }] },
    { id: 'lod2', maxTriangles: 24, parts: [{ id: 'body', primitive: 'box', size: { x: 6, y: 4, z: 8 }, center: { x: 0, y: 2, z: 0 }, material: 'wall' }] },
  ],
  collision: [{ id: 'body', primitive: 'box', size: { x: 6, y: 4, z: 8 }, center: { x: 0, y: 2, z: 0 } }],
};

test('Stack 3 source contract accepts semantic family and explicit memory estimates', () => {
  assert.deepEqual(validateAssetSource(baseSource), []);
});

test('Stack 3 source contract requires semantic family and positive memory estimates', () => {
  const missingFamily = structuredClone(baseSource) as any;
  delete missingFamily.semanticFamily;
  assert.match(validateAssetSource(missingFamily).join('\n'), /semanticFamily/);

  const missingBudget = structuredClone(baseSource) as any;
  delete missingBudget.runtime.estimatedGpuGeometryBytes;
  assert.match(validateAssetSource(missingBudget).join('\n'), /estimatedGpuGeometryBytes/);

  const invalidBudget = structuredClone(baseSource) as any;
  invalidBudget.runtime.estimatedGpuMaterialBytes = 0;
  assert.match(validateAssetSource(invalidBudget).join('\n'), /estimatedGpuMaterialBytes/);
});

const baseManifest = {
  schemaVersion: 2,
  entries: [{
    assetId: 'cf_bld_res_test_a_low_v01',
    revision: 1,
    category: 'building',
    semanticFamily: 'residential-detached-low',
    geometry: {
      lod0: 'assets/models/cf_bld_res_test_a_low_v01_lod0.glb',
      lod1: 'assets/models/cf_bld_res_test_a_low_v01_lod1.glb',
      lod2: 'assets/models/cf_bld_res_test_a_low_v01_lod2.glb',
      collision: 'assets/collisions/cf_bld_res_test_a_low_v01_collision.glb',
    },
    dimensions: { widthM: 8, depthM: 10, heightM: 6 },
    pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
    placement: { snapMode: 'parcel', zoneCompatibility: ['residential'], density: ['low'] },
    sockets: [],
    materials: [{ id: 'wall', family: 'stucco' }],
    stateChannels: { condition: ['good', 'worn'] },
    runtime: {
      instancing: 'thin',
      streamingClass: 'normal',
      memoryClass: 'small',
      estimatedCpuGeometryBytes: 12000,
      estimatedGpuGeometryBytes: 18000,
      estimatedGpuMaterialBytes: 4096,
    },
    art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
  }],
};

test('Stack 3 manifest requires semantic family and explicit positive memory estimates', () => {
  assert.deepEqual(validateAssetManifestV2(baseManifest), []);

  const missingFamily = structuredClone(baseManifest) as any;
  delete missingFamily.entries[0].semanticFamily;
  assert.match(validateAssetManifestV2(missingFamily).join('\n'), /semanticFamily/);

  const missingBudget = structuredClone(baseManifest) as any;
  delete missingBudget.entries[0].runtime.estimatedCpuGeometryBytes;
  assert.match(validateAssetManifestV2(missingBudget).join('\n'), /estimatedCpuGeometryBytes/);

  const invalidBudget = structuredClone(baseManifest) as any;
  invalidBudget.entries[0].runtime.estimatedGpuGeometryBytes = -1;
  assert.match(validateAssetManifestV2(invalidBudget).join('\n'), /estimatedGpuGeometryBytes/);
});
