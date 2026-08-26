import type { AssetManifest, AssetManifestEntry, AssetOrientation } from './AssetTypes.ts';
import { composeAssetManifests } from './AssetManifestComposer.ts';
import { PASS_B1_COMPOSED_ASSET_MANIFEST } from './PassB1AssetManifest.ts';

const ATLAS_ID = 'public_realm';
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 192;
const ATLAS_COLUMNS = 16;
const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 1152;

let slot = 0;

function sourceRect(index: number): AssetManifestEntry['sourceRect'] {
  return Object.freeze({
    x: (index % ATLAS_COLUMNS) * FRAME_WIDTH,
    y: Math.floor(index / ATLAS_COLUMNS) * FRAME_HEIGHT,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  });
}

function entry(
  variantKey: string,
  subcategory: NonNullable<AssetManifestEntry['subcategory']>,
  orientation: AssetOrientation,
  symmetric: boolean,
): AssetManifestEntry {
  const tags = symmetric
    ? Object.freeze(['north-american', 'pass-b2', 'symmetric'])
    : Object.freeze(['north-american', 'pass-b2']);
  return Object.freeze({
    assetId: `${variantKey}_o${orientation}`,
    variantKey,
    atlasId: ATLAS_ID,
    sourceRect: sourceRect(slot++),
    footprint: Object.freeze({ width: 1, height: 1 }),
    anchor: Object.freeze({ x: 64, y: 160 }),
    category: 'public-realm',
    subcategory,
    orientation,
    weight: 1,
    tags,
  });
}

function symmetric(variantKey: string, subcategory: string): AssetManifestEntry {
  return entry(variantKey, subcategory, 0, true);
}

function directional(variantKey: string, subcategory: string): readonly AssetManifestEntry[] {
  return Object.freeze(([0, 1, 2, 3] as const).map((orientation) => entry(variantKey, subcategory, orientation, false)));
}

const surfaces = Object.freeze([
  symmetric('realm_sidewalk_concrete_01', 'surface'),
  symmetric('realm_sidewalk_paver_01', 'surface'),
  symmetric('realm_plaza_stone_01', 'surface'),
  symmetric('realm_plaza_concrete_01', 'surface'),
  symmetric('realm_permeable_pavers_01', 'surface'),
  symmetric('realm_grass_verge_01', 'surface'),
]);

const access = Object.freeze([
  ...directional('realm_curb_standard_01', 'access'),
  ...directional('realm_curb_ramp_01', 'access'),
  ...directional('realm_driveway_cut_01', 'access'),
  ...directional('realm_service_apron_01', 'access'),
  ...directional('realm_loading_apron_01', 'access'),
  ...directional('realm_parking_lot_entrance_01', 'access'),
]);

const furniture = Object.freeze([
  ...directional('realm_bench_01', 'furniture'),
  symmetric('realm_ped_lamp_01', 'furniture'),
  symmetric('realm_road_lamp_01', 'furniture'),
  symmetric('realm_bollards_01', 'furniture'),
  symmetric('realm_planter_01', 'furniture'),
  symmetric('realm_bin_01', 'furniture'),
  symmetric('realm_hydrant_01', 'furniture'),
]);

const vegetation = Object.freeze([
  symmetric('realm_tree_pit_01', 'vegetation'),
  symmetric('realm_tree_pit_02', 'vegetation'),
  symmetric('realm_tree_young_01', 'vegetation'),
  symmetric('realm_tree_young_02', 'vegetation'),
  symmetric('realm_tree_young_03', 'vegetation'),
  symmetric('realm_tree_mature_01', 'vegetation'),
  symmetric('realm_tree_mature_02', 'vegetation'),
  symmetric('realm_tree_mature_03', 'vegetation'),
  symmetric('realm_tree_mature_04', 'vegetation'),
  symmetric('realm_tree_ornamental_01', 'vegetation'),
  symmetric('realm_tree_ornamental_02', 'vegetation'),
  symmetric('realm_tree_ornamental_03', 'vegetation'),
  symmetric('realm_hedge_01', 'vegetation'),
  symmetric('realm_hedge_02', 'vegetation'),
  symmetric('realm_median_planting_01', 'vegetation'),
  symmetric('realm_median_planting_02', 'vegetation'),
  symmetric('realm_median_planting_03', 'vegetation'),
]);

const parking = Object.freeze([
  ...directional('realm_parking_surface_01', 'parking'),
  ...directional('realm_parking_landscaped_edge_01', 'parking'),
  ...directional('realm_garage_structured_entry_01', 'parking'),
  ...directional('realm_garage_podium_entry_01', 'parking'),
  ...directional('realm_curbside_cars_01', 'parking'),
]);

const publicSpace = Object.freeze([
  symmetric('realm_pocket_plaza_01', 'public-space'),
  symmetric('realm_pocket_plaza_02', 'public-space'),
  symmetric('realm_civic_forecourt_01', 'public-space'),
  symmetric('realm_civic_forecourt_02', 'public-space'),
  symmetric('realm_commercial_forecourt_01', 'public-space'),
  symmetric('realm_commercial_forecourt_02', 'public-space'),
  symmetric('realm_small_square_01', 'public-space'),
  symmetric('realm_small_square_02', 'public-space'),
  symmetric('realm_cafe_market_01', 'public-space'),
  symmetric('realm_cafe_market_02', 'public-space'),
  symmetric('realm_cafe_market_03', 'public-space'),
  symmetric('realm_fountain_plinth_01', 'public-space'),
  symmetric('realm_fountain_plinth_02', 'public-space'),
]);

const entries = Object.freeze([
  ...surfaces,
  ...access,
  ...furniture,
  ...vegetation,
  ...parking,
  ...publicSpace,
]);

if (entries.length !== 90 || slot !== 90) {
  throw new Error(`Pass B2 manifest expected 90 entries, got ${entries.length}/${slot}`);
}

export const PASS_B2_ASSET_MANIFEST: AssetManifest = Object.freeze({
  schemaVersion: 1,
  atlases: Object.freeze([
    Object.freeze({
      atlasId: ATLAS_ID,
      url: './assets/atlases/public_realm.png',
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
    }),
  ]),
  entries,
});

export const PASS_B2_COMPOSED_ASSET_MANIFEST: AssetManifest = composeAssetManifests(
  PASS_B1_COMPOSED_ASSET_MANIFEST,
  PASS_B2_ASSET_MANIFEST,
);
