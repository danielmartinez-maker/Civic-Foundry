export type UtilityFacilityType = 'power' | 'water' | 'landfill' | 'power_substation' | 'water_pump';

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
  power_substation: Object.freeze({ id: 'power_substation', constructionCost: 24_000, operatingCost: 320, capacity: 1_440 }),
  water_pump: Object.freeze({ id: 'water_pump', constructionCost: 18_000, operatingCost: 260, capacity: 1_200 }),
});

export const UTILITY_CORRIDOR_CAPACITY = Object.freeze({
  power_distribution: Object.freeze({ 1: 180, 2: 360, 3: 720 }),
  power_transmission: Object.freeze({ 1: 720, 2: 1_440, 3: 2_880 }),
  water_main: Object.freeze({ 1: 150, 2: 300, 3: 600 }),
  water_trunk: Object.freeze({ 1: 600, 2: 1_200, 3: 2_400 }),
} as const);

export const UTILITY_CORRIDOR_COST = Object.freeze({
  power_distribution: Object.freeze({ 1: 120, 2: 210, 3: 380 }),
  power_transmission: Object.freeze({ 1: 300, 2: 520, 3: 900 }),
  water_main: Object.freeze({ 1: 100, 2: 180, 3: 330 }),
  water_trunk: Object.freeze({ 1: 260, 2: 450, 3: 780 }),
} as const);

export const UTILITY_CORRIDOR_OPERATING_COST = Object.freeze({
  power_distribution: Object.freeze({ 1: 1.0, 2: 1.6, 3: 2.5 }),
  power_transmission: Object.freeze({ 1: 1.8, 2: 2.8, 3: 4.3 }),
  water_main: Object.freeze({ 1: 0.8, 2: 1.3, 3: 2.1 }),
  water_trunk: Object.freeze({ 1: 1.5, 2: 2.4, 3: 3.7 }),
} as const);
