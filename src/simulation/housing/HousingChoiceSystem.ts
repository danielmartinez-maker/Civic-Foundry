import { HOUSING_CONFIG } from '../../data/housing.ts';
import { clamp01 } from '../core/types.ts';
import type {
  HouseholdCohort,
  HousingCandidate,
  HousingChoiceContext,
  HousingChoiceResult,
  HousingUtilityComponents,
  MortgageQuote,
} from './HousingTypes.ts';

function paymentForPrincipal(principal: number, annualRate: number, years: number): number {
  const months = years * 12;
  if (principal <= 0) return 0;
  if (annualRate === 0) return principal / months;
  const monthlyRate = annualRate / 12;
  const factor = Math.pow(1 + monthlyRate, months);
  return principal * ((monthlyRate * factor) / (factor - 1));
}

function principalForPayment(payment: number, annualRate: number, years: number): number {
  const months = years * 12;
  if (payment <= 0) return 0;
  if (annualRate === 0) return payment * months;
  const monthlyRate = annualRate / 12;
  const factor = Math.pow(1 + monthlyRate, months);
  return payment * ((factor - 1) / (monthlyRate * factor));
}

export class HousingChoiceSystem {
  quoteMortgage(household: HouseholdCohort, annualRate: number, askingPrice: number): MortgageQuote {
    if (!Number.isFinite(annualRate) || annualRate < 0) throw new Error('mortgage rate must be non-negative and finite');
    if (!Number.isFinite(askingPrice) || askingPrice < 0) throw new Error('asking price must be non-negative and finite');

    const requiredDownPayment = askingPrice * HOUSING_CONFIG.downPaymentRatio;
    const transactionReserve = askingPrice * HOUSING_CONFIG.transactionReserveRatio;
    const emergencyReserve = HOUSING_CONFIG.emergencyReserveMonths * household.grossIncome;
    const principal = Math.max(0, askingPrice - requiredDownPayment);
    const scheduledPayment = paymentForPrincipal(principal, annualRate, HOUSING_CONFIG.mortgageTermYears);

    const rejectionReasons: string[] = [];
    if (requiredDownPayment + transactionReserve > household.liquidSavings) rejectionReasons.push('down-payment');
    if (household.grossIncome <= 0 || scheduledPayment / Math.max(1, household.grossIncome) > HOUSING_CONFIG.maxDebtServiceRatio) {
      rejectionReasons.push('debt-service');
    }
    if (household.liquidSavings - requiredDownPayment - transactionReserve < emergencyReserve) {
      rejectionReasons.push('emergency-reserve');
    }

    const maxPayment = Math.max(0, household.grossIncome * HOUSING_CONFIG.maxDebtServiceRatio);
    const maxPrincipal = principalForPayment(maxPayment, annualRate, HOUSING_CONFIG.mortgageTermYears);
    const paymentLimited = maxPrincipal / Math.max(0.01, 1 - HOUSING_CONFIG.downPaymentRatio);
    const cashLimited = household.liquidSavings / Math.max(0.01, HOUSING_CONFIG.downPaymentRatio);

    return Object.freeze({
      eligible: rejectionReasons.length === 0,
      principal,
      scheduledPayment,
      requiredDownPayment,
      transactionReserve,
      emergencyReserve,
      maximumAffordablePrice: Math.max(0, Math.min(paymentLimited, cashLimited)),
      rejectionReasons: Object.freeze(rejectionReasons),
    });
  }

  evaluateCandidate(household: HouseholdCohort, candidate: HousingCandidate, context: HousingChoiceContext): HousingChoiceResult {
    const rejectionReasons: string[] = [];
    if (candidate.availableUnits < household.unitRequirement) rejectionReasons.push('capacity');

    let housingCost = candidate.housingCost;
    let mortgage: MortgageQuote | null = null;
    if (candidate.tenure === 'owner') {
      mortgage = this.quoteMortgage(household, context.marketInterestRate, candidate.askingPrice);
      housingCost = mortgage.scheduledPayment;
      rejectionReasons.push(...mortgage.rejectionReasons);
    }

    const burden = housingCost <= 0 ? 0 : household.grossIncome <= 0 ? 1 : housingCost / household.grossIncome;
    if (context.voluntaryMove && burden > HOUSING_CONFIG.maxNewMoveBurden) rejectionReasons.push('housing-burden');

    const affordability = clamp01(1 - burden / Math.max(0.01, HOUSING_CONFIG.maxNewMoveBurden));
    const space = clamp01(candidate.residentsPerUnit / Math.max(1, household.householdSize));
    const commute = clamp01(candidate.accessibility);
    const services = clamp01(candidate.services);
    const neighborhood = clamp01((candidate.neighborhood + candidate.quality) / 2);
    const tenure = household.tenure === 'seeking' ? 0.8 : household.tenure === candidate.tenure ? 1 : 0.65;
    const vehicle = household.vehicleAccess ? 0.75 : commute;
    const preferredDensity = household.householdSize >= 4 ? 0.35 : household.householdSize === 1 ? 0.8 : 0.6;
    const density = clamp01(1 - Math.abs(clamp01(candidate.density) - preferredDensity));
    const stability = clamp01(household.employmentStability * 0.7 + candidate.quality * 0.3);
    const movingCost = context.voluntaryMove ? household.moveFriction : 0;
    const overcrowdingPenalty = clamp01(candidate.overcrowdingRatio);
    const displacementRisk = clamp01(candidate.displacementRisk);

    const components: HousingUtilityComponents = {
      affordability,
      space,
      commute,
      services,
      neighborhood,
      tenure,
      vehicle,
      density,
      stability,
      movingCost,
      overcrowdingPenalty,
      displacementRisk,
    };
    const preferences = household.preferences;
    const totalUtility =
      affordability * preferences.affordability +
      space * preferences.space +
      commute * preferences.commute +
      services * preferences.services +
      neighborhood * preferences.neighborhood +
      tenure * preferences.tenure +
      vehicle * (household.vehicleAccess ? 0.25 : 0.7) +
      density * preferences.density +
      stability * preferences.stability -
      movingCost -
      overcrowdingPenalty * 1.2 -
      displacementRisk;

    return Object.freeze({
      buildingId: candidate.buildingId,
      tenure: candidate.tenure,
      eligible: rejectionReasons.length === 0,
      totalUtility,
      housingCost,
      components: Object.freeze(components),
      rejectionReasons: Object.freeze([...new Set(rejectionReasons)]),
      mortgage,
    });
  }

  rankCandidates(household: HouseholdCohort, candidates: readonly HousingCandidate[], context: HousingChoiceContext): HousingChoiceResult[] {
    return candidates
      .map((candidate) => this.evaluateCandidate(household, candidate, context))
      .sort((a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.totalUtility - a.totalUtility ||
        a.buildingId.localeCompare(b.buildingId) ||
        a.tenure.localeCompare(b.tenure));
  }
}
