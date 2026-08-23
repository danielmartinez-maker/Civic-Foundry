import type { BuildingIntensity } from '../../data/buildings.ts';
import type { ZoneType } from '../core/types.ts';

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
}>;
