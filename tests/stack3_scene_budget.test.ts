import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetManifestV2Entry } from '../src/rendering/3d/assets/AssetManifestV2.ts';
import {
  STACK3_PRODUCTION_ASSET_IDS,
  buildStack3AcceptanceDistrict,
  summarizeProductionBudget,
} from '../src/rendering/3d/presentation/Stack3AcceptanceDistrict.ts';

const entries = new Map(STACK3_PRODUCTION_ASSET_IDS.map((assetId, index) => [assetId, {
  assetId,
  revision: 1,
  category: 'building',
  semanticFamily: `family-${index}`,
  geometry: { lod0: `assets/models/${assetId}_lod0.glb` },
  dimensions: { widthM: 8, depthM: 10, heightM: 6 },
  pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
  placement: { snapMode: 'parcel' }, sockets: [], materials: [], stateChannels: {},
  runtime: {
    instancing: 'thin', streamingClass: 'normal', memoryClass: 'small',
    estimatedCpuGeometryBytes: 1000 + index,
    estimatedGpuGeometryBytes: 2000 + index,
    estimatedGpuMaterialBytes: 500 + index,
  },
  art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
} as AssetManifestV2Entry]));
const catalog = { get: (assetId: string) => entries.get(assetId as typeof STACK3_PRODUCTION_ASSET_IDS[number]) };

test('block fixture is deterministic, has at least 100 entities, and covers all production families', () => {
  const first = buildStack3AcceptanceDistrict('block');
  const second = buildStack3AcceptanceDistrict('block');
  assert.ok(first.length >= 100);
  assert.deepEqual(first, second);
  assert.deepEqual([...new Set(first.map((state) => state.assetId))].sort(), [...STACK3_PRODUCTION_ASSET_IDS].sort());
});

test('neighborhood fixture scales past 1000 entities while prototypes remain catalog-bounded', () => {
  const states = buildStack3AcceptanceDistrict('neighborhood');
  assert.ok(states.length >= 1000);
  const summary = summarizeProductionBudget(states, catalog);
  assert.equal(summary.entityCount, states.length);
  assert.ok(summary.uniquePrototypes <= STACK3_PRODUCTION_ASSET_IDS.length);
  assert.ok(summary.estimatedGpuGeometryBytes > 0);
  assert.ok(summary.estimatedGpuMaterialBytes > 0);
});

test('structural GPU budget depends on unique prototypes rather than repeated instance count', () => {
  const block = buildStack3AcceptanceDistrict('block');
  const repeated = [...block, ...block.map((item) => ({ ...item, presentationId: `${item.presentationId}:copy` }))];
  const first = summarizeProductionBudget(block, catalog);
  const second = summarizeProductionBudget(repeated, catalog);
  assert.equal(second.entityCount, first.entityCount * 2);
  assert.equal(second.uniquePrototypes, first.uniquePrototypes);
  assert.equal(second.estimatedGpuGeometryBytes, first.estimatedGpuGeometryBytes);
  assert.equal(second.estimatedGpuMaterialBytes, first.estimatedGpuMaterialBytes);
});
