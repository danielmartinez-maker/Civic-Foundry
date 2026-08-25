import type { BuildingIntensity } from '../../data/buildings.ts';
import type { ZoneType } from '../core/types.ts';
import type { BuildingQualityTier, PrivateParkingProfile, UrbanUse } from '../urban/UrbanTypes.ts';

export type DevelopmentUseMarketSignal = Readonly<{
  demand: number;
  taxRate: number;
  marketRentMultiplier: number;
  marketVacancyRate: number;
}>;

export type DevelopmentParcelContext = Readonly<{
  demand: number;
  taxRate: number;
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
  constructionCostIndex: number;
  marketInterestRate: number;
  zoningMaxIntensity: BuildingIntensity;
  marketPressure: number;
  marketRentMultiplier: number;
  marketVacancyRate: number;
  landValueMultiplier: number;
  marketByUse?: Readonly<Record<UrbanUse, DevelopmentUseMarketSignal>>;
  policyAffordableHousingShare?: number;
  policyDevelopmentFeeRate?: number;
  policyPermittingCostReduction?: number;
}>;

export type DevelopmentSemanticTuple = Readonly<{
  qualityTier: BuildingQualityTier;
  parkingProfile: PrivateParkingProfile;
  parkingSpaces: number;
  useMixKey: string;
}>;

export type DevelopmentFeasibilityResult = Readonly<{
  lotId: string;
  definitionId: string;
  zone: ZoneType;
  legal: boolean;
  feasible: boolean;
  landValue: number;
  accessScore: number;
  achievableRent: number;
  rentableCapacity: number;
  grossPotentialRent: number;
  vacancyRate: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  propertyTaxes: number;
  netOperatingIncome: number;
  hardConstructionCost: number;
  parkingCost?: number;
  softCosts: number;
  sitePreparationCost: number;
  preFinanceDevelopmentCost: number;
  marketFinancingCost: number;
  totalDevelopmentCost: number;
  capRate: number;
  stabilizedValue: number;
  yieldOnCost: number;
  returnOnCost: number;
  residualLandValue: number;
  riskScore: number;
  rejectionReasons: readonly string[];
  qualityTier?: BuildingQualityTier;
  parkingProfile?: PrivateParkingProfile;
  parkingSpaces?: number;
  useMixKey?: string;
}>;

export type DeveloperPreferences = Readonly<Record<ZoneType, number>>;

export type DeveloperSeed = Readonly<{
  id: string;
  availableCapital: number;
  hurdleRate: number;
  maxLeverage: number;
  financingSpread: number;
  riskTolerance: number;
  maxConcurrentProjects: number;
  minimumProjectCost: number;
  preferences: DeveloperPreferences;
}>;

export type DeveloperState = DeveloperSeed & Readonly<{
  committedCapital: number;
}>;

export type DeveloperMarketContext = Readonly<{
  tick: number;
  marketInterestRate: number;
}>;

export type DevelopmentBid = DevelopmentSemanticTuple & Readonly<{
  id: string;
  lotId: string;
  definitionId: string;
  zone: ZoneType;
  developerId: string;
  expectedReturn: number;
  expectedReturnMargin: number;
  requiredEquity: number;
  financingCost: number;
  totalDevelopmentCost: number;
  preferenceBonus: number;
  capitalEfficiencyBonus: number;
  residualValueBonus: number;
  riskPenalty: number;
  rankScore: number;
  residualLandValue: number;
}>;

export type DevelopmentAward = DevelopmentBid & Readonly<{
  awardId: string;
  buildingId: string;
  awardTick: number;
  completionTick: number;
  releaseTick: number;
}>;

export type DeveloperCommitment = DevelopmentSemanticTuple & Readonly<{
  awardId: string;
  buildingId: string;
  lotId: string;
  definitionId: string;
  developerId: string;
  equity: number;
  awardTick: number;
  completionTick: number;
  releaseTick: number;
  expectedReturn: number;
}>;

export type DeveloperMarketStateSnapshot = Readonly<{
  developers: readonly DeveloperState[];
  commitments: readonly DeveloperCommitment[];
}>;