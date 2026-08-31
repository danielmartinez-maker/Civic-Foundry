import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetId } from '../src/rendering/3d/assets/AssetManifestV2.ts';
import type { AssetLod } from '../src/rendering/3d/assets/AssetCatalogV2.ts';
import type {
  BuildingVisualState,
  PresentationEntityId,
  WorldPresentationSnapshot,
} from '../src/rendering/3d/presentation/PresentationTypes.ts';
import {
  BuildingSceneLayer,
  type BuildingAssetSource,
  type BuildingPickMetadata,
  type BuildingSceneAdapter,
} from '../src/rendering/3d/scene/BuildingSceneLayer.ts';

const HOUSE_A = 'cf_bld_res_detached_house_a_low_v01' as AssetId;
const BUILDING_ID = 'building:house-a-debug' as const;

type FakePrototype = Readonly<{ key: string }>;
type FakeHandle = Readonly<{
  presentationId: PresentationEntityId;
  metadata: BuildingPickMetadata;
}>;

function state(overrides: Partial<BuildingVisualState> = {}): BuildingVisualState {
  return Object.freeze({
    presentationId: BUILDING_ID,
    canonicalBuildingId: 'house-a-debug',
    assetId: HOUSE_A,
    transform: Object.freeze({
      positionM: Object.freeze({ x: 120, y: 0, z: 100 }),
      rotationYRad: 0,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    }),
    fallbackBoundsM: Object.freeze({
      footprint: Object.freeze([
        Object.freeze({ x: 115.5, y: 94 }),
        Object.freeze({ x: 124.5, y: 94 }),
        Object.freeze({ x: 124.5, y: 106 }),
        Object.freeze({ x: 115.5, y: 106 }),
      ]),
      heightM: 7.6,
    }),
    state: Object.freeze({
      condition: 'excellent' as const,
      occupancy: 'occupied' as const,
      powered: true,
      construction: 'none' as const,
      constructionProgress: 0,
      nightLighting: false,
    }),
    variationSeed: 108,
    structuralFingerprint: 'structure:1',
    appearanceFingerprint: 'appearance:1',
    ...overrides,
  });
}

function snapshot(building: BuildingVisualState): WorldPresentationSnapshot {
  return Object.freeze({
    revision: Object.freeze({ world: 1, buildings: 1, environment: 1 }),
    visualTime: 'day' as const,
    buildings: Object.freeze([building]),
    dirty: Object.freeze({
      structuralBuildings: Object.freeze([BUILDING_ID]),
      appearanceBuildings: Object.freeze([]),
      removedBuildings: Object.freeze([]),
    }),
  });
}

function layer() {
  const assets: BuildingAssetSource<FakePrototype> = {
    request: async ({ assetId, lod }) => Object.freeze({
      key: `${assetId}@${lod}`,
      assetId,
      lod,
      prototype: Object.freeze({ key: `${assetId}@${lod}` }),
      release: (): void => {},
    }),
  };
  const adapter: BuildingSceneAdapter<FakePrototype, FakeHandle> = {
    createAssetBuilding: (building, _prototype, _lod, metadata) => Object.freeze({
      presentationId: building.presentationId,
      metadata,
    }),
    createFallbackBuilding: (building, metadata) => Object.freeze({
      presentationId: building.presentationId,
      metadata,
    }),
    applyAppearance: () => {},
    disposeBuilding: () => {},
  };
  return new BuildingSceneLayer<FakePrototype, FakeHandle>({ assets, adapter });
}

test('debugBuildingState exposes canonical presentation state without renderer handles', async () => {
  const sceneLayer = layer();
  const building = state();
  await sceneLayer.applySnapshot(snapshot(building), { x: 120, y: 40, z: 140 });

  const debug = sceneLayer.debugBuildingState(BUILDING_ID);
  assert.ok(debug);
  assert.equal(debug.assetId, HOUSE_A);
  assert.equal(debug.lod, 'lod0');
  assert.equal(debug.variationSeed, 108);
  assert.match(debug.structuralHandleId, /^building:house-a-debug:structural:\d+$/);
  assert.deepEqual(Object.keys(debug).sort(), [
    'assetId',
    'lod',
    'structuralHandleId',
    'variationSeed',
  ]);
  assert.equal(sceneLayer.debugBuildingState('building:missing'), null);

  sceneLayer.dispose();
});

test('appearance-only updates retain structuralHandleId while structural replacement changes it', async () => {
  const sceneLayer = layer();
  const initial = state();
  await sceneLayer.applySnapshot(snapshot(initial), { x: 120, y: 40, z: 140 });
  const first = sceneLayer.debugBuildingState(BUILDING_ID);
  assert.ok(first);

  const appearance = state({
    appearanceFingerprint: 'appearance:2',
    state: Object.freeze({ ...initial.state, condition: 'worn' as const }),
  });
  await sceneLayer.applySnapshot(Object.freeze({
    ...snapshot(appearance),
    dirty: Object.freeze({
      structuralBuildings: Object.freeze([]),
      appearanceBuildings: Object.freeze([BUILDING_ID]),
      removedBuildings: Object.freeze([]),
    }),
  }), { x: 120, y: 40, z: 140 });
  const second = sceneLayer.debugBuildingState(BUILDING_ID);
  assert.equal(second?.structuralHandleId, first.structuralHandleId);

  const structural = state({ structuralFingerprint: 'structure:2' });
  await sceneLayer.applySnapshot(snapshot(structural), { x: 120, y: 40, z: 140 });
  const third = sceneLayer.debugBuildingState(BUILDING_ID);
  assert.ok(third);
  assert.notEqual(third.structuralHandleId, first.structuralHandleId);

  sceneLayer.dispose();
});
