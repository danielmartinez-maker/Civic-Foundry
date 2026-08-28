import { validateAssetManifest } from '../assets/AssetManifestValidation.ts';
import type {
  AssetManifest,
  AssetManifestEntry,
  AssetOrientation,
  AssetQuery,
} from '../assets/AssetTypes.ts';
import { resolveVariantEntry } from '../assets/VariantSelector.ts';

/**
 * DOM/Pixi-free catalog over the canonical presentation asset manifest.
 *
 * GPU loading code may adapt entries into textures, but this catalog remains
 * the single deterministic query/variant seam shared with existing helpers.
 */
export class GpuAssetCatalog {
  private readonly manifest: AssetManifest;
  private readonly entryById = new Map<string, AssetManifestEntry>();
  private readonly entriesByVariant = new Map<string, AssetManifestEntry[]>();
  private readonly diagnosticSet = new Set<string>();
  private readonly queryCache = new Map<string, readonly AssetManifestEntry[]>();

  constructor(manifest: AssetManifest) {
    this.manifest = manifest;
    if (manifest.schemaVersion !== 1) {
      throw new Error(`unsupported asset manifest schema: ${String(manifest.schemaVersion)}`);
    }

    for (const error of validateAssetManifest(manifest)) {
      this.diagnosticSet.add(error);
    }

    for (const entry of manifest.entries) {
      if (!this.entryById.has(entry.assetId)) this.entryById.set(entry.assetId, entry);
      const family = this.entriesByVariant.get(entry.variantKey) ?? [];
      family.push(entry);
      this.entriesByVariant.set(entry.variantKey, family);
    }
  }

  query(query: AssetQuery): readonly AssetManifestEntry[] {
    const key = JSON.stringify({
      category: query.category ?? null,
      subcategory: query.subcategory ?? null,
      zone: query.zone ?? null,
      intensity: query.intensity ?? null,
      constructionStage: query.constructionStage ?? null,
      variantKey: query.variantKey ?? null,
      orientation: query.orientation ?? null,
      tags: query.tags ? [...query.tags].sort() : null,
    });
    const cached = this.queryCache.get(key);
    if (cached) return cached;

    const result = Object.freeze(this.manifest.entries.filter((entry) => {
      if (query.category !== undefined && entry.category !== query.category) return false;
      if (query.subcategory !== undefined && entry.subcategory !== query.subcategory) return false;
      if (query.zone !== undefined && entry.zone !== query.zone) return false;
      if (query.intensity !== undefined && entry.intensity !== query.intensity) return false;
      if (query.constructionStage !== undefined && entry.constructionStage !== query.constructionStage) return false;
      if (query.variantKey !== undefined && entry.variantKey !== query.variantKey) return false;
      if (query.orientation !== undefined && entry.orientation !== query.orientation) return false;
      if (query.tags && !query.tags.every((tag) => entry.tags?.includes(tag))) return false;
      return true;
    }));
    this.queryCache.set(key, result);
    return result;
  }

  resolveEntry(assetId: string): AssetManifestEntry | undefined {
    return this.entryById.get(assetId);
  }

  resolveVariant(
    variantKey: string,
    orientation: AssetOrientation,
  ): AssetManifestEntry | undefined {
    return resolveVariantEntry(
      this.entriesByVariant.get(variantKey) ?? [],
      variantKey,
      orientation,
    );
  }

  diagnostics(): readonly string[] {
    return Object.freeze([...this.diagnosticSet].sort());
  }
}
