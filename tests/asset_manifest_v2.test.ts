import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssetManifestV2,
  validateAssetManifestV2,
} from '../src/rendering/3d/assets/AssetManifestV2Validation.ts';

const valid = {
  schemaVersion: 2,
  entries: [{
    assetId: 'cf_bld_res_detached_house_a_low_v01',
    revision: 1,
    category: 'building',
    semanticFamily: 'residential-detached-low',
    geometry: {
      lod0: 'assets/models/cf_bld_res_detached_house_a_low_v01_lod0.glb',
      lod1: 'assets/models/cf_bld_res_detached_house_a_low_v01_lod1.glb',
      lod2: 'assets/models/cf_bld_res_detached_house_a_low_v01_lod2.glb',
      collision: 'assets/collisions/cf_bld_res_detached_house_a_low_v01_collision.glb',
    },
    dimensions: { widthM: 9, depthM: 12, heightM: 7.6 },
    pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
    placement: { snapMode: 'parcel', zoneCompatibility: ['residential'], density: ['low'] },
    sockets: [
      { id: 'front_entry', position: { x: 0, y: 0, z: -6 }, forward: { x: 0, y: 0, z: -1 } },
      { id: 'rear_service', position: { x: 0, y: 0, z: 6 }, forward: { x: 0, y: 0, z: 1 } },
      { id: 'exterior_light', position: { x: 0, y: 2.3, z: -6.01 }, forward: { x: 0, y: 0, z: -1 } },
    ],
    materials: [{ id: 'stucco_cream', family: 'stucco' }],
    stateChannels: {
      condition: ['excellent', 'good', 'worn', 'distressed', 'unsafe'],
      occupancy: ['vacant', 'occupied'],
      power: ['off', 'on'],
      construction: ['none', 'active'],
      night: ['day', 'night'],
    },
    runtime: {
      instancing: 'thin',
      streamingClass: 'normal',
      memoryClass: 'small',
      estimatedCpuGeometryBytes: 24000,
      estimatedGpuGeometryBytes: 36000,
      estimatedGpuMaterialBytes: 8192,
    },
    art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
  }],
} as const;

test('Asset Manifest V2 accepts the canonical House A contract', () => {
  assert.doesNotThrow(() => assertAssetManifestV2(valid));
  assert.equal(validateAssetManifestV2(valid).length, 0);
});

test('Asset Manifest V2 rejects external and parent-relative model references', () => {
  const external = structuredClone(valid) as any;
  external.entries[0].geometry.lod0 = 'https://example.com/house.glb';
  assert.match(validateAssetManifestV2(external).join('\n'), /runtime-relative/);

  const parent = structuredClone(valid) as any;
  parent.entries[0].geometry.lod0 = '../house.glb';
  assert.match(validateAssetManifestV2(parent).join('\n'), /runtime-relative/);
});

test('Asset Manifest V2 rejects duplicate IDs and wrong axis conventions', () => {
  const duplicate = structuredClone(valid) as any;
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  assert.match(validateAssetManifestV2(duplicate).join('\n'), /duplicate assetId/);

  const axis = structuredClone(valid) as any;
  axis.entries[0].pivot.up = '+Z';
  assert.match(validateAssetManifestV2(axis).join('\n'), /\+Y/);
});
