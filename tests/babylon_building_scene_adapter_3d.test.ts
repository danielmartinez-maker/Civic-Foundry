import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { AssetId } from '../src/rendering/3d/assets/AssetManifestV2.ts';
import type { BabylonPrototypeInstantiationOptions } from '../src/rendering/3d/assets/BabylonGlbPrototypeLoader.ts';
import type { BuildingVisualState } from '../src/rendering/3d/presentation/PresentationTypes.ts';
import {
  BabylonBuildingSceneAdapter,
  type BabylonBuildingHandle,
} from '../src/rendering/3d/scene/BabylonBuildingSceneAdapter.ts';

const HOUSE_A = 'cf_bld_res_detached_house_a_low_v01' as AssetId;

function approx(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function state(assetId: AssetId | null = HOUSE_A): BuildingVisualState {
  return Object.freeze({
    presentationId: 'building:b1',
    canonicalBuildingId: 'b1',
    assetId,
    transform: Object.freeze({
      positionM: Object.freeze({ x: 12, y: 0, z: 34 }),
      rotationYRad: 0.25,
      scale: Object.freeze({ x: 1.1, y: 1.2, z: 0.9 }),
    }),
    fallbackBoundsM: Object.freeze({
      footprint: Object.freeze([
        Object.freeze({ x: 7, y: 31 }),
        Object.freeze({ x: 17, y: 31 }),
        Object.freeze({ x: 17, y: 37 }),
        Object.freeze({ x: 7, y: 37 }),
      ]),
      heightM: 12,
    }),
    state: Object.freeze({
      condition: 'excellent',
      occupancy: 'occupied',
      powered: true,
      construction: 'none',
      constructionProgress: 0,
      nightLighting: false,
    }),
    variationSeed: 42,
    structuralFingerprint: 'b1:structure:1',
    appearanceFingerprint: 'b1:appearance:1',
  });
}

test('Babylon building adapter instantiates House A with isolated materials, exact transform, pick metadata, and reversible appearance', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const adapter = new BabylonBuildingSceneAdapter(scene);
  let cloneMaterials: boolean | undefined;
  let instanceDisposed = false;
  let glass: PBRMaterial | null = null;

  const prototype = Object.freeze({
    instantiate: (prefix: string, options: BabylonPrototypeInstantiationOptions = {}) => {
      assert.equal(prefix, 'building:b1');
      cloneMaterials = options.cloneMaterials;
      const root = new TransformNode('house-root', scene);
      const window = MeshBuilder.CreateBox('window-glass', { size: 1 }, scene);
      window.parent = root;
      glass = new PBRMaterial('glass_pale_blue', scene);
      glass.albedoColor = new Color3(0.8, 0.7, 0.6);
      glass.roughness = 0.4;
      window.material = glass;
      return Object.freeze({
        rootNodes: Object.freeze([root]),
        dispose: (): void => {
          if (instanceDisposed) return;
          instanceDisposed = true;
          root.dispose(false, true);
        },
      });
    },
  });

  const handle = adapter.createAssetBuilding(
    state(),
    prototype as never,
    'lod0',
    Object.freeze({ presentationEntityId: 'building:b1' }),
  );

  assert.equal(cloneMaterials, true);
  approx(handle.root.position.x, 12);
  approx(handle.root.position.y, 0);
  approx(handle.root.position.z, 34);
  approx(handle.root.rotation.y, 0.25);
  approx(handle.root.scaling.x, 1.1);
  approx(handle.root.scaling.y, 1.2);
  approx(handle.root.scaling.z, 0.9);
  assert.deepEqual(handle.root.metadata, { presentationEntityId: 'building:b1' });
  assert.ok(glass);

  adapter.applyAppearance(handle, Object.freeze({
    baseTint: Object.freeze({ r: 0.7, g: 0.65, b: 0.6 }),
    roughnessMultiplier: 1.4,
    grimeAmount: 0.5,
    windowsEmissive: true,
    scaffoldVisible: true,
    constructionProgress: 0.5,
  }));
  assert.ok(glass.roughness > 0.4);
  assert.ok(glass.albedoColor.r < 0.8);
  assert.ok(glass.emissiveColor.r > 0);
  assert.equal(handle.scaffoldRoot.isEnabled(), true);
  approx(handle.scaffoldRoot.scaling.y, 0.5);

  adapter.applyAppearance(handle, Object.freeze({
    baseTint: Object.freeze({ r: 1, g: 1, b: 1 }),
    roughnessMultiplier: 1,
    grimeAmount: 0,
    windowsEmissive: false,
    scaffoldVisible: false,
    constructionProgress: 0,
  }));
  approx(glass.albedoColor.r, 0.8);
  approx(glass.albedoColor.g, 0.7);
  approx(glass.albedoColor.b, 0.6);
  approx(glass.roughness, 0.4);
  approx(glass.emissiveColor.r, 0);
  assert.equal(handle.scaffoldRoot.isEnabled(), false);

  adapter.disposeBuilding(handle);
  adapter.disposeBuilding(handle);
  assert.equal(instanceDisposed, true);
  assert.equal(handle.root.isDisposed(), true);
  scene.dispose();
  engine.dispose();
});

test('Babylon fallback proxy uses absolute canonical footprint bounds without double-applying centroid transform', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const adapter = new BabylonBuildingSceneAdapter(scene);
  const handle: BabylonBuildingHandle = adapter.createFallbackBuilding(
    state(null),
    Object.freeze({ presentationEntityId: 'building:b1' }),
  );

  assert.ok(handle.fallbackMesh);
  handle.fallbackMesh.computeWorldMatrix(true);
  const bounds = handle.fallbackMesh.getBoundingInfo().boundingBox;
  approx(handle.fallbackMesh.position.x, 12);
  approx(handle.fallbackMesh.position.y, 6);
  approx(handle.fallbackMesh.position.z, 34);
  approx(bounds.extendSizeWorld.x, 5);
  approx(bounds.extendSizeWorld.y, 6);
  approx(bounds.extendSizeWorld.z, 3);
  assert.deepEqual(handle.fallbackMesh.metadata, { presentationEntityId: 'building:b1' });
  approx(handle.root.position.x, 0);
  approx(handle.root.position.z, 0);

  adapter.disposeBuilding(handle);
  scene.dispose();
  engine.dispose();
});
