import type { DevelopmentFeasibilityResult } from './DevelopmentTypes.ts';
import type { ResidentialRedevelopmentPressure } from './RedevelopmentPressureSystem.ts';

const MINIMUM_REDEVELOPMENT_PRESSURE = 0.25;
const DEFAULT_MINIMUM_POST_REDEVELOPMENT_AFFORDABLE_SHARE = 0.85;
const DEFAULT_LOWER_INCOME_RELOCATION_PROTECTION = 0.90;

export type RedevelopmentRelocationContext = Readonly<{
  population: number;
  physicalCapacity: number;
  effectiveAffordableCapacity: number;
  unplacedResidents: number;
  minimumAffordableShare?: number;
  lowerIncomeRelocationProtection?: number;
}>;

export type RedevelopmentExecutionInput = Readonly<{
  pressure: ResidentialRedevelopmentPressure;
  residentCapacity: number;
  affordabilityScore: number;
  displacedLowerIncomeResidents?: number;
  lowerIncomeAffordableSlack?: number;
  activeCommitment?: boolean;
  replacementEvaluation: DevelopmentFeasibilityResult;
}>;

export type RedevelopmentExecutionDecisionReason =
  | 'admitted'
  | 'low-pressure'
  | 'unplaced-residents'
  | 'active-commitment'
  | 'replacement-mismatch'
  | 'replacement-infeasible'
  | 'physical-capacity'
  | 'affordable-capacity'
  | 'lower-income-relocation'
  | 'redevelopment-economics';

export type RedevelopmentExecutionDecision = Readonly<{
  lotId: string;
  buildingId: string;
  definitionId?: string;
  pressure: number;
  reason: RedevelopmentExecutionDecisionReason;
}>;

export type RedevelopmentExecutionSnapshot = Readonly<{
  opportunities: readonly DevelopmentFeasibilityResult[];
  decisions: readonly RedevelopmentExecutionDecision[];
  remainingPhysicalCapacity: number;
  remainingEffectiveAffordableCapacity: number;
}>;

export type RedevelopmentExecutionState =
  | 'under-contract'
  | 'acquired'
  | 'relocating'
  | 'demolition'
  | 'construction'
  | 'lease-up'
  | 'stabilized';

export type RedevelopmentProjectExecution = Readonly<{
  id: string;
  parcelIds: readonly string[];
  buildingIds: readonly string[];
  state: RedevelopmentExecutionState;
  displacedHouseholdIds: readonly string[];
}>;

export type RedevelopmentProjectTickInput = Readonly<{
  relocatedHouseholdIds: readonly string[];
  acquisitionCompleted?: boolean;
  demolitionCompleted?: boolean;
  constructionCompleted?: boolean;
  leaseUpCompleted?: boolean;
}>;

function requireFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

function requireFiniteUnit(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be within [0, 1]`);
}

function cloneEvaluation(result: DevelopmentFeasibilityResult): DevelopmentFeasibilityResult {
  return Object.freeze({ ...result, rejectionReasons: Object.freeze([...result.rejectionReasons]) });
}

function adjustedForRedevelopment(
  base: DevelopmentFeasibilityResult,
  demolitionCost: number,
  displacementCost: number,
): DevelopmentFeasibilityResult {
  const friction = demolitionCost + displacementCost;
  const adjustedPreFinance = base.preFinanceDevelopmentCost + friction;
  const financingScale = base.preFinanceDevelopmentCost > 0
    ? adjustedPreFinance / base.preFinanceDevelopmentCost
    : 1;
  const adjustedMarketFinancing = base.marketFinancingCost * financingScale;
  const additionalMarketFinancing = adjustedMarketFinancing - base.marketFinancingCost;
  const adjustedTotal = adjustedPreFinance + adjustedMarketFinancing;
  const adjustedYield = adjustedTotal > 0 ? base.netOperatingIncome / adjustedTotal : 0;
  const adjustedReturn = adjustedTotal > 0
    ? (base.stabilizedValue - adjustedTotal) / adjustedTotal
    : -1;
  const adjustedResidual = base.residualLandValue - friction * 1.10 - additionalMarketFinancing;
  const rejectionReasons = [...base.rejectionReasons];
  if (adjustedResidual < base.landValue && !rejectionReasons.includes('redevelopment-friction-residual')) {
    rejectionReasons.push('redevelopment-friction-residual');
  }
  const feasible = base.legal && base.feasible && adjustedResidual >= base.landValue;

  return Object.freeze({
    ...base,
    feasible,
    preFinanceDevelopmentCost: adjustedPreFinance,
    marketFinancingCost: adjustedMarketFinancing,
    totalDevelopmentCost: adjustedTotal,
    yieldOnCost: adjustedYield,
    returnOnCost: adjustedReturn,
    residualLandValue: adjustedResidual,
    rejectionReasons: Object.freeze(rejectionReasons),
  });
}

export class RedevelopmentExecutionSystem {
  private state: RedevelopmentExecutionSnapshot = Object.freeze({
    opportunities: Object.freeze([]),
    decisions: Object.freeze([]),
    remainingPhysicalCapacity: 0,
    remainingEffectiveAffordableCapacity: 0,
  });

  evaluate(
    context: RedevelopmentRelocationContext,
    inputs: readonly RedevelopmentExecutionInput[],
  ): RedevelopmentExecutionSnapshot {
    requireFiniteNonNegative('population', context.population);
    requireFiniteNonNegative('physicalCapacity', context.physicalCapacity);
    requireFiniteNonNegative('effectiveAffordableCapacity', context.effectiveAffordableCapacity);
    requireFiniteNonNegative('unplacedResidents', context.unplacedResidents);
    const minimumAffordableShare = context.minimumAffordableShare ?? DEFAULT_MINIMUM_POST_REDEVELOPMENT_AFFORDABLE_SHARE;
    const lowerIncomeRelocationProtection = context.lowerIncomeRelocationProtection ?? DEFAULT_LOWER_INCOME_RELOCATION_PROTECTION;
    requireFiniteUnit('minimumAffordableShare', minimumAffordableShare);
    requireFiniteUnit('lowerIncomeRelocationProtection', lowerIncomeRelocationProtection);

    const sorted = inputs.slice().sort((a, b) =>
      b.pressure.pressure - a.pressure.pressure
      || a.pressure.lotId.localeCompare(b.pressure.lotId)
      || a.replacementEvaluation.definitionId.localeCompare(b.replacementEvaluation.definitionId));

    let remainingPhysicalCapacity = context.physicalCapacity;
    let remainingEffectiveAffordableCapacity = context.effectiveAffordableCapacity;
    let reservedLowerIncomeSlack = 0;
    const opportunities: DevelopmentFeasibilityResult[] = [];
    const decisions: RedevelopmentExecutionDecision[] = [];

    for (const input of sorted) {
      requireFiniteNonNegative('residentCapacity', input.residentCapacity);
      requireFiniteUnit('affordabilityScore', input.affordabilityScore);
      requireFiniteNonNegative('redevelopment pressure', input.pressure.pressure);
      requireFiniteNonNegative('demolitionCost', input.pressure.demolitionCost);
      requireFiniteNonNegative('displacementCost', input.pressure.displacementCost);
      const displacedLowerIncomeResidents = input.displacedLowerIncomeResidents ?? 0;
      const lowerIncomeAffordableSlack = input.lowerIncomeAffordableSlack ?? 0;
      requireFiniteNonNegative('displacedLowerIncomeResidents', displacedLowerIncomeResidents);
      requireFiniteNonNegative('lowerIncomeAffordableSlack', lowerIncomeAffordableSlack);

      const decisionBase = {
        lotId: input.pressure.lotId,
        buildingId: input.pressure.buildingId,
        definitionId: input.replacementEvaluation.definitionId,
        pressure: input.pressure.pressure,
      } as const;

      if (context.unplacedResidents > 0) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'unplaced-residents' }));
        continue;
      }
      if (input.pressure.pressure < MINIMUM_REDEVELOPMENT_PRESSURE) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'low-pressure' }));
        continue;
      }
      if (input.activeCommitment === true) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'active-commitment' }));
        continue;
      }
      if (
        input.pressure.lotId !== input.replacementEvaluation.lotId
        || !input.pressure.bestReplacementDefinitionId
        || input.pressure.bestReplacementDefinitionId !== input.replacementEvaluation.definitionId
      ) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'replacement-mismatch' }));
        continue;
      }
      if (
        input.replacementEvaluation.zone !== 'residential'
        || !input.replacementEvaluation.legal
        || !input.replacementEvaluation.feasible
      ) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'replacement-infeasible' }));
        continue;
      }

      const postPhysicalCapacity = remainingPhysicalCapacity - input.residentCapacity;
      if (postPhysicalCapacity < context.population) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'physical-capacity' }));
        continue;
      }
      const removedAffordableCapacity = input.residentCapacity * input.affordabilityScore;
      const postAffordableCapacity = remainingEffectiveAffordableCapacity - removedAffordableCapacity;
      if (postAffordableCapacity < context.population * minimumAffordableShare) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'affordable-capacity' }));
        continue;
      }
      const requiredLowerIncomeSlack = displacedLowerIncomeResidents * lowerIncomeRelocationProtection;
      if (
        displacedLowerIncomeResidents > 0
        && Math.max(0, lowerIncomeAffordableSlack - reservedLowerIncomeSlack) < requiredLowerIncomeSlack
      ) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'lower-income-relocation' }));
        continue;
      }

      const adjusted = adjustedForRedevelopment(
        input.replacementEvaluation,
        input.pressure.demolitionCost,
        input.pressure.displacementCost,
      );
      if (!adjusted.feasible) {
        decisions.push(Object.freeze({ ...decisionBase, reason: 'redevelopment-economics' }));
        continue;
      }

      opportunities.push(adjusted);
      remainingPhysicalCapacity = postPhysicalCapacity;
      remainingEffectiveAffordableCapacity = postAffordableCapacity;
      reservedLowerIncomeSlack += requiredLowerIncomeSlack;
      decisions.push(Object.freeze({ ...decisionBase, reason: 'admitted' }));
    }

    this.state = Object.freeze({
      opportunities: Object.freeze(opportunities.map(cloneEvaluation)),
      decisions: Object.freeze(decisions.map((decision) => Object.freeze({ ...decision }))),
      remainingPhysicalCapacity,
      remainingEffectiveAffordableCapacity,
    });
    return this.snapshot();
  }

  tick(
    execution: RedevelopmentProjectExecution,
    input: RedevelopmentProjectTickInput,
  ): RedevelopmentProjectExecution {
    validateProjectExecution(execution);
    const relocated = new Set(input.relocatedHouseholdIds);
    if (relocated.size !== input.relocatedHouseholdIds.length) {
      throw new Error('relocatedHouseholdIds must not contain duplicates');
    }
    for (const householdId of relocated) requireEntityId('relocatedHouseholdId', householdId);

    let nextState = execution.state;
    switch (execution.state) {
      case 'under-contract':
        if (input.acquisitionCompleted === true) nextState = 'acquired';
        break;
      case 'acquired':
        nextState = unresolvedHouseholds(execution.displacedHouseholdIds, relocated).length > 0
          ? 'relocating'
          : 'demolition';
        break;
      case 'relocating':
        if (unresolvedHouseholds(execution.displacedHouseholdIds, relocated).length === 0) nextState = 'demolition';
        break;
      case 'demolition':
        if (input.demolitionCompleted === true) nextState = 'construction';
        break;
      case 'construction':
        if (input.constructionCompleted === true) nextState = 'lease-up';
        break;
      case 'lease-up':
        if (input.leaseUpCompleted === true) nextState = 'stabilized';
        break;
      case 'stabilized':
        break;
    }

    if (nextState === execution.state) return execution;
    return Object.freeze({
      ...execution,
      parcelIds: Object.freeze([...execution.parcelIds]),
      buildingIds: Object.freeze([...execution.buildingIds]),
      displacedHouseholdIds: Object.freeze([...execution.displacedHouseholdIds]),
      state: nextState,
    });
  }

  snapshot(): RedevelopmentExecutionSnapshot {
    return Object.freeze({
      opportunities: Object.freeze(this.state.opportunities.map(cloneEvaluation)),
      decisions: Object.freeze(this.state.decisions.map((decision) => Object.freeze({ ...decision }))),
      remainingPhysicalCapacity: this.state.remainingPhysicalCapacity,
      remainingEffectiveAffordableCapacity: this.state.remainingEffectiveAffordableCapacity,
    });
  }
}

function validateProjectExecution(execution: RedevelopmentProjectExecution): void {
  requireEntityId('redevelopment execution id', execution.id);
  if (execution.parcelIds.length === 0) throw new Error('redevelopment execution requires at least one parcel');
  if (execution.buildingIds.length === 0) throw new Error('redevelopment execution requires at least one building');
  validateUniqueEntityIds('parcelIds', execution.parcelIds);
  validateUniqueEntityIds('buildingIds', execution.buildingIds);
  validateUniqueEntityIds('displacedHouseholdIds', execution.displacedHouseholdIds);
}

function validateUniqueEntityIds(name: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    requireEntityId(name, value);
    if (seen.has(value)) throw new Error(`${name} must not contain duplicates`);
    seen.add(value);
  }
}

function requireEntityId(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be non-empty`);
}

function unresolvedHouseholds(
  displacedHouseholdIds: readonly string[],
  relocatedHouseholdIds: ReadonlySet<string>,
): readonly string[] {
  return displacedHouseholdIds.filter((householdId) => !relocatedHouseholdIds.has(householdId));
}
