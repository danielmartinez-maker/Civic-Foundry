export type UtilityFacilityType = 'power' | 'water' | 'landfill';

export type UtilityDefinition = Readonly<{
  id: UtilityFacilityType;
  constructionCost: number;
  operatingCost: number;
  capacity: number;
}>;

export const UTILITY_DEFINITIONS: Readonly<Record<UtilityFacilityType, UtilityDefinition>> = Object.freeze({
  power: Object.freeze({ id: 'power', constructionCost: 18_000, operatingCost: 260, capacity: 180 }),
  water: Object.freeze({ id: 'water', constructionCost: 12_000, operatingCost: 170, capacity: 150 }),
  landfill: Object.freeze({ id: 'landfill', constructionCost: 10_000, operatingCost: 140, capacity: 90 }),
});
