import type { BuildingDefinition, BuildingIntensity } from '../../data/buildings.ts';
import { getBuildingTypology } from '../../data/buildingTypologies.ts';
import type { DevelopmentCandidate } from '../buildings/BuildingTypes.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';
import { clamp, clamp01 } from '../core/types.ts';
import type { ZoneType } from '../core/types.ts';
import type { UseType } from '../zoning/ZoningTypes.ts';
import type {
  DevelopmentFeasibilityResult,
  DevelopmentParcelContext,
  PhysicalDevelopmentContext,
  PhysicalDevelopmentFeasibilityResult,
} from './DevelopmentTypes.ts';

const INTENSITY_RANK: Readonly<Record<BuildingIntensity, number>> = Object.freeze({ low: 0, medium: 1, high: 2 });
const ZONE_BASE_LAND_VALUE: Readonly<Record<ZoneType, number>> = Object.freeze({
  residential: 12_000,
  commercial: 18_000,
  industrial: 10_000,
});
const AFFORDABLE_RENT_MULTIPLIER = 0.65;
const PHYSICAL_SOFT_COST_RATIO = 0.15;

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

function validatePhysicalContext(context: PhysicalDevelopmentContext): void {
  const finiteValues: Array<readonly [string, number]> = [
    ['taxRate', context.taxRate],
    ['personAccessibility', context.personAccessibility],
    ['freightAccessibility', context.freightAccessibility],
    ['serviceQuality', context.serviceQuality],
    ['neighborhoodQuality', context.neighborhoodQuality],
    ['utilityRatio', context.utilityRatio],
    ['constructionCostIndex', context.constructionCostIndex],
    ['marketInterestRate', context.marketInterestRate],
    ['marketVacancyRate', context.marketVacancyRate],
    ['landValuePerM2', context.landValuePerM2],
    ['demolitionCost', context.demolitionCost],
    ['relocationCost', context.relocationCost],
    ['sitePreparationCost', context.sitePreparationCost],
    ['developerLeverage', context.developerLeverage],
    ['financingSpread', context.financingSpread],
  ];
  for (const [name, value] of finiteValues) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (context.taxRate < 0) throw new Error('taxRate must be non-negative');
  if (context.constructionCostIndex <= 0) throw new Error('constructionCostIndex must be positive');
  if (context.marketInterestRate < 0) throw new Error('marketInterestRate must be non-negative');
  if (context.marketVacancyRate < 0 || context.marketVacancyRate >= 1) throw new Error('marketVacancyRate must be within [0, 1)');
  if (context.landValuePerM2 < 0) throw new Error('landValuePerM2 must be non-negative');
  if (context.demolitionCost < 0 || context.relocationCost < 0 || context.sitePreparationCost < 0) {
    throw new Error('site costs must be non-negative');
  }
  if (context.developerLeverage < 0 || context.developerLeverage > 1) throw new Error('developerLeverage must be within [0, 1]');
  if (context.financingSpread < 0) throw new Error('financingSpread must be non-negative');
  for (const [use, rent] of Object.entries(context.marketRentPerM2ByUse)) {
    if (rent !== undefined && (!Number.isFinite(rent) || rent < 0)) throw new Error(`market rent for ${use} must be non-negative and finite`);
  }
  if ((context.policyAffordableHousingShare ?? 0) < 0 || (context.policyAffordableHousingShare ?? 0) > 0.30) throw new Error('policyAffordableHousingShare must be within [0, 0.3]');
  if ((context.policyDevelopmentFeeRate ?? 0) < 0 || (context.policyDevelopmentFeeRate ?? 0) > 0.20) throw new Error('policyDevelopmentFeeRate must be within [0, 0.2]');
  if ((context.policyPermittingCostReduction ?? 0) < 0 || (context.policyPermittingCostReduction ?? 0) > 0.50) throw new Error('policyPermittingCostReduction must be within [0, 0.5]');
}

function validatePhysicalCandidate(candidate: DevelopmentCandidate, parcel: Parcel): void {
  if (!candidate.parcelIds.includes(parcel.id)) throw new Error(`candidate does not include parcel: ${parcel.id}`);
  if (!Number.isFinite(candidate.grossFloorAreaM2) || candidate.grossFloorAreaM2 <= 0) throw new Error('grossFloorAreaM2 must be positive and finite');
  if (!Number.isFinite(candidate.usableFloorAreaM2) || candidate.usableFloorAreaM2 <= 0) throw new Error('usableFloorAreaM2 must be positive and finite');
  if (candidate.usableFloorAreaM2 > candidate.grossFloorAreaM2) throw new Error('usableFloorAreaM2 cannot exceed grossFloorAreaM2');
  if (!Number.isFinite(parcel.areaM2) || parcel.areaM2 <= 0) throw new Error('parcel area must be positive and finite');
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
      .map((definition) => this.evaluateLegacyCandidate(lot, definition, context));
    this.evaluations = results.map((result) => ({ ...result, rejectionReasons: [...result.rejectionReasons] }));
    return results;
  }

  evaluateCandidate(
    candidate: DevelopmentCandidate,
    parcel: Parcel,
    context: PhysicalDevelopmentContext,
  ): PhysicalDevelopmentFeasibilityResult {
    validatePhysicalContext(context);
    validatePhysicalCandidate(candidate, parcel);
    const typology = getBuildingTypology(candidate.typologyId);

    const personAccessibility = clamp01(context.personAccessibility);
    const freightAccessibility = clamp01(context.freightAccessibility);
    const serviceQuality = clamp01(context.serviceQuality);
    const utilityRatio = clamp01(context.utilityRatio);
    const taxRate = clamp(context.taxRate, 0, 0.25);
    const affordableHousingShare = candidate.uses.includes('residential')
      ? clamp(context.policyAffordableHousingShare ?? 0, 0, 0.30)
      : 0;
    const developmentFeeRate = clamp(context.policyDevelopmentFeeRate ?? 0, 0, 0.20);
    const permittingCostReduction = clamp(context.policyPermittingCostReduction ?? 0, 0, 0.50);
    const zone = zoneForUses(candidate.uses, typology.primaryUse);
    const industrial = zone === 'industrial';
    const accessScore = industrial
      ? 0.75 * freightAccessibility + 0.25 * personAccessibility
      : 0.80 * personAccessibility + 0.20 * freightAccessibility;

    let grossPotentialRent = 0;
    let allocatedUsableArea = 0;
    for (const floor of candidate.floors) {
      for (const allocation of floor.uses) {
        const marketRent = context.marketRentPerM2ByUse[allocation.use]
          ?? typology.baseRentPerM2ByUse[allocation.use]
          ?? 0;
        const affordableFactor = allocation.use === 'residential'
          ? 1 - affordableHousingShare * (1 - AFFORDABLE_RENT_MULTIPLIER)
          : 1;
        grossPotentialRent += allocation.floorAreaM2 * marketRent * affordableFactor;
        allocatedUsableArea += allocation.floorAreaM2;
      }
    }
    if (Math.abs(allocatedUsableArea - candidate.usableFloorAreaM2) > 0.01) {
      throw new Error('candidate floor allocations must conserve usable floor area');
    }

    const achievableRent = candidate.usableFloorAreaM2 > 0
      ? grossPotentialRent / candidate.usableFloorAreaM2
      : 0;
    const vacancyRate = clamp(context.marketVacancyRate + (typology.baseVacancy - 0.10), 0.03, 0.35);
    const effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate);
    const operatingExpenses = effectiveGrossIncome * typology.operatingExpenseRatio;

    const landValue = parcel.areaM2 * context.landValuePerM2;
    const hardConstructionCost = candidate.grossFloorAreaM2 * typology.costPerM2 * context.constructionCostIndex;
    const softCosts = hardConstructionCost * PHYSICAL_SOFT_COST_RATIO * (1 - permittingCostReduction);
    const improvementValue = hardConstructionCost + softCosts;
    const propertyTaxes = (landValue + improvementValue) * taxRate;
    const netOperatingIncome = Math.max(0, effectiveGrossIncome - operatingExpenses - propertyTaxes);
    const developmentFee = (hardConstructionCost + softCosts) * developmentFeeRate;
    const preFinanceDevelopmentCost = landValue
      + hardConstructionCost
      + softCosts
      + context.demolitionCost
      + context.relocationCost
      + context.sitePreparationCost
      + developmentFee;
    const constructionTicks = Math.max(
      1,
      Math.ceil(candidate.grossFloorAreaM2 / 1_000 * typology.constructionTicksPer1000M2),
    );
    const debtAmount = preFinanceDevelopmentCost * clamp01(context.developerLeverage);
    const durationYears = constructionTicks / 250;
    const financingRate = context.marketInterestRate + context.financingSpread;
    const marketFinancingCost = debtAmount * financingRate * durationYears;
    const totalDevelopmentCost = preFinanceDevelopmentCost + marketFinancingCost;
    const capRate = clamp(typology.baseCapRate + typology.riskWeight * 0.015 + (1 - accessScore) * 0.01, 0.045, 0.11);
    const stabilizedValue = netOperatingIncome / capRate;
    const yieldOnCost = totalDevelopmentCost > 0 ? netOperatingIncome / totalDevelopmentCost : 0;
    const returnOnCost = totalDevelopmentCost > 0 ? (stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost : -1;
    const requiredDeveloperProfit = preFinanceDevelopmentCost * 0.10;
    const residualLandValue = stabilizedValue
      - (hardConstructionCost
        + softCosts
        + context.demolitionCost
        + context.relocationCost
        + context.sitePreparationCost
        + developmentFee
        + marketFinancingCost)
      - requiredDeveloperProfit;
    const riskScore = clamp01(
      typology.riskWeight * 0.50
      + vacancyRate * 0.80
      + (1 - accessScore) * 0.30
      + (1 - utilityRatio) * 0.25
      + (1 - serviceQuality) * 0.15,
    );

    const rejectionReasons: string[] = [];
    if (!candidate.zoningLegal) rejectionReasons.push('zoning-compliance');
    if (accessScore < typology.minimumAccess) rejectionReasons.push('access');
    if (utilityRatio < typology.minimumUtilityRatio) rejectionReasons.push('utilities');
    if (serviceQuality < typology.minimumServiceQuality) rejectionReasons.push('services');
    if (netOperatingIncome <= 0) rejectionReasons.push('non-positive-noi');
    if (residualLandValue < landValue) rejectionReasons.push('residual-land-value');

    const legal = candidate.zoningLegal;
    const feasible = legal && rejectionReasons.length === 0;
    const definitionId = typology.legacyDefinitionId ?? typology.id;

    return Object.freeze({
      siteId: parcel.id,
      candidateId: candidate.id,
      typologyId: typology.id,
      grossFloorAreaM2: candidate.grossFloorAreaM2,
      usableFloorAreaM2: candidate.usableFloorAreaM2,
      improvementValue,
      demolitionCost: context.demolitionCost,
      relocationCost: context.relocationCost,
      constructionTicks,
      lotId: parcel.id,
      definitionId,
      zone,
      legal,
      feasible,
      landValue,
      accessScore,
      achievableRent,
      rentableCapacity: candidate.usableFloorAreaM2,
      grossPotentialRent,
      vacancyRate,
      effectiveGrossIncome,
      operatingExpenses,
      propertyTaxes,
      netOperatingIncome,
      hardConstructionCost,
      softCosts,
      sitePreparationCost: context.sitePreparationCost,
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

  lastEvaluations(): DevelopmentFeasibilityResult[] {
    return this.evaluations.map((result) => ({ ...result, rejectionReasons: [...result.rejectionReasons] }));
  }

  private evaluateLegacyCandidate(
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

function zoneForUses(uses: readonly UseType[], primaryUse: UseType): ZoneType {
  const use = uses.includes(primaryUse) ? primaryUse : uses[0] ?? primaryUse;
  if (use === 'residential') return 'residential';
  if (use === 'light-industrial' || use === 'heavy-industrial' || use === 'logistics') return 'industrial';
  return 'commercial';
}
