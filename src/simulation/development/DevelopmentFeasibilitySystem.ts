import { getBuildingDefinition, type BuildingDefinition, type BuildingIntensity } from '../../data/buildings.ts';
import { PARKING_PROFILES, QUALITY_PROFILES } from '../../data/urbanFabric.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';
import { clamp, clamp01 } from '../core/types.ts';
import type { ZoneType } from '../core/types.ts';
import {
  compareUrbanDevelopmentCandidates,
  urbanComponentsForDefinition,
  type UrbanDevelopmentCandidate,
} from '../urban/UrbanDevelopmentCandidate.ts';
import type { UrbanUse } from '../urban/UrbanTypes.ts';
import type { DevelopmentFeasibilityResult, DevelopmentParcelContext, DevelopmentUseMarketSignal } from './DevelopmentTypes.ts';

const INTENSITY_RANK: Readonly<Record<BuildingIntensity, number>> = Object.freeze({ low: 0, medium: 1, high: 2 });
const ZONE_BASE_LAND_VALUE: Readonly<Record<ZoneType, number>> = Object.freeze({
  residential: 12_000,
  commercial: 18_000,
  industrial: 10_000,
});
const AFFORDABLE_RENT_MULTIPLIER = 0.65;

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validateUseSignal(use: UrbanUse, signal: DevelopmentUseMarketSignal): void {
  requireFinite(`${use}.demand`, signal.demand);
  requireFinite(`${use}.taxRate`, signal.taxRate);
  requireFinite(`${use}.marketRentMultiplier`, signal.marketRentMultiplier);
  requireFinite(`${use}.marketVacancyRate`, signal.marketVacancyRate);
  if (signal.taxRate < 0) throw new Error(`${use}.taxRate must be non-negative`);
  if (signal.marketRentMultiplier <= 0) throw new Error(`${use}.marketRentMultiplier must be positive`);
  if (signal.marketVacancyRate < 0 || signal.marketVacancyRate >= 1) throw new Error(`${use}.marketVacancyRate must be within [0, 1)`);
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
  requireFinite('marketPressure', context.marketPressure);
  requireFinite('marketRentMultiplier', context.marketRentMultiplier);
  requireFinite('marketVacancyRate', context.marketVacancyRate);
  requireFinite('landValueMultiplier', context.landValueMultiplier);
  if (context.policyAffordableHousingShare !== undefined) requireFinite('policyAffordableHousingShare', context.policyAffordableHousingShare);
  if (context.policyDevelopmentFeeRate !== undefined) requireFinite('policyDevelopmentFeeRate', context.policyDevelopmentFeeRate);
  if (context.policyPermittingCostReduction !== undefined) requireFinite('policyPermittingCostReduction', context.policyPermittingCostReduction);
  if (context.taxRate < 0) throw new Error('taxRate must be non-negative');
  if (context.constructionCostIndex <= 0) throw new Error('constructionCostIndex must be positive');
  if (context.marketInterestRate < 0) throw new Error('marketInterestRate must be non-negative');
  if (context.marketPressure < 0 || context.marketPressure > 1.25) throw new Error('marketPressure must be within [0, 1.25]');
  if (context.marketRentMultiplier <= 0) throw new Error('marketRentMultiplier must be positive');
  if (context.marketVacancyRate < 0 || context.marketVacancyRate >= 1) throw new Error('marketVacancyRate must be within [0, 1)');
  if (context.landValueMultiplier <= 0) throw new Error('landValueMultiplier must be positive');
  if ((context.policyAffordableHousingShare ?? 0) < 0 || (context.policyAffordableHousingShare ?? 0) > 0.30) throw new Error('policyAffordableHousingShare must be within [0, 0.3]');
  if ((context.policyDevelopmentFeeRate ?? 0) < 0 || (context.policyDevelopmentFeeRate ?? 0) > 0.20) throw new Error('policyDevelopmentFeeRate must be within [0, 0.2]');
  if ((context.policyPermittingCostReduction ?? 0) < 0 || (context.policyPermittingCostReduction ?? 0) > 0.50) throw new Error('policyPermittingCostReduction must be within [0, 0.5]');
  if (!(context.zoningMaxIntensity in INTENSITY_RANK)) throw new Error('invalid zoningMaxIntensity');
  if (context.marketByUse) {
    validateUseSignal('residential', context.marketByUse.residential);
    validateUseSignal('commercial', context.marketByUse.commercial);
    validateUseSignal('industrial', context.marketByUse.industrial);
  }
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

function useSignal(context: DevelopmentParcelContext, use: UrbanUse): DevelopmentUseMarketSignal {
  return context.marketByUse?.[use] ?? {
    demand: context.demand,
    taxRate: context.taxRate,
    marketRentMultiplier: context.marketRentMultiplier,
    marketVacancyRate: context.marketVacancyRate,
  };
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

  evaluateUrbanCandidates(
    lot: Lot,
    candidates: readonly UrbanDevelopmentCandidate[],
    context: DevelopmentParcelContext,
  ): DevelopmentFeasibilityResult[] {
    validateContext(context);
    const results = candidates
      .slice()
      .sort(compareUrbanDevelopmentCandidates)
      .map((candidate) => this.evaluateUrbanCandidate(lot, candidate, context));
    this.evaluations = results.map((result) => ({ ...result, rejectionReasons: [...result.rejectionReasons] }));
    return results;
  }

  lastEvaluations(): DevelopmentFeasibilityResult[] {
    return this.evaluations.map((result) => ({ ...result, rejectionReasons: [...result.rejectionReasons] }));
  }

  private evaluateUrbanCandidate(
    lot: Lot,
    candidate: UrbanDevelopmentCandidate,
    context: DevelopmentParcelContext,
  ): DevelopmentFeasibilityResult {
    const definition = getBuildingDefinition(candidate.definitionId);
    validateDefinition(definition);
    const quality = QUALITY_PROFILES[candidate.qualityTier];
    const parking = PARKING_PROFILES[candidate.parkingProfile];
    const components = urbanComponentsForDefinition(definition.id);

    const personAccessibility = clamp01(context.personAccessibility);
    const freightAccessibility = clamp01(context.freightAccessibility);
    const serviceQuality = clamp01(context.serviceQuality);
    const utilityRatio = clamp01(context.utilityRatio);
    const affordableHousingShare = definition.zone === 'residential'
      ? clamp(context.policyAffordableHousingShare ?? 0, 0, 0.30)
      : 0;
    const developmentFeeRate = clamp(context.policyDevelopmentFeeRate ?? 0, 0, 0.20);
    const permittingCostReduction = clamp(context.policyPermittingCostReduction ?? 0, 0, 0.50);
    const accessScore = definition.zone === 'industrial'
      ? 0.75 * freightAccessibility + 0.25 * personAccessibility
      : 0.80 * personAccessibility + 0.20 * freightAccessibility;

    const parkingRentMultiplier = candidate.parkingProfile === 'reduced' && personAccessibility < 0.60
      ? 0.92 + (personAccessibility / 0.60) * 0.08
      : 1;
    let grossPotentialRent = 0;
    let weightedRent = 0;
    let weightedVacancy = 0;
    let propertyTaxes = 0;
    let rentableCapacity = 0;
    for (const component of components) {
      const signal = useSignal(context, component.use);
      const share = component.areaShareBps / 10_000;
      const componentCapacity = component.use === 'residential' ? component.residentCapacity : component.jobCapacity;
      const affordableFactor = component.use === 'residential'
        ? 1 - affordableHousingShare * (1 - AFFORDABLE_RENT_MULTIPLIER)
        : 1;
      const componentRent = definition.baseRent
        * clamp(signal.marketRentMultiplier, 0.50, 2.00)
        * quality.achievableRent
        * parkingRentMultiplier
        * affordableFactor;
      weightedRent += componentRent * share;
      const componentVacancy = clamp(signal.marketVacancyRate + (definition.baseVacancy - 0.10), 0.03, 0.35);
      weightedVacancy += componentVacancy * share;
      grossPotentialRent += componentRent * componentCapacity;
      propertyTaxes += component.taxBase * clamp(signal.taxRate, 0, 0.25);
      rentableCapacity += componentCapacity;
    }
    const achievableRent = weightedRent;
    const vacancyRate = weightedVacancy;
    rentableCapacity = Math.max(1, rentableCapacity);
    const effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate);
    const operatingExpenseRatio = clamp(definition.operatingExpenseRatio * quality.operatingExpense, 0, 0.95);
    const operatingExpenses = effectiveGrossIncome * operatingExpenseRatio;
    const netOperatingIncome = Math.max(0, effectiveGrossIncome - operatingExpenses - propertyTaxes);

    const baseHardConstructionCost = definition.baseConstructionCost
      * context.constructionCostIndex
      * definition.complexityFactor
      * quality.hardConstructionCost;
    const parkingCost = candidate.parkingSpaces * parking.constructionCostPerSpace;
    const hardConstructionCost = baseHardConstructionCost + parkingCost;
    const baseSoftCosts = hardConstructionCost * definition.softCostRatio;
    const softCosts = baseSoftCosts * (1 - permittingCostReduction);
    const deficiency = Math.max(0, 1 - Math.min(utilityRatio, serviceQuality, accessScore));
    const sitePreparationCost = hardConstructionCost * deficiency * 0.08;
    const developmentFee = (hardConstructionCost + softCosts) * developmentFeeRate;
    const landValue = ZONE_BASE_LAND_VALUE[definition.zone] * clamp(context.landValueMultiplier, 0.40, 2.00);
    const preFinanceDevelopmentCost = landValue + hardConstructionCost + softCosts + sitePreparationCost + developmentFee;
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
      - (hardConstructionCost + softCosts + sitePreparationCost + developmentFee + marketFinancingCost)
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
    const minimumAccess = clamp01(definition.minimumAccess + quality.minimumAccessBonus);
    const minimumServiceQuality = clamp01(definition.minimumServiceQuality + quality.minimumServiceBonus);
    if (!zoneMatches) rejectionReasons.push('zone-mismatch');
    if (!intensityAllowed) rejectionReasons.push('zoning-intensity');
    if (accessScore < minimumAccess) rejectionReasons.push('access');
    if (utilityRatio < definition.minimumUtilityRatio) rejectionReasons.push('utilities');
    if (serviceQuality < minimumServiceQuality) rejectionReasons.push('services');
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
      parkingCost,
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
      qualityTier: candidate.qualityTier,
      parkingProfile: candidate.parkingProfile,
      parkingSpaces: candidate.parkingSpaces,
      useMixKey: candidate.useMixKey,
    });
  }

  private evaluateCandidate(
    lot: Lot,
    definition: BuildingDefinition,
    context: DevelopmentParcelContext,
  ): DevelopmentFeasibilityResult {
    validateDefinition(definition);

    const personAccessibility = clamp01(context.personAccessibility);
    const freightAccessibility = clamp01(context.freightAccessibility);
    const serviceQuality = clamp01(context.serviceQuality);
    const utilityRatio = clamp01(context.utilityRatio);
    const taxRate = clamp(context.taxRate, 0, 0.25);
    const affordableHousingShare = definition.zone === 'residential'
      ? clamp(context.policyAffordableHousingShare ?? 0, 0, 0.30)
      : 0;
    const developmentFeeRate = clamp(context.policyDevelopmentFeeRate ?? 0, 0, 0.20);
    const permittingCostReduction = clamp(context.policyPermittingCostReduction ?? 0, 0, 0.50);

    const accessScore = definition.zone === 'industrial'
      ? 0.75 * freightAccessibility + 0.25 * personAccessibility
      : 0.80 * personAccessibility + 0.20 * freightAccessibility;
    const marketAchievableRent = definition.baseRent * clamp(context.marketRentMultiplier, 0.50, 2.00);
    const blendedRentFactor = 1 - affordableHousingShare * (1 - AFFORDABLE_RENT_MULTIPLIER);
    const achievableRent = marketAchievableRent * blendedRentFactor;
    const vacancyRate = clamp(
      context.marketVacancyRate + (definition.baseVacancy - 0.10),
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
    const baseSoftCosts = hardConstructionCost * definition.softCostRatio;
    const softCosts = baseSoftCosts * (1 - permittingCostReduction);
    const deficiency = Math.max(0, 1 - Math.min(utilityRatio, serviceQuality, accessScore));
    const sitePreparationCost = hardConstructionCost * deficiency * 0.08;
    const developmentFee = (hardConstructionCost + softCosts) * developmentFeeRate;
    const landValue = ZONE_BASE_LAND_VALUE[definition.zone] * clamp(context.landValueMultiplier, 0.40, 2.00);
    const preFinanceDevelopmentCost = landValue + hardConstructionCost + softCosts + sitePreparationCost + developmentFee;
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
      - (hardConstructionCost + softCosts + sitePreparationCost + developmentFee + marketFinancingCost)
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