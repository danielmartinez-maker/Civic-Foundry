import { HOUSING_CONFIG } from '../../data/housing.ts';
import type {
  HouseholdAffordabilityState,
  HouseholdCohort,
  HouseholdCreateInput,
  HouseholdPreferenceWeights,
  HouseholdStateSnapshot,
  HouseholdTenure,
  MortgageProxy,
} from './HousingTypes.ts';

type MutableHousehold = { -readonly [K in keyof HouseholdCohort]: HouseholdCohort[K] };

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function cloneMortgage(value: MortgageProxy | null): MortgageProxy | null {
  return value ? { ...value } : null;
}

function clonePreferences(value: HouseholdPreferenceWeights): HouseholdPreferenceWeights {
  return { ...value };
}

function cloneHousehold(value: HouseholdCohort): HouseholdCohort {
  return {
    ...value,
    employerFirmIds: [...value.employerFirmIds],
    mortgage: cloneMortgage(value.mortgage),
    preferences: clonePreferences(value.preferences),
  };
}

function burdenState(burden: number): HouseholdAffordabilityState {
  if (burden < HOUSING_CONFIG.comfortableBurden) return 'comfortable';
  if (burden < HOUSING_CONFIG.manageableBurden) return 'manageable';
  if (burden < HOUSING_CONFIG.severeBurden) return 'stressed';
  return 'severe';
}

function calculateBurden(housingCost: number, grossIncome: number): number {
  if (housingCost <= 0) return 0;
  if (grossIncome <= 0) return 1;
  return Math.max(0, housingCost / grossIncome);
}

function defaultPreferences(input: Pick<HouseholdCreateInput, 'householdSize' | 'vehicleAccess' | 'tenure'>): HouseholdPreferenceWeights {
  return Object.freeze({
    affordability: input.tenure === 'seeking' ? 1.25 : 1.15,
    commute: input.vehicleAccess ? 0.85 : 1.20,
    services: 0.80,
    neighborhood: 0.80,
    space: Math.min(1.30, 0.85 + input.householdSize * 0.10),
    density: input.householdSize >= 4 ? 0.45 : 0.65,
    tenure: 1.00,
    stability: 0.75,
  });
}

function validateMortgage(mortgage: MortgageProxy | null, prefix: string): void {
  if (!mortgage) return;
  for (const [name, value] of Object.entries(mortgage)) finite(`${prefix}.${name}`, value);
  if (mortgage.originalPrincipal < 0 || mortgage.remainingPrincipal < 0 || mortgage.remainingPrincipal > mortgage.originalPrincipal) {
    throw new Error(`${prefix} principal is invalid`);
  }
  if (mortgage.annualRate < 0 || mortgage.scheduledPayment < 0 || !Number.isInteger(mortgage.purchaseTick) || mortgage.purchaseTick < 0) {
    throw new Error(`${prefix} terms are invalid`);
  }
}

function validatePreferences(preferences: HouseholdPreferenceWeights, prefix: string): void {
  for (const [name, value] of Object.entries(preferences)) {
    finite(`${prefix}.${name}`, value);
    if (value < 0) throw new Error(`${prefix}.${name} must be non-negative`);
  }
}

function validateHousehold(h: HouseholdCohort): void {
  if (!h.id) throw new Error('household id is required');
  if (!Number.isInteger(h.weight) || h.weight <= 0) throw new Error(`${h.id}.weight must be a positive integer`);
  if (!Number.isInteger(h.householdSize) || h.householdSize <= 0) throw new Error(`${h.id}.householdSize must be positive`);
  if (!Number.isInteger(h.workers) || h.workers < 0 || h.workers > h.householdSize) throw new Error(`${h.id}.workers is invalid`);
  if (!Number.isInteger(h.employedWorkers) || h.employedWorkers < 0 || h.employedWorkers > h.workers) throw new Error(`${h.id}.employedWorkers is invalid`);
  if (!Number.isInteger(h.unitRequirement) || h.unitRequirement <= 0) throw new Error(`${h.id}.unitRequirement must be positive`);
  if (!Number.isInteger(h.createdTick) || h.createdTick < 0) throw new Error(`${h.id}.createdTick is invalid`);
  if (h.tenure === 'owner' && !h.buildingId) throw new Error(`${h.id} owner must have a building`);
  for (const [name, value] of [
    ['grossIncome', h.grossIncome], ['disposableHousingIncome', h.disposableHousingIncome], ['employmentStability', h.employmentStability],
    ['liquidSavings', h.liquidSavings], ['housingCost', h.housingCost], ['housingCostBurden', h.housingCostBurden], ['moveFriction', h.moveFriction],
  ] as const) finite(`${h.id}.${name}`, value);
  if (h.grossIncome < 0 || h.disposableHousingIncome < 0 || h.liquidSavings < 0 || h.housingCost < 0 || h.housingCostBurden < 0 || h.moveFriction < 0) {
    throw new Error(`${h.id} contains negative economic state`);
  }
  if (h.employmentStability < 0 || h.employmentStability > 1) throw new Error(`${h.id}.employmentStability must be within [0, 1]`);
  for (const field of ['residenceCycles', 'arrearsCycles', 'severeBurdenCycles', 'unhousedCycles'] as const) {
    if (!Number.isInteger(h[field]) || h[field] < 0) throw new Error(`${h.id}.${field} is invalid`);
  }
  validateMortgage(h.mortgage, `${h.id}.mortgage`);
  validatePreferences(h.preferences, `${h.id}.preferences`);
}

function mergeSignature(h: HouseholdCohort): string {
  return JSON.stringify({
    householdSize: h.householdSize,
    workers: h.workers,
    employedWorkers: h.employedWorkers,
    employerFirmIds: [...h.employerFirmIds].sort(),
    grossIncome: h.grossIncome,
    disposableHousingIncome: h.disposableHousingIncome,
    employmentStability: h.employmentStability,
    tenure: h.tenure,
    buildingId: h.buildingId,
    unitRequirement: h.unitRequirement,
    vehicleAccess: h.vehicleAccess,
    liquidSavings: h.liquidSavings,
    mortgage: h.mortgage,
    housingCost: h.housingCost,
    housingCostBurden: h.housingCostBurden,
    affordabilityState: h.affordabilityState,
    preferences: h.preferences,
    moveFriction: h.moveFriction,
    residenceCycles: h.residenceCycles,
    displacementState: h.displacementState,
    searchState: h.searchState,
    arrearsCycles: h.arrearsCycles,
    severeBurdenCycles: h.severeBurdenCycles,
    unhousedCycles: h.unhousedCycles,
    lastMoveReason: h.lastMoveReason,
  });
}

export class HouseholdCohortSystem {
  private readonly households = new Map<string, MutableHousehold>();
  private nextId = 1;

  create(input: HouseholdCreateInput, tick: number): HouseholdCohort {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
    const id = `household:${this.nextId++}`;
    const grossIncome = input.grossIncome ?? 0;
    const housingCost = input.housingCost ?? 0;
    const burden = calculateBurden(housingCost, grossIncome);
    const household: HouseholdCohort = {
      id,
      weight: input.weight,
      householdSize: input.householdSize,
      workers: input.workers,
      employedWorkers: input.employedWorkers ?? 0,
      employerFirmIds: [...(input.employerFirmIds ?? [])].sort(),
      grossIncome,
      disposableHousingIncome: input.disposableHousingIncome ?? grossIncome * HOUSING_CONFIG.disposableIncomeRatio,
      employmentStability: input.employmentStability ?? 0.25,
      tenure: input.tenure,
      buildingId: input.buildingId,
      unitRequirement: input.unitRequirement,
      vehicleAccess: input.vehicleAccess,
      liquidSavings: input.liquidSavings,
      mortgage: cloneMortgage(input.mortgage ?? null),
      housingCost,
      housingCostBurden: burden,
      affordabilityState: burdenState(burden),
      preferences: clonePreferences(input.preferences ?? defaultPreferences(input)),
      moveFriction: input.moveFriction ?? (0.06 + (input.tenure === 'owner' ? HOUSING_CONFIG.ownerMoveFrictionBonus : 0)),
      residenceCycles: 0,
      displacementState: 'none',
      searchState: input.buildingId ? 'stable' : 'searching',
      arrearsCycles: 0,
      severeBurdenCycles: burden >= HOUSING_CONFIG.severeBurden ? 1 : 0,
      unhousedCycles: 0,
      lastMoveReason: null,
      createdTick: tick,
    };
    validateHousehold(household);
    this.households.set(id, cloneHousehold(household) as MutableHousehold);
    return cloneHousehold(household);
  }

  list(): HouseholdCohort[] {
    return [...this.households.values()].sort((a, b) => a.id.localeCompare(b.id)).map(cloneHousehold);
  }

  get(id: string): HouseholdCohort | undefined {
    const household = this.households.get(id);
    return household ? cloneHousehold(household) : undefined;
  }

  split(id: string, branchWeight: number, _reason: string): { branch: HouseholdCohort; remainder: HouseholdCohort } {
    const current = this.households.get(id);
    if (!current) throw new Error(`unknown household: ${id}`);
    if (!Number.isInteger(branchWeight) || branchWeight <= 0 || branchWeight >= current.weight) {
      throw new Error('split weight must be a positive integer smaller than household weight');
    }
    const branchId = `household:${this.nextId++}`;
    const branch: MutableHousehold = { ...cloneHousehold(current), id: branchId, weight: branchWeight } as MutableHousehold;
    current.weight -= branchWeight;
    this.households.set(branchId, branch);
    return { branch: cloneHousehold(branch), remainder: cloneHousehold(current) };
  }

  assignResidence(id: string, buildingId: string, tenure: Exclude<HouseholdTenure, 'seeking'>, housingCost: number, mortgage: MortgageProxy | null, reason: string): HouseholdCohort {
    const h = this.require(id);
    if (!buildingId) throw new Error('buildingId is required');
    finite('housingCost', housingCost);
    if (housingCost < 0) throw new Error('housingCost must be non-negative');
    validateMortgage(mortgage, `${id}.mortgage`);
    h.buildingId = buildingId;
    h.tenure = tenure;
    h.housingCost = housingCost;
    h.mortgage = cloneMortgage(mortgage);
    h.housingCostBurden = calculateBurden(housingCost, h.grossIncome);
    h.affordabilityState = burdenState(h.housingCostBurden);
    h.displacementState = 'none';
    h.searchState = 'stable';
    h.unhousedCycles = 0;
    h.residenceCycles = 0;
    h.lastMoveReason = reason;
    return cloneHousehold(h);
  }

  markSearching(id: string, reason: string): HouseholdCohort {
    const h = this.require(id);
    h.searchState = 'searching';
    h.lastMoveReason = reason;
    return cloneHousehold(h);
  }

  markDisplaced(id: string, reason: string): HouseholdCohort {
    const h = this.require(id);
    h.buildingId = null;
    h.tenure = 'seeking';
    h.housingCost = 0;
    h.housingCostBurden = 0;
    h.affordabilityState = 'comfortable';
    h.displacementState = 'displaced';
    h.searchState = 'searching';
    h.residenceCycles = 0;
    h.lastMoveReason = reason;
    return cloneHousehold(h);
  }

  remove(id: string): HouseholdCohort | undefined {
    const h = this.households.get(id);
    if (!h) return undefined;
    this.households.delete(id);
    return cloneHousehold(h);
  }

  mergeCompatible(): number {
    const groups = new Map<string, MutableHousehold[]>();
    for (const h of [...this.households.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (h.searchState !== 'stable' || h.displacementState !== 'none') continue;
      const key = mergeSignature(h);
      const values = groups.get(key) ?? [];
      values.push(h);
      groups.set(key, values);
    }
    let merged = 0;
    for (const values of groups.values()) {
      values.sort((a, b) => a.id.localeCompare(b.id));
      const survivor = values[0];
      if (!survivor) continue;
      for (const candidate of values.slice(1)) {
        if (survivor.weight + candidate.weight > HOUSING_CONFIG.cohortTargetMaxWeight) continue;
        survivor.weight += candidate.weight;
        this.households.delete(candidate.id);
        merged++;
      }
    }
    return merged;
  }

  representedHouseholds(): number {
    return [...this.households.values()].reduce((sum, h) => sum + h.weight, 0);
  }

  residentPopulation(): number {
    return [...this.households.values()].reduce((sum, h) => sum + h.weight * h.householdSize, 0);
  }

  snapshotState(): HouseholdStateSnapshot {
    return { households: this.list(), nextId: this.nextId };
  }

  restoreState(state: HouseholdStateSnapshot): void {
    if (!state || typeof state !== 'object' || !Array.isArray(state.households)) throw new Error('household state must contain households');
    if (!Number.isInteger(state.nextId) || state.nextId < 1) throw new Error('household nextId must be positive');
    const next = new Map<string, MutableHousehold>();
    for (const raw of state.households) {
      validateHousehold(raw);
      if (next.has(raw.id)) throw new Error(`duplicate household id: ${raw.id}`);
      next.set(raw.id, cloneHousehold(raw) as MutableHousehold);
    }
    this.households.clear();
    for (const [id, household] of next) this.households.set(id, household);
    this.nextId = state.nextId;
  }

  private require(id: string): MutableHousehold {
    const h = this.households.get(id);
    if (!h) throw new Error(`unknown household: ${id}`);
    return h;
  }
}
