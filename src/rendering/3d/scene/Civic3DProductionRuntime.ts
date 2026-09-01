import type { Scene } from '@babylonjs/core/scene.js';
import { AssetCatalogV2, type AssetLod } from '../assets/AssetCatalogV2.ts';
import type { AssetId, AssetManifestV2 } from '../assets/AssetManifestV2.ts';
import {
  AssetStreamingManager,
  type AssetLease,
  type AssetPrototypeLoadRequest,
} from '../assets/AssetStreamingManager.ts';
import {
  BabylonGlbPrototype,
  BabylonGlbPrototypeLoader,
} from '../assets/BabylonGlbPrototypeLoader.ts';
import type { ProductionVisualState } from '../presentation/PresentationTypes.ts';
import {
  BabylonProductionSceneAdapter,
  type BabylonProductionHandle,
  type ProductionPickIdentity,
} from './BabylonProductionSceneAdapter.ts';
import { CIVIC_3D_ASSET_CATALOG_URL } from './Civic3DBuildingRuntime.ts';
import {
  ProductionSceneLayer,
  type ProductionSceneCameraPosition,
  type ProductionSceneStats,
  selectProductionLod,
} from './ProductionSceneLayer.ts';

export type Civic3DProductionRuntimeOptions = Readonly<{
  fetchManifest?: (url: string) => Promise<AssetManifestV2>;
  loadPrototype?: (request: AssetPrototypeLoadRequest) => Promise<BabylonGlbPrototype>;
}>;

type RequiredPrototype = Readonly<{
  assetId: AssetId;
  lod: AssetLod;
}>;

async function fetchRuntimeManifest(url: string): Promise<AssetManifestV2> {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load 3D asset catalog '${url}': HTTP ${response.status}`);
  }
  return await response.json() as AssetManifestV2;
}

function prototypeKey(assetId: AssetId, lod: AssetLod): string {
  return `${assetId}@${lod}`;
}

export class Civic3DProductionRuntime {
  private readonly scene: Scene;
  private readonly catalog: AssetCatalogV2;
  private readonly streaming: AssetStreamingManager<BabylonGlbPrototype>;
  private readonly layer: ProductionSceneLayer<BabylonProductionHandle>;
  private readonly adapter: BabylonProductionSceneAdapter;
  private readonly leases: Map<string, AssetLease<BabylonGlbPrototype>>;
  private disposed = false;

  private constructor(
    scene: Scene,
    catalog: AssetCatalogV2,
    streaming: AssetStreamingManager<BabylonGlbPrototype>,
    layer: ProductionSceneLayer<BabylonProductionHandle>,
    adapter: BabylonProductionSceneAdapter,
    leases: Map<string, AssetLease<BabylonGlbPrototype>>,
  ) {
    this.scene = scene;
    this.catalog = catalog;
    this.streaming = streaming;
    this.layer = layer;
    this.adapter = adapter;
    this.leases = leases;
  }

  static async create(
    scene: Scene,
    options: Civic3DProductionRuntimeOptions = {},
  ): Promise<Civic3DProductionRuntime> {
    const manifest = await (options.fetchManifest ?? fetchRuntimeManifest)(CIVIC_3D_ASSET_CATALOG_URL);
    const catalog = new AssetCatalogV2(manifest);
    const defaultLoader = new BabylonGlbPrototypeLoader(scene);
    const streaming = new AssetStreamingManager<BabylonGlbPrototype>({
      catalog,
      loader: options.loadPrototype ?? ((request) => defaultLoader.load(request)),
    });
    const leases = new Map<string, AssetLease<BabylonGlbPrototype>>();
    const adapter = new BabylonProductionSceneAdapter(scene, (assetId, lod) => {
      const lease = leases.get(prototypeKey(assetId, lod));
      if (!lease) {
        throw new Error(`Production prototype '${prototypeKey(assetId, lod)}' is not resident`);
      }
      return lease.prototype;
    });
    const layer = new ProductionSceneLayer<BabylonProductionHandle>(catalog, adapter);
    return new Civic3DProductionRuntime(scene, catalog, streaming, layer, adapter, leases);
  }

  async apply(
    states: readonly ProductionVisualState[],
    camera: ProductionSceneCameraPosition,
  ): Promise<ProductionSceneStats> {
    this.assertAlive();
    const required = this.requiredPrototypes(states, camera);
    const newlyAcquired: string[] = [];

    try {
      for (const [key, prototype] of required) {
        if (this.leases.has(key)) continue;
        const lease = await this.streaming.request({
          assetId: prototype.assetId,
          lod: prototype.lod,
          priority: 1,
        });
        this.leases.set(key, lease);
        newlyAcquired.push(key);
      }
    } catch (error) {
      for (const key of newlyAcquired.reverse()) {
        this.leases.get(key)?.release();
        this.leases.delete(key);
        this.streaming.evict(key);
      }
      throw error;
    }

    const stats = this.layer.apply(states, camera);
    for (const [key, lease] of [...this.leases.entries()]) {
      if (required.has(key)) continue;
      lease.release();
      this.leases.delete(key);
      this.streaming.evict(key);
    }

    // GLB nodes can exist structurally before their first PBR effects are ready. Waiting here
    // makes an accepted production apply visually complete before the caller renders a frame.
    await this.scene.whenReadyAsync();
    return stats;
  }

  debugStats(): ProductionSceneStats {
    return this.layer.debugStats();
  }

  debugReconstructionDigest(): string {
    return this.layer.reconstructionDigest();
  }

  debugPickIdentities(): readonly ProductionPickIdentity[] {
    return this.adapter.debugPickIdentities();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.layer.clear();
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
    this.streaming.dispose();
  }

  private requiredPrototypes(
    states: readonly ProductionVisualState[],
    camera: ProductionSceneCameraPosition,
  ): ReadonlyMap<string, RequiredPrototype> {
    const required = new Map<string, RequiredPrototype>();
    for (const state of [...states].sort((left, right) => left.presentationId.localeCompare(right.presentationId))) {
      const asset = this.catalog.get(state.assetId);
      if (!asset) {
        throw new Error(`Unknown production asset '${state.assetId}' for '${state.presentationId}'`);
      }
      const lod = selectProductionLod(asset, state, camera);
      const key = prototypeKey(state.assetId, lod);
      if (!required.has(key)) required.set(key, Object.freeze({ assetId: state.assetId, lod }));
    }
    return required;
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('Civic3DProductionRuntime is disposed');
  }
}
