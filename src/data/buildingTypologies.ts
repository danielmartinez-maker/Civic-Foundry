import { BUILDING_DEFINITION_BY_ID, type BuildingDefinition } from './buildings.ts';
import type { BuildingTypology } from '../simulation/buildings/BuildingTypes.ts';
import type { UseType } from '../simulation/zoning/ZoningTypes.ts';

export type { BuildingTypology } from '../simulation/buildings/BuildingTypes.ts';

const DEFAULT_JOBS_PER_1000_M2: Readonly<Partial<Record<UseType, number>>> = Object.freeze({
  retail: 28,
  office: 45,
  hospitality: 22,
  'light-industrial': 18,
  'heavy-industrial': 12,
  logistics: 9,
  civic: 25,
});

function legacyTypology(
  definitionId: string,
  name: string,
  primaryUse: UseType,
  allowedUses: readonly UseType[],
  defaultUseMix: Readonly<Partial<Record<UseType, number>>>,
  preferredStories: number,
  minStories: number,
  maxStories: number,
  efficiencyRatio: number,
): BuildingTypology {
  const definition = BUILDING_DEFINITION_BY_ID[definitionId];
  if (!definition) throw new Error(`unknown legacy definition: ${definitionId}`);
  const assumedAreaM2 = legacyReferenceArea(definition);
  const primaryJobDensity = definition.jobCapacity > 0
    ? definition.jobCapacity / assumedAreaM2 * 1_000
    : 0;
  const jobsPer1000M2ByUse = { ...DEFAULT_JOBS_PER_1000_M2 };
  if (primaryJobDensity > 0) jobsPer1000M2ByUse[primaryUse] = primaryJobDensity;

  return Object.freeze({
    id: `typology:${definitionId}`,
    name,
    legacyDefinitionId: definitionId,
    primaryUse,
    allowedUses: Object.freeze([...allowedUses]),
    defaultUseMix: Object.freeze({ ...defaultUseMix }),
    preferredStories,
    minStories,
    maxStories,
    floorToFloorHeightMeters: preferredStories >= 8 ? 3.4 : 3.2,
    efficiencyRatio,
    costPerM2: definition.baseConstructionCost / assumedAreaM2,
    maintenanceCostPerM2: Math.max(1, definition.baseConstructionCost * 0.018 / assumedAreaM2),
    constructionTicksPer1000M2: definition.constructionTicks / assumedAreaM2 * 1_000,
    averageResidentialUnitAreaM2: 82,
    jobsPer1000M2ByUse: Object.freeze(jobsPer1000M2ByUse),
    powerDemandPer1000M2: definition.powerDemand / assumedAreaM2 * 1_000,
    waterDemandPer1000M2: definition.waterDemand / assumedAreaM2 * 1_000,
    garbagePer1000M2: definition.garbageGeneration / assumedAreaM2 * 1_000,
    taxBasePerM2: definition.taxBase / assumedAreaM2,
    baseRentPerM2ByUse: Object.freeze(Object.fromEntries(
      allowedUses.map((use) => [use, definition.baseRent / assumedAreaM2]),
    ) as Partial<Record<UseType, number>>),
    operatingExpenseRatio: definition.operatingExpenseRatio,
    baseVacancy: definition.baseVacancy,
    baseCapRate: definition.baseCapRate,
    minimumAccess: definition.minimumAccess,
    minimumUtilityRatio: definition.minimumUtilityRatio,
    minimumServiceQuality: definition.minimumServiceQuality,
    complexityFactor: definition.complexityFactor,
    riskWeight: definition.riskWeight,
    conversionSuitability: definition.zone === 'industrial' ? 0.45 : 0.7,
  });
}

function mixedTypology(
  id: string,
  name: string,
  seedDefinitionId: string,
  preferredStories: number,
  maxStories: number,
  efficiencyRatio: number,
  conversionSuitability: number,
): BuildingTypology {
  const seed = legacyTypology(
    seedDefinitionId,
    name,
    'residential',
    ['residential', 'retail', 'office'],
    { residential: 0.65, retail: 0.20, office: 0.15 },
    preferredStories,
    3,
    maxStories,
    efficiencyRatio,
  );
  const physicalSeed: Omit<BuildingTypology, 'legacyDefinitionId'> = {
    id: seed.id,
    name: seed.name,
    primaryUse: seed.primaryUse,
    allowedUses: seed.allowedUses,
    defaultUseMix: seed.defaultUseMix,
    preferredStories: seed.preferredStories,
    minStories: seed.minStories,
    maxStories: seed.maxStories,
    floorToFloorHeightMeters: seed.floorToFloorHeightMeters,
    efficiencyRatio: seed.efficiencyRatio,
    costPerM2: seed.costPerM2,
    maintenanceCostPerM2: seed.maintenanceCostPerM2,
    constructionTicksPer1000M2: seed.constructionTicksPer1000M2,
    averageResidentialUnitAreaM2: seed.averageResidentialUnitAreaM2,
    jobsPer1000M2ByUse: seed.jobsPer1000M2ByUse,
    powerDemandPer1000M2: seed.powerDemandPer1000M2,
    waterDemandPer1000M2: seed.waterDemandPer1000M2,
    garbagePer1000M2: seed.garbagePer1000M2,
    taxBasePerM2: seed.taxBasePerM2,
    baseRentPerM2ByUse: seed.baseRentPerM2ByUse,
    operatingExpenseRatio: seed.operatingExpenseRatio,
    baseVacancy: seed.baseVacancy,
    baseCapRate: seed.baseCapRate,
    minimumAccess: seed.minimumAccess,
    minimumUtilityRatio: seed.minimumUtilityRatio,
    minimumServiceQuality: seed.minimumServiceQuality,
    complexityFactor: seed.complexityFactor,
    riskWeight: seed.riskWeight,
    ...(seed.conversionSuitability === undefined ? {} : { conversionSuitability: seed.conversionSuitability }),
  };
  return Object.freeze({
    ...physicalSeed,
    id,
    name,
    primaryUse: 'residential',
    allowedUses: Object.freeze(['residential', 'retail', 'office'] as const),
    defaultUseMix: Object.freeze({ residential: 0.65, retail: 0.20, office: 0.15 }),
    preferredStories,
    maxStories,
    efficiencyRatio,
    conversionSuitability,
  });
}

export const BUILDING_TYPOLOGIES: readonly BuildingTypology[] = Object.freeze([
  legacyTypology('residential_cottage', 'Detached Cottage', 'residential', ['residential'], { residential: 1 }, 2, 1, 2, 0.86),
  legacyTypology('residential_rowhouse', 'Rowhouse', 'residential', ['residential'], { residential: 1 }, 3, 2, 4, 0.84),
  legacyTypology('residential_apartment', 'Apartment Building', 'residential', ['residential'], { residential: 1 }, 8, 4, 14, 0.80),
  legacyTypology('commercial_shop', 'Neighborhood Shop', 'retail', ['retail'], { retail: 1 }, 1, 1, 2, 0.88),
  legacyTypology('commercial_block', 'Commercial Block', 'office', ['retail', 'office'], { retail: 0.35, office: 0.65 }, 4, 2, 8, 0.82),
  legacyTypology('commercial_office', 'Office Tower', 'office', ['office'], { office: 1 }, 12, 6, 24, 0.78),
  legacyTypology('industrial_workshop', 'Light Industrial Workshop', 'light-industrial', ['light-industrial'], { 'light-industrial': 1 }, 1, 1, 2, 0.90),
  legacyTypology('industrial_warehouse', 'Warehouse', 'logistics', ['logistics', 'light-industrial'], { logistics: 0.75, 'light-industrial': 0.25 }, 1, 1, 2, 0.92),
  legacyTypology('industrial_plant', 'Industrial Plant', 'heavy-industrial', ['heavy-industrial'], { 'heavy-industrial': 1 }, 2, 1, 4, 0.88),
  mixedTypology('main_street_mixed_use', 'Main Street Mixed Use', 'commercial_block', 5, 8, 0.80, 0.82),
  mixedTypology('podium_mixed_use', 'Podium Mixed Use', 'commercial_office', 12, 24, 0.76, 0.68),
]);

export const BUILDING_TYPOLOGY_BY_ID: Readonly<Record<string, BuildingTypology>> = Object.freeze(
  Object.fromEntries(BUILDING_TYPOLOGIES.map((typology) => [typology.id, typology])) as Record<string, BuildingTypology>,
);

export function getBuildingTypology(id: string): BuildingTypology {
  const result = BUILDING_TYPOLOGY_BY_ID[id];
  if (!result) throw new Error(`unknown building typology: ${id}`);
  return result;
}

export function typologyForLegacyDefinition(definitionId: string): BuildingTypology {
  return getBuildingTypology(`typology:${definitionId}`);
}

function legacyReferenceArea(definition: BuildingDefinition): number {
  const residentialArea = definition.residentCapacity > 0 ? definition.residentCapacity * 32 : 0;
  const jobArea = definition.jobCapacity > 0 ? definition.jobCapacity * 28 : 0;
  return Math.max(120, residentialArea + jobArea);
}