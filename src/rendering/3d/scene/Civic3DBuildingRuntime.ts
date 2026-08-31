import type { Scene } from '@babylonjs/core/scene.js';
import { AssetCatalogV2 } from '../assets/AssetCatalogV2.ts';
import type { AssetManifestV2 } from '../assets/AssetManifestV2.ts';
import {
  AssetStreamingManager,
  type AssetPrototypeLoadRequest,
} from '../assets/AssetStreamingManager.ts';
import {
  BabylonGlbPrototype,
  BabylonGlbPrototypeLoader,
} from '../assets/BabylonGlbPrototypeLoader.ts';
import type { WorldPresentationSnapshot } from '../presentation/PresentationTypes.ts';
import {
  BabylonBuildingSceneAdapter,
  type BabylonBuildingHandle,
} from './BabylonBuildingSceneAdapter.ts';
import {
  BuildingSceneLayer,
  type BuildingSceneDebugState,
} from './BuildingSceneLayer.ts';
import {
  BuildingSceneReconciliationPump,
  type BuildingSceneCameraPosition,
} from './BuildingSceneReconciliationPump.ts';

export const CIVIC_3D_ASSET_CATALOG_URL = 'assets/manifests/catalog-v2.json';

export type Civic3DBuildingRuntimeDiagnostics = Readonly<{
  loadedPrototypes: number;
  buildingInstances: number;
  fallbackBuildings: number;
  assetRequests: number;
  cacheHits: number;
  cacheMisses: number;
}>;

export type Civic3DBuildingRuntimeOptions = Readonly<{
  fetchManifest?: (url: string) => Promise<AssetManifestV2>;
  loadPrototype?: (request: AssetPrototypeLoadRequest) => Promise<BabylonGlbPrototype>;
  onDiagnostic?: (message: string) => void;
}>;

async function fetchRuntimeManifest(url: string): Promise<AssetManifestV2> {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load 3D asset catalog '${url}': HTTP ${response.status}`);
  }
  return await response.json() as AssetManifestV2;
}

function diagnosticMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Civic3DBuildingRuntime {
  private readonly streaming: AssetStreamingManager<BabylonGlbPrototype>;
  private readonly layer: BuildingSceneLayer<BabylonGlbPrototype, BabylonBuildingHandle>;
  private readonly pump: BuildingSceneReconciliationPump;
  private buildingInstances = 0;
  private fallbackBuildings = 0;
  private disposed = false;

  private constructor(
    streaming: AssetStreamingManager<BabylonGlbPrototype>,
    layer: BuildingSceneLayer<BabylonGlbPrototype, BabylonBuildingHandle>,
    pump: BuildingSceneReconciliationPump,
  ) {
    this.streaming = streaming;
    this.layer = layer;
    this.pump = pump;
  }

  static async create(
    scene: Scene,
    options: Civic3DBuildingRuntimeOptions = {},
  ): Promise<Civic3DBuildingRuntime> {
    const manifest = await (options.fetchManifest ?? fetchRuntimeManifest)(CIVIC_3D_ASSET_CATALOG_URL);
    const catalog = new AssetCatalogV2(manifest);
    const defaultLoader = new BabylonGlbPrototypeLoader(scene);
    const streaming = new AssetStreamingManager<BabylonGlbPrototype>({
      catalog,
      loader: options.loadPrototype ?? ((request) => defaultLoader.load(request)),
    });
    const layer = new BuildingSceneLayer<BabylonGlbPrototype, BabylonBuildingHandle>({
      assets: streaming,
      adapter: new BabylonBuildingSceneAdapter(scene),
    });

    let runtime: Civic3DBuildingRuntime | null = null;
    const pump = new BuildingSceneReconciliationPump({
      applySnapshot: async (snapshot, cameraPositionM): Promise<void> => {
        await layer.applySnapshot(snapshot, cameraPositionM);
        if (!runtime) return;
        runtime.buildingInstances = snapshot.buildings.length;
        runtime.fallbackBuildings = snapshot.buildings.reduce(
          (count, building) => count + (building.assetId === null ? 1 : 0),
          0,
        );
      },
      onError: (error): void => options.onDiagnostic?.(diagnosticMessage(error)),
    });

    runtime = new Civic3DBuildingRuntime(streaming, layer, pump);
    return runtime;
  }

  submit(
    snapshot: WorldPresentationSnapshot,
    cameraPositionM: BuildingSceneCameraPosition,
  ): void {
    if (this.disposed) return;
    this.pump.submit(snapshot, cameraPositionM);
  }

  async whenIdle(): Promise<void> {
    await this.pump.whenIdle();
  }

  debugBuildingState(presentationId: `building:${string}`): BuildingSceneDebugState | null {
    return this.layer.debugBuildingState(presentationId);
  }

  diagnostics(): Civic3DBuildingRuntimeDiagnostics {
    const streaming = this.streaming.diagnostics();
    return Object.freeze({
      loadedPrototypes: streaming.residentCount,
      buildingInstances: this.buildingInstances,
      fallbackBuildings: this.fallbackBuildings,
      assetRequests: streaming.requestCount,
      cacheHits: streaming.cacheHits,
      cacheMisses: streaming.cacheMisses,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pump.dispose();
    await this.pump.whenIdle();
    this.layer.dispose();
    this.streaming.dispose();
    this.buildingInstances = 0;
    this.fallbackBuildings = 0;
  }
}
