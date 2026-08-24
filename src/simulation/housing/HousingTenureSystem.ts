import type { BuildingIntensity } from '../../data/buildings.ts';
import { clamp } from '../core/types.ts';
import type { HousingTenure } from './HousingEconomics.ts';

const OWNER_SHARE_BY_INTENSITY: Readonly<Record<BuildingIntensity, number>> = Object.freeze({
  low: 0.60,
  medium: 0.40,
  high: 0.25,
});

const LOAN_TO_VALUE = 0.80;
const MORTGAGE_TERM_MONTHS = 360;
const ANNUAL_CARRYING_COST_RATE = 0.015;

export type HousingTenureBuildingInput = Readonly<{
  buildingId: string;
  intensity: BuildingIntensity;
  capacity: number;
  askingRent: number;
  personAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
}>;

export type HousingTenureOption = Readonly<{
  buildingId: string;
  tenure: HousingTenure;
  capacity: number;
  monthlyCost: number;
  monthlyRent?: number;
  impliedPurchasePrice?: number;
  personAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
}>;

export type BuildingTenureEconomics = Readonly<{
  buildingId: string;
  totalCapacity: number;
  rentalCapacity: number;
  ownershipCapacity: number;
  askingRent: number;
  impliedPurchasePrice: number;
  monthlyOwnerCost: number;
}>;

export type HousingTenureSnapshot = Readonly<{
  marketInterestRate: number;
  byBuilding: Readonly<Record<string, BuildingTenureEconomics>>;
  options: readonly HousingTenureOption[];
}>;

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

function validateInput(input: HousingTenureBuildingInput): void {
  if (input.buildingId.length === 0) throw new Error('buildingId must be non-empty');
  requireFiniteNonNegative('capacity', input.capacity);
  requireFiniteNonNegative('askingRent', input.askingRent);
  for (const [name, value] of Object.entries({
    personAccessibility: input.personAccessibility,
    serviceQuality: input.serviceQuality,
    neighborhoodQuality: input.neighborhoodQuality,
    utilityRatio: input.utilityRatio,
  })) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
}

function ownerEconomics(askingRent: number, marketInterestRate: number): Readonly<{
  impliedPurchasePrice: number;
  monthlyOwnerCost: number;
}> {
  const annualMarketRent = askingRent * 12;
  const capitalizationRate = clamp(0.045 + 0.40 * marketInterestRate, 0.05, 0.09);
  const impliedPurchasePrice = annualMarketRent / capitalizationRate;
  const principal = impliedPurchasePrice * LOAN_TO_VALUE;
  const monthlyRate = marketInterestRate / 12;
  const mortgagePayment = monthlyRate === 0
    ? principal / MORTGAGE_TERM_MONTHS
    : principal * monthlyRate * Math.pow(1 + monthlyRate, MORTGAGE_TERM_MONTHS)
      / (Math.pow(1 + monthlyRate, MORTGAGE_TERM_MONTHS) - 1);
  const monthlyCarryingCost = impliedPurchasePrice * ANNUAL_CARRYING_COST_RATE / 12;
  return Object.freeze({
    impliedPurchasePrice,
    monthlyOwnerCost: mortgagePayment + monthlyCarryingCost,
  });
}

function emptySnapshot(): HousingTenureSnapshot {
  return Object.freeze({
    marketInterestRate: 0,
    byBuilding: Object.freeze({}),
    options: Object.freeze([]),
  });
}

export class HousingTenureSystem {
  private latest: HousingTenureSnapshot = emptySnapshot();

  evaluate(
    marketInterestRate: number,
    inputs: readonly HousingTenureBuildingInput[],
  ): HousingTenureSnapshot {
    requireFiniteNonNegative('marketInterestRate', marketInterestRate);
    const sorted = inputs.slice().sort((a, b) => a.buildingId.localeCompare(b.buildingId));
    const seen = new Set<string>();
    const byBuilding: Record<string, BuildingTenureEconomics> = {};
    const options: HousingTenureOption[] = [];

    for (const input of sorted) {
      validateInput(input);
      if (seen.has(input.buildingId)) throw new Error(`duplicate buildingId: ${input.buildingId}`);
      seen.add(input.buildingId);

      const ownerShare = OWNER_SHARE_BY_INTENSITY[input.intensity];
      const ownershipCapacity = input.capacity * ownerShare;
      const rentalCapacity = input.capacity - ownershipCapacity;
      const economics = ownerEconomics(input.askingRent, marketInterestRate);

      byBuilding[input.buildingId] = Object.freeze({
        buildingId: input.buildingId,
        totalCapacity: input.capacity,
        rentalCapacity,
        ownershipCapacity,
        askingRent: input.askingRent,
        impliedPurchasePrice: economics.impliedPurchasePrice,
        monthlyOwnerCost: economics.monthlyOwnerCost,
      });

      const shared = {
        buildingId: input.buildingId,
        personAccessibility: input.personAccessibility,
        serviceQuality: input.serviceQuality,
        neighborhoodQuality: input.neighborhoodQuality,
        utilityRatio: input.utilityRatio,
      } as const;
      options.push(Object.freeze({
        ...shared,
        tenure: 'renter',
        capacity: rentalCapacity,
        monthlyCost: input.askingRent,
        monthlyRent: input.askingRent,
      }));
      options.push(Object.freeze({
        ...shared,
        tenure: 'owner',
        capacity: ownershipCapacity,
        monthlyCost: economics.monthlyOwnerCost,
        impliedPurchasePrice: economics.impliedPurchasePrice,
      }));
    }

    this.latest = Object.freeze({
      marketInterestRate,
      byBuilding: Object.freeze(byBuilding),
      options: Object.freeze(options),
    });
    return this.snapshot();
  }

  snapshot(): HousingTenureSnapshot {
    return Object.freeze({
      marketInterestRate: this.latest.marketInterestRate,
      byBuilding: Object.freeze(Object.fromEntries(
        Object.entries(this.latest.byBuilding).map(([id, item]) => [id, Object.freeze({ ...item })]),
      )),
      options: Object.freeze(this.latest.options.map((option) => Object.freeze({ ...option }))),
    });
  }
}
