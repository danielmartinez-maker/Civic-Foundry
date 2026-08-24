import type { BuildingIntensity } from '../../data/buildings.ts';
import type { ZoneType } from '../core/types.ts';

export type DevelopmentPolicyState = Readonly<{
  densityBonus: 0 | 1;
  affordableHousingShare: number;
  developmentFeeRate: number;
  permittingCostReduction: number;
  redevelopmentAffordableFloor: number;
}>;

export type DevelopmentPolicyPatch = Partial<DevelopmentPolicyState>;

const INTENSITIES: readonly BuildingIntensity[] = ['low', 'medium', 'high'];
const DEFAULT_STATE: DevelopmentPolicyState = Object.freeze({
  densityBonus: 0,
  affordableHousingShare: 0,
  developmentFeeRate: 0,
  permittingCostReduction: 0,
  redevelopmentAffordableFloor: 0.85,
});

function requireRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be within [${min}, ${max}]`);
  }
  return value;
}

function validate(state: DevelopmentPolicyState): DevelopmentPolicyState {
  if (state.densityBonus !== 0 && state.densityBonus !== 1) throw new Error('densityBonus must be 0 or 1');
  requireRange('affordableHousingShare', state.affordableHousingShare, 0, 0.30);
  requireRange('developmentFeeRate', state.developmentFeeRate, 0, 0.20);
  requireRange('permittingCostReduction', state.permittingCostReduction, 0, 0.50);
  requireRange('redevelopmentAffordableFloor', state.redevelopmentAffordableFloor, 0.75, 1);
  return Object.freeze({ ...state });
}

export class DevelopmentPolicySystem {
  private state: DevelopmentPolicyState = DEFAULT_STATE;

  snapshot(): DevelopmentPolicyState {
    return Object.freeze({ ...this.state });
  }

  update(patch: DevelopmentPolicyPatch): DevelopmentPolicyState {
    this.state = validate({ ...this.state, ...patch });
    return this.snapshot();
  }

  restore(state: DevelopmentPolicyState): DevelopmentPolicyState {
    this.state = validate({ ...state });
    return this.snapshot();
  }

  adjustMaxIntensity(zone: ZoneType, base: BuildingIntensity): BuildingIntensity {
    if (zone !== 'residential' || this.state.densityBonus === 0) return base;
    const index = INTENSITIES.indexOf(base);
    return INTENSITIES[Math.min(INTENSITIES.length - 1, index + this.state.densityBonus)]!;
  }

  residentialRentFactor(): number {
    // Mandated affordable capacity is modeled at 65% of market rent; the citywide
    // blended factor is used consistently by housing choice and new-project underwriting.
    return 1 - this.state.affordableHousingShare * 0.35;
  }
}
