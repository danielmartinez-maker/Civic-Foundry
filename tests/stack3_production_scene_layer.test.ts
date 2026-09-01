import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetManifestV2Entry } from '../src/rendering/3d/assets/AssetManifestV2.ts';
import type { ProductionVisualState } from '../src/rendering/3d/presentation/PresentationTypes.ts';
import { ProductionSceneLayer, type ProductionSceneAdapter } from '../src/rendering/3d/scene/ProductionSceneLayer.ts';

const entry: AssetManifestV2Entry = {
  assetId: 'cf_bld_res_test_a_v01', revision: 1, category: 'building', semanticFamily: 'residential-test',
  geometry: { lod0: 'assets/models/a0.glb', lod1: 'assets/models/a1.glb', lod2: 'assets/models/a2.glb' },
  dimensions: { widthM: 8, depthM: 10, heightM: 6 }, pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
  placement: { snapMode: 'parcel' }, sockets: [], materials: [{ id: 'wall', family: 'stucco' }], stateChannels: {},
  runtime: { instancing: 'thin', streamingClass: 'normal', memoryClass: 'small', estimatedCpuGeometryBytes: 1000, estimatedGpuGeometryBytes: 2000, estimatedGpuMaterialBytes: 500 },
  art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
};

function state(overrides: Partial<ProductionVisualState> = {}): ProductionVisualState {
  return {
    presentationId: 'building:1', canonicalId: '1', assetId: entry.assetId,
    transform: { positionM: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } },
    variationSeed: 7, structuralFingerprint: 's1', appearanceFingerprint: 'a1',
    ...overrides,
  };
}

class FakeAdapter implements ProductionSceneAdapter<{ id: string; lod: string }> {
  creates = 0; appearanceUpdates = 0; destroys = 0;
  create(input: { state: ProductionVisualState; lod: 'lod0' | 'lod1' | 'lod2' }) { this.creates += 1; return { id: input.state.presentationId, lod: input.lod }; }
  updateAppearance() { this.appearanceUpdates += 1; }
  destroy() { this.destroys += 1; }
}

const catalog = { get: (assetId: string) => assetId === entry.assetId ? entry : undefined };

test('unchanged production reconciliation creates no new retained instances', () => {
  const adapter = new FakeAdapter();
  const layer = new ProductionSceneLayer(catalog, adapter);
  layer.apply([state()], { x: 0, y: 10, z: 12 });
  const first = layer.debugStats();
  layer.apply([state()], { x: 0, y: 10, z: 12 });
  const second = layer.debugStats();
  assert.equal(adapter.creates, 1);
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
});

test('appearance changes update in place while structural changes replace', () => {
  const adapter = new FakeAdapter();
  const layer = new ProductionSceneLayer(catalog, adapter);
  layer.apply([state()], { x: 0, y: 10, z: 12 });
  layer.apply([state({ appearanceFingerprint: 'a2' })], { x: 0, y: 10, z: 12 });
  assert.equal(adapter.creates, 1);
  assert.equal(adapter.appearanceUpdates, 1);
  layer.apply([state({ structuralFingerprint: 's2', appearanceFingerprint: 'a2' })], { x: 0, y: 10, z: 12 });
  assert.equal(adapter.creates, 2);
  assert.equal(adapter.destroys, 1);
});

test('canonical identity changes replace the retained handle even when fingerprints are unchanged', () => {
  const adapter = new FakeAdapter();
  const layer = new ProductionSceneLayer(catalog, adapter);
  layer.apply([state()], { x: 0, y: 10, z: 12 });
  const result = layer.apply([state({ canonicalId: '2' })], { x: 0, y: 10, z: 12 });
  assert.equal(adapter.creates, 2);
  assert.equal(adapter.destroys, 1);
  assert.equal(result.replaced, 1);
  const digest = JSON.parse(layer.reconstructionDigest()) as Array<{ canonicalId: string }>;
  assert.equal(digest[0]?.canonicalId, '2');
});

test('teardown and rebuild preserve deterministic reconstruction digest and budget counts', () => {
  const adapter = new FakeAdapter();
  const layer = new ProductionSceneLayer(catalog, adapter);
  layer.apply([state()], { x: 0, y: 10, z: 12 });
  const firstDigest = layer.reconstructionDigest();
  const firstBudget = layer.debugStats();
  layer.clear();
  layer.apply([state()], { x: 0, y: 10, z: 12 });
  assert.equal(layer.reconstructionDigest(), firstDigest);
  assert.equal(layer.debugStats().uniquePrototypes, 1);
  assert.equal(firstBudget.estimatedGpuBytes, 2500);
});
