import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const mat = (id, family, baseColor) => ({ id, family, baseColor, roughness: 0.86, metallic: 0 });
const box = (id, size, center, material) => ({ id, primitive: 'box', size, center, material });
const collisionBox = (id, size, center) => ({ id, primitive: 'box', size, center });

function source({ assetId, category, semanticFamily, path, width, depth, height, color, family = 'painted_masonry', snapMode = 'parcel', zones = [], density = [], channels = {}, accent = null, memory = 'small', instancing = 'thin' }) {
  const bodyHeight = Math.max(0.2, height * 0.72);
  const body = { x: width * 0.82, y: bodyHeight, z: depth * 0.82 };
  const bodyCenter = { x: 0, y: bodyHeight / 2, z: 0 };
  const materials = [mat('primary', family, color)];
  const lod0Parts = [box('body', body, bodyCenter, 'primary')];
  const lod1Parts = [box('body', body, bodyCenter, 'primary')];
  const lod2Parts = [box('body', { x: width * 0.76, y: bodyHeight * 0.94, z: depth * 0.76 }, { x: 0, y: bodyHeight * 0.47, z: 0 }, 'primary')];
  if (accent) {
    materials.push(mat('accent', accent.family, accent.color));
    const ah = Math.max(0.12, height * 0.16);
    lod0Parts.push(box('accent', { x: width * 0.56, y: ah, z: depth * 0.58 }, { x: 0, y: bodyHeight + ah / 2, z: 0 }, 'accent'));
    lod1Parts.push(box('accent', { x: width * 0.5, y: ah, z: depth * 0.52 }, { x: 0, y: bodyHeight + ah / 2, z: 0 }, 'accent'));
  }
  const placement = { snapMode };
  if (zones.length) placement.zoneCompatibility = zones;
  if (density.length) placement.density = density;
  return {
    path,
    data: {
      schemaVersion: 1,
      assetId,
      category,
      semanticFamily,
      dimensions: { widthM: width, depthM: depth, heightM: height },
      pivot: { convention: 'ground-center', forward: '-Z', up: '+Y' },
      placement,
      materials,
      sockets: [],
      stateChannels: channels,
      runtime: {
        instancing,
        streamingClass: category === 'vehicle' ? 'near' : 'normal',
        memoryClass: memory,
        estimatedCpuGeometryBytes: accent ? 24576 : 16384,
        estimatedGpuGeometryBytes: accent ? 36864 : 24576,
        estimatedGpuMaterialBytes: accent ? 8192 : 4096,
      },
      art: { styleFamily: 'civic-foundry-miniature', qualityTier: 'standard' },
      lods: [
        { id: 'lod0', maxTriangles: 96, parts: lod0Parts },
        { id: 'lod1', maxTriangles: 72, parts: lod1Parts },
        { id: 'lod2', maxTriangles: 36, parts: lod2Parts },
      ],
      collision: [collisionBox('collision_body', body, bodyCenter)],
      bakedPeople: false,
      bakedVehicles: false,
      bakedText: false,
    },
  };
}

const assets = [
  source({ assetId: 'cf_bld_res_rowhouse_a_med_v01', category: 'building', semanticFamily: 'residential-rowhouse-medium', path: 'assets/source/3d/buildings/cf_bld_res_rowhouse_a_med_v01.asset.json', width: 7.2, depth: 15, height: 11.5, color: '#b78062', family: 'brick', snapMode: 'parcel', zones: ['residential'], density: ['medium'], channels: { condition: ['excellent','good','worn','distressed','unsafe'], occupancy: ['vacant','occupied'], power: ['off','on'], night: ['day','night'] }, accent: { family: 'roofing', color: '#4b4a48' } }),
  source({ assetId: 'cf_bld_com_corner_shop_a_low_v01', category: 'building', semanticFamily: 'commercial-corner-shop-low', path: 'assets/source/3d/buildings/cf_bld_com_corner_shop_a_low_v01.asset.json', width: 12, depth: 13, height: 7.4, color: '#c8b58e', family: 'stucco', snapMode: 'parcel', zones: ['commercial'], density: ['low'], channels: { condition: ['excellent','good','worn','distressed','unsafe'], occupancy: ['vacant','occupied'], power: ['off','on'], night: ['day','night'] }, accent: { family: 'glass', color: '#8fb5bc' } }),
  source({ assetId: 'cf_bld_mix_mainstreet_a_med_v01', category: 'building', semanticFamily: 'mixed-use-mainstreet-medium', path: 'assets/source/3d/buildings/cf_bld_mix_mainstreet_a_med_v01.asset.json', width: 15, depth: 18, height: 17, color: '#b66f54', family: 'brick', snapMode: 'parcel', zones: ['mixed_use'], density: ['medium'], channels: { condition: ['excellent','good','worn','distressed','unsafe'], occupancy: ['vacant','occupied'], power: ['off','on'], night: ['day','night'] }, accent: { family: 'glass', color: '#9abfc4' }, memory: 'medium' }),
  source({ assetId: 'cf_bld_ind_light_workshop_a_low_v01', category: 'industrial', semanticFamily: 'industrial-light-workshop-low', path: 'assets/source/3d/industrial/cf_bld_ind_light_workshop_a_low_v01.asset.json', width: 22, depth: 30, height: 9, color: '#9aa0a0', family: 'metal', snapMode: 'parcel', zones: ['industrial'], density: ['low'], channels: { condition: ['excellent','good','worn','distressed','unsafe'], occupancy: ['vacant','occupied'], power: ['off','on'] }, accent: { family: 'roofing', color: '#555a5c' }, memory: 'medium' }),
  source({ assetId: 'cf_fac_fire_station_a_v01', category: 'civic', semanticFamily: 'civic-fire-station', path: 'assets/source/3d/civic/cf_fac_fire_station_a_v01.asset.json', width: 26, depth: 32, height: 10, color: '#c6b39a', family: 'masonry', snapMode: 'parcel', zones: ['civic'], channels: { condition: ['excellent','good','worn'], occupancy: ['vacant','occupied'], power: ['off','on'], night: ['day','night'] }, accent: { family: 'painted_metal', color: '#8f3d35' }, memory: 'medium' }),
  source({ assetId: 'cf_prop_street_furniture_a_v01', category: 'public_realm', semanticFamily: 'public-realm-street-furniture', path: 'assets/source/3d/public-realm/cf_prop_street_furniture_a_v01.asset.json', width: 2.4, depth: 1.2, height: 1.1, color: '#5f6462', family: 'metal', snapMode: 'road', channels: {}, accent: { family: 'wood', color: '#8c7358' }, memory: 'tiny' }),
  source({ assetId: 'cf_veh_compact_car_a_v01', category: 'vehicle', semanticFamily: 'vehicle-compact-car', path: 'assets/source/3d/vehicles/cf_veh_compact_car_a_v01.asset.json', width: 1.8, depth: 4.2, height: 1.55, color: '#657f8c', family: 'painted_metal', snapMode: 'road', channels: { power: ['off','on'] }, accent: { family: 'glass', color: '#8eabb2' }, memory: 'tiny' }),
  source({ assetId: 'cf_transit_bus_stop_a_v01', category: 'transit', semanticFamily: 'transit-local-bus-stop', path: 'assets/source/3d/transit/cf_transit_bus_stop_a_v01.asset.json', width: 4.5, depth: 1.8, height: 2.8, color: '#6e7d77', family: 'metal', snapMode: 'road', channels: { night: ['day','night'] }, accent: { family: 'glass', color: '#a7c3c7' }, memory: 'tiny' }),
  source({ assetId: 'cf_veg_deciduous_tree_a_v01', category: 'vegetation', semanticFamily: 'vegetation-deciduous-tree', path: 'assets/source/3d/vegetation/cf_veg_deciduous_tree_a_v01.asset.json', width: 7.5, depth: 7.5, height: 10.5, color: '#6f8b62', family: 'vegetation', snapMode: 'free', channels: {}, accent: { family: 'wood', color: '#695747' }, memory: 'tiny' }),
  source({ assetId: 'cf_prop_pocket_park_a_v01', category: 'public_realm', semanticFamily: 'public-realm-pocket-park', path: 'assets/source/3d/public-realm/cf_prop_pocket_park_a_v01.asset.json', width: 18, depth: 18, height: 1.2, color: '#7f956f', family: 'landscape', snapMode: 'parcel', zones: ['civic','residential','mixed_use'], channels: {}, accent: { family: 'stone', color: '#b2aa9b' }, memory: 'small' }),
  source({ assetId: 'cf_construction_basic_kit_a_v01', category: 'construction', semanticFamily: 'construction-basic-kit', path: 'assets/source/3d/construction/cf_construction_basic_kit_a_v01.asset.json', width: 12, depth: 12, height: 9, color: '#d2a447', family: 'painted_metal', snapMode: 'socket', channels: { construction: ['none','active'] }, accent: { family: 'wood', color: '#8b7254' }, memory: 'small' }),
  source({ assetId: 'cf_condition_basic_kit_a_v01', category: 'public_realm', semanticFamily: 'condition-attachment-kit', path: 'assets/source/3d/condition/cf_condition_basic_kit_a_v01.asset.json', width: 6, depth: 1.2, height: 3, color: '#766f65', family: 'wood', snapMode: 'socket', channels: { condition: ['excellent','good','worn','distressed','unsafe'] }, accent: { family: 'metal', color: '#686a68' }, memory: 'tiny' }),
  source({ assetId: 'cf_landmark_water_tower_a_v01', category: 'civic', semanticFamily: 'landmark-water-tower', path: 'assets/source/3d/civic/cf_landmark_water_tower_a_v01.asset.json', width: 12, depth: 12, height: 28, color: '#778381', family: 'metal', snapMode: 'parcel', zones: ['civic','industrial'], channels: { condition: ['excellent','good','worn','distressed'], night: ['day','night'] }, accent: { family: 'painted_metal', color: '#a4a39a' }, memory: 'medium', instancing: 'unique' }),
];

for (const asset of assets) {
  await mkdir(dirname(asset.path), { recursive: true });
  await writeFile(asset.path, `${JSON.stringify(asset.data, null, 2)}\n`);
}

console.log(`Wrote ${assets.length} Stack 3 production asset sources.`);
