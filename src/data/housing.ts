import type { HousingProduct, HousingProductAllocation, MigrantArchetype } from '../simulation/housing/HousingTypes.ts';

export const HOUSING_CADENCE = Object.freeze({ conditions: 10, economics: 50, market: 100, redevelopment: 250 });

export const HOUSING_CONFIG = Object.freeze({
  targetOccupancy: 0.94,
  maxNormalRentChange: 0.03,
  severeVacancyRate: 0.25,
  maxSevereVacancyRentCut: 0.06,
  maxSalePriceChange: 0.04,
  comfortableBurden: 0.25,
  manageableBurden: 0.35,
  severeBurden: 0.50,
  maxNewMoveBurden: 0.50,
  downPaymentRatio: 0.20,
  transactionReserveRatio: 0.03,
  emergencyReserveMonths: 3,
  maxDebtServiceRatio: 0.35,
  mortgageTermYears: 30,
  ownerMoveFrictionBonus: 0.12,
  tenureMoveFrictionPerMarketCycle: 0.002,
  maxCandidateBuildings: 16,
  maxInboundHouseholdsPerMarketCycle: 24,
  outMigrationUnhousedCycles: 3,
  outMigrationSevereBurdenCycles: 4,
  cohortTargetMaxWeight: 40,
  salePriceToEffectiveRent: 60,
  sellingCostRatio: 0.06,
  demolitionCostRatio: 0.08,
  displacementCostPerHousehold: 800,
  unemployedWorkerFallbackIncome: 700,
  disposableIncomeRatio: 0.80,
  savingsRate: 0.05,
  savingsCapMonths: 24,
});

export const HOUSEHOLD_WAGE_BY_ARCHETYPE = Object.freeze({
  retail_local: 2_800,
  wholesale_logistics: 3_600,
  light_manufacturing: 4_200,
  assembly_manufacturing: 5_200,
} as const);

export const HOUSING_PRODUCT_OPTIONS: Readonly<Record<string, readonly HousingProduct[]>> = Object.freeze({
  residential_cottage: Object.freeze(['for_sale', 'rental'] as const),
  residential_rowhouse: Object.freeze(['rental', 'for_sale', 'mixed'] as const),
  residential_apartment: Object.freeze(['rental', 'mixed'] as const),
});

export const LEGACY_V7_PRODUCT_RULES = Object.freeze({
  residential_cottage: 'for_sale',
  residential_rowhouse: 'mixed',
  residential_apartment: 'rental',
} as const);

export const MIGRANT_ARCHETYPES: readonly MigrantArchetype[] = Object.freeze([
  Object.freeze({ householdSize: 1, workers: 1, vehicleAccess: false, tenurePreference: 'renter', savingsMonths: 1 }),
  Object.freeze({ householdSize: 2, workers: 1, vehicleAccess: true, tenurePreference: 'renter', savingsMonths: 2 }),
  Object.freeze({ householdSize: 3, workers: 2, vehicleAccess: true, tenurePreference: 'owner', savingsMonths: 3 }),
  Object.freeze({ householdSize: 4, workers: 2, vehicleAccess: true, tenurePreference: 'owner', savingsMonths: 4 }),
]);

export function defaultLegacyProductAllocation(definitionId: string, housingUnits: number): HousingProductAllocation {
  if (!Number.isInteger(housingUnits) || housingUnits < 0) throw new Error('housingUnits must be a non-negative integer');
  const product = LEGACY_V7_PRODUCT_RULES[definitionId as keyof typeof LEGACY_V7_PRODUCT_RULES];
  if (!product) throw new Error(`no legacy housing product rule for: ${definitionId}`);
  if (product === 'rental') return Object.freeze({ product, rentalUnits: housingUnits, forSaleUnits: 0 });
  if (product === 'for_sale') return Object.freeze({ product, rentalUnits: 0, forSaleUnits: housingUnits });
  const rentalUnits = Math.ceil(housingUnits / 2);
  return Object.freeze({ product, rentalUnits, forSaleUnits: housingUnits - rentalUnits });
}
