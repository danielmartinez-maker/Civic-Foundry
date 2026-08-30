import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAssetSource } from '../tools/3d/CivicAssetCompiler.mjs';

const source = {
  schemaVersion: 1,
  assetId: 'cf_test_building_box_low_a_v01',
  category: 'building',
  dimensions: { widthM: 4, depthM: 6, heightM: 3 },
  pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
  materials: [
    {
      id: 'wall',
      family: 'stucco',
      baseColor: '#d6c7a8',
      roughness: 0.8,
      metallic: 0,
    },
  ],
  sockets: [
    {
      id: 'front_entry',
      position: { x: 0, y: 0, z: -3 },
      forward: { x: 0, y: 0, z: -1 },
    },
  ],
  stateChannels: {},
  runtime: {
    instancing: 'thin',
    streamingClass: 'normal',
    memoryClass: 'tiny',
  },
  art: {
    styleFamily: 'civic-foundry-miniature',
    qualityTier: 'standard',
  },
  lods: [
    {
      id: 'lod0',
      maxTriangles: 100,
      parts: [
        {
          id: 'body',
          primitive: 'box',
          size: { x: 4, y: 3, z: 6 },
          center: { x: 0, y: 1.5, z: 0 },
          material: 'wall',
        },
      ],
    },
    {
      id: 'lod1',
      maxTriangles: 100,
      parts: [
        {
          id: 'body',
          primitive: 'box',
          size: { x: 4, y: 3, z: 6 },
          center: { x: 0, y: 1.5, z: 0 },
          material: 'wall',
        },
      ],
    },
    {
      id: 'lod2',
      maxTriangles: 100,
      parts: [
        {
          id: 'body',
          primitive: 'box',
          size: { x: 4, y: 3, z: 6 },
          center: { x: 0, y: 1.5, z: 0 },
          material: 'wall',
        },
      ],
    },
  ],
  collision: [
    {
      id: 'collision_body',
      primitive: 'box',
      size: { x: 4, y: 3, z: 6 },
      center: { x: 0, y: 1.5, z: 0 },
    },
  ],
};

test('compiler emits byte-identical GLB for identical source', async () => {
  const first = await compileAssetSource(source, {
    compilerVersion: 'test-v1',
  });
  const second = await compileAssetSource(source, {
    compilerVersion: 'test-v1',
  });
  assert.deepEqual(first.lods.lod0, second.lods.lod0);
  assert.equal(first.contentHash, second.contentHash);
});

test('compiler rejects geometry below ground and missing required LODs', async () => {
  const below = structuredClone(source) as any;
  below.lods[0].parts[0].center.y = -2;
  await assert.rejects(
    () => compileAssetSource(below, { compilerVersion: 'test-v1' }),
    /below ground/,
  );

  const missing = structuredClone(source) as any;
  missing.lods = missing.lods.slice(0, 2);
  await assert.rejects(
    () => compileAssetSource(missing, { compilerVersion: 'test-v1' }),
    /lod2/,
  );
});
