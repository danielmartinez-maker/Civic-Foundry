import type { AssetId, AssetManifestV2Entry } from '../assets/AssetManifestV2.ts';
import type { AssetLod } from '../assets/AssetCatalogV2.ts';
import type {
  ProductionPresentationEntityId,
  ProductionVisualState,
} from '../presentation/PresentationTypes.ts';

export type ProductionAssetCatalogLike = Readonly<{
  get(assetId: AssetId): AssetManifestV2Entry | undefined;
}>;

export type ProductionSceneAdapter<Handle> = Readonly<{
  create(input: Readonly<{ state: ProductionVisualState; asset: AssetManifestV2Entry; lod: AssetLod }>): Handle;
  updateAppearance(handle: Handle, state: ProductionVisualState): void;
  destroy(handle: Handle): void;
}>;

type RetainedProductionEntry<Handle> = {
  state: ProductionVisualState;
  asset: AssetManifestV2Entry;
  lod: AssetLod;
  handle: Handle;
};

export type ProductionSceneStats = Readonly<{
  active: number;
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  replaced: number;
  uniquePrototypes: number;
  estimatedCpuBytes: number;
  estimatedGpuBytes: number;
}>;

export type ProductionSceneCameraPosition = Readonly<{ x: number; y: number; z: number }>;

const distance = (
  state: ProductionVisualState,
  camera: ProductionSceneCameraPosition,
): number => {
  const dx = state.transform.positionM.x - camera.x;
  const dy = state.transform.positionM.y - camera.y;
  const dz = state.transform.positionM.z - camera.z;
  return Math.hypot(dx, dy, dz);
};

export function selectProductionLod(
  asset: AssetManifestV2Entry,
  state: ProductionVisualState,
  camera: ProductionSceneCameraPosition,
): AssetLod {
  const d = distance(state, camera);
  if (d < 40 || !asset.geometry.lod1) return 'lod0';
  if (d < 140 || !asset.geometry.lod2) return 'lod1';
  return 'lod2';
}

function digestState<Handle>(entry: RetainedProductionEntry<Handle>): unknown {
  return {
    presentationId: entry.state.presentationId,
    canonicalId: entry.state.canonicalId,
    assetId: entry.state.assetId,
    lod: entry.lod,
    transform: entry.state.transform,
    variationSeed: entry.state.variationSeed,
    structuralFingerprint: entry.state.structuralFingerprint,
    appearanceFingerprint: entry.state.appearanceFingerprint,
  };
}

export class ProductionSceneLayer<Handle> {
  private readonly catalog: ProductionAssetCatalogLike;
  private readonly adapter: ProductionSceneAdapter<Handle>;
  private readonly retained = new Map<ProductionPresentationEntityId, RetainedProductionEntry<Handle>>();
  private lastStats: ProductionSceneStats = Object.freeze({
    active: 0, created: 0, updated: 0, removed: 0, unchanged: 0, replaced: 0,
    uniquePrototypes: 0, estimatedCpuBytes: 0, estimatedGpuBytes: 0,
  });

  constructor(catalog: ProductionAssetCatalogLike, adapter: ProductionSceneAdapter<Handle>) {
    this.catalog = catalog;
    this.adapter = adapter;
  }

  apply(states: readonly ProductionVisualState[], camera: ProductionSceneCameraPosition): ProductionSceneStats {
    let created = 0;
    let updated = 0;
    let removed = 0;
    let unchanged = 0;
    let replaced = 0;
    const incomingIds = new Set(states.map((state) => state.presentationId));

    for (const [presentationId, entry] of [...this.retained.entries()]) {
      if (incomingIds.has(presentationId)) continue;
      this.adapter.destroy(entry.handle);
      this.retained.delete(presentationId);
      removed += 1;
    }

    for (const state of [...states].sort((left, right) => left.presentationId.localeCompare(right.presentationId))) {
      const asset = this.catalog.get(state.assetId);
      if (!asset) throw new Error(`Unknown production asset '${state.assetId}' for '${state.presentationId}'`);
      const lod = selectProductionLod(asset, state, camera);
      const existing = this.retained.get(state.presentationId);
      if (!existing) {
        const handle = this.adapter.create({ state, asset, lod });
        this.retained.set(state.presentationId, { state, asset, lod, handle });
        created += 1;
        continue;
      }

      const structuralChange =
        existing.state.assetId !== state.assetId ||
        existing.state.structuralFingerprint !== state.structuralFingerprint ||
        existing.lod !== lod;
      if (structuralChange) {
        this.adapter.destroy(existing.handle);
        const handle = this.adapter.create({ state, asset, lod });
        this.retained.set(state.presentationId, { state, asset, lod, handle });
        created += 1;
        removed += 1;
        replaced += 1;
        continue;
      }

      if (existing.state.appearanceFingerprint !== state.appearanceFingerprint) {
        this.adapter.updateAppearance(existing.handle, state);
        existing.state = state;
        existing.asset = asset;
        updated += 1;
      } else {
        existing.state = state;
        unchanged += 1;
      }
    }

    const uniqueAssets = new Map<AssetId, AssetManifestV2Entry>();
    for (const entry of this.retained.values()) uniqueAssets.set(entry.asset.assetId, entry.asset);
    let estimatedCpuBytes = 0;
    let estimatedGpuBytes = 0;
    for (const asset of uniqueAssets.values()) {
      estimatedCpuBytes += asset.runtime.estimatedCpuGeometryBytes;
      estimatedGpuBytes += asset.runtime.estimatedGpuGeometryBytes + asset.runtime.estimatedGpuMaterialBytes;
    }

    this.lastStats = Object.freeze({
      active: this.retained.size,
      created,
      updated,
      removed,
      unchanged,
      replaced,
      uniquePrototypes: uniqueAssets.size,
      estimatedCpuBytes,
      estimatedGpuBytes,
    });
    return this.lastStats;
  }

  debugStats(): ProductionSceneStats {
    return this.lastStats;
  }

  reconstructionDigest(): string {
    return JSON.stringify(
      [...this.retained.values()]
        .sort((left, right) => left.state.presentationId.localeCompare(right.state.presentationId))
        .map(digestState),
    );
  }

  clear(): void {
    for (const entry of this.retained.values()) this.adapter.destroy(entry.handle);
    this.retained.clear();
    this.lastStats = Object.freeze({
      active: 0, created: 0, updated: 0, removed: 0, unchanged: 0, replaced: 0,
      uniquePrototypes: 0, estimatedCpuBytes: 0, estimatedGpuBytes: 0,
    });
  }
}
