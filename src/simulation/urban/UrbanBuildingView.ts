import { conditionBandForScore, deterministicParkingSpaces } from '../../data/urbanFabric.ts';
import { getUrbanPrototype } from '../../data/urbanPrototypes.ts';
import { definitionForBuilding, type Building } from '../buildings/BuildingSystem.ts';
import type {
  BuildingConditionBand,
  BuildingQualityTier,
  PrivateParkingProfile,
  UrbanBuildingState,
  UrbanLifecycleState,
  UrbanUse,
  UrbanUseComponent,
} from './UrbanTypes.ts';

export type UrbanBuildingView = Readonly<{
  buildingId: string;
  lotId: string;
  x: number;
  y: number;
  definitionId: string;
  dominantUse: UrbanUse;
  intensity: 'low' | 'medium' | 'high';
  buildingStatus: Building['status'];
  useComponents: readonly UrbanUseComponent[];
  nominalResidentialCapacity: number;
  nominalCommercialJobCapacity: number;
  nominalIndustrialJobCapacity: number;
  nominalJobCapacity: number;
  residentialCapacity: number;
  commercialJobCapacity: number;
  industrialJobCapacity: number;
  jobCapacity: number;
  taxBaseByUse: Readonly<Record<UrbanUse, number>>;
  taxBase: number;
  powerDemand: number;
  waterDemand: number;
  garbageGeneration: number;
  qualityTier: BuildingQualityTier;
  conditionScore: number;
  conditionBand: BuildingConditionBand;
  lifecycleState: UrbanLifecycleState;
  conditionCapacityMultiplier: number;
  occupancyEligible: boolean;
  newOccupancyEligible: boolean;
  parking: Readonly<{ profile: PrivateParkingProfile; spaces: number }>;
}>;

export type UrbanBusinessSite = Readonly<{
  buildingId: string;
  x: number;
  y: number;
  dominantZone: UrbanUse;
  commercialJobCapacity: number;
  industrialJobCapacity: number;
  totalJobCapacity: number;
  occupancyEligible: boolean;
}>;

function effectiveCapacity(value: number, multiplier: number): number {
  return Math.max(0, Math.round(value * multiplier));
}

export function conditionCapacityMultiplier(state: Pick<UrbanBuildingState, 'conditionScore' | 'lifecycleState'>): number {
  if (state.lifecycleState === 'construction' || state.lifecycleState === 'abandoned' || state.lifecycleState === 'condemned') return 0;
  if (state.lifecycleState === 'renovating') return 0.50;
  return state.conditionScore < 50 ? 0.85 : 1;
}

export function buildUrbanBuildingView(building: Building, state: UrbanBuildingState): UrbanBuildingView {
  if (building.id !== state.buildingId) throw new Error(`urban state/building mismatch: ${state.buildingId} != ${building.id}`);
  const definition = definitionForBuilding(building);
  const nominalResidentialCapacity = state.useComponents.reduce((sum, item) => sum + item.residentCapacity, 0);
  const nominalCommercialJobCapacity = state.useComponents.filter((item) => item.use === 'commercial').reduce((sum, item) => sum + item.jobCapacity, 0);
  const nominalIndustrialJobCapacity = state.useComponents.filter((item) => item.use === 'industrial').reduce((sum, item) => sum + item.jobCapacity, 0);
  const nominalJobCapacity = nominalCommercialJobCapacity + nominalIndustrialJobCapacity;
  const multiplier = conditionCapacityMultiplier(state);
  const taxBaseByUse = Object.freeze({
    residential: state.useComponents.filter((item) => item.use === 'residential').reduce((sum, item) => sum + item.taxBase, 0),
    commercial: state.useComponents.filter((item) => item.use === 'commercial').reduce((sum, item) => sum + item.taxBase, 0),
    industrial: state.useComponents.filter((item) => item.use === 'industrial').reduce((sum, item) => sum + item.taxBase, 0),
  });
  const useComponents = Object.freeze(state.useComponents.map((item) => Object.freeze({ ...item })));
  const lifecycleOccupancyEligible = !['construction', 'abandoned'].includes(state.lifecycleState);
  const newOccupancyEligible = !['construction', 'condemned', 'abandoned'].includes(state.lifecycleState);

  return Object.freeze({
    buildingId: building.id, lotId: building.lotId, x: building.x, y: building.y,
    definitionId: building.definitionId, dominantUse: building.zone, intensity: definition.intensity,
    buildingStatus: building.status, useComponents,
    nominalResidentialCapacity, nominalCommercialJobCapacity, nominalIndustrialJobCapacity, nominalJobCapacity,
    residentialCapacity: effectiveCapacity(nominalResidentialCapacity, multiplier),
    commercialJobCapacity: effectiveCapacity(nominalCommercialJobCapacity, multiplier),
    industrialJobCapacity: effectiveCapacity(nominalIndustrialJobCapacity, multiplier),
    jobCapacity: effectiveCapacity(nominalJobCapacity, multiplier),
    taxBaseByUse,
    taxBase: taxBaseByUse.residential + taxBaseByUse.commercial + taxBaseByUse.industrial,
    powerDemand: definition.powerDemand, waterDemand: definition.waterDemand, garbageGeneration: definition.garbageGeneration,
    qualityTier: state.qualityTier, conditionScore: state.conditionScore, conditionBand: conditionBandForScore(state.conditionScore),
    lifecycleState: state.lifecycleState, conditionCapacityMultiplier: multiplier,
    occupancyEligible: building.status === 'occupied' && lifecycleOccupancyEligible,
    newOccupancyEligible: building.status === 'occupied' && newOccupancyEligible,
    parking: Object.freeze({ ...state.parking }),
  });
}

export function urbanBusinessSiteFromView(view: UrbanBuildingView): UrbanBusinessSite {
  return Object.freeze({
    buildingId: view.buildingId,
    x: view.x,
    y: view.y,
    dominantZone: view.dominantUse,
    commercialJobCapacity: view.commercialJobCapacity,
    industrialJobCapacity: view.industrialJobCapacity,
    totalJobCapacity: view.jobCapacity,
    occupancyEligible: view.newOccupancyEligible && view.jobCapacity > 0,
  });
}

export function legacyUrbanStateForBuilding(building: Building, migrationTick: number): UrbanBuildingState {
  if (!Number.isInteger(migrationTick) || migrationTick < 0) throw new Error('migration tick must be a non-negative integer');
  const definition = definitionForBuilding(building);
  const useComponent: UrbanUseComponent = Object.freeze({
    use: building.zone, areaShareBps: 10_000, residentCapacity: definition.residentCapacity,
    jobCapacity: definition.jobCapacity, taxBase: definition.taxBase,
  });
  return Object.freeze({
    buildingId: building.id,
    useComponents: Object.freeze([useComponent]),
    qualityTier: 'standard', conditionScore: 80,
    lifecycleState: building.status === 'construction' ? 'construction' : 'stabilized',
    conditionEstablishedTick: migrationTick, lastConditionTick: migrationTick, renovationCount: 0,
    parking: Object.freeze({ profile: 'legacy-none', spaces: 0 }),
  });
}

export function compatibilityUrbanStateForBuilding(building: Building, tick: number): UrbanBuildingState {
  const prototype = getUrbanPrototype(building.definitionId);
  if (prototype.components.length === 1) return legacyUrbanStateForBuilding(building, tick);
  const baselineSpaces = deterministicParkingSpaces(prototype.components.reduce((sum, item) => {
    if (item.use === 'residential') return sum + item.residentCapacity * 0.20;
    if (item.use === 'commercial') return sum + item.jobCapacity * 0.35;
    return sum + item.jobCapacity * 0.20;
  }, 0));
  return Object.freeze({
    buildingId: building.id,
    useComponents: Object.freeze(prototype.components.map((item) => Object.freeze({ ...item }))),
    qualityTier: 'standard',
    conditionScore: building.status === 'construction' ? 100 : 80,
    lifecycleState: building.status === 'construction' ? 'construction' : 'stabilized',
    conditionEstablishedTick: tick, lastConditionTick: tick, renovationCount: 0,
    parking: Object.freeze({ profile: 'standard', spaces: baselineSpaces }),
  });
}
