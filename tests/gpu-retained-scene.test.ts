import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const retainedModuleUrl = new URL('../src/rendering/gpu/RetainedSceneIndex.ts', import.meta.url);
const catalogModuleUrl = new URL('../src/rendering/gpu/GpuAssetCatalog.ts', import.meta.url);

async function loadRetainedSceneIndex(): Promise<any> {
  assert.ok(existsSync(retainedModuleUrl), 'RetainedSceneIndex must exist before retained GPU rendering can be implemented');
  const module = await import(retainedModuleUrl.href);
  assert.equal(typeof module.RetainedSceneIndex, 'function');
  return module.RetainedSceneIndex;
}

async function loadGpuAssetCatalog(): Promise<any> {
  assert.ok(existsSync(catalogModuleUrl), 'GpuAssetCatalog must exist and wrap the canonical Pass A manifest');
  const module = await import(catalogModuleUrl.href);
  assert.equal(typeof module.GpuAssetCatalog, 'function');
  return module.GpuAssetCatalog;
}

test('retained index reuses identity for an unchanged fingerprint', async () => {
  const RetainedSceneIndex = await loadRetainedSceneIndex();
  const index = new RetainedSceneIndex();
  let nextId = 0;
  const hooks = {
    create: () => ({ id: ++nextId }),
    update: () => undefined,
    destroy: () => undefined,
  };

  const first = index.sync([{ key: 'road:4,4', fingerprint: 'local|3' }], hooks);
  const second = index.sync([{ key: 'road:4,4', fingerprint: 'local|3' }], hooks);

  assert.equal(first.entries[0]?.value.id, second.entries[0]?.value.id);
  assert.equal(second.delta.created, 0);
  assert.equal(second.delta.updated, 0);
  assert.equal(second.delta.removed, 0);
  assert.equal(second.totals.active, 1);
});

test('retained index updates in place and destroys keys that disappear', async () => {
  const RetainedSceneIndex = await loadRetainedSceneIndex();
  const index = new RetainedSceneIndex();
  let nextId = 0;
  let updates = 0;
  let destroys = 0;
  const hooks = {
    create: () => ({ id: ++nextId }),
    update: () => { updates += 1; },
    destroy: () => { destroys += 1; },
  };

  const first = index.sync([{ key: 'building:a', fingerprint: 'occupied|asset-a' }], hooks);
  const firstId = first.entries[0]?.value.id;
  const changed = index.sync([{ key: 'building:a', fingerprint: 'construction|asset-b' }], hooks);

  assert.equal(changed.entries[0]?.value.id, firstId);
  assert.equal(changed.delta.created, 0);
  assert.equal(changed.delta.updated, 1);
  assert.equal(updates, 1);

  const removed = index.sync([], hooks);
  assert.equal(removed.delta.removed, 1);
  assert.equal(removed.totals.active, 0);
  assert.equal(destroys, 1);
});

test('GPU asset catalog queries and resolves the canonical Pass A manifest', async () => {
  const [{ PASS_A_ASSET_MANIFEST }, { GpuAssetCatalog }] = await Promise.all([
    import('../src/rendering/assets/PassAAssetManifest.ts'),
    loadGpuAssetCatalog().then((Ctor) => ({ GpuAssetCatalog: Ctor })),
  ]);
  const catalog = new GpuAssetCatalog(PASS_A_ASSET_MANIFEST);

  assert.equal(catalog.query({ category: 'road', subcategory: 'local' }).length, 16);
  assert.equal(catalog.resolveEntry('vehicle_bus_01_o2')?.variantKey, 'vehicle_bus_01');
  assert.equal(catalog.resolveVariant('vehicle_bus_01', 2)?.assetId, 'vehicle_bus_01_o2');
  assert.deepEqual(catalog.diagnostics(), []);
});

test('GPU asset catalog surfaces canonical manifest validation errors', async () => {
  const [{ GpuAssetCatalog }, { PASS_A_ASSET_MANIFEST }] = await Promise.all([
    loadGpuAssetCatalog().then((Ctor) => ({ GpuAssetCatalog: Ctor })),
    import('../src/rendering/assets/PassAAssetManifest.ts'),
  ]);
  const entry = PASS_A_ASSET_MANIFEST.entries[0]!;
  const invalidManifest = {
    schemaVersion: 1,
    atlases: PASS_A_ASSET_MANIFEST.atlases,
    entries: [entry, entry],
  };
  const catalog = new GpuAssetCatalog(invalidManifest);
  assert.ok(catalog.diagnostics().some((message: string) => message.includes('duplicate assetId')));
});
