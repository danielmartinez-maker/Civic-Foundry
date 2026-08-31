import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type {
  AssetId,
  AssetManifestV2,
  AssetManifestV2Entry,
} from '../src/rendering/3d/assets/AssetManifestV2.ts';
import type {
  AssetPrototypeLoadRequest,
} from '../src/rendering/3d/assets/AssetStreamingManager.ts';
import type { BabylonGlbPrototype } from '../src/rendering/3d/assets/BabylonGlbPrototypeLoader.ts';
import type {
  BuildingVisualState,
  WorldPresentationSnapshot,
} from '../src/rendering/3d/presentation/PresentationTypes.ts';
import {
  Civic3DBuildingRuntime,
  CIVIC_3D_ASSET_CATALOG_URL,
} from '../src/rendering/3d/scene/Civic3DBuildingRuntime.ts';

const HOUSE_A = 'cf_bld_res_detached_house_a_low_v01' as AssetId;

function houseManifest(): AssetManifestV2 {
  const entry: AssetManifestV2Entry = Object.freeze({
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
  return Object.freeze({ schemaVersion: 2, entries: Object.freeze([entry]) });
}

function houseState(): BuildingVisualState {
  return Object.freeze({
    presentationId: 'building:b1',
    canonicalBuildingId: 'b1',
    assetId: HOUSE_A,
    transform: Object.freeze({
      positionM: Object.freeze({ x: 20, y: 0, z: 20 }),
      rotationYRad: 0,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    }),
    fallbackBoundsM: Object.freeze({
      footprint: Object.freeze([
        Object.freeze({ x: 15.5, y: 14 }),
        Object.freeze({ x: 24.5, y: 14 }),
        Object.freeze({ x: 24.5, y: 26 }),
        Object.freeze({ x: 15.5, y: 26 }),
      ]),
      heightM: 7.6,
    }),
    state: Object.freeze({
      condition: 'good',
      occupancy: 'occupied',
      powered: true,
      construction: 'none',
      constructionProgress: 0,
      nightLighting: false,
    }),
    variationSeed: 1,
    structuralFingerprint: 'b1:structure:1',
    appearanceFingerprint: 'b1:appearance:1',
  });
}

function snapshot(worldRevision: number, dirty = true): WorldPresentationSnapshot {
  return Object.freeze({
    revision: Object.freeze({ world: worldRevision, buildings: 1, environment: 0 }),
    visualTime: 'day',
    buildings: Object.freeze([houseState()]),
    dirty: Object.freeze({
      structuralBuildings: Object.freeze(dirty ? ['building:b1'] : []),
      appearanceBuildings: Object.freeze([]),
      removedBuildings: Object.freeze([]),
    }),
  });
}

test('3D building runtime loads generated catalog, streams House A once, retains it, reports real stats, and shuts down cleanly', async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const fetches: string[] = [];
  const loads: string[] = [];
  const disposedPrototypes: string[] = [];

  const runtime = await Civic3DBuildingRuntime.create(scene, {
    fetchManifest: async (url) => {
      fetches.push(url);
      return houseManifest();
    },
    loadPrototype: async (request: AssetPrototypeLoadRequest) => {
      loads.push(request.key);
      const prototype = {
        key: request.key,
        instantiate: (prefix: string, options: Readonly<{ cloneMaterials?: boolean }> = {}) => {
          assert.equal(prefix, 'building:b1');
          assert.equal(options.cloneMaterials, true);
          const root = new TransformNode(`${prefix}:prototype-root`, scene);
          let disposed = false;
          return Object.freeze({
            rootNodes: Object.freeze([root]),
            dispose: (): void => {
              if (disposed) return;
              disposed = true;
              root.dispose(false, true);
            },
          });
        },
        dispose: (): void => { disposedPrototypes.push(request.key); },
      } as unknown as BabylonGlbPrototype;
      return prototype;
    },
  });

  assert.deepEqual(fetches, [CIVIC_3D_ASSET_CATALOG_URL]);
  assert.equal(CIVIC_3D_ASSET_CATALOG_URL, 'assets/manifests/catalog-v2.json');

  runtime.submit(snapshot(1), Object.freeze({ x: 20, y: 40, z: 20 }));
  await runtime.whenIdle();
  assert.deepEqual(loads, [`${HOUSE_A}@lod0`]);
  assert.deepEqual(runtime.diagnostics(), {
    loadedPrototypes: 1,
    buildingInstances: 1,
    fallbackBuildings: 0,
    assetRequests: 1,
    cacheHits: 0,
    cacheMisses: 1,
  });

  runtime.submit(snapshot(2, false), Object.freeze({ x: 20, y: 40, z: 20 }));
  await runtime.whenIdle();
  assert.deepEqual(loads, [`${HOUSE_A}@lod0`]);
  assert.equal(runtime.diagnostics().assetRequests, 1);

  await runtime.dispose();
  assert.deepEqual(disposedPrototypes, [`${HOUSE_A}@lod0`]);
  scene.dispose();
  engine.dispose();
});

test('3D building runtime reports reconciliation failures and continues with the newest queued snapshot', async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const diagnostics: string[] = [];
  let attempts = 0;
  const runtime = await Civic3DBuildingRuntime.create(scene, {
    fetchManifest: async () => houseManifest(),
    loadPrototype: async () => {
      attempts += 1;
      throw new Error('broken calibration GLB');
    },
    onDiagnostic: (message) => diagnostics.push(message),
  });

  runtime.submit(snapshot(1), Object.freeze({ x: 20, y: 40, z: 20 }));
  runtime.submit(snapshot(2), Object.freeze({ x: 20, y: 40, z: 20 }));
  await runtime.whenIdle();

  assert.ok(attempts >= 1);
  assert.ok(diagnostics.some((entry) => entry.includes('broken calibration GLB')));
  await runtime.dispose();
  scene.dispose();
  engine.dispose();
});
