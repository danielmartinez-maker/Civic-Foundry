import type { AssetId } from '../assets/AssetManifestV2.ts';
import type { BuildingV2 } from '../../../simulation/buildings/BuildingTypes.ts';
import { polygonCentroid } from '../../../world/cadastre/Geometry.ts';
import type {
  BuildingVisualState,
  VisualCondition,
  VisualTime,
} from './PresentationTypes.ts';
import { visualFingerprint, visualSeed } from './VisualDeterminism.ts';

const HOUSE_A_ASSET_ID = 'cf_bld_res_detached_house_a_low_v01' as AssetId;
const CONSTRUCTION_PHASES = new Set(['foundation', 'structure', 'enclosure', 'fit-out']);

export type BuildingVisualResolveContext = Readonly<{
  powerRatio: number;
  visualTime: VisualTime;
}>;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function conditionFor(exteriorCondition: number): VisualCondition {
  if (exteriorCondition >= 85) return 'excellent';
  if (exteriorCondition >= 65) return 'good';
  if (exteriorCondition >= 40) return 'worn';
  if (exteriorCondition >= 20) return 'distressed';
  return 'unsafe';
}

function assetFor(building: BuildingV2): AssetId | null {
  return building.typologyId === 'typology:residential_cottage' ? HOUSE_A_ASSET_ID : null;
}

function constructionState(building: BuildingV2): Readonly<{
  construction: 'none' | 'active';
  constructionProgress: number;
}> {
  const projectPhase = building.project?.phase;
  const active =
    building.status === 'construction' ||
    (projectPhase !== undefined && CONSTRUCTION_PHASES.has(projectPhase));
  return Object.freeze({
    construction: active ? 'active' : 'none',
    constructionProgress: active ? clamp01(building.project?.progress ?? 0) : 0,
  });
}

export class BuildingVisualResolver {
  resolve(building: BuildingV2, context: BuildingVisualResolveContext): BuildingVisualState {
    const presentationId = `building:${building.id}` as const;
    const assetId = assetFor(building);
    const centroid = polygonCentroid(building.footprint);
    const transform = Object.freeze({
      positionM: Object.freeze({ x: centroid.x, y: 0, z: centroid.y }),
      rotationYRad: 0,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    });
    const occupancy = building.status === 'occupied' ? 'occupied' : 'vacant';
    const powered = Number.isFinite(context.powerRatio) && context.powerRatio >= 0.5;
    const construction = constructionState(building);
    const state = Object.freeze({
      condition: conditionFor(building.lifecycle.exteriorCondition),
      occupancy,
      powered,
      construction: construction.construction,
      constructionProgress: construction.constructionProgress,
      nightLighting: context.visualTime === 'night' && occupancy === 'occupied' && powered,
    });
    const fallbackBoundsM = Object.freeze({
      footprint: building.footprint,
      heightM: building.heightMeters,
    });
    const variationSeed = visualSeed(presentationId, assetId ?? 'canonical-bounds-proxy', 'base');

    const structuralFingerprint = visualFingerprint({
      presentationId,
      assetId,
      typologyId: building.typologyId,
      footprint: building.footprint,
      heightMeters: building.heightMeters,
      transform,
    });
    const appearanceFingerprint = visualFingerprint({
      state,
      variationSeed,
    });

    return Object.freeze({
      presentationId,
      canonicalBuildingId: building.id,
      assetId,
      transform,
      fallbackBoundsM,
      state,
      variationSeed,
      structuralFingerprint,
      appearanceFingerprint,
    });
  }
}
