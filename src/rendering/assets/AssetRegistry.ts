import { validateAssetManifest } from './AssetManifestValidation.ts';
import type {
  AssetManifest,
  AssetManifestEntry,
  AssetOrientation,
  AssetQuery,
  AssetResolution,
} from './AssetTypes.ts';
import { resolveVariantEntry } from './VariantSelector.ts';

export class AssetRegistry {
  private readonly entryById = new Map<string, AssetManifestEntry>();
  private readonly entriesByVariant = new Map<string, AssetManifestEntry[]>();
  private readonly atlasUrls = new Map<string, string>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly failedAtlases = new Set<string>();
  private readonly diagnosticSet = new Set<string>();
  private readonly invalidAssetIds = new Set<string>();
  private readyValue = false;

  constructor(private readonly manifest: AssetManifest) {
    if (manifest.schemaVersion !== 1) throw new Error(`unsupported asset manifest schema: ${String(manifest.schemaVersion)}`);
    const errors = validateAssetManifest(manifest);
    for (const error of errors) {
      this.diagnosticSet.add(error);
      for (const entry of manifest.entries) if (error.includes(`asset ${entry.assetId}`)) this.invalidAssetIds.add(entry.assetId);
    }
    for (const atlas of manifest.atlases) this.atlasUrls.set(atlas.atlasId, atlas.url);
    for (const entry of manifest.entries) {
      this.entryById.set(entry.assetId, entry);
      const family = this.entriesByVariant.get(entry.variantKey) ?? [];
      family.push(entry);
      this.entriesByVariant.set(entry.variantKey, family);
    }
  }

  get ready(): boolean { return this.readyValue; }

  async preload(): Promise<void> {
    if (typeof Image === 'undefined') {
      this.diagnosticSet.add('Image constructor unavailable; raster atlases cannot preload in this environment');
      this.readyValue = true;
      return;
    }
    await Promise.all([...this.atlasUrls].map(([atlasId, url]) => new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => { this.images.set(atlasId, image); resolve(); };
      image.onerror = () => {
        this.failedAtlases.add(atlasId);
        this.diagnosticSet.add(`atlas failed to load: ${atlasId} (${url})`);
        resolve();
      };
      image.src = url;
    })));
    this.readyValue = true;
  }

  query(query: AssetQuery): readonly AssetManifestEntry[] {
    return this.manifest.entries.filter((entry) => {
      if (query.category !== undefined && entry.category !== query.category) return false;
      if (query.subcategory !== undefined && entry.subcategory !== query.subcategory) return false;
      if (query.zone !== undefined && entry.zone !== query.zone) return false;
      if (query.intensity !== undefined && entry.intensity !== query.intensity) return false;
      if (query.constructionStage !== undefined && entry.constructionStage !== query.constructionStage) return false;
      if (query.variantKey !== undefined && entry.variantKey !== query.variantKey) return false;
      if (query.orientation !== undefined && entry.orientation !== query.orientation) return false;
      if (query.tags && !query.tags.every((tag) => entry.tags?.includes(tag))) return false;
      return true;
    });
  }

  resolveAssetId(assetId: string): AssetResolution {
    const entry = this.entryById.get(assetId);
    if (!entry) return this.fallback(assetId, 'manifest entry missing');
    if (this.invalidAssetIds.has(assetId)) return this.fallback(assetId, 'manifest entry invalid');
    if (this.failedAtlases.has(entry.atlasId)) return this.fallback(assetId, `atlas unavailable: ${entry.atlasId}`);
    const image = this.images.get(entry.atlasId);
    if (!image) return this.fallback(assetId, `atlas not ready: ${entry.atlasId}`);
    return { kind: 'sprite', entry, image };
  }

  resolveVariant(variantKey: string, orientation: AssetOrientation): AssetResolution {
    const family = this.entriesByVariant.get(variantKey) ?? [];
    const entry = resolveVariantEntry(family, variantKey, orientation);
    if (!entry) return this.fallback(variantKey, `orientation ${orientation} missing`);
    return this.resolveAssetId(entry.assetId);
  }

  diagnostics(): readonly string[] {
    return Object.freeze([...this.diagnosticSet].sort());
  }

  private fallback(assetId: string, reason: string): AssetResolution {
    this.diagnosticSet.add(`${assetId}: ${reason}`);
    return { kind: 'fallback', assetId, reason };
  }
}
