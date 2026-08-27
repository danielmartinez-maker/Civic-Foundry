import type { AssetManifest, AssetManifestEntry } from './AssetTypes.ts';
import { PASS_A_ASSET_MANIFEST, PASS_A_BUILDING_VARIANTS } from './PassAAssetManifest.ts';
import { composeAssetManifests } from './AssetManifestComposer.ts';

const ATLAS_ID = 'urban_depth_buildings';
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 192;
const ATLAS_COLUMNS = 16;
const ATLAS_WIDTH = ATLAS_COLUMNS * FRAME_WIDTH;
const ATLAS_ROWS = 9;
const ATLAS_HEIGHT = ATLAS_ROWS * FRAME_HEIGHT;

const LEGACY_CONDITIONS = Object.freeze(['new', 'aging', 'neglected', 'abandoned'] as const);
const MIXED_CONDITIONS = Object.freeze(['new', 'maintained', 'aging', 'neglected', 'abandoned'] as const);

export const PASS_B1_MIXED_USE_FAMILIES = Object.freeze([
  ['mix_mainstreet_corner_01', 'main_street_mixed_use', 'medium'],
  ['mix_mainstreet_row_01', 'main_street_mixed_use', 'medium'],
  ['mix_mainstreet_courtyard_01', 'main_street_mixed_use', 'medium'],
  ['mix_podium_slab_01', 'podium_mixed_use', 'high'],
  ['mix_podium_tower_01', 'podium_mixed_use', 'high'],
  ['mix_podium_courtyard_01', 'podium_mixed_use', 'high'],
] as const);

function sourceRect(slot: number): AssetManifestEntry['sourceRect'] {
  return Object.freeze({
    x: (slot % ATLAS_COLUMNS) * FRAME_WIDTH,
    y: Math.floor(slot / ATLAS_COLUMNS) * FRAME_HEIGHT,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  });
}

let slot = 0;

const legacyConditionEntries: AssetManifestEntry[] = PASS_A_BUILDING_VARIANTS.flatMap(([baseVariant, zone, intensity]) =>
  LEGACY_CONDITIONS.map((condition) => {
    const variantKey = `${baseVariant}__${condition}`;
    const entry: AssetManifestEntry = {
      assetId: `${variantKey}_o0`,
      variantKey,
      atlasId: ATLAS_ID,
      sourceRect: sourceRect(slot++),
      footprint: { width: 1, height: 1 },
      anchor: { x: 64, y: 160 },
      category: 'building',
      zone,
      intensity,
      condition,
      orientation: 0,
      weight: 1,
      tags: ['symmetric', 'north-american', 'urban-depth', `base-family:${baseVariant}`],
    };
    return entry;
  }),
);

const mixedUseEntries: AssetManifestEntry[] = PASS_B1_MIXED_USE_FAMILIES.flatMap(([family, typologyId, intensity]) =>
  MIXED_CONDITIONS.map((condition) => {
    const variantKey = `${family}__${condition}`;
    const entry: AssetManifestEntry = {
      assetId: `${variantKey}_o0`,
      variantKey,
      atlasId: ATLAS_ID,
      sourceRect: sourceRect(slot++),
      footprint: { width: 1, height: 1 },
      anchor: { x: 64, y: 160 },
      category: 'building',
      subcategory: 'mixed-use',
      intensity,
      condition,
      orientation: 0,
      weight: 1,
      tags: [
        'symmetric',
        'north-american',
        'urban-depth',
        'mixed-use',
        `base-family:${family}`,
        `typology:${typologyId}`,
      ],
    };
    return entry;
  }),
);

const entries = Object.freeze([...legacyConditionEntries, ...mixedUseEntries]);

export const PASS_B1_ASSET_MANIFEST: AssetManifest = Object.freeze({
  schemaVersion: 1,
  atlases: Object.freeze([
    { atlasId: ATLAS_ID, url: './assets/atlases/urban_depth_buildings.png', width: ATLAS_WIDTH, height: ATLAS_HEIGHT },
  ]),
  entries,
});

export const PASS_B1_COMPOSED_ASSET_MANIFEST: AssetManifest = composeAssetManifests(
  PASS_A_ASSET_MANIFEST,
  PASS_B1_ASSET_MANIFEST,
);
