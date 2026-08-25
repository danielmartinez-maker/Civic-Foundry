import { QUALITY_PROFILES } from '../../data/urbanFabric.ts';
import type { BuildingDefinition } from '../../data/buildings.ts';
import type { UrbanFabricDomain } from './UrbanFabricDomain.ts';
import type { RenovationCommitment, RenovationStateSnapshot } from './UrbanTypes.ts';

export type RenovationCandidateInput = Readonly<{
  buildingId: string;
  developerId: string;
  startTick: number;
  definition: BuildingDefinition;
}>;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function validateTick(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

function cloneCommitment(commitment: RenovationCommitment): RenovationCommitment {
  return Object.freeze({ ...commitment });
}

export class RenovationSystem {
  private readonly domain: UrbanFabricDomain;
  private commitments = new Map<string, RenovationCommitment>();

  constructor(domain: UrbanFabricDomain) {
    this.domain = domain;
  }

  evaluateCandidates(inputs: readonly RenovationCandidateInput[]): RenovationCommitment[] {
    return inputs
      .slice()
      .sort((a, b) => a.buildingId.localeCompare(b.buildingId)
        || a.developerId.localeCompare(b.developerId)
        || a.startTick - b.startTick
        || a.definition.id.localeCompare(b.definition.id))
      .map((input) => this.evaluateCandidate(input));
  }

  evaluateCandidate(input: RenovationCandidateInput): RenovationCommitment {
    if (input.buildingId.length === 0) throw new Error('buildingId must be non-empty');
    if (input.developerId.length === 0) throw new Error('developerId must be non-empty');
    validateTick('startTick', input.startTick);
    const state = this.domain.get(input.buildingId);
    if (!state) throw new Error(`renovation building not found: ${input.buildingId}`);
    if (state.lifecycleState === 'construction' || state.lifecycleState === 'abandoned') {
      throw new Error(`renovation is not allowed from lifecycle ${state.lifecycleState}`);
    }
    if (state.lifecycleState === 'renovating' || this.commitments.has(input.buildingId)) {
      throw new Error(`active renovation commitment already exists for ${input.buildingId}`);
    }
    if (state.conditionScore >= 90) throw new Error('renovation requires condition below target');

    const qualityMultiplier = QUALITY_PROFILES[state.qualityTier].hardConstructionCost;
    const cost = roundMoney(input.definition.baseConstructionCost * 0.22 * qualityMultiplier);
    const duration = Math.max(50, Math.ceil((55 + input.definition.complexityFactor * 55) * qualityMultiplier));
    return Object.freeze({
      buildingId: input.buildingId,
      developerId: input.developerId,
      startTick: input.startTick,
      completionTick: input.startTick + duration,
      cost,
      targetCondition: 90,
    });
  }

  start(input: RenovationCandidateInput): RenovationCommitment {
    const commitment = this.evaluateCandidate(input);
    const current = this.domain.get(input.buildingId);
    if (!current) throw new Error(`renovation building not found: ${input.buildingId}`);
    this.commitments.set(input.buildingId, commitment);
    this.domain.replace({ ...current, lifecycleState: 'renovating' });
    return cloneCommitment(commitment);
  }

  hasActive(buildingId: string): boolean {
    return this.commitments.has(buildingId);
  }

  cancel(buildingId: string): boolean {
    return this.commitments.delete(buildingId);
  }

  tick(targetTick: number): void {
    validateTick('targetTick', targetTick);
    const due = [...this.commitments.values()]
      .filter((commitment) => commitment.completionTick <= targetTick)
      .sort((a, b) => a.completionTick - b.completionTick || a.buildingId.localeCompare(b.buildingId));
    for (const commitment of due) {
      const current = this.domain.get(commitment.buildingId);
      if (!current) {
        this.commitments.delete(commitment.buildingId);
        continue;
      }
      if (current.lifecycleState !== 'renovating') {
        throw new Error(`renovation lifecycle mismatch for ${commitment.buildingId}`);
      }
      this.domain.replace({
        ...current,
        conditionScore: commitment.targetCondition,
        lifecycleState: 'lease-up',
        conditionEstablishedTick: commitment.completionTick,
        lastConditionTick: Math.max(current.lastConditionTick, commitment.completionTick),
        renovationCount: current.renovationCount + 1,
      });
      this.commitments.delete(commitment.buildingId);
    }
  }

  snapshotState(): RenovationStateSnapshot {
    return Object.freeze({
      commitments: Object.freeze([...this.commitments.values()]
        .sort((a, b) => a.buildingId.localeCompare(b.buildingId))
        .map(cloneCommitment)),
    });
  }

  restoreState(state: RenovationStateSnapshot): RenovationStateSnapshot {
    if (!state || typeof state !== 'object' || !Array.isArray(state.commitments)) {
      throw new Error('renovation state must contain commitments');
    }
    const restored = new Map<string, RenovationCommitment>();
    for (const commitment of state.commitments) {
      if (commitment.buildingId.length === 0 || commitment.developerId.length === 0) {
        throw new Error('renovation commitment ids must be non-empty');
      }
      validateTick('renovation startTick', commitment.startTick);
      validateTick('renovation completionTick', commitment.completionTick);
      if (commitment.completionTick <= commitment.startTick) throw new Error('renovation completion must follow start');
      if (!Number.isFinite(commitment.cost) || commitment.cost < 0) throw new Error('renovation cost must be finite and non-negative');
      if (commitment.targetCondition !== 90) throw new Error('renovation target condition must be 90');
      if (restored.has(commitment.buildingId)) throw new Error(`duplicate renovation commitment: ${commitment.buildingId}`);
      const building = this.domain.get(commitment.buildingId);
      if (!building) throw new Error(`renovation commitment references missing building: ${commitment.buildingId}`);
      if (building.lifecycleState !== 'renovating') throw new Error(`renovation commitment requires renovating lifecycle: ${commitment.buildingId}`);
      restored.set(commitment.buildingId, cloneCommitment(commitment));
    }
    this.commitments = restored;
    return this.snapshotState();
  }
}
