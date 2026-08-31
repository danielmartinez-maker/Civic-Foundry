import assert from 'node:assert/strict';
import test from 'node:test';
import { AssetCatalogV2 } from '../src/rendering/3d/assets/AssetCatalogV2.ts';
import {
  AssetStreamingManager,
  type AssetPrototypeLoadRequest,
} from '../src/rendering/3d/assets/AssetStreamingManager.ts';
import type {
  AssetId,
  AssetManifestV2,
  AssetManifestV2Entry,
} from '../src/rendering/3d/assets/AssetManifestV2.ts';

const HOUSE_A = 'cf_bld_res_detached_house_a_low_v01' as AssetId;

function houseEntry(): AssetManifestV2Entry {
  return Object.freeze({
    assetId: HOUSE_A,
    revision: 1,
    category: 'building',
    geometry: Object.freeze({
      lod0: `models/${HOUSE_A}_lod0.glb`,
      lod1: `models/${HOUSE_A}_lod1.glb`,
      lod2: `models/${HOUSE_A}_lod2.glb`,
      collision: `models/${HOUSE_A}_collision.glb`,
    }),
    dimensions: Object.freeze({ widthM: 9, depthM: 12, heightM: 7.6 }),
    pivot: Object.freeze({ convention: 'ground-center', forward: '-Z', up: '+Y' }),
    placement: Object.freeze({ snapMode: 'parcel' }),
    sockets: Object.freeze([]),
    materials: Object.freeze([]),
    stateChannels: Object.freeze({}),
    runtime: Object.freeze({ instancing: 'thin', streamingClass: 'near', memoryClass: 'small' }),
    art: Object.freeze({ styleFamily: 'civic-miniature', qualityTier: 'calibration' }),
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

test('aborting one deduplicated consumer never disposes the prototype needed by a surviving consumer', async () => {
  const manifest: AssetManifestV2 = Object.freeze({ schemaVersion: 2, entries: Object.freeze([houseEntry()]) });
  const gate = deferred<Readonly<{ key: string; dispose(): void }>>();
  const disposed: string[] = [];
  let loads = 0;
  const loader = async (_request: AssetPrototypeLoadRequest) => {
    loads += 1;
    return await gate.promise;
  };
  const manager = new AssetStreamingManager({
    catalog: new AssetCatalogV2(manifest),
    loader,
    maxConcurrent: 1,
  });
  const abort = new AbortController();

  const cancelled = manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1, signal: abort.signal });
  const surviving = manager.request({ assetId: HOUSE_A, lod: 'lod0', priority: 1 });
  abort.abort();
  gate.resolve(Object.freeze({
    key: `${HOUSE_A}@lod0`,
    dispose: () => { disposed.push(`${HOUSE_A}@lod0`); },
  }));

  await assert.rejects(cancelled, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  const lease = await surviving;

  assert.equal(loads, 1);
  assert.deepEqual(disposed, []);
  assert.equal(lease.prototype.key, `${HOUSE_A}@lod0`);
  assert.equal(manager.debugRefCount(lease.key), 1);
  lease.release();
  manager.dispose();
  assert.deepEqual(disposed, [`${HOUSE_A}@lod0`]);
});
