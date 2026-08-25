import { BUILDING_DEFINITION_BY_ID, type BuildingDefinition } from './buildings.ts';
import type { BuildingTypology } from '../simulation/buildings/BuildingTypes.ts';
import type { UseType } from '../simulation/zoning/ZoningTypes.ts';

const DEFAULT_JOB_AREA: Readonly<Partial<Record<UseType, number>>> = Object.freeze({
  retail: 35,
  office: 22,
  hospitality: 45,
  'light-industrial': 55,
  'heavy-industrial': 85,
  logistics: 110,
  civic: 40,
});

function legacyTypology(
  definitionId: string,
  permittedUses: readonly UseType[],
  preferredStories: number,
  efficiencyRatio: number,
): BuildingTypology {
  const definition = BUILDING_DEFINITION_BY_ID[definitionId];
  if (!definition) throw new Error(`unknown legacy definition: ${definitionId}`);
  const assumedAreaM2 = legacyReferenceArea(definition);
  return Object.freeze({
    id: `typology:${definitionId}`,
    legacyDefinitionId: definitionId,
    permittedUses: Object.freeze([...permittedUses]),
    preferredStories,
    floorToFloorHeightMeters: preferredStories >= 8 ? 3.4 : 3.2,
    efficiencyRatio,
    costPerM2: definition.baseConstructionCost / assumedAreaM2,
    annualMaintenancePerM2: Math.max(1, definition.baseConstructionCost * 0.018 / assumedAreaM2),
    constructionTicks: definition.constructionTicks,
    complexityFactor: definition.complexityFactor,
    averageResidentialUnitM2: 82,
    jobAreaPerEmployeeM2: DEFAULT_JOB_AREA,
    powerDemandPerM2: definition.powerDemand / assumedAreaM2,
    waterDemandPerM2: definition.waterDemand / assumedAreaM2,
    garbagePerM2: definition.garbageGeneration / assumedAreaM2,
    taxBasePerM2: definition.taxBase / assumedAreaM2,
    baseRentPerM2: definition.baseRent / assumedAreaM2,
    operatingExpenseRatio: definition.operatingExpenseRatio,
    baseVacancy: definition.baseVacancy,
    baseCapRate: definition.baseCapRate,
    conversionSuitability: definition.zone === 'industrial' ? 0.45 : 0.7,
  });
}

function mixedTypology(
  id: string,
  seedDefinitionId: string,
  preferredStories: number,
  efficiencyRatio: number,
  conversionSuitability: number,
): BuildingTypology {
  const seed = legacyTypology(seedDefinitionId, ['residential', 'retail', 'office'], preferredStories, efficiencyRatio);
  return Object.freeze({
    ...seed,
    id,
    permittedUses: Object.freeze(['residential', 'retail', 'office'] as const),
    preferredStories,
    efficiencyRatio,
    conversionSuitability,
  });
}

export const BUILDING_TYPOLOGIES: readonly BuildingTypology[] = Object.freeze([
  legacyTypology('residential_cottage', ['residential'], 2, 0.86),
  legacyTypology('residential_rowhouse', ['residential'], 3, 0.84),
  legacyTypology('residential_apartment', ['residential'], 8, 0.80),
  legacyTypology('commercial_shop', ['retail'], 1, 0.88),
  legacyTypology('commercial_block', ['retail', 'office'], 4, 0.82),
  legacyTypology('commercial_office', ['office'], 12, 0.78),
  legacyTypology('industrial_workshop', ['light-industrial'], 1, 0.90),
  legacyTypology('industrial_warehouse', ['logistics', 'light-industrial'], 1, 0.92),
  legacyTypology('industrial_plant', ['heavy-industrial'], 2, 0.88),
  mixedTypology('main_street_mixed_use', 'commercial_block', 5, 0.80, 0.82),
  mixedTypology('podium_mixed_use', 'commercial_office', 12, 0.76, 0.68),
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
