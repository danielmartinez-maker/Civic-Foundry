import { Assets, Rectangle, Texture } from 'pixi.js';
import type {
  AssetManifest,
  AssetManifestEntry,
  AssetOrientation,
  AssetQuery,
} from '../assets/AssetTypes.ts';
import { GpuAssetCatalog } from './GpuAssetCatalog.ts';

export type GpuTextureResolution = Readonly<{
  entry: AssetManifestEntry;
  texture: Texture;
}>;

/** Pixi texture adapter over the canonical Pass A manifest. */
export class GpuAssetRegistry {
  private readonly manifest: AssetManifest;
  private readonly catalog: GpuAssetCatalog;
  private readonly textures = new Map<string, Texture>();
  private readonly diagnosticSet = new Set<string>();
  private readyValue = false;

  constructor(manifest: AssetManifest) {
    this.manifest = manifest;
    this.catalog = new GpuAssetCatalog(manifest);
    for (const diagnostic of this.catalog.diagnostics()) this.diagnosticSet.add(diagnostic);
  }

  get ready(): boolean { return this.readyValue; }

  query(query: AssetQuery): readonly AssetManifestEntry[] {
    return this.catalog.query(query);
  }

  resolveEntry(assetId: string): AssetManifestEntry | undefined {
    return this.catalog.resolveEntry(assetId);
  }

  resolveVariant(variantKey: string, orientation: AssetOrientation): AssetManifestEntry | undefined {
    return this.catalog.resolveVariant(variantKey, orientation);
  }

  async preload(): Promise<void> {
    if (this.readyValue) return;
    const atlasTextures = new Map<string, Texture>();
    await Promise.all(this.manifest.atlases.map(async (atlas) => {
      try {
        const texture = await Assets.load<Texture>(atlas.url);
        atlasTextures.set(atlas.atlasId, texture);
      } catch (error) {
        this.diagnosticSet.add(`atlas failed to load: ${atlas.atlasId} (${atlas.url}): ${String(error)}`);
      }
    }));

    for (const entry of this.manifest.entries) {
      const atlas = atlasTextures.get(entry.atlasId);
      if (!atlas) continue;
      const { x, y, width, height } = entry.sourceRect;
      try {
        this.textures.set(entry.assetId, new Texture({
          source: atlas.source,
          frame: new Rectangle(x, y, width, height),
        }));
      } catch (error) {
        this.diagnosticSet.add(`${entry.assetId}: texture resolution failed: ${String(error)}`);
      }
    }
    this.readyValue = true;
  }

  texture(assetId: string): GpuTextureResolution | null {
    const entry = this.catalog.resolveEntry(assetId);
    if (!entry) {
      this.diagnosticSet.add(`${assetId}: manifest entry missing`);
      return null;
    }
    const texture = this.textures.get(assetId);
    if (!texture) {
      if (this.readyValue) this.diagnosticSet.add(`${assetId}: texture unavailable`);
      return null;
    }
    return { entry, texture };
  }

  diagnostics(): readonly string[] {
    return Object.freeze([...this.diagnosticSet].sort());
  }
}
