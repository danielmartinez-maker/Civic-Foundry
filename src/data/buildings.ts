import type { ZoneType } from '../simulation/core/types.ts';

export type BuildingIntensity = 'low' | 'medium' | 'high';

export type BuildingDefinition = Readonly<{
  id: string;
  zone: ZoneType;
  intensity: BuildingIntensity;
  constructionTicks: number;
  residentCapacity: number;
  housingUnits: number;
  overcrowdingMultiplier: number;
  jobCapacity: number;
  powerDemand: number;
  waterDemand: number;
  garbageGeneration: number;
  taxBase: number;
  baseConstructionCost: number;
  softCostRatio: number;
  baseRent: number;
  operatingExpenseRatio: number;
  baseVacancy: number;
  baseCapRate: number;
  minimumAccess: number;
  minimumUtilityRatio: number;
  minimumServiceQuality: number;
  complexityFactor: number;
  riskWeight: number;
}>;

function definition(value: BuildingDefinition): BuildingDefinition {
  return Object.freeze(value);
}

const residential = Object.freeze([
  definition({
    id: 'residential_cottage', zone: 'residential', intensity: 'low', constructionTicks: 50,
    residentCapacity: 10, housingUnits: 4, overcrowdingMultiplier: 1.40, jobCapacity: 0,
    powerDemand: 6, waterDemand: 5, garbageGeneration: 2, taxBase: 120,
    baseConstructionCost: 35_000, softCostRatio: 0.12, baseRent: 600,
    operatingExpenseRatio: 0.28, baseVacancy: 0.08, baseCapRate: 0.065,
    minimumAccess: 0.25, minimumUtilityRatio: 0.45, minimumServiceQuality: 0.25,
    complexityFactor: 1, riskWeight: 0.25,
  }),
  definition({
    id: 'residential_rowhouse', zone: 'residential', intensity: 'medium', constructionTicks: 70,
    residentCapacity: 28, housingUnits: 12, overcrowdingMultiplier: 1.35, jobCapacity: 0,
    powerDemand: 16, waterDemand: 14, garbageGeneration: 5, taxBase: 250,
    baseConstructionCost: 80_000, softCostRatio: 0.14, baseRent: 480,
    operatingExpenseRatio: 0.30, baseVacancy: 0.09, baseCapRate: 0.06,
    minimumAccess: 0.45, minimumUtilityRatio: 0.65, minimumServiceQuality: 0.45,
    complexityFactor: 1.08, riskWeight: 0.35,
  }),
  definition({
    id: 'residential_apartment', zone: 'residential', intensity: 'high', constructionTicks: 100,
    residentCapacity: 72, housingUnits: 32, overcrowdingMultiplier: 1.30, jobCapacity: 0,
    powerDemand: 38, waterDemand: 34, garbageGeneration: 12, taxBase: 520,
    baseConstructionCost: 170_000, softCostRatio: 0.16, baseRent: 400,
    operatingExpenseRatio: 0.33, baseVacancy: 0.10, baseCapRate: 0.0575,
    minimumAccess: 0.70, minimumUtilityRatio: 0.85, minimumServiceQuality: 0.65,
    complexityFactor: 1.15, riskWeight: 0.50,
  }),
] as const);

const commercial = Object.freeze([
  definition({
    id: 'commercial_shop', zone: 'commercial', intensity: 'low', constructionTicks: 65,
    residentCapacity: 0, housingUnits: 0, overcrowdingMultiplier: 1, jobCapacity: 8,
    powerDemand: 12, waterDemand: 7, garbageGeneration: 4, taxBase: 220,
    baseConstructionCost: 55_000, softCostRatio: 0.12, baseRent: 1_400,
    operatingExpenseRatio: 0.34, baseVacancy: 0.10, baseCapRate: 0.07,
    minimumAccess: 0.35, minimumUtilityRatio: 0.50, minimumServiceQuality: 0.35,
    complexityFactor: 1, riskWeight: 0.30,
  }),
  definition({
    id: 'commercial_block', zone: 'commercial', intensity: 'medium', constructionTicks: 85,
    residentCapacity: 0, housingUnits: 0, overcrowdingMultiplier: 1, jobCapacity: 22,
    powerDemand: 26, waterDemand: 15, garbageGeneration: 10, taxBase: 480,
    baseConstructionCost: 125_000, softCostRatio: 0.15, baseRent: 1_000,
    operatingExpenseRatio: 0.36, baseVacancy: 0.11, baseCapRate: 0.067,
    minimumAccess: 0.55, minimumUtilityRatio: 0.70, minimumServiceQuality: 0.50,
    complexityFactor: 1.10, riskWeight: 0.42,
  }),
  definition({
    id: 'commercial_office', zone: 'commercial', intensity: 'high', constructionTicks: 115,
    residentCapacity: 0, housingUnits: 0, overcrowdingMultiplier: 1, jobCapacity: 45,
    powerDemand: 45, waterDemand: 25, garbageGeneration: 16, taxBase: 900,
    baseConstructionCost: 240_000, softCostRatio: 0.18, baseRent: 900,
    operatingExpenseRatio: 0.40, baseVacancy: 0.12, baseCapRate: 0.065,
    minimumAccess: 0.72, minimumUtilityRatio: 0.85, minimumServiceQuality: 0.68,
    complexityFactor: 1.18, riskWeight: 0.58,
  }),
] as const);

const industrial = Object.freeze([
  definition({
    id: 'industrial_workshop', zone: 'industrial', intensity: 'low', constructionTicks: 80,
    residentCapacity: 0, housingUnits: 0, overcrowdingMultiplier: 1, jobCapacity: 14,
    powerDemand: 22, waterDemand: 12, garbageGeneration: 8, taxBase: 320,
    baseConstructionCost: 85_000, softCostRatio: 0.11, baseRent: 1_250,
    operatingExpenseRatio: 0.32, baseVacancy: 0.09, baseCapRate: 0.078,
    minimumAccess: 0.30, minimumUtilityRatio: 0.55, minimumServiceQuality: 0.20,
    complexityFactor: 1, riskWeight: 0.32,
  }),
  definition({
    id: 'industrial_warehouse', zone: 'industrial', intensity: 'medium', constructionTicks: 100,
    residentCapacity: 0, housingUnits: 0, overcrowdingMultiplier: 1, jobCapacity: 32,
    powerDemand: 45, waterDemand: 22, garbageGeneration: 16, taxBase: 650,
    baseConstructionCost: 175_000, softCostRatio: 0.13, baseRent: 1_050,
    operatingExpenseRatio: 0.30, baseVacancy: 0.10, baseCapRate: 0.075,
    minimumAccess: 0.55, minimumUtilityRatio: 0.70, minimumServiceQuality: 0.25,
    complexityFactor: 1.08, riskWeight: 0.42,
  }),
  definition({
    id: 'industrial_plant', zone: 'industrial', intensity: 'high', constructionTicks: 130,
    residentCapacity: 0, housingUnits: 0, overcrowdingMultiplier: 1, jobCapacity: 70,
    powerDemand: 90, waterDemand: 50, garbageGeneration: 32, taxBase: 1_300,
    baseConstructionCost: 320_000, softCostRatio: 0.15, baseRent: 950,
    operatingExpenseRatio: 0.34, baseVacancy: 0.12, baseCapRate: 0.072,
    minimumAccess: 0.75, minimumUtilityRatio: 0.88, minimumServiceQuality: 0.30,
    complexityFactor: 1.18, riskWeight: 0.60,
  }),
] as const);

export const BUILDING_VARIANTS: Readonly<Record<ZoneType, readonly BuildingDefinition[]>> = Object.freeze({
  residential,
  commercial,
  industrial,
});

export const BUILDING_DEFINITIONS: Readonly<Record<ZoneType, BuildingDefinition>> = Object.freeze({
  residential: residential[0],
  commercial: commercial[0],
  industrial: industrial[0],
});

export const BUILDING_DEFINITION_BY_ID: Readonly<Record<string, BuildingDefinition>> = Object.freeze(
  Object.fromEntries(
    Object.values(BUILDING_VARIANTS).flat().map((item) => [item.id, item]),
  ) as Record<string, BuildingDefinition>,
);

export function getBuildingDefinition(id: string): BuildingDefinition {
  const result = BUILDING_DEFINITION_BY_ID[id];
  if (!result) throw new Error(`unknown building definition: ${id}`);
  return result;
}
