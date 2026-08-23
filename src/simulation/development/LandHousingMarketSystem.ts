import { clamp, clamp01, type ZoneType } from '../core/types.ts';

const ZONES: readonly ZoneType[] = ['residential', 'commercial', 'industrial'];
const BASE_MARKET_VACANCY: Readonly<Record<ZoneType, number>> = Object.freeze({
  residential: 0.12,
  commercial: 0.14,
  industrial: 0.13,
});

export type ZonePropertyMarketSnapshot = Readonly<{
  zone: ZoneType;
  marketPressure: number;
  rentIndex: number;
  vacancyRate: number;
  landValueIndex: number;
}>;

export type LandHousingMarketSnapshot = Readonly<{
  zones: Readonly<Record<ZoneType, ZonePropertyMarketSnapshot>>;
  housingPressure: number;
  housingRentIndex: number;
  housingVacancyRate: number;
}>;

export type LandHousingMarketInputs = Readonly<{
  demand: Readonly<Record<ZoneType, number>>;
  population: number;
  residentialCapacity: number;
  employmentUtilization: number;
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  utilityRatio: number;
}>;

export type ParcelMarketContext = Readonly<{
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
  frontageAccessBonus: number;
}>;

export type ParcelMarketSignal = Readonly<{
  marketPressure: number;
  marketRentMultiplier: number;
  marketVacancyRate: number;
  landValueMultiplier: number;
}>;

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new Error(`${name} must be non-negative`);
}

function validateInputs(inputs: LandHousingMarketInputs): void {
  nonNegative('population', inputs.population);
  nonNegative('residentialCapacity', inputs.residentialCapacity);
  finite('employmentUtilization', inputs.employmentUtilization);
  finite('personAccessibility', inputs.personAccessibility);
  finite('freightAccessibility', inputs.freightAccessibility);
  finite('serviceQuality', inputs.serviceQuality);
  finite('utilityRatio', inputs.utilityRatio);
  for (const zone of ZONES) finite(`${zone} demand`, inputs.demand[zone]);
}

function validateParcel(context: ParcelMarketContext): void {
  finite('personAccessibility', context.personAccessibility);
  finite('freightAccessibility', context.freightAccessibility);
  finite('serviceQuality', context.serviceQuality);
  finite('neighborhoodQuality', context.neighborhoodQuality);
  finite('utilityRatio', context.utilityRatio);
  finite('frontageAccessBonus', context.frontageAccessBonus);
}

function zoneSnapshot(
  zone: ZoneType,
  marketPressure: number,
  relevantAccess: number,
  serviceUtilityQuality: number,
): ZonePropertyMarketSnapshot {
  const pressure = clamp(marketPressure, 0, 1.25);
  const access = clamp01(relevantAccess);
  const quality = clamp01(serviceUtilityQuality);
  return Object.freeze({
    zone,
    marketPressure: pressure,
    rentIndex: clamp(0.72 + pressure * 0.55 + (access - 0.5) * 0.12, 0.65, 1.60),
    vacancyRate: clamp(BASE_MARKET_VACANCY[zone] + (0.70 - pressure) * 0.18, 0.03, 0.35),
    landValueIndex: clamp(0.65 + pressure * 0.70 + (access - 0.5) * 0.18 + (quality - 0.5) * 0.10, 0.55, 1.75),
  });
}

function emptySnapshot(): LandHousingMarketSnapshot {
  const residential = zoneSnapshot('residential', 0, 0, 0);
  const commercial = zoneSnapshot('commercial', 0, 0, 0);
  const industrial = zoneSnapshot('industrial', 0, 0, 0);
  return Object.freeze({
    zones: Object.freeze({ residential, commercial, industrial }),
    housingPressure: residential.marketPressure,
    housingRentIndex: residential.rentIndex,
    housingVacancyRate: residential.vacancyRate,
  });
}

export class LandHousingMarketSystem {
  private latest: LandHousingMarketSnapshot = emptySnapshot();

  evaluate(inputs: LandHousingMarketInputs): LandHousingMarketSnapshot {
    validateInputs(inputs);
    const personAccessibility = clamp01(inputs.personAccessibility);
    const freightAccessibility = clamp01(inputs.freightAccessibility);
    const serviceQuality = clamp01(inputs.serviceQuality);
    const utilityRatio = clamp01(inputs.utilityRatio);
    const employmentUtilization = clamp01(inputs.employmentUtilization);
    const serviceUtilityQuality = (serviceQuality + utilityRatio) / 2;
    const normalizedDemand = (zone: ZoneType) => clamp01((clamp(inputs.demand[zone], -1, 1) + 1) / 2);
    const housingUtilization = inputs.residentialCapacity <= 0
      ? (inputs.population > 0 ? 1.25 : 0)
      : clamp(inputs.population / inputs.residentialCapacity, 0, 1.25);

    const residentialPressure = clamp(
      0.55 * housingUtilization
      + 0.30 * normalizedDemand('residential')
      + 0.10 * personAccessibility
      + 0.05 * serviceUtilityQuality,
      0,
      1.25,
    );
    const commercialPressure = clamp(
      0.55 * normalizedDemand('commercial')
      + 0.20 * personAccessibility
      + 0.15 * employmentUtilization
      + 0.10 * serviceQuality,
      0,
      1.25,
    );
    const industrialPressure = clamp(
      0.55 * normalizedDemand('industrial')
      + 0.25 * freightAccessibility
      + 0.10 * employmentUtilization
      + 0.10 * utilityRatio,
      0,
      1.25,
    );

    const residential = zoneSnapshot('residential', residentialPressure, personAccessibility, serviceUtilityQuality);
    const commercial = zoneSnapshot('commercial', commercialPressure, personAccessibility, serviceUtilityQuality);
    const industrial = zoneSnapshot('industrial', industrialPressure, freightAccessibility, serviceUtilityQuality);
    this.latest = Object.freeze({
      zones: Object.freeze({ residential, commercial, industrial }),
      housingPressure: residential.marketPressure,
      housingRentIndex: residential.rentIndex,
      housingVacancyRate: residential.vacancyRate,
    });
    return this.latest;
  }

  parcelSignal(zone: ZoneType, context: ParcelMarketContext): ParcelMarketSignal {
    validateParcel(context);
    const market = this.latest.zones[zone];
    const personAccessibility = clamp01(context.personAccessibility);
    const freightAccessibility = clamp01(context.freightAccessibility);
    const serviceQuality = clamp01(context.serviceQuality);
    const neighborhoodQuality = clamp01(context.neighborhoodQuality);
    const utilityRatio = clamp01(context.utilityRatio);
    const frontageBonus = clamp(context.frontageAccessBonus, -0.15, 0.15);
    const relevantAccess = zone === 'industrial'
      ? 0.75 * freightAccessibility + 0.25 * personAccessibility
      : 0.80 * personAccessibility + 0.20 * freightAccessibility;
    const neighborhoodWeight = zone === 'industrial' ? 0.04 : 0.12;
    const localRentFactor = clamp(
      1
      + (relevantAccess - 0.5) * 0.30
      + (serviceQuality - 0.5) * 0.12
      + (neighborhoodQuality - 0.5) * neighborhoodWeight
      + (utilityRatio - 0.5) * 0.14
      + frontageBonus,
      0.65,
      1.35,
    );
    const localLandFactor = clamp(
      1
      + (relevantAccess - 0.5) * 0.38
      + (serviceQuality - 0.5) * 0.14
      + (neighborhoodQuality - 0.5) * (zone === 'industrial' ? 0.05 : 0.16)
      + (utilityRatio - 0.5) * 0.12
      + frontageBonus * 1.15,
      0.60,
      1.45,
    );
    const deficiencyPenalty = Math.max(0, 0.65 - relevantAccess) * 0.10
      + Math.max(0, 0.65 - serviceQuality) * 0.08
      + Math.max(0, 0.70 - utilityRatio) * 0.10
      + Math.max(0, 0.60 - neighborhoodQuality) * (zone === 'industrial' ? 0.02 : 0.05);
    const strengthReduction = Math.max(0, relevantAccess - 0.80) * 0.03
      + Math.max(0, serviceQuality - 0.80) * 0.02
      + Math.max(0, utilityRatio - 0.85) * 0.02
      + Math.max(0, frontageBonus) * 0.04;

    return Object.freeze({
      marketPressure: market.marketPressure,
      marketRentMultiplier: clamp(market.rentIndex * localRentFactor, 0.50, 2.00),
      marketVacancyRate: clamp(market.vacancyRate + deficiencyPenalty - strengthReduction, 0.03, 0.35),
      landValueMultiplier: clamp(market.landValueIndex * localLandFactor, 0.40, 2.00),
    });
  }

  snapshot(): LandHousingMarketSnapshot {
    return this.latest;
  }
}
