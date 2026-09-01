import assert from 'node:assert/strict';
import test from 'node:test';
import { AssetCatalogV2 } from '../src/rendering/3d/assets/AssetCatalogV2.ts';
import { GLBResourceCache } from '../src/rendering/3d/assets/GLBResourceCache.ts';
import { ScenePrototypeCache } from '../src/rendering/3d/assets/ScenePrototypeCache.ts';
import {
  AssetLoadError,
  AssetStreamingManager,
  type AssetPrototypeLoadRequest,
} from '../src/rendering/3d/assets/AssetStreamingManager.ts';
import type {
  AssetCategory,
  AssetId,
  AssetManifestV2,
  AssetManifestV2Entry,
} from '../src/rendering/3d/assets/AssetManifestV2.ts';

const HOUSE_A = 'cf_bld_res_detached_house_a_low_v01' as AssetId;
const TREE_A = 'cf_veg_tree_deciduous_a_small_v01' as AssetId;
const CAR_A = 'cf_vehicle_compact_car_a_small_v01' as AssetId;

function entry(assetId: AssetId, category: AssetCategory = 'building'): AssetManifestV2Entry {
  return Object.freeze({
    assetId,
    revision: 1,
    category,
    semanticFamily: `test-${category}`,
    geometry: Object.freeze({
      lod0: `models/${assetId}_lod0.glb`,
      lod1: `models/${assetId}_lod1.glb`,
      lod2: `models/${assetId}_lod2.glb`,
      collision: `models/${assetId}_collision.glb`,
    }),
    dimensions: Object.freeze({ widthM: 9, depthM: 12, heightM: 7.6 }),
    pivot: Object.freeze({ convention: 'ground-center' as const, forward: '-Z' as const, up: '+Y' as const }),
    placement: Object.freeze({ snapMode: 'parcel' as const }),
    sockets: Object.freeze([]),
    materials: Object.freeze([]),
    stateChannels: Object.freeze({}),
    runtime: Object.freeze({
      instancing: 'thin' as const,
      streamingClass: 'near' as const,
      memoryClass: 'small' as const,
      estimatedCpuGeometryBytes: 4096,
      estimatedGpuGeometryBytes: 8192,
      estimatedGpuMaterialBytes: 2048,
    }),
    art: Object.freeze({ styleFamily: 'civic-miniature', qualityTier: 'calibration' }),
  });
}

const manifest: AssetManifestV2 = Object.freeze({
  schemaVersion: 2,
  entries: Object.freeze([
    entry(TREE_A, 'vegetation'),
    entry(HOUSE_A, 'building'),
    entry(CAR_A, 'vehicle'),
  ]),
});

type FakePrototype = Readonly<{
  key: string;
  dispose(): void;
}>;

function fakePrototype(key: string, disposed?: string[]): FakePrototype {
  return Object.freeze({
    key,
    dispose: () => { disposed?.push(key); },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function managerWith(
  loader: (request: AssetPrototypeLoadRequest) => Promise<FakePrototype>,
  maxConcurrent = 2,
): AssetStreamingManager<FakePrototype> {
  return new AssetStreamingManager({
    catalog: new AssetCatalogV2(manifest),
    loader,
    maxConcurrent,
  });
}

test('asset catalog validates and stores entries in deterministic asset-id order', () => {
  const catalog = new AssetCatalogV2(manifest);
  assert.deepEqual(catalog.list().map((asset) => asset.assetId), [HOUSE_A, CAR_A, TREE_A].sort());
  assert.equal(catalog.get(HOUSE_A)?.assetId, HOUSE_A);
  assert.equal(catalog.require(HOUSE_A).assetId, HOUSE_A);
  assert.equal(catalog.model(HOUSE_A, 'lod2'), `models/${HOUSE_A}_lod2.glb`);
  assert.throws(() => catalog.require('cf_missing_asset_v01' as AssetId), /unknown asset/i);
});

test('asset catalog rejects an invalid Asset Manifest V2 at construction', () => {
  assert.throws(
    () => new AssetCatalogV2({ schemaVersion: 2, entries: [{ assetId: 'bad' }] } as unknown as AssetManifestV2),
    /Asset Manifest V2 invalid/i,
  );
});

test('duplicate asset+LOD requests collapse to one load and both leases share a prototype', async () => {
  let loads = 0;
  const manager = managerWith(async (request) => {
    loads += 1;
    return fakePrototype(request.key);
  });

  const [a, b] = await Promise.all([
    manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 }),
    manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 }),
  ]);

  assert.equal(loads, 1);
  assert.equal(a.prototype, b.prototype);
  assert.equal(manager.debugRefCount(a.key), 2);
  a.release();
  assert.equal(manager.debugRefCount(a.key), 1);
  b.release();
  assert.equal(manager.debugRefCount(a.key), 0);
  manager.dispose();
});

test('lease release is guarded so refcounts never fall below zero', async () => {
  const manager = managerWith(async (request) => fakePrototype(request.key));
  const lease = await manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 });
  lease.release();
  assert.equal(manager.debugRefCount(lease.key), 0);
  assert.throws(() => lease.release(), /released/i);
  assert.equal(manager.debugRefCount(lease.key), 0);
  manager.dispose();
});

test('cache hits and misses are deterministic and resolved resources remain resident until eviction/disposal', async () => {
  let loads = 0;
  const manager = managerWith(async (request) => {
    loads += 1;
    return fakePrototype(request.key);
  });

  const first = await manager.request({ assetId: HOUSE_A, lod: 'lod1', priority: 2 });
  first.release();
  const second = await manager.request({ assetId: HOUSE_A, lod: 'lod1', priority: 2 });
  second.release();

  assert.equal(loads, 1);
  assert.deepEqual(manager.diagnostics(), {
    requestCount: 2,
    cacheHits: 1,
    cacheMisses: 1,
    residentCount: 1,
    queuedCount: 0,
    activeLoads: 0,
  });
  manager.dispose();
});

test('cancellation before acquisition rejects the lease and disposes an unreferenced loaded prototype', async () => {
  const gate = deferred<FakePrototype>();
  const disposed: string[] = [];
  const manager = managerWith(async () => await gate.promise, 1);
  const abort = new AbortController();
  const request = manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1, signal: abort.signal });

  abort.abort();
  gate.resolve(fakePrototype(`${HOUSE_A}@lod0`, disposed));

  await assert.rejects(request, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  await Promise.resolve();
  assert.deepEqual(disposed, [`${HOUSE_A}@lod0`]);
  assert.equal(manager.diagnostics().residentCount, 0);
  assert.equal(manager.debugRefCount(`${HOUSE_A}@lod0`), 0);
  manager.dispose();
});

test('priority broker starts queued P0 work before queued P4 work with FIFO inside a priority', async () => {
  const firstGate = deferred<FakePrototype>();
  const starts: string[] = [];
  const manager = managerWith(async (request) => {
    starts.push(request.key);
    if (request.assetId === HOUSE_A) return await firstGate.promise;
    return fakePrototype(request.key);
  }, 1);

  const first = manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 2 });
  await Promise.resolve();
  const background = manager.request({ assetId: TREE_A, lod: 'lod0', priority: 4 });
  const critical = manager.request({ assetId: CAR_A, lod: 'lod0', priority: 0 });
  await Promise.resolve();
  assert.deepEqual(starts, [`${HOUSE_A}@lod0`]);

  firstGate.resolve(fakePrototype(`${HOUSE_A}@lod0`));
  const leases = await Promise.all([first, background, critical]);
  assert.deepEqual(starts, [`${HOUSE_A}@lod0`, `${CAR_A}@lod0`, `${TREE_A}@lod0`]);
  for (const lease of leases) lease.release();
  manager.dispose();
});

test('transient loader failure retries once and then succeeds', async () => {
  let attempts = 0;
  const manager = managerWith(async (request) => {
    attempts += 1;
    if (attempts === 1) throw new AssetLoadError('temporary network failure', 'transient');
    return fakePrototype(request.key);
  });

  const lease = await manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 });
  assert.equal(attempts, 2);
  lease.release();
  manager.dispose();
});

test('permanent loader failure is not retried', async () => {
  let attempts = 0;
  const manager = managerWith(async () => {
    attempts += 1;
    throw new AssetLoadError('invalid glb', 'permanent');
  });

  await assert.rejects(
    manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 }),
    /invalid glb/i,
  );
  assert.equal(attempts, 1);
  manager.dispose();
});

test('resource cache refcounts and scene prototype cache disposal are explicit', () => {
  const resources = new GLBResourceCache<FakePrototype>();
  const prototypes = new ScenePrototypeCache<FakePrototype>();
  const disposed: string[] = [];
  const key = `${HOUSE_A}@lod0` as const;
  const prototype = fakePrototype(key, disposed);

  resources.set(key, prototype);
  prototypes.set(key, prototype);
  assert.equal(resources.acquire(key), prototype);
  assert.equal(resources.refCount(key), 1);
  resources.release(key);
  assert.equal(resources.refCount(key), 0);
  assert.throws(() => resources.release(key), /zero/i);

  assert.equal(prototypes.evict(key), true);
  assert.deepEqual(disposed, [key]);
  assert.equal(prototypes.evict(key), false);
});

test('Babylon GLB prototype loader centralizes URL loading, instantiation, and presentation disposal', async () => {
  const { BabylonGlbPrototypeLoader } = await import(
    '../src/rendering/3d/assets/BabylonGlbPrototypeLoader.ts'
  );
  const scene = Object.freeze({ id: 'scene' });
  const loadCalls: Array<Readonly<{ rootUrl: string; fileName: string; scene: unknown }>> = [];
  const disposeCalls: string[] = [];
  let rename: ((name: string) => string) | undefined;
  const rootNode = Object.freeze({ dispose: () => { disposeCalls.push('root'); } });
  const skeleton = Object.freeze({ dispose: () => { disposeCalls.push('skeleton'); } });
  const animationGroup = Object.freeze({ dispose: () => { disposeCalls.push('animation'); } });
  const container = Object.freeze({
    instantiateModelsToScene: (nameFunction?: (name: string) => string) => {
      rename = nameFunction;
      return Object.freeze({
        rootNodes: Object.freeze([rootNode]),
        skeletons: Object.freeze([skeleton]),
        animationGroups: Object.freeze([animationGroup]),
      });
    },
    dispose: () => { disposeCalls.push('container'); },
  });
  const loader = new BabylonGlbPrototypeLoader(scene as never, {
    loadAssetContainerAsync: async (rootUrl: string, fileName: string, receivedScene: unknown) => {
      loadCalls.push(Object.freeze({ rootUrl, fileName, scene: receivedScene }));
      return container as never;
    },
  });
  const key = `${HOUSE_A}@lod0`;
  const prototype = await loader.load({
    key,
    assetId: HOUSE_A,
    lod: 'lod0',
    url: `models/${HOUSE_A}_lod0.glb`,
  });

  assert.deepEqual(loadCalls, [{
    rootUrl: 'models/',
    fileName: `${HOUSE_A}_lod0.glb`,
    scene,
  }]);
  assert.equal(prototype.key, key);

  const instance = prototype.instantiate('building:b1');
  assert.equal(rename?.('root'), 'building:b1:root');
  assert.deepEqual(instance.rootNodes, [rootNode]);
  instance.dispose();
  assert.deepEqual(disposeCalls, ['animation', 'skeleton', 'root']);

  prototype.dispose();
  assert.deepEqual(disposeCalls, ['animation', 'skeleton', 'root', 'container']);
  assert.throws(() => prototype.instantiate('building:b2'), /disposed/i);
});
