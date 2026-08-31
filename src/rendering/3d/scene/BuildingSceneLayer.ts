import type { AssetId } from '../assets/AssetManifestV2.ts';
import type { AssetLod } from '../assets/AssetCatalogV2.ts';
import type { AssetRequestPriority } from '../assets/AssetRequestBroker.ts';
import type {
  BuildingVisualState,
  PresentationEntityId,
  WorldPresentationSnapshot,
} from '../presentation/PresentationTypes.ts';
import {
  resolveBuildingAppearance,
  type BuildingAppearance,
} from './StateVisualResolver.ts';

export type BuildingPickMetadata = Readonly<{
  presentationEntityId: PresentationEntityId;
}>;

export type BuildingAssetLease<P> = Readonly<{
  key: string;
  assetId: AssetId;
  lod: AssetLod;
  prototype: P;
  release(): void;
}>;

export type BuildingAssetSource<P> = Readonly<{
  request(request: Readonly<{
    assetId: AssetId;
    lod: AssetLod;
    priority: AssetRequestPriority;
    signal?: AbortSignal;
  }>): Promise<BuildingAssetLease<P>>;
}>;

export type BuildingSceneAdapter<P, H> = Readonly<{
  createAssetBuilding(
    state: BuildingVisualState,
    prototype: P,
    lod: AssetLod,
    metadata: BuildingPickMetadata,
  ): H;
  createFallbackBuilding(
    state: BuildingVisualState,
    metadata: BuildingPickMetadata,
  ): H;
  applyAppearance(handle: H, appearance: BuildingAppearance): void;
  disposeBuilding(handle: H): void;
}>;

type CameraPositionM = Readonly<{ x: number; y: number; z: number }>;

type RetainedBuilding<P, H> = {
  state: BuildingVisualState;
  handle: H;
  lod: AssetLod | 'proxy';
  lease: BuildingAssetLease<P> | null;
};

export type BuildingSceneLayerOptions<P, H> = Readonly<{
  assets: BuildingAssetSource<P>;
  adapter: BuildingSceneAdapter<P, H>;
}>;

const LOD0_MAX_M = 90;
const LOD1_MAX_M = 260;
const HYSTERESIS = 0.1;
const LOD0_EXIT_M = LOD0_MAX_M * (1 + HYSTERESIS);
const LOD0_ENTER_M = LOD0_MAX_M * (1 - HYSTERESIS);
const LOD1_EXIT_M = LOD1_MAX_M * (1 + HYSTERESIS);
const LOD1_ENTER_M = LOD1_MAX_M * (1 - HYSTERESIS);
const BUILDING_STREAM_PRIORITY: AssetRequestPriority = 1;

export function selectBuildingLod(distanceM: number, current: AssetLod | null): AssetLod {
  const distance = Math.max(0, Number.isFinite(distanceM) ? distanceM : Number.POSITIVE_INFINITY);

  if (current === null) {
    if (distance <= LOD0_MAX_M) return 'lod0';
    if (distance <= LOD1_MAX_M) return 'lod1';
    return 'lod2';
  }

  if (current === 'lod0') {
    if (distance > LOD1_EXIT_M) return 'lod2';
    if (distance > LOD0_EXIT_M) return 'lod1';
    return 'lod0';
  }

  if (current === 'lod1') {
    if (distance <= LOD0_ENTER_M) return 'lod0';
    if (distance > LOD1_EXIT_M) return 'lod2';
    return 'lod1';
  }

  if (distance <= LOD0_ENTER_M) return 'lod0';
  if (distance <= LOD1_ENTER_M) return 'lod1';
  return 'lod2';
}

function distanceToBuilding(state: BuildingVisualState, camera: CameraPositionM): number {
  const dx = camera.x - state.transform.positionM.x;
  const dy = camera.y - state.transform.positionM.y;
  const dz = camera.z - state.transform.positionM.z;
  return Math.hypot(dx, dy, dz);
}

function metadataFor(state: BuildingVisualState): BuildingPickMetadata {
  return Object.freeze({ presentationEntityId: state.presentationId });
}

export class BuildingSceneLayer<P, H> {
  private readonly assets: BuildingAssetSource<P>;
  private readonly adapter: BuildingSceneAdapter<P, H>;
  private readonly retained = new Map<PresentationEntityId, RetainedBuilding<P, H>>();
  private disposed = false;

  constructor(options: BuildingSceneLayerOptions<P, H>) {
    this.assets = options.assets;
    this.adapter = options.adapter;
  }

  async applySnapshot(
    snapshot: WorldPresentationSnapshot,
    cameraPositionM: CameraPositionM,
  ): Promise<void> {
    this.assertAlive();
    const incoming = new Map<PresentationEntityId, BuildingVisualState>(
      snapshot.buildings.map((state) => [state.presentationId, state]),
    );

    const removals = new Set<PresentationEntityId>(snapshot.dirty.removedBuildings);
    for (const id of this.retained.keys()) {
      if (!incoming.has(id)) removals.add(id);
    }
    for (const id of removals) this.removeRetained(id);

    const structural = new Set<PresentationEntityId>(snapshot.dirty.structuralBuildings);
    const appearance = new Set<PresentationEntityId>(snapshot.dirty.appearanceBuildings);

    for (const state of snapshot.buildings) {
      const existing = this.retained.get(state.presentationId) ?? null;
      const structureChanged =
        existing === null ||
        structural.has(state.presentationId) ||
        existing.state.structuralFingerprint !== state.structuralFingerprint ||
        existing.state.assetId !== state.assetId;

      if (structureChanged) {
        await this.replaceRetained(state, existing, cameraPositionM);
        continue;
      }

      const appearanceChanged =
        appearance.has(state.presentationId) ||
        existing.state.appearanceFingerprint !== state.appearanceFingerprint;
      if (appearanceChanged) {
        this.adapter.applyAppearance(existing.handle, resolveBuildingAppearance(state.state));
      }
      existing.state = state;

      if (state.assetId === null || existing.lod === 'proxy') continue;
      const nextLod = selectBuildingLod(distanceToBuilding(state, cameraPositionM), existing.lod);
      if (nextLod !== existing.lod) {
        await this.replaceRetained(state, existing, cameraPositionM, nextLod);
      }
    }
  }

  debugHandle(id: PresentationEntityId): H | null {
    return this.retained.get(id)?.handle ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.retained.keys()]) this.removeRetained(id);
  }

  private async replaceRetained(
    state: BuildingVisualState,
    existing: RetainedBuilding<P, H> | null,
    cameraPositionM: CameraPositionM,
    forcedLod?: AssetLod,
  ): Promise<void> {
    const replacement = await this.createRetained(state, cameraPositionM, existing, forcedLod);
    this.retained.set(state.presentationId, replacement);
    if (existing) this.disposeRetained(existing);
  }

  private async createRetained(
    state: BuildingVisualState,
    cameraPositionM: CameraPositionM,
    existing: RetainedBuilding<P, H> | null,
    forcedLod?: AssetLod,
  ): Promise<RetainedBuilding<P, H>> {
    const metadata = metadataFor(state);
    const appearance = resolveBuildingAppearance(state.state);

    if (state.assetId === null) {
      const handle = this.adapter.createFallbackBuilding(state, metadata);
      try {
        this.adapter.applyAppearance(handle, appearance);
      } catch (error) {
        this.adapter.disposeBuilding(handle);
        throw error;
      }
      return { state, handle, lod: 'proxy', lease: null };
    }

    const currentLod =
      existing && existing.state.assetId === state.assetId && existing.lod !== 'proxy'
        ? existing.lod
        : null;
    const lod = forcedLod ?? selectBuildingLod(distanceToBuilding(state, cameraPositionM), currentLod);
    const lease = await this.assets.request({
      assetId: state.assetId,
      lod,
      priority: BUILDING_STREAM_PRIORITY,
    });

    try {
      const handle = this.adapter.createAssetBuilding(state, lease.prototype, lod, metadata);
      try {
        this.adapter.applyAppearance(handle, appearance);
      } catch (error) {
        this.adapter.disposeBuilding(handle);
        throw error;
      }
      return { state, handle, lod, lease };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private removeRetained(id: PresentationEntityId): void {
    const entry = this.retained.get(id);
    if (!entry) return;
    this.retained.delete(id);
    this.disposeRetained(entry);
  }

  private disposeRetained(entry: RetainedBuilding<P, H>): void {
    try {
      this.adapter.disposeBuilding(entry.handle);
    } finally {
      entry.lease?.release();
    }
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('BuildingSceneLayer is disposed');
  }
}
