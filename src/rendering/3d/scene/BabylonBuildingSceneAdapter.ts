import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetLod } from '../assets/AssetCatalogV2.ts';
import type {
  BabylonGlbPrototype,
  BabylonPrototypeInstance,
} from '../assets/BabylonGlbPrototypeLoader.ts';
import type { BuildingVisualState } from '../presentation/PresentationTypes.ts';
import type {
  BuildingPickMetadata,
  BuildingSceneAdapter,
} from './BuildingSceneLayer.ts';
import type { BuildingAppearance } from './StateVisualResolver.ts';

const MIN_PROXY_DIMENSION_M = 0.05;
const SCAFFOLD_THICKNESS_M = 0.08;
const SCAFFOLD_CLEARANCE_M = 0.25;
const SCAFFOLD_COLOR = Object.freeze({ r: 0.43, g: 0.46, b: 0.48 });
const WINDOW_EMISSIVE = Object.freeze({ r: 0.72, g: 0.44, b: 0.18 });
const GRIME_COLOR = Object.freeze({ r: 0.34, g: 0.31, b: 0.27 });

export type BabylonBuildingHandle = {
  readonly presentationId: BuildingVisualState['presentationId'];
  readonly root: TransformNode;
  readonly scaffoldRoot: TransformNode;
  readonly fallbackMesh: Mesh | null;
};

type MaterialBaseline = Readonly<{
  material: PBRMaterial;
  albedoColor: Color3;
  emissiveColor: Color3;
  roughness: number;
  windowMaterial: boolean;
}>;

type InternalBuildingHandle = BabylonBuildingHandle & {
  readonly prototypeInstance: BabylonPrototypeInstance | null;
  readonly materialBaselines: readonly MaterialBaseline[];
  readonly scaffoldMaterial: PBRMaterial;
  disposed: boolean;
};

type FootprintBounds = Readonly<{
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  height: number;
}>;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function copyPickMetadata(metadata: BuildingPickMetadata): BuildingPickMetadata {
  return Object.freeze({ ...metadata });
}

function assignPickMetadata(node: Node, metadata: BuildingPickMetadata): void {
  node.metadata = copyPickMetadata(metadata);
  for (const descendant of node.getDescendants(false)) {
    descendant.metadata = copyPickMetadata(metadata);
  }
}

function footprintBounds(state: BuildingVisualState): FootprintBounds {
  const footprint = state.fallbackBoundsM.footprint;
  if (footprint.length < 3) {
    throw new Error(`Building '${state.presentationId}' fallback footprint requires at least three points`);
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of footprint) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }

  return Object.freeze({
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: Math.max(MIN_PROXY_DIMENSION_M, maxX - minX),
    depth: Math.max(MIN_PROXY_DIMENSION_M, maxZ - minZ),
    height: Math.max(MIN_PROXY_DIMENSION_M, state.fallbackBoundsM.heightM),
  });
}

function collectPbrBaselines(rootNodes: readonly Node[]): readonly MaterialBaseline[] {
  const seen = new Set<PBRMaterial>();
  const baselines: MaterialBaseline[] = [];

  for (const root of rootNodes) {
    const nodes: Node[] = [root, ...root.getDescendants(false)];
    for (const node of nodes) {
      if (!(node instanceof AbstractMesh)) continue;
      const material = node.material;
      if (!(material instanceof PBRMaterial) || seen.has(material)) continue;
      seen.add(material);
      baselines.push(Object.freeze({
        material,
        albedoColor: material.albedoColor.clone(),
        emissiveColor: material.emissiveColor.clone(),
        roughness: material.roughness ?? 0.7,
        windowMaterial: /glass|window/i.test(material.name),
      }));
    }
  }

  return Object.freeze(baselines);
}

function createScaffoldMaterial(scene: Scene, presentationId: string): PBRMaterial {
  const material = new PBRMaterial(`${presentationId}:scaffold-material`, scene);
  material.albedoColor = new Color3(SCAFFOLD_COLOR.r, SCAFFOLD_COLOR.g, SCAFFOLD_COLOR.b);
  material.metallic = 0.7;
  material.roughness = 0.48;
  return material;
}

function createScaffold(
  scene: Scene,
  state: BuildingVisualState,
  parent: TransformNode,
  worldCoordinates: boolean,
): Readonly<{ root: TransformNode; material: PBRMaterial }> {
  const bounds = footprintBounds(state);
  const root = new TransformNode(`${state.presentationId}:scaffold`, scene);
  root.parent = parent;
  root.position.set(
    worldCoordinates ? bounds.centerX : bounds.centerX - state.transform.positionM.x,
    0,
    worldCoordinates ? bounds.centerZ : bounds.centerZ - state.transform.positionM.z,
  );

  const material = createScaffoldMaterial(scene, state.presentationId);
  const halfWidth = bounds.width / 2 + SCAFFOLD_CLEARANCE_M;
  const halfDepth = bounds.depth / 2 + SCAFFOLD_CLEARANCE_M;
  const postHeight = bounds.height + 0.35;
  const postY = postHeight / 2;
  const corners = [
    [-halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
  ] as const;

  for (const [index, [x, z]] of corners.entries()) {
    const post = MeshBuilder.CreateBox(`${state.presentationId}:scaffold-post-${index}`, {
      width: SCAFFOLD_THICKNESS_M,
      height: postHeight,
      depth: SCAFFOLD_THICKNESS_M,
    }, scene);
    post.parent = root;
    post.position.set(x, postY, z);
    post.material = material;
  }

  const railLevels = [
    Math.max(0.7, bounds.height * 0.34),
    Math.max(1.4, bounds.height * 0.68),
    bounds.height,
  ] as const;
  for (const [levelIndex, rawY] of railLevels.entries()) {
    const y = Math.min(postHeight - 0.1, rawY);
    for (const z of [-halfDepth, halfDepth]) {
      const rail = MeshBuilder.CreateBox(`${state.presentationId}:scaffold-rail-x-${levelIndex}-${z}`, {
        width: halfWidth * 2,
        height: SCAFFOLD_THICKNESS_M,
        depth: SCAFFOLD_THICKNESS_M,
      }, scene);
      rail.parent = root;
      rail.position.set(0, y, z);
      rail.material = material;
    }
    for (const x of [-halfWidth, halfWidth]) {
      const rail = MeshBuilder.CreateBox(`${state.presentationId}:scaffold-rail-z-${levelIndex}-${x}`, {
        width: SCAFFOLD_THICKNESS_M,
        height: SCAFFOLD_THICKNESS_M,
        depth: halfDepth * 2,
      }, scene);
      rail.parent = root;
      rail.position.set(x, y, 0);
      rail.material = material;
    }
  }

  root.setEnabled(false);
  return Object.freeze({ root, material });
}

function createFallbackMaterial(scene: Scene, presentationId: string): PBRMaterial {
  const material = new PBRMaterial(`${presentationId}:fallback-material`, scene);
  material.albedoColor = new Color3(0.72, 0.69, 0.64);
  material.metallic = 0;
  material.roughness = 0.78;
  return material;
}

function applyBaselineAppearance(
  baseline: MaterialBaseline,
  appearance: BuildingAppearance,
): void {
  const grime = clamp01(appearance.grimeAmount);
  const grimeBlend = grime * 0.34;
  const tintedR = baseline.albedoColor.r * clamp01(appearance.baseTint.r);
  const tintedG = baseline.albedoColor.g * clamp01(appearance.baseTint.g);
  const tintedB = baseline.albedoColor.b * clamp01(appearance.baseTint.b);

  baseline.material.albedoColor.set(
    tintedR * (1 - grimeBlend) + GRIME_COLOR.r * grimeBlend,
    tintedG * (1 - grimeBlend) + GRIME_COLOR.g * grimeBlend,
    tintedB * (1 - grimeBlend) + GRIME_COLOR.b * grimeBlend,
  );
  baseline.material.roughness = clamp01(
    baseline.roughness * Math.max(0, appearance.roughnessMultiplier) + grime * 0.08,
  );

  if (baseline.windowMaterial && appearance.windowsEmissive) {
    baseline.material.emissiveColor.set(WINDOW_EMISSIVE.r, WINDOW_EMISSIVE.g, WINDOW_EMISSIVE.b);
  } else {
    baseline.material.emissiveColor.copyFrom(baseline.emissiveColor);
  }
}

function makeHandle(
  presentationId: BuildingVisualState['presentationId'],
  root: TransformNode,
  scaffoldRoot: TransformNode,
  fallbackMesh: Mesh | null,
  prototypeInstance: BabylonPrototypeInstance | null,
  materialBaselines: readonly MaterialBaseline[],
  scaffoldMaterial: PBRMaterial,
): InternalBuildingHandle {
  return {
    presentationId,
    root,
    scaffoldRoot,
    fallbackMesh,
    prototypeInstance,
    materialBaselines,
    scaffoldMaterial,
    disposed: false,
  };
}

export class BabylonBuildingSceneAdapter implements BuildingSceneAdapter<BabylonGlbPrototype, BabylonBuildingHandle> {
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  createAssetBuilding(
    state: BuildingVisualState,
    prototype: BabylonGlbPrototype,
    _lod: AssetLod,
    pickMetadata: BuildingPickMetadata,
  ): BabylonBuildingHandle {
    const root = new TransformNode(`${state.presentationId}:root`, this.scene);
    root.position.set(state.transform.positionM.x, state.transform.positionM.y, state.transform.positionM.z);
    root.rotation.y = state.transform.rotationYRad;
    root.scaling.set(state.transform.scale.x, state.transform.scale.y, state.transform.scale.z);
    root.metadata = copyPickMetadata(pickMetadata);

    let instance: BabylonPrototypeInstance | null = null;
    try {
      instance = prototype.instantiate(state.presentationId, { cloneMaterials: true });
      for (const instanceRoot of instance.rootNodes) {
        instanceRoot.parent = root;
        assignPickMetadata(instanceRoot, pickMetadata);
      }
      const baselines = collectPbrBaselines(instance.rootNodes);
      const scaffold = createScaffold(this.scene, state, root, false);
      return makeHandle(
        state.presentationId,
        root,
        scaffold.root,
        null,
        instance,
        baselines,
        scaffold.material,
      );
    } catch (error) {
      instance?.dispose();
      root.dispose(false, true);
      throw error;
    }
  }

  createFallbackBuilding(
    state: BuildingVisualState,
    pickMetadata: BuildingPickMetadata,
  ): BabylonBuildingHandle {
    const root = new TransformNode(`${state.presentationId}:fallback-root`, this.scene);
    root.metadata = copyPickMetadata(pickMetadata);
    const bounds = footprintBounds(state);
    const mesh = MeshBuilder.CreateBox(`${state.presentationId}:fallback`, {
      width: bounds.width,
      height: bounds.height,
      depth: bounds.depth,
    }, this.scene);
    mesh.parent = root;
    mesh.position.set(bounds.centerX, bounds.height / 2, bounds.centerZ);
    mesh.material = createFallbackMaterial(this.scene, state.presentationId);
    mesh.metadata = copyPickMetadata(pickMetadata);

    const baselines = collectPbrBaselines([mesh]);
    const scaffold = createScaffold(this.scene, state, root, true);
    return makeHandle(
      state.presentationId,
      root,
      scaffold.root,
      mesh,
      null,
      baselines,
      scaffold.material,
    );
  }

  applyAppearance(handle: BabylonBuildingHandle, appearance: BuildingAppearance): void {
    const internal = handle as InternalBuildingHandle;
    if (internal.disposed) return;
    for (const baseline of internal.materialBaselines) {
      applyBaselineAppearance(baseline, appearance);
    }
    internal.scaffoldRoot.scaling.y = clamp01(appearance.constructionProgress);
    internal.scaffoldRoot.setEnabled(appearance.scaffoldVisible);
  }

  disposeBuilding(handle: BabylonBuildingHandle): void {
    const internal = handle as InternalBuildingHandle;
    if (internal.disposed) return;
    internal.disposed = true;

    if (internal.prototypeInstance) {
      internal.prototypeInstance.dispose();
      internal.scaffoldRoot.dispose(false, false);
      internal.scaffoldMaterial.dispose(false, true);
      internal.root.dispose(false, false);
      return;
    }

    internal.scaffoldMaterial.dispose(false, true);
    internal.root.dispose(false, true);
  }
}
