export type AssetOrientation = 0 | 1 | 2 | 3;

export type AssetManifestEntry = Readonly<{
  assetId: string;
  variantKey: string;
  atlasId: string;
  sourceRect: Readonly<{ x: number; y: number; width: number; height: number }>;
  footprint: Readonly<{ width: number; height: number }>;
  anchor: Readonly<{ x: number; y: number }>;
  category: string;
  subcategory?: string;
  zone?: 'residential' | 'commercial' | 'industrial';
  intensity?: 'low' | 'medium' | 'high';
  qualityTier?: 'economy' | 'standard' | 'premium' | 'luxury';
  condition?: 'new' | 'maintained' | 'aging' | 'neglected' | 'abandoned';
  constructionStage?: string;
  orientation?: AssetOrientation;
  animation?: Readonly<{ frames: number; frameTicks: number }>;
  nightVariantAssetId?: string;
  weight?: number;
  tags?: readonly string[];
}>;

export type AtlasDescriptor = Readonly<{
  atlasId: string;
  url: string;
  width: number;
  height: number;
}>;

export type AssetManifest = Readonly<{
  schemaVersion: 1;
  atlases: readonly AtlasDescriptor[];
  entries: readonly AssetManifestEntry[];
}>;

export type AssetQuery = Readonly<{
  category?: string;
  subcategory?: string;
  zone?: AssetManifestEntry['zone'];
  intensity?: AssetManifestEntry['intensity'];
  qualityTier?: AssetManifestEntry['qualityTier'];
  condition?: AssetManifestEntry['condition'];
  constructionStage?: string;
  variantKey?: string;
  orientation?: AssetOrientation;
  tags?: readonly string[];
}>;

export type AssetResolution =
  | Readonly<{ kind: 'sprite'; entry: AssetManifestEntry; image: HTMLImageElement }>
  | Readonly<{ kind: 'fallback'; assetId: string; reason: string }>;
