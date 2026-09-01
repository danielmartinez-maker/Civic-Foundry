import type {
  AssetId,
  AssetManifestV2,
  AssetManifestV2Entry,
  AssetModelReference,
} from './AssetManifestV2.ts';
import { validateAssetManifestV2 } from './AssetManifestV2Validation.ts';

export type AssetLod = 'lod0' | 'lod1' | 'lod2';

export class AssetCatalogV2 {
  private readonly entries: readonly AssetManifestV2Entry[];
  private readonly byId: ReadonlyMap<AssetId, AssetManifestV2Entry>;
  private readonly bySemanticFamily: ReadonlyMap<string, readonly AssetManifestV2Entry[]>;

  constructor(manifest: AssetManifestV2) {
    const errors = validateAssetManifestV2(manifest);
    if (errors.length > 0) {
      throw new Error(`Asset Manifest V2 invalid:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    }

    const entries = [...manifest.entries].sort((left, right) => left.assetId.localeCompare(right.assetId));
    this.entries = Object.freeze(entries);
    this.byId = new Map(entries.map((entry) => [entry.assetId, entry] as const));

    const families = new Map<string, AssetManifestV2Entry[]>();
    for (const entry of entries) {
      const familyEntries = families.get(entry.semanticFamily) ?? [];
      familyEntries.push(entry);
      families.set(entry.semanticFamily, familyEntries);
    }
    this.bySemanticFamily = new Map(
      [...families.entries()].map(([family, familyEntries]) => [
        family,
        Object.freeze([...familyEntries].sort((left, right) => left.assetId.localeCompare(right.assetId))),
      ] as const),
    );
  }

  list(): readonly AssetManifestV2Entry[] {
    return this.entries;
  }

  listBySemanticFamily(family: string): readonly AssetManifestV2Entry[] {
    return this.bySemanticFamily.get(family) ?? Object.freeze([]);
  }

  get(assetId: AssetId): AssetManifestV2Entry | undefined {
    return this.byId.get(assetId);
  }

  require(assetId: AssetId): AssetManifestV2Entry {
    const asset = this.get(assetId);
    if (!asset) throw new Error(`Unknown asset '${assetId}'`);
    return asset;
  }

  model(assetId: AssetId, lod: AssetLod): AssetModelReference {
    const reference = this.require(assetId).geometry[lod];
    if (!reference) throw new Error(`Asset '${assetId}' does not provide ${lod}`);
    return reference;
  }
}
