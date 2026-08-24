import { clamp01 } from '../core/types.ts';

export type HousingIncomeBand = 'lower' | 'middle' | 'upper';
export type HousingTenure = 'renter' | 'owner';

export type HousingBandProfile = Readonly<{
  share: number;
  monthlyIncome: number;
  maxHousingBurden: number;
}>;

export type HousingQualityInputs = Readonly<{
  personAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
}>;

export const HOUSING_BANDS: readonly HousingIncomeBand[] = Object.freeze(['lower', 'middle', 'upper']);
export const HOUSING_ALLOCATION_ORDER: readonly HousingIncomeBand[] = Object.freeze(['upper', 'middle', 'lower']);
export const HOUSING_TENURES: readonly HousingTenure[] = Object.freeze(['renter', 'owner']);

export const HOUSING_BAND_PROFILES: Readonly<Record<HousingIncomeBand, HousingBandProfile>> = Object.freeze({
  lower: Object.freeze({ share: 0.45, monthlyIncome: 1_500, maxHousingBurden: 0.35 }),
  middle: Object.freeze({ share: 0.40, monthlyIncome: 2_600, maxHousingBurden: 0.32 }),
  upper: Object.freeze({ share: 0.15, monthlyIncome: 4_500, maxHousingBurden: 0.28 }),
});

export const DESIRED_TENURE_SHARES: Readonly<Record<HousingIncomeBand, Readonly<Record<HousingTenure, number>>>> = Object.freeze({
  lower: Object.freeze({ renter: 0.80, owner: 0.20 }),
  middle: Object.freeze({ renter: 0.50, owner: 0.50 }),
  upper: Object.freeze({ renter: 0.30, owner: 0.70 }),
});

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

export function housingBurden(monthlyCost: number, band: HousingIncomeBand): number {
  requireFiniteNonNegative('monthlyCost', monthlyCost);
  return monthlyCost / HOUSING_BAND_PROFILES[band].monthlyIncome;
}

export function housingAffordabilityScore(monthlyCost: number, band: HousingIncomeBand): number {
  const profile = HOUSING_BAND_PROFILES[band];
  const burden = housingBurden(monthlyCost, band);
  return clamp01((2 * profile.maxHousingBurden - burden) / profile.maxHousingBurden);
}

export function housingQualityScore(inputs: HousingQualityInputs): number {
  for (const [name, value] of Object.entries(inputs)) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  return clamp01(
    0.30 * clamp01(inputs.neighborhoodQuality)
    + 0.25 * clamp01(inputs.serviceQuality)
    + 0.25 * clamp01(inputs.personAccessibility)
    + 0.20 * clamp01(inputs.utilityRatio),
  );
}

export function housingTenurePreferenceScore(
  band: HousingIncomeBand,
  preferredTenure: HousingTenure,
  optionTenure: HousingTenure,
): number {
  return optionTenure === preferredTenure ? 1 : DESIRED_TENURE_SHARES[band][optionTenure];
}

export function housingCandidateScore(
  monthlyCost: number,
  band: HousingIncomeBand,
  preferredTenure: HousingTenure,
  optionTenure: HousingTenure,
  quality: HousingQualityInputs,
): number {
  return clamp01(
    0.55 * housingAffordabilityScore(monthlyCost, band)
    + 0.30 * housingQualityScore(quality)
    + 0.15 * housingTenurePreferenceScore(band, preferredTenure, optionTenure),
  );
}
