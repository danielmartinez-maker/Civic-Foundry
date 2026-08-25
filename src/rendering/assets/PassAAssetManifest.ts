import type { AssetManifest, AssetManifestEntry, AssetOrientation } from './AssetTypes.ts';

export const PASS_A_ART_BIBLE = Object.freeze({
  grass: '#7f956e', forestGround: '#647d59', rock: '#7d7f7d', water: '#5f88a4',
  asphalt: '#3f454a', sidewalk: '#b9b1a5', concrete: '#aaa79f',
  laneWhite: '#e3e0d5', laneYellow: '#d9be69', shadow: 'rgba(38,45,48,.24)',
} as const);

const terrainEntries: AssetManifestEntry[] = [
  ['grass', 1], ['grass', 2], ['forest', 1], ['forest', 2],
  ['rock', 1], ['rock', 2], ['water', 1], ['water', 2],
].map(([biome, variant], index) => ({
  assetId: `terrain_${biome}_${String(variant).padStart(2, '0')}`,
  variantKey: `terrain_${biome}_${String(variant).padStart(2, '0')}`,
  atlasId: 'terrain', sourceRect: { x: index * 128, y: 0, width: 128, height: 64 },
  footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 32 },
  category: 'terrain', subcategory: String(biome), orientation: 0, weight: 1, tags: ['symmetric'],
}));

const roadTypes = ['local', 'collector', 'arterial'] as const;
const roadEntries: AssetManifestEntry[] = roadTypes.flatMap((roadType, row) =>
  Array.from({ length: 16 }, (_, mask) => ({
    assetId: `road_${roadType}_mask_${mask.toString().padStart(2, '0')}`,
    variantKey: `road_${roadType}_mask_${mask.toString().padStart(2, '0')}`,
    atlasId: 'roads', sourceRect: { x: mask * 128, y: row * 64, width: 128, height: 64 },
    footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 32 },
    category: 'road', subcategory: roadType, orientation: 0, weight: 1,
    tags: [`mask:${mask}`, 'symmetric-camera-mask'],
  })),
);

export const PASS_A_BUILDING_VARIANTS = Object.freeze([
  ['res_low_detached_01','residential','low'], ['res_low_detached_02','residential','low'], ['res_low_detached_03','residential','low'],
  ['res_mid_rowhouse_01','residential','medium'], ['res_mid_walkup_01','residential','medium'], ['res_mid_courtyard_01','residential','medium'],
  ['res_high_slab_01','residential','high'], ['res_high_podium_01','residential','high'], ['res_high_tower_01','residential','high'],
  ['com_low_corner_01','commercial','low'], ['com_low_strip_01','commercial','low'], ['com_low_office_01','commercial','low'],
  ['com_mid_block_01','commercial','medium'], ['com_mid_office_01','commercial','medium'], ['com_mid_hotel_01','commercial','medium'],
  ['com_high_office_01','commercial','high'], ['com_high_hotel_01','commercial','high'], ['com_high_corporate_01','commercial','high'],
  ['ind_low_workshop_01','industrial','low'], ['ind_low_repair_01','industrial','low'], ['ind_low_warehouse_01','industrial','low'],
  ['ind_mid_distribution_01','industrial','medium'], ['ind_mid_logistics_01','industrial','medium'], ['ind_mid_factory_01','industrial','medium'],
  ['ind_high_plant_01','industrial','high'], ['ind_high_processing_01','industrial','high'], ['ind_high_manufacturing_01','industrial','high'],
] as const);

const buildingEntries: AssetManifestEntry[] = PASS_A_BUILDING_VARIANTS.map(([variantKey, zone, intensity], index) => ({
  assetId: `${variantKey}_o0`, variantKey, atlasId: 'buildings',
  sourceRect: { x: index * 128, y: 0, width: 128, height: 192 },
  footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 160 },
  category: 'building', zone, intensity, orientation: 0, weight: 1,
  tags: ['symmetric', 'north-american'],
}));

const constructionStages = ['site', 'foundation', 'structure', 'facade'] as const;
const intensities = ['low', 'medium', 'high'] as const;
const constructionEntries: AssetManifestEntry[] = intensities.flatMap((intensity, intensityIndex) =>
  constructionStages.map((stage, stageIndex) => {
    const slot = intensityIndex * constructionStages.length + stageIndex;
    const variantKey = `construction_${intensity}_${stage}`;
    return {
      assetId: `${variantKey}_o0`, variantKey, atlasId: 'construction',
      sourceRect: { x: slot * 128, y: 0, width: 128, height: 160 },
      footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 144 },
      category: 'construction', intensity, constructionStage: stage, orientation: 0, weight: 1,
      tags: ['symmetric', 'north-american'],
    };
  }),
);

const civicTypes = ['fire_station', 'police_station', 'clinic', 'elementary_school', 'landfill', 'recycling_center'] as const;
const civicEntries: AssetManifestEntry[] = civicTypes.map((type, index) => ({
  assetId: `civic_${type}_01_o0`, variantKey: `civic_${type}_01`, atlasId: 'civic',
  sourceRect: { x: index * 128, y: 0, width: 128, height: 160 },
  footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 144 },
  category: 'civic', subcategory: type, orientation: 0, weight: 1, tags: ['symmetric', 'north-american'],
}));

const utilityTypes = ['power', 'water', 'landfill'] as const;
const utilityEntries: AssetManifestEntry[] = utilityTypes.map((type, index) => ({
  assetId: `utility_${type}_01_o0`, variantKey: `utility_${type}_01`, atlasId: 'utilities',
  sourceRect: { x: index * 128, y: 0, width: 128, height: 160 },
  footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 144 },
  category: 'utility', subcategory: type, orientation: 0, weight: 1, tags: ['symmetric', 'north-american'],
}));

const vegetationVariants = [
  ['tree_street_young_01','young'], ['tree_street_young_02','young'],
  ['tree_street_mature_01','mature'], ['tree_street_mature_02','mature'],
  ['tree_large_01','large'], ['tree_large_02','large'], ['tree_large_03','large'],
  ['shrub_01','shrub'], ['shrub_02','shrub'],
] as const;
const vegetationEntries: AssetManifestEntry[] = vegetationVariants.map(([variantKey, type], index) => ({
  assetId: `${variantKey}_o0`, variantKey, atlasId: 'vegetation',
  sourceRect: { x: index * 96, y: 0, width: 96, height: 160 },
  footprint: { width: 1, height: 1 }, anchor: { x: 48, y: 144 },
  category: 'vegetation', subcategory: type, orientation: 0, weight: 1, tags: ['symmetric'],
}));

export const PASS_A_VEHICLE_FAMILIES = Object.freeze([
  'vehicle_sedan_01', 'vehicle_suv_01', 'vehicle_delivery_van_01', 'vehicle_box_truck_01',
  'vehicle_freight_truck_01', 'vehicle_bus_01', 'vehicle_brt_01', 'vehicle_tram_01',
  'vehicle_fire_engine_01', 'vehicle_police_01', 'vehicle_ambulance_01', 'vehicle_garbage_truck_01',
] as const);
const vehicleEntries: AssetManifestEntry[] = PASS_A_VEHICLE_FAMILIES.flatMap((variantKey, familyIndex) =>
  ([0,1,2,3] as const).map((orientation: AssetOrientation) => {
    const slot = familyIndex * 4 + orientation;
    return {
      assetId: `${variantKey}_o${orientation}`, variantKey, atlasId: 'vehicles',
      sourceRect: { x: slot * 80, y: 0, width: 80, height: 64 },
      footprint: { width: 1, height: 1 }, anchor: { x: 40, y: 43 },
      category: 'vehicle', subcategory: variantKey.replace(/^vehicle_/, '').replace(/_01$/, ''),
      orientation, weight: 1, tags: ['north-american'],
    };
  }),
);

const entries = Object.freeze([
  ...terrainEntries, ...roadEntries, ...buildingEntries, ...constructionEntries,
  ...civicEntries, ...utilityEntries, ...vegetationEntries, ...vehicleEntries,
]);

export const PASS_A_ASSET_MANIFEST: AssetManifest = Object.freeze({
  schemaVersion: 1,
  atlases: Object.freeze([
    { atlasId: 'terrain', url: './assets/atlases/terrain.png', width: 1024, height: 64 },
    { atlasId: 'roads', url: './assets/atlases/roads.png', width: 2048, height: 192 },
    { atlasId: 'buildings', url: './assets/atlases/buildings.png', width: 4096, height: 2048 },
    { atlasId: 'construction', url: './assets/atlases/construction.png', width: 2048, height: 768 },
    { atlasId: 'civic', url: './assets/atlases/civic.png', width: 2048, height: 768 },
    { atlasId: 'utilities', url: './assets/atlases/utilities.png', width: 1024, height: 512 },
    { atlasId: 'vegetation', url: './assets/atlases/vegetation.png', width: 1024, height: 512 },
    { atlasId: 'vehicles', url: './assets/atlases/vehicles.png', width: 4096, height: 768 },
  ]),
  entries,
});
