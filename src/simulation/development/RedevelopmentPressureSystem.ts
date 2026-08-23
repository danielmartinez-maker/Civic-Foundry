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

  snapshot(): RedevelopmentPressureSnapshot {
    return this.latest;
  }
}
