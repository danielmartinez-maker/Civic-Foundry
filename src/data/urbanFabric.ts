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
}>;

export const QUALITY_PROFILES: Readonly<Record<BuildingQualityTier, BuildingQualityProfile>> = Object.freeze({
  economy: Object.freeze({ hardConstructionCost: 0.90, achievableRent: 0.90, operatingExpense: 0.95, conditionResilience: 0.85, accessThresholdBonus: 0, serviceThresholdBonus: 0 }),
  standard: Object.freeze({ hardConstructionCost: 1.00, achievableRent: 1.00, operatingExpense: 1.00, conditionResilience: 1.00, accessThresholdBonus: 0, serviceThresholdBonus: 0 }),
  premium: Object.freeze({ hardConstructionCost: 1.18, achievableRent: 1.16, operatingExpense: 1.05, conditionResilience: 1.15, accessThresholdBonus: 0.05, serviceThresholdBonus: 0.05 }),
  luxury: Object.freeze({ hardConstructionCost: 1.40, achievableRent: 1.32, operatingExpense: 1.10, conditionResilience: 1.25, accessThresholdBonus: 0.10, serviceThresholdBonus: 0.10 }),
});

export const QUALITY_RANK: Readonly<Record<BuildingQualityTier, number>> = Object.freeze({
  economy: 0, standard: 1, premium: 2, luxury: 3,
});

export type ParkingProfileDefinition = Readonly<{
  spaceMultiplier: number;
  costPerSpace: number;
}>;

export const PARKING_PROFILE_DEFINITIONS: Readonly<Record<PrivateParkingProfile, ParkingProfileDefinition>> = Object.freeze({
  'legacy-none': Object.freeze({ spaceMultiplier: 0, costPerSpace: 0 }),
  reduced: Object.freeze({ spaceMultiplier: 0.50, costPerSpace: 2_500 }),
  standard: Object.freeze({ spaceMultiplier: 1.00, costPerSpace: 3_000 }),
  abundant: Object.freeze({ spaceMultiplier: 1.50, costPerSpace: 3_500 }),
  structured: Object.freeze({ spaceMultiplier: 1.00, costPerSpace: 9_000 }),
});

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
