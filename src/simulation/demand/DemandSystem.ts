import type { TaxRates } from '../tax/TaxSystem.ts';
import { clamp } from '../core/types.ts';

export type DemandInputs = Readonly<{
  population: number;
  housingCapacity: number;
  workforce: number;
  employed: number;
  totalJobs: number;
  powerRatio: number;
  waterRatio: number;
  garbageRatio: number;
  taxRates: TaxRates;
  trafficJobAccessibility: number;
  trafficCommercialAccessibility: number;
  serviceQuality?: number;
  commercialServiceQuality?: number;
}>;

export type DemandSnapshot = Readonly<{ residential: number; commercial: number; industrial: number }>;

function taxSignal(rate: number): number {
  return clamp((0.18 - rate) / 0.18, -1, 1);
}

export class DemandSystem {
  evaluate(input: DemandInputs): DemandSnapshot {
    const service = clamp((input.powerRatio + input.waterRatio + input.garbageRatio) / 3, 0, 1) * 2 - 1;
    const housingPressure = input.housingCapacity <= 0 ? 1 : clamp((input.population + 4 - input.housingCapacity) / Math.max(4, input.housingCapacity), -1, 1);
    const employmentQuality = input.workforce <= 0 ? 0.5 : clamp(input.employed / Math.max(1, input.workforce), 0, 1) * 2 - 1;
    const jobAvailability = input.workforce <= 0 ? 0.5 : clamp((input.totalJobs - input.workforce) / Math.max(4, input.workforce), -1, 1);
    const commercialSupply = clamp((input.population * 0.45 - input.totalJobs * 0.25) / Math.max(4, input.population), -1, 1);
    const serviceQuality = clamp(input.serviceQuality ?? 0.7, 0, 1);
    const commercialServiceQuality = clamp(input.commercialServiceQuality ?? serviceQuality, 0, 1);
    const residentialServiceModifier = clamp((serviceQuality - 0.70) * 0.50, -0.25, 0.15);
    const commercialServiceModifier = clamp((commercialServiceQuality - 0.70) * 0.35, -0.20, 0.10);
    const industrialStarter = input.totalJobs < Math.max(6, input.population * 0.35) ? 0.8 : -0.1;

    const residential = 0.3 * housingPressure + 0.25 * employmentQuality + 0.2 * service + 0.15 * taxSignal(input.taxRates.residential) + 0.1 * (input.trafficJobAccessibility * 2 - 1) + residentialServiceModifier;
    const commercial = 0.35 * commercialSupply + 0.2 * service + 0.15 * taxSignal(input.taxRates.commercial) + 0.15 * employmentQuality + 0.15 * (input.trafficCommercialAccessibility * 2 - 1) + commercialServiceModifier;
    const industrial = 0.35 * industrialStarter + 0.2 * service + 0.15 * taxSignal(input.taxRates.industrial) + 0.15 * jobAvailability + 0.15 * employmentQuality;

    return {
      residential: clamp(residential, -1, 1),
      commercial: clamp(commercial, -1, 1),
      industrial: clamp(industrial, -1, 1),
    };
  }
}
