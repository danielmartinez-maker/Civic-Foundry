import { clamp } from '../core/types.ts';
import type { DevelopmentFeasibilityResult } from './DevelopmentTypes.ts';

export type ResidentialRedevelopmentInput = Readonly<{
  buildingId: string;
  lotId: string;
  existingDefinitionId: string;
  existingBaseConstructionCost: number;
  assignedResidents: number;
  existingEvaluation: DevelopmentFeasibilityResult;
  replacementEvaluations: readonly DevelopmentFeasibilityResult[];
}>;

export type ResidentialRedevelopmentPressure = Readonly<{
  buildingId: string;
  lotId: string;
  existingDefinitionId: string;
  bestReplacementDefinitionId?: string;
  currentUseValue: number;
  demolitionCost: number;
  displacementCost: number;
  netRedevelopmentValue: number;
  pressure: number;
}>;

export type RedevelopmentPressureSnapshot = Readonly<{
  parcels: readonly ResidentialRedevelopmentPressure[];
  highPressureCount: number;
  averagePressure: number;
}>;

export type PhysicalRedevelopmentPressureInput = Readonly<{
  parcelId: string;
  unusedEffectiveFARRatio: number;
  landImprovementRatio: number;
  buildingCondition: number;
  demandScore: number;
  accessibilityChange: number;
  rezoned: boolean;
  assemblyOpportunity: number;
  profitabilityScore: number;
  relocationCostRatio: number;
  demolitionCostRatio: number;
  preservationRestriction: number;
}>;

export type PhysicalRedevelopmentPressureContributions = Readonly<{
  unusedFar: number;
  landImprovementRatio: number;
  deterioration: number;
  demand: number;
  accessibilityChange: number;
  rezoning: number;
  assembly: number;
  profitability: number;
  relocation: number;
  demolition: number;
  preservation: number;
}>;

export type PhysicalRedevelopmentPressure = Readonly<{
  parcelId: string;
  pressure: number;
  positivePressure: number;
  penaltyPressure: number;
  contributions: PhysicalRedevelopmentPressureContributions;
  reasons: readonly string[];
}>;

const EMPTY_SNAPSHOT: RedevelopmentPressureSnapshot = Object.freeze({
  parcels: Object.freeze([]),
  highPressureCount: 0,
  averagePressure: 0,
});

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new Error(`${name} must be non-negative`);
}

function bounded(name: string, value: number, minimum: number, maximum: number): void {
  finite(name, value);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be within [${minimum}, ${maximum}]`);
  }
}

function validateEvaluation(name: string, evaluation: DevelopmentFeasibilityResult): void {
  finite(`${name}.stabilizedValue`, evaluation.stabilizedValue);
  finite(`${name}.totalDevelopmentCost`, evaluation.totalDevelopmentCost);
  finite(`${name}.landValue`, evaluation.landValue);
  if (evaluation.stabilizedValue < 0) throw new Error(`${name}.stabilizedValue must be non-negative`);
  if (evaluation.totalDevelopmentCost < 0) throw new Error(`${name}.totalDevelopmentCost must be non-negative`);
  if (evaluation.landValue < 0) throw new Error(`${name}.landValue must be non-negative`);
}

function validateInput(input: ResidentialRedevelopmentInput): void {
  if (input.buildingId.length === 0) throw new Error('buildingId must be non-empty');
  if (input.lotId.length === 0) throw new Error('lotId must be non-empty');
  if (input.existingDefinitionId.length === 0) throw new Error('existingDefinitionId must be non-empty');
  nonNegative('existingBaseConstructionCost', input.existingBaseConstructionCost);
  nonNegative('assignedResidents', input.assignedResidents);
  validateEvaluation('existingEvaluation', input.existingEvaluation);
  for (const replacement of input.replacementEvaluations) validateEvaluation('replacementEvaluation', replacement);
}

function validatePhysicalInput(input: PhysicalRedevelopmentPressureInput): void {
  if (typeof input.parcelId !== 'string' || input.parcelId.trim().length === 0) {
    throw new Error('parcelId must be non-empty');
  }
  bounded('unusedEffectiveFARRatio', input.unusedEffectiveFARRatio, 0, 1);
  nonNegative('landImprovementRatio', input.landImprovementRatio);
  bounded('buildingCondition', input.buildingCondition, 0, 100);
  bounded('demandScore', input.demandScore, 0, 1);
  bounded('accessibilityChange', input.accessibilityChange, -1, 1);
  if (typeof input.rezoned !== 'boolean') throw new Error('rezoned must be boolean');
  bounded('assemblyOpportunity', input.assemblyOpportunity, 0, 1);
  bounded('profitabilityScore', input.profitabilityScore, 0, 1);
  bounded('relocationCostRatio', input.relocationCostRatio, 0, 1);
  bounded('demolitionCostRatio', input.demolitionCostRatio, 0, 1);
  bounded('preservationRestriction', input.preservationRestriction, 0, 1);
}

export class RedevelopmentPressureSystem {
  private latest: RedevelopmentPressureSnapshot = EMPTY_SNAPSHOT;

  evaluate(inputs: readonly ResidentialRedevelopmentInput[]): RedevelopmentPressureSnapshot {
    const parcels: ResidentialRedevelopmentPressure[] = [];

    for (const input of inputs) {
      validateInput(input);
      const currentUseValue = Math.max(1, input.existingEvaluation.stabilizedValue);
      const demolitionCost = input.existingBaseConstructionCost * 0.08;
      const displacementCost = input.assignedResidents * 250;
      const candidates = input.replacementEvaluations
        .filter((candidate) => candidate.zone === 'residential'
          && candidate.legal
          && candidate.feasible
          && candidate.definitionId !== input.existingDefinitionId)
        .map((candidate) => {
          const replacementCostExLand = Math.max(0, candidate.totalDevelopmentCost - candidate.landValue);
          const netRedevelopmentValue = candidate.stabilizedValue
            - replacementCostExLand
            - currentUseValue
            - demolitionCost
            - displacementCost;
          return {
            definitionId: candidate.definitionId,
            netRedevelopmentValue,
            pressure: clamp(netRedevelopmentValue / currentUseValue, 0, 1.25),
          };
        })
        .sort((a, b) => b.pressure - a.pressure
          || b.netRedevelopmentValue - a.netRedevelopmentValue
          || a.definitionId.localeCompare(b.definitionId));

      const best = candidates[0];
      parcels.push(Object.freeze({
        buildingId: input.buildingId,
        lotId: input.lotId,
        existingDefinitionId: input.existingDefinitionId,
        ...(best ? { bestReplacementDefinitionId: best.definitionId } : {}),
        currentUseValue,
        demolitionCost,
        displacementCost,
        netRedevelopmentValue: best?.netRedevelopmentValue ?? 0,
        pressure: best?.pressure ?? 0,
      }));
    }

    parcels.sort((a, b) => b.pressure - a.pressure || a.lotId.localeCompare(b.lotId));
    const frozenParcels = Object.freeze(parcels.slice());
    const highPressureCount = frozenParcels.filter((parcel) => parcel.pressure >= 0.25).length;
    const averagePressure = frozenParcels.length > 0
      ? frozenParcels.reduce((sum, parcel) => sum + parcel.pressure, 0) / frozenParcels.length
      : 0;
    this.latest = Object.freeze({
      parcels: frozenParcels,
      highPressureCount,
      averagePressure,
    });
    return this.latest;
  }

  evaluatePhysical(input: PhysicalRedevelopmentPressureInput): PhysicalRedevelopmentPressure {
    validatePhysicalInput(input);

    const contributions: PhysicalRedevelopmentPressureContributions = Object.freeze({
      unusedFar: input.unusedEffectiveFARRatio * 0.15,
      landImprovementRatio: (input.landImprovementRatio / (1 + input.landImprovementRatio)) * 0.10,
      deterioration: (1 - input.buildingCondition / 100) * 0.15,
      demand: input.demandScore * 0.10,
      accessibilityChange: Math.max(0, input.accessibilityChange) * 0.08,
      rezoning: input.rezoned ? 0.08 : 0,
      assembly: input.assemblyOpportunity * 0.08,
      profitability: input.profitabilityScore * 0.26,
      relocation: input.relocationCostRatio * 0.15,
      demolition: input.demolitionCostRatio * 0.10,
      preservation: input.preservationRestriction * 0.30,
    });

    const positivePressure = contributions.unusedFar
      + contributions.landImprovementRatio
      + contributions.deterioration
      + contributions.demand
      + contributions.accessibilityChange
      + contributions.rezoning
      + contributions.assembly
      + contributions.profitability;
    const penaltyPressure = contributions.relocation
      + contributions.demolition
      + contributions.preservation;
    const pressure = clamp(positivePressure - penaltyPressure, 0, 1);
    const reasons: string[] = [];

    if (input.unusedEffectiveFARRatio >= 0.25) reasons.push('unused-far');
    if (input.landImprovementRatio >= 1) reasons.push('land-value-dominance');
    if (input.buildingCondition <= 60) reasons.push('deterioration');
    if (input.demandScore >= 0.60) reasons.push('strong-demand');
    if (input.accessibilityChange >= 0.10) reasons.push('accessibility-gain');
    if (input.rezoned) reasons.push('rezoning');
    if (input.assemblyOpportunity >= 0.25) reasons.push('assembly-opportunity');
    if (input.profitabilityScore >= 0.60) reasons.push('redevelopment-profitability');
    if (input.relocationCostRatio >= 0.20) reasons.push('relocation-friction');
    if (input.demolitionCostRatio >= 0.20) reasons.push('demolition-friction');
    if (input.preservationRestriction > 0) reasons.push('preservation-restriction');

    return Object.freeze({
      parcelId: input.parcelId,
      pressure,
      positivePressure,
      penaltyPressure,
      contributions,
      reasons: Object.freeze(reasons),
    });
  }

  snapshot(): RedevelopmentPressureSnapshot {
    return this.latest;
  }
}
