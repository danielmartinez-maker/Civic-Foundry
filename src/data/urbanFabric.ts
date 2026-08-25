import type {
  BuildingConditionBand,
  BuildingQualityTier,
  PrivateParkingProfile,
  UrbanLifecycleState,
} from '../simulation/urban/UrbanTypes.ts';

export const BUILDING_QUALITY_TIERS = Object.freeze([
  'economy', 'standard', 'premium', 'luxury',
] as const satisfies readonly BuildingQualityTier[]);

export const BUILDING_CONDITION_BANDS = Object.freeze([
  'new', 'maintained', 'aging', 'neglected', 'abandoned',
] as const satisfies readonly BuildingConditionBand[]);

export const PRIVATE_PARKING_PROFILES = Object.freeze([
  'legacy-none', 'reduced', 'standard', 'abundant', 'structured',
] as const satisfies readonly PrivateParkingProfile[]);

export const URBAN_LIFECYCLE_STATES = Object.freeze([
  'construction', 'lease-up', 'stabilized', 'aging', 'neglected', 'renovating', 'condemned', 'abandoned',
] as const satisfies readonly UrbanLifecycleState[]);

export type BuildingQualityProfile = Readonly<{
  hardConstructionCost: number;
  achievableRent: number;
  operatingExpense: number;
  conditionResilience: number;
  accessThresholdBonus: number;
  serviceThresholdBonus: number;
  minimumAccessBonus: number;
  minimumServiceBonus: number;
}>;

function qualityProfile(
  hardConstructionCost: number,
  achievableRent: number,
  operatingExpense: number,
  conditionResilience: number,
  accessThresholdBonus: number,
  serviceThresholdBonus: number,
): BuildingQualityProfile {
  return Object.freeze({
    hardConstructionCost,
    achievableRent,
    operatingExpense,
    conditionResilience,
    accessThresholdBonus,
    serviceThresholdBonus,
    minimumAccessBonus: accessThresholdBonus,
    minimumServiceBonus: serviceThresholdBonus,
  });
}

export const QUALITY_PROFILES: Readonly<Record<BuildingQualityTier, BuildingQualityProfile>> = Object.freeze({
  economy: qualityProfile(0.90, 0.90, 0.95, 0.85, 0, 0),
  standard: qualityProfile(1.00, 1.00, 1.00, 1.00, 0, 0),
  premium: qualityProfile(1.18, 1.16, 1.05, 1.15, 0.05, 0.05),
  luxury: qualityProfile(1.40, 1.32, 1.10, 1.25, 0.10, 0.10),
});

export const QUALITY_RANK: Readonly<Record<BuildingQualityTier, number>> = Object.freeze({
  economy: 0, standard: 1, premium: 2, luxury: 3,
});

export type ParkingProfileDefinition = Readonly<{
  spaceMultiplier: number;
  costPerSpace: number;
  spacesMultiplier: number;
  constructionCostPerSpace: number;
}>;

function parkingProfile(spaceMultiplier: number, costPerSpace: number): ParkingProfileDefinition {
  return Object.freeze({
    spaceMultiplier,
    costPerSpace,
    spacesMultiplier: spaceMultiplier,
    constructionCostPerSpace: costPerSpace,
  });
}

export const PARKING_PROFILE_DEFINITIONS: Readonly<Record<PrivateParkingProfile, ParkingProfileDefinition>> = Object.freeze({
  'legacy-none': parkingProfile(0, 0),
  reduced: parkingProfile(0.50, 2_500),
  standard: parkingProfile(1.00, 3_000),
  abundant: parkingProfile(1.50, 3_500),
  structured: parkingProfile(1.00, 9_000),
});

// Task 4 development code consumes the concise name; both exports reference the same immutable table.
export const PARKING_PROFILES = PARKING_PROFILE_DEFINITIONS;

export const PARKING_RANK: Readonly<Record<PrivateParkingProfile, number>> = Object.freeze({
  'legacy-none': -1, reduced: 0, standard: 1, abundant: 2, structured: 3,
});

export const URBAN_CONDITION_CADENCE_TICKS = 100;

export function conditionBandForScore(score: number): BuildingConditionBand {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('condition score must be finite within [0, 100]');
  if (score >= 90) return 'new';
  if (score >= 70) return 'maintained';
  if (score >= 50) return 'aging';
  if (score >= 25) return 'neglected';
  return 'abandoned';
}

export function deterministicParkingSpaces(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('parking-space input must be finite and non-negative');
  return Math.max(0, Math.round(value));
}
