import type { BuildingDefinition, BuildingIntensity } from '../../data/buildings.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';
import { clamp, clamp01 } from '../core/types.ts';
import type { ZoneType } from '../core/types.ts';
import type { DevelopmentFeasibilityResult, DevelopmentParcelContext } from './DevelopmentTypes.ts';

const INTENSITY_RANK: Readonly<Record<BuildingIntensity, number>> = Object.freeze({ low: 0, medium: 1, high: 2 });
const ZONE_BASE_LAND_VALUE: Readonly<Record<ZoneType, number>> = Object.freeze({
  residential: 12_000,
  commercial: 18_000,
  industrial: 10_000,
});

function requireFinite(name: keyof DevelopmentParcelContext, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validateContext(context: DevelopmentParcelContext): void {
  requireFinite('demand', context.demand);
  requireFinite('taxRate', context.taxRate);
  requireFinite('personAccessibility', context.personAccessibility);
  requireFinite('freightAccessibility', context.freightAccessibility);
  requireFinite('serviceQuality', context.serviceQuality);
  requireFinite('neighborhoodQuality', context.neighborhoodQuality);
  requireFinite('utilityRatio', context.utilityRatio);
  requireFinite('constructionCostIndex', context.constructionCostIndex);
  requireFinite('marketInterestRate', context.marketInterestRate);
  if (context.taxRate < 0) throw new Error('taxRate must be non-negative');
  if (context.constructionCostIndex <= 0) throw new Error('constructionCostIndex must be positive');
  if (context.marketInterestRate < 0) throw new Error('marketInterestRate must be non-negative');
  if (!(context.zoningMaxIntensity in INTENSITY_RANK)) throw new Error('invalid zoningMaxIntensity');
}

function validateDefinition(definition: BuildingDefinition): void {
  const positive: Array<readonly [string, number]> = [
    ['constructionTicks', definition.constructionTicks],
    ['baseConstructionCost', definition.baseConstructionCost],
    ['baseRent', definition.baseRent],
    ['baseCapRate', definition.baseCapRate],
    ['complexityFactor', definition.complexityFactor],
  ];
  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${definition.id}.${name} must be positive and finite`);
  }
}

export class DevelopmentFeasibilitySystem {
  private evaluations: DevelopmentFeasibilityResult[] = [];

  evaluateLot(
    lot: Lot,
    definitions: readonly BuildingDefinition[],
    context: DevelopmentParcelContext,
  ): DevelopmentFeasibilityResult[] {
    validateContext(context);
    const results = definitions
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((definition) => this.evaluateCandidate(lot, definition, context));
    this.evaluations = results.map((result) => ({ ...result, rejectionReasons: [...result.rejectionReasons] }));
    return results;
  }

  lastEvaluations(): DevelopmentFeasibilityResult[] {
    return this.evaluations.map((result) => ({ ...result, rejectionReasons: [...result.rejectionReasons] }));
  }

  private evaluateCandidate(
    lot: Lot,
    definition: BuildingDefinition,
    context: DevelopmentParcelContext,
  ): DevelopmentFeasibilityResult {
    validateDefinition(definition);

    const demand = clamp(context.demand, -1, 1);
    const personAccessibility = clamp01(context.personAccessibility);
    const freightAccessibility = clamp01(context.freightAccessibility);
    const serviceQuality = clamp01(context.serviceQuality);
    const neighborhoodQuality = clamp01(context.neighborhoodQuality);
    const utilityRatio = clamp01(context.utilityRatio);
    const taxRate = clamp(context.taxRate, 0, 0.25);

    const demandFactor = clamp(0.65 + ((demand + 1) / 2) * 0.85, 0.65, 1.50);
    const accessScore = definition.zone === 'industrial'
      ? 0.75 * freightAccessibility + 0.25 * personAccessibility
      : 0.80 * personAccessibility + 0.20 * freightAccessibility;
    const accessFactor = clamp(0.70 + accessScore * 0.60, 0.70, 1.30);
    const serviceFactor = clamp(0.75 + serviceQuality * 0.45, 0.75, 1.20);
    const utilityFactor = clamp(0.50 + utilityRatio * 0.50, 0.50, 1.00);
    const neighborhoodFactor = clamp(0.75 + neighborhoodQuality * 0.50, 0.75, 1.25);
    const achievableRent = definition.baseRent * demandFactor * accessFactor * serviceFactor * utilityFactor * neighborhoodFactor;

    const normalizedDemand = (demand + 1) / 2;
    const weakDemandPenalty = Math.max(0, 0.5 - normalizedDemand) * 0.18;
    const poorAccessPenalty = Math.max(0, 0.6 - accessScore) * 0.16;
    const servicePenalty = Math.max(0, 0.6 - serviceQuality) * 0.12;
    const strongDemandReduction = Math.max(0, normalizedDemand - 0.7) * 0.10;
    const vacancyRate = clamp(
      definition.baseVacancy + weakDemandPenalty + poorAccessPenalty + servicePenalty - strongDemandReduction,
      0.03,
      0.35,
    );

    const rentableCapacity = Math.max(1, definition.residentCapacity + definition.jobCapacity);
    const grossPotentialRent = achievableRent * rentableCapacity;
    const effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate);
    const operatingExpenses = effectiveGrossIncome * definition.operatingExpenseRatio;
    const propertyTaxes = definition.taxBase * taxRate;
    const netOperatingIncome = Math.max(0, effectiveGrossIncome - operatingExpenses - propertyTaxes);

    const hardConstructionCost = definition.baseConstructionCost * context.constructionCostIndex * definition.complexityFactor;
    const softCosts = hardConstructionCost * definition.softCostRatio;
    const deficiency = Math.max(0, 1 - Math.min(utilityRatio, serviceQuality, accessScore));
    const sitePreparationCost = hardConstructionCost * deficiency * 0.08;
    const landValue = ZONE_BASE_LAND_VALUE[definition.zone] * demandFactor * accessFactor * serviceFactor * neighborhoodFactor;
    const preFinanceDevelopmentCost = landValue + hardConstructionCost + softCosts + sitePreparationCost;
    const neutralDebt = preFinanceDevelopmentCost * 0.55;
    const durationYears = definition.constructionTicks / 250;
    const marketFinancingCost = neutralDebt * context.marketInterestRate * durationYears;
    const totalDevelopmentCost = preFinanceDevelopmentCost + marketFinancingCost;
    const capRate = clamp(definition.baseCapRate + definition.riskWeight * 0.015 + (1 - accessScore) * 0.01, 0.045, 0.11);
    const stabilizedValue = netOperatingIncome / capRate;
    const yieldOnCost = totalDevelopmentCost > 0 ? netOperatingIncome / totalDevelopmentCost : 0;
    const returnOnCost = totalDevelopmentCost > 0 ? (stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost : -1;
    const requiredDeveloperProfit = preFinanceDevelopmentCost * 0.10;
    const residualLandValue = stabilizedValue
      - (hardConstructionCost + softCosts + sitePreparationCost + marketFinancingCost)
      - requiredDeveloperProfit;
    const riskScore = clamp01(
      definition.riskWeight * 0.50
      + vacancyRate * 0.80
      + (1 - accessScore) * 0.30
      + (1 - utilityRatio) * 0.25
      + (1 - serviceQuality) * 0.15,
    );

    const rejectionReasons: string[] = [];
    const zoneMatches = definition.zone === lot.zone;
    const intensityAllowed = INTENSITY_RANK[definition.intensity] <= INTENSITY_RANK[context.zoningMaxIntensity];
    if (!zoneMatches) rejectionReasons.push('zone-mismatch');
    if (!intensityAllowed) rejectionReasons.push('zoning-intensity');
    if (accessScore < definition.minimumAccess) rejectionReasons.push('access');
    if (utilityRatio < definition.minimumUtilityRatio) rejectionReasons.push('utilities');
    if (serviceQuality < definition.minimumServiceQuality) rejectionReasons.push('services');
    if (netOperatingIncome <= 0) rejectionReasons.push('non-positive-noi');
    if (residualLandValue < landValue) rejectionReasons.push('residual-land-value');

    const legal = zoneMatches && intensityAllowed;
    const feasible = legal && rejectionReasons.length === 0;

    return Object.freeze({
      lotId: lot.id,
      definitionId: definition.id,
      zone: definition.zone,
      legal,
      feasible,
      landValue,
      accessScore,
      achievableRent,
      rentableCapacity,
      grossPotentialRent,
      vacancyRate,
      effectiveGrossIncome,
      operatingExpenses,
      propertyTaxes,
      netOperatingIncome,
      hardConstructionCost,
      softCosts,
      sitePreparationCost,
      preFinanceDevelopmentCost,
      marketFinancingCost,
      totalDevelopmentCost,
      capRate,
      stabilizedValue,
      yieldOnCost,
      returnOnCost,
      residualLandValue,
      riskScore,
      rejectionReasons: Object.freeze(rejectionReasons),
    });
  }
}
