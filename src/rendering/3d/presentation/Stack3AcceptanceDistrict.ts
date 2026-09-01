import type { AssetId, AssetManifestV2Entry } from '../assets/AssetManifestV2.ts';
import type { ProductionPresentationEntityId, ProductionVisualState } from './PresentationTypes.ts';
import { visualSeed } from './VisualDeterminism.ts';

export const STACK3_PRODUCTION_ASSET_IDS = Object.freeze([
  'cf_bld_res_detached_house_a_low_v01',
  'cf_bld_res_rowhouse_a_med_v01',
  'cf_bld_com_corner_shop_a_low_v01',
  'cf_bld_mix_mainstreet_a_med_v01',
  'cf_bld_ind_light_workshop_a_low_v01',
  'cf_fac_fire_station_a_v01',
  'cf_prop_street_furniture_a_v01',
  'cf_veh_compact_car_a_v01',
  'cf_transit_bus_stop_a_v01',
  'cf_veg_deciduous_tree_a_v01',
  'cf_prop_pocket_park_a_v01',
  'cf_construction_basic_kit_a_v01',
  'cf_condition_basic_kit_a_v01',
  'cf_landmark_water_tower_a_v01',
] as const satisfies readonly AssetId[]);

function prefixFor(assetId: AssetId): string {
  if (assetId.startsWith('cf_veh_')) return 'vehicle';
  if (assetId.startsWith('cf_fac_')) return 'facility';
  if (assetId.startsWith('cf_transit_')) return 'transit';
  if (assetId.startsWith('cf_veg_')) return 'vegetation';
  if (assetId.startsWith('cf_construction_')) return 'construction';
  if (assetId.startsWith('cf_landmark_')) return 'landmark';
  if (assetId.startsWith('cf_prop_') || assetId.startsWith('cf_condition_')) return 'prop';
  return 'building';
}

export function buildStack3AcceptanceDistrict(scale: 'block' | 'neighborhood'): readonly ProductionVisualState[] {
  const repetitions = scale === 'block' ? 8 : 72;
  const states: ProductionVisualState[] = [];
  const columns = scale === 'block' ? 14 : 42;
  let ordinal = 0;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const assetId of STACK3_PRODUCTION_ASSET_IDS) {
      const x = (ordinal % columns) * 12;
      const z = Math.floor(ordinal / columns) * 14;
      const rotationY = (ordinal % 4) * (Math.PI / 2);
      const presentationId = `${prefixFor(assetId)}:stack3:${ordinal}` as ProductionPresentationEntityId;
      const structuralFingerprint = `${assetId}:${x}:${z}:${rotationY.toFixed(6)}`;
      states.push(Object.freeze({
        presentationId,
        canonicalId: `stack3:${ordinal}`,
        assetId,
        transform: Object.freeze({
          positionM: Object.freeze({ x, y: 0, z }),
          rotationY,
          scale: Object.freeze({ x: 1, y: 1, z: 1 }),
        }),
        variationSeed: visualSeed(presentationId, assetId, 'stack3-acceptance'),
        structuralFingerprint,
        appearanceFingerprint: `${assetId}:default`,
      }));
      ordinal += 1;
    }
  }
  return Object.freeze(states);
}

export type ProductionBudgetSummary = Readonly<{
  entityCount: number;
  uniquePrototypes: number;
  estimatedCpuGeometryBytes: number;
  estimatedGpuGeometryBytes: number;
  estimatedGpuMaterialBytes: number;
}>;

export function summarizeProductionBudget(
  states: readonly ProductionVisualState[],
  catalog: Readonly<{ get(assetId: string): AssetManifestV2Entry | undefined }>,
): ProductionBudgetSummary {
  const uniqueAssetIds = [...new Set(states.map((state) => state.assetId))].sort();
  let estimatedCpuGeometryBytes = 0;
  let estimatedGpuGeometryBytes = 0;
  let estimatedGpuMaterialBytes = 0;
  for (const assetId of uniqueAssetIds) {
    const asset = catalog.get(assetId);
    if (!asset) throw new Error(`Acceptance district references unknown asset '${assetId}'`);
    estimatedCpuGeometryBytes += asset.runtime.estimatedCpuGeometryBytes;
    estimatedGpuGeometryBytes += asset.runtime.estimatedGpuGeometryBytes;
    estimatedGpuMaterialBytes += asset.runtime.estimatedGpuMaterialBytes;
  }
  return Object.freeze({
    entityCount: states.length,
    uniquePrototypes: uniqueAssetIds.length,
    estimatedCpuGeometryBytes,
    estimatedGpuGeometryBytes,
    estimatedGpuMaterialBytes,
  });
}
