import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetId } from '../src/rendering/3d/assets/AssetManifestV2.ts';
import type { AssetLod } from '../src/rendering/3d/assets/AssetCatalogV2.ts';
import type {
  BuildingVisualState,
  PresentationEntityId,
  VisualCondition,
  WorldPresentationSnapshot,
} from '../src/rendering/3d/presentation/PresentationTypes.ts';
import {
  BuildingSceneLayer,
  selectBuildingLod,
  type BuildingAssetSource,
  type BuildingPickMetadata,
  type BuildingSceneAdapter,
} from '../src/rendering/3d/scene/BuildingSceneLayer.ts';
import { resolveBuildingAppearance } from '../src/rendering/3d/scene/StateVisualResolver.ts';

const HOUSE_A = 'cf_bld_res_detached_house_a_low_v01' as AssetId;
const B1 = 'building:b1' as const;
const B2 = 'building:b2' as const;

type FakePrototype = Readonly<{ key: string }>;
type FakeHandle = {
  readonly id: number;
  readonly kind: 'asset' | 'fallback';
  readonly presentationId: PresentationEntityId;
  readonly metadata: BuildingPickMetadata;
  readonly assetId: AssetId | null;
  readonly lod: AssetLod | 'proxy';
  appearanceUpdates: number;
  disposed: boolean;
};

function building(
  presentationId: `building:${string}`,
  overrides: Partial<BuildingVisualState> = {},
): BuildingVisualState {
  const canonicalBuildingId = presentationId.slice('building:'.length);
  const footprint = Object.freeze([
    Object.freeze({ x: -4.5, y: -6 }),
    Object.freeze({ x: 4.5, y: -6 }),
    Object.freeze({ x: 4.5, y: 6 }),
    Object.freeze({ x: -4.5, y: 6 }),
  ]);
  return Object.freeze({
    presentationId,
    canonicalBuildingId,
    assetId: HOUSE_A,
    transform: Object.freeze({
      positionM: Object.freeze({ x: 0, y: 0, z: 0 }),
      rotationYRad: 0,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    }),
    fallbackBoundsM: Object.freeze({ footprint, heightM: 7.6 }),
    state: Object.freeze({
      condition: 'excellent' as const,
      occupancy: 'occupied' as const,
      powered: true,
      construction: 'none' as const,
      constructionProgress: 0,
      nightLighting: false,
    }),
    variationSeed: 42,
    structuralFingerprint: `${presentationId}:structure:1`,
    appearanceFingerprint: `${presentationId}:appearance:1`,
    ...overrides,
  });
}

function snapshot(
  buildings: readonly BuildingVisualState[],
  dirty: Partial<WorldPresentationSnapshot['dirty']> = {},
): WorldPresentationSnapshot {
  return Object.freeze({
    revision: Object.freeze({ world: 1, buildings: 1, environment: 1 }),
    visualTime: 'day' as const,
    buildings: Object.freeze([...buildings]),
    dirty: Object.freeze({
      structuralBuildings: Object.freeze([...(dirty.structuralBuildings ?? [])]),
      appearanceBuildings: Object.freeze([...(dirty.appearanceBuildings ?? [])]),
      removedBuildings: Object.freeze([...(dirty.removedBuildings ?? [])]),
    }),
  });
}

function testRig() {
  let nextHandleId = 1;
  const requests: Array<Readonly<{ assetId: AssetId; lod: AssetLod }>> = [];
  const releases: string[] = [];
  const assetCreates: Array<Readonly<{ state: BuildingVisualState; lod: AssetLod; metadata: BuildingPickMetadata }>> = [];
  const fallbackCreates: Array<Readonly<{ state: BuildingVisualState; metadata: BuildingPickMetadata }>> = [];
  const disposedHandles: number[] = [];

  const assets: BuildingAssetSource<FakePrototype> = {
    request: async ({ assetId, lod }) => {
      requests.push(Object.freeze({ assetId, lod }));
      const key = `${assetId}@${lod}` as const;
      let released = false;
      return Object.freeze({
        key,
        assetId,
        lod,
        prototype: Object.freeze({ key }),
        release: (): void => {
          if (released) throw new Error(`fake lease '${key}' already released`);
          released = true;
          releases.push(key);
        },
      });
    },
  };

  const adapter: BuildingSceneAdapter<FakePrototype, FakeHandle> = {
    createAssetBuilding: (state, prototype, lod, metadata) => {
      assert.equal(prototype.key, `${state.assetId}@${lod}`);
      assetCreates.push(Object.freeze({ state, lod, metadata }));
      return {
        id: nextHandleId++,
        kind: 'asset',
        presentationId: state.presentationId,
        metadata,
        assetId: state.assetId,
        lod,
        appearanceUpdates: 0,
        disposed: false,
      };
    },
    createFallbackBuilding: (state, metadata) => {
      fallbackCreates.push(Object.freeze({ state, metadata }));
      return {
        id: nextHandleId++,
        kind: 'fallback',
        presentationId: state.presentationId,
        metadata,
        assetId: null,
        lod: 'proxy',
        appearanceUpdates: 0,
        disposed: false,
      };
    },
    applyAppearance: (handle) => {
      handle.appearanceUpdates += 1;
    },
    disposeBuilding: (handle) => {
      handle.disposed = true;
      disposedHandles.push(handle.id);
    },
  };

  const layer = new BuildingSceneLayer<FakePrototype, FakeHandle>({ assets, adapter });
  return { layer, requests, releases, assetCreates, fallbackCreates, disposedHandles };
}

test('unchanged and appearance-only snapshots retain the same building handle and base prototype lease', async () => {
  const rig = testRig();
  const initial = building(B1);
  await rig.layer.applySnapshot(
    snapshot([initial], { structuralBuildings: [B1] }),
    { x: 0, y: 0, z: 70 },
  );
  const handle = rig.layer.debugHandle(B1);
  assert.ok(handle);
  assert.equal(rig.requests.length, 1);
  assert.equal(handle.appearanceUpdates, 1);

  await rig.layer.applySnapshot(snapshot([initial]), { x: 0, y: 0, z: 70 });
  assert.equal(rig.layer.debugHandle(B1), handle);
  assert.equal(rig.requests.length, 1);
  assert.equal(handle.appearanceUpdates, 1);

  const appearanceOnly = building(B1, {
    state: Object.freeze({ ...initial.state, condition: 'worn' as const }),
    appearanceFingerprint: `${B1}:appearance:2`,
  });
  await rig.layer.applySnapshot(
    snapshot([appearanceOnly], { appearanceBuildings: [B1] }),
    { x: 0, y: 0, z: 70 },
  );
  assert.equal(rig.layer.debugHandle(B1), handle);
  assert.equal(rig.requests.length, 1);
  assert.equal(handle.appearanceUpdates, 2);
  assert.equal(rig.releases.length, 0);

  rig.layer.dispose();
});

test('structural replacement swaps only the affected building and removal releases its lease', async () => {
  const rig = testRig();
  const first = building(B1);
  const second = building(B2, {
    transform: Object.freeze({
      positionM: Object.freeze({ x: 25, y: 0, z: 0 }),
      rotationYRad: 0,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    }),
  });
  await rig.layer.applySnapshot(
    snapshot([first, second], { structuralBuildings: [B1, B2] }),
    { x: 0, y: 0, z: 60 },
  );
  const firstHandle = rig.layer.debugHandle(B1);
  const secondHandle = rig.layer.debugHandle(B2);
  assert.ok(firstHandle);
  assert.ok(secondHandle);

  const restructured = building(B1, {
    fallbackBoundsM: Object.freeze({
      footprint: Object.freeze([
        Object.freeze({ x: -5, y: -6 }),
        Object.freeze({ x: 5, y: -6 }),
        Object.freeze({ x: 5, y: 6 }),
        Object.freeze({ x: -5, y: 6 }),
      ]),
      heightM: 8.2,
    }),
    structuralFingerprint: `${B1}:structure:2`,
  });
  await rig.layer.applySnapshot(
    snapshot([restructured, second], { structuralBuildings: [B1] }),
    { x: 0, y: 0, z: 60 },
  );

  assert.notEqual(rig.layer.debugHandle(B1), firstHandle);
  assert.equal(rig.layer.debugHandle(B2), secondHandle);
  assert.equal(firstHandle.disposed, true);
  assert.equal(secondHandle.disposed, false);
  assert.equal(rig.releases.length, 1);

  await rig.layer.applySnapshot(
    snapshot([second], { removedBuildings: [B1] }),
    { x: 0, y: 0, z: 60 },
  );
  assert.equal(rig.layer.debugHandle(B1), null);
  assert.equal(rig.layer.debugHandle(B2), secondHandle);
  assert.equal(rig.releases.length, 2);

  rig.layer.dispose();
});

test('unsupported typology uses canonical fallback bounds and exact presentation pick metadata without borrowing House A', async () => {
  const rig = testRig();
  const unsupported = building(B1, {
    assetId: null,
    fallbackBoundsM: Object.freeze({
      footprint: Object.freeze([
        Object.freeze({ x: -7, y: -4 }),
        Object.freeze({ x: 7, y: -4 }),
        Object.freeze({ x: 7, y: 4 }),
        Object.freeze({ x: -7, y: 4 }),
      ]),
      heightM: 18,
    }),
    structuralFingerprint: `${B1}:unsupported`,
  });

  await rig.layer.applySnapshot(
    snapshot([unsupported], { structuralBuildings: [B1] }),
    { x: 0, y: 0, z: 50 },
  );

  assert.equal(rig.requests.length, 0);
  assert.equal(rig.assetCreates.length, 0);
  assert.equal(rig.fallbackCreates.length, 1);
  assert.deepEqual(rig.fallbackCreates[0]?.state.fallbackBoundsM, unsupported.fallbackBoundsM);
  assert.deepEqual(rig.fallbackCreates[0]?.metadata, { presentationEntityId: B1 });
  assert.deepEqual(Object.keys(rig.fallbackCreates[0]?.metadata ?? {}), ['presentationEntityId']);
  assert.equal(rig.layer.debugHandle(B1)?.assetId, null);
  assert.equal(rig.layer.debugHandle(B1)?.lod, 'proxy');

  rig.layer.dispose();
});

test('House A instances receive exact canonical presentation pick metadata', async () => {
  const rig = testRig();
  const state = building(B1);
  await rig.layer.applySnapshot(
    snapshot([state], { structuralBuildings: [B1] }),
    { x: 0, y: 0, z: 50 },
  );
  assert.equal(rig.assetCreates.length, 1);
  assert.deepEqual(rig.assetCreates[0]?.metadata, { presentationEntityId: B1 });
  assert.deepEqual(Object.keys(rig.assetCreates[0]?.metadata ?? {}), ['presentationEntityId']);
  rig.layer.dispose();
});

test('LOD selection uses 90m and 260m thresholds with ten-percent hysteresis', () => {
  assert.equal(selectBuildingLod(0, null), 'lod0');
  assert.equal(selectBuildingLod(90, null), 'lod0');
  assert.equal(selectBuildingLod(90.01, null), 'lod1');
  assert.equal(selectBuildingLod(260, null), 'lod1');
  assert.equal(selectBuildingLod(260.01, null), 'lod2');

  assert.equal(selectBuildingLod(99, 'lod0'), 'lod0');
  assert.equal(selectBuildingLod(99.01, 'lod0'), 'lod1');
  assert.equal(selectBuildingLod(81.01, 'lod1'), 'lod1');
  assert.equal(selectBuildingLod(81, 'lod1'), 'lod0');
  assert.equal(selectBuildingLod(286, 'lod1'), 'lod1');
  assert.equal(selectBuildingLod(286.01, 'lod1'), 'lod2');
  assert.equal(selectBuildingLod(234.01, 'lod2'), 'lod2');
  assert.equal(selectBuildingLod(234, 'lod2'), 'lod1');
});

test('camera distance changes replace House A only after crossing hysteresis boundaries', async () => {
  const rig = testRig();
  const state = building(B1);
  const initial = snapshot([state], { structuralBuildings: [B1] });
  await rig.layer.applySnapshot(initial, { x: 80, y: 0, z: 0 });
  const lod0Handle = rig.layer.debugHandle(B1);
  assert.equal(lod0Handle?.lod, 'lod0');

  await rig.layer.applySnapshot(snapshot([state]), { x: 95, y: 0, z: 0 });
  assert.equal(rig.layer.debugHandle(B1), lod0Handle);
  assert.equal(rig.requests.length, 1);

  await rig.layer.applySnapshot(snapshot([state]), { x: 105, y: 0, z: 0 });
  const lod1Handle = rig.layer.debugHandle(B1);
  assert.notEqual(lod1Handle, lod0Handle);
  assert.equal(lod1Handle?.lod, 'lod1');
  assert.deepEqual(rig.requests.map((request) => request.lod), ['lod0', 'lod1']);

  await rig.layer.applySnapshot(snapshot([state]), { x: 275, y: 0, z: 0 });
  assert.equal(rig.layer.debugHandle(B1), lod1Handle);

  await rig.layer.applySnapshot(snapshot([state]), { x: 300, y: 0, z: 0 });
  const lod2Handle = rig.layer.debugHandle(B1);
  assert.equal(lod2Handle?.lod, 'lod2');
  assert.notEqual(lod2Handle, lod1Handle);

  await rig.layer.applySnapshot(snapshot([state]), { x: 250, y: 0, z: 0 });
  assert.equal(rig.layer.debugHandle(B1), lod2Handle);
  await rig.layer.applySnapshot(snapshot([state]), { x: 225, y: 0, z: 0 });
  assert.equal(rig.layer.debugHandle(B1)?.lod, 'lod1');

  rig.layer.dispose();
});

test('state visual profiles degrade deterministically and power gates night emissive windows', () => {
  const conditions: readonly VisualCondition[] = ['excellent', 'good', 'worn', 'distressed', 'unsafe'];
  const appearances = conditions.map((condition) => resolveBuildingAppearance({
    condition,
    occupancy: 'occupied',
    powered: true,
    construction: 'none',
    constructionProgress: 0,
    nightLighting: false,
  }));

  assert.deepEqual(
    appearances.map((appearance) => appearance.grimeAmount),
    [...appearances.map((appearance) => appearance.grimeAmount)].sort((a, b) => a - b),
  );
  assert.deepEqual(
    appearances.map((appearance) => appearance.roughnessMultiplier),
    [...appearances.map((appearance) => appearance.roughnessMultiplier)].sort((a, b) => a - b),
  );
  const brightness = appearances.map((appearance) =>
    appearance.baseTint.r + appearance.baseTint.g + appearance.baseTint.b,
  );
  assert.deepEqual(brightness, [...brightness].sort((a, b) => b - a));

  assert.equal(resolveBuildingAppearance({
    condition: 'good',
    occupancy: 'occupied',
    powered: true,
    construction: 'none',
    constructionProgress: 0,
    nightLighting: true,
  }).windowsEmissive, true);
  assert.equal(resolveBuildingAppearance({
    condition: 'good',
    occupancy: 'occupied',
    powered: false,
    construction: 'none',
    constructionProgress: 0,
    nightLighting: true,
  }).windowsEmissive, false);
  assert.equal(resolveBuildingAppearance({
    condition: 'good',
    occupancy: 'vacant',
    powered: true,
    construction: 'none',
    constructionProgress: 0,
    nightLighting: true,
  }).windowsEmissive, false);
});

test('active construction exposes deterministic scaffold visibility and bounded progress without changing asset identity', () => {
  const appearance = resolveBuildingAppearance({
    condition: 'worn',
    occupancy: 'vacant',
    powered: true,
    construction: 'active',
    constructionProgress: 0.63,
    nightLighting: false,
  });
  assert.equal(appearance.scaffoldVisible, true);
  assert.equal(appearance.constructionProgress, 0.63);

  const clamped = resolveBuildingAppearance({
    condition: 'worn',
    occupancy: 'vacant',
    powered: true,
    construction: 'active',
    constructionProgress: 2,
    nightLighting: false,
  });
  assert.equal(clamped.constructionProgress, 1);
});
