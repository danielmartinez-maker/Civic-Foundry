import { QUALITY_PROFILES, URBAN_CONDITION_CADENCE_TICKS } from '../../data/urbanFabric.ts';
import { clamp01 } from '../core/types.ts';
import type { UrbanFabricDomain } from './UrbanFabricDomain.ts';
import type { UrbanBuildingState, UrbanLifecycleState } from './UrbanTypes.ts';

export type MaintenanceAdequacyInput = Readonly<{
  occupancyUtilization: number;
  utilityRatio: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  marketRentStrength: number;
  firmDistress: number;
}>;

export type MaintenanceAdequacyTrace = Readonly<{
  occupancy: number;
  utilities: number;
  services: number;
  neighborhood: number;
  market: number;
  firmHealth: number;
}>;

export type MaintenanceAdequacyResult = Readonly<{
  score: number;
  contributions: MaintenanceAdequacyTrace;
}>;

export type UrbanConditionBuildingContext = MaintenanceAdequacyInput & Readonly<{
  buildingId: string;
  buildingOccupied: boolean;
  assignedResidents: number;
  activeFirm: boolean;
}>;

export type UrbanConditionUpdateContext = Readonly<{
  buildingContext: (buildingId: string, tick: number) => UrbanConditionBuildingContext | undefined;
}>;

const MAINTENANCE_WEIGHTS = Object.freeze({
  occupancy: 0.15,
  utilities: 0.25,
  services: 0.18,
  neighborhood: 0.15,
  market: 0.17,
  firmHealth: 0.10,
});

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function nextCadenceBoundary(lastConditionTick: number): number {
  return (Math.floor(lastConditionTick / URBAN_CONDITION_CADENCE_TICKS) + 1) * URBAN_CONDITION_CADENCE_TICKS;
}

export function calculateMaintenanceAdequacy(input: MaintenanceAdequacyInput): MaintenanceAdequacyResult {
  finite('occupancyUtilization', input.occupancyUtilization);
  finite('utilityRatio', input.utilityRatio);
  finite('serviceQuality', input.serviceQuality);
  finite('neighborhoodQuality', input.neighborhoodQuality);
  finite('marketRentStrength', input.marketRentStrength);
  finite('firmDistress', input.firmDistress);

  const contributions = Object.freeze({
    occupancy: rounded(clamp01(input.occupancyUtilization) * MAINTENANCE_WEIGHTS.occupancy),
    utilities: rounded(clamp01(input.utilityRatio) * MAINTENANCE_WEIGHTS.utilities),
    services: rounded(clamp01(input.serviceQuality) * MAINTENANCE_WEIGHTS.services),
    neighborhood: rounded(clamp01(input.neighborhoodQuality) * MAINTENANCE_WEIGHTS.neighborhood),
    market: rounded(clamp01(input.marketRentStrength) * MAINTENANCE_WEIGHTS.market),
    firmHealth: rounded((1 - clamp01(input.firmDistress)) * MAINTENANCE_WEIGHTS.firmHealth),
  });
  const score = rounded(clamp01(Object.values(contributions).reduce((sum, value) => sum + value, 0)));
  return Object.freeze({ score, contributions });
}

function lifecycleAfterWear(
  state: UrbanBuildingState,
  conditionScore: number,
  context: UrbanConditionBuildingContext,
  boundaryTick: number,
): UrbanLifecycleState {
  if (conditionScore < 25) {
    return context.assignedResidents <= 0 && !context.activeFirm ? 'abandoned' : 'condemned';
  }
  if (conditionScore < 50) return 'neglected';
  if (conditionScore < 70) return 'aging';

  if (state.lifecycleState === 'lease-up') {
    const occupied = context.assignedResidents > 0 || context.activeFirm || context.occupancyUtilization > 0;
    if (occupied || boundaryTick - state.conditionEstablishedTick >= 300) return 'stabilized';
    return 'lease-up';
  }
  return state.lifecycleState === 'construction' ? 'lease-up' : 'stabilized';
}

function wearForBoundary(state: UrbanBuildingState, context: UrbanConditionBuildingContext): number {
  const adequacy = calculateMaintenanceAdequacy(context).score;
  const adequacyWearFactor = 0.5 + (1 - adequacy) * 1.5;
  const resilience = QUALITY_PROFILES[state.qualityTier].conditionResilience;
  return rounded(adequacyWearFactor / resilience);
}

export class UrbanConditionSystem {
  constructor(private readonly domain: UrbanFabricDomain) {}

  updateThroughTick(targetTick: number, context: UrbanConditionUpdateContext): void {
    if (!Number.isInteger(targetTick) || targetTick < 0) throw new Error('targetTick must be a non-negative integer');

    // Process cadence boundaries globally, then building IDs, so chunking and incremental stepping are equivalent.
    while (true) {
      const states = this.domain.list();
      const dueBoundaries = states
        .map((state) => nextCadenceBoundary(state.lastConditionTick))
        .filter((tick) => tick <= targetTick);
      if (dueBoundaries.length === 0) return;
      const boundaryTick = Math.min(...dueBoundaries);

      const dueStates = states
        .filter((state) => nextCadenceBoundary(state.lastConditionTick) === boundaryTick)
        .sort((a, b) => a.buildingId.localeCompare(b.buildingId));

      for (const snapshot of dueStates) {
        const current = this.domain.get(snapshot.buildingId);
        if (!current) continue;
        const buildingContext = context.buildingContext(current.buildingId, boundaryTick);
        if (!buildingContext) {
          this.domain.replace({ ...current, lastConditionTick: boundaryTick });
          continue;
        }
        if (buildingContext.buildingId !== current.buildingId) {
          throw new Error(`condition context/building mismatch: ${buildingContext.buildingId} != ${current.buildingId}`);
        }
        finite('assignedResidents', buildingContext.assignedResidents);
        if (buildingContext.assignedResidents < 0) throw new Error('assignedResidents must be non-negative');

        if (current.lifecycleState === 'construction') {
          this.domain.replace({
            ...current,
            lifecycleState: buildingContext.buildingOccupied ? 'lease-up' : 'construction',
            lastConditionTick: boundaryTick,
          });
          continue;
        }

        if (current.lifecycleState === 'renovating') {
          this.domain.replace({ ...current, lastConditionTick: boundaryTick });
          continue;
        }

        const wear = wearForBoundary(current, buildingContext);
        const conditionScore = rounded(Math.max(0, current.conditionScore - wear));
        const lifecycleState = lifecycleAfterWear(current, conditionScore, buildingContext, boundaryTick);
        this.domain.replace({
          ...current,
          conditionScore,
          lifecycleState,
          lastConditionTick: boundaryTick,
        });
      }
    }
  }
}
