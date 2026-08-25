import {
  BUILDING_QUALITY_TIERS,
  PRIVATE_PARKING_PROFILES,
  URBAN_LIFECYCLE_STATES,
} from '../../data/urbanFabric.ts';
import type {
  UrbanBuildingState,
  UrbanFabricStateSnapshot,
  UrbanFabricValidationOptions,
  UrbanUseComponent,
} from './UrbanTypes.ts';

function finiteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

function nonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

export function validateUseComponents(items: readonly UrbanUseComponent[]): void {
  if (items.length === 0) throw new Error('urban use components must be non-empty');
  if (items.reduce((sum, item) => sum + item.areaShareBps, 0) !== 10_000) {
    throw new Error('urban use area shares must sum to 10,000');
  }

  const uses = new Set<string>();
  for (const item of items) {
    if (uses.has(item.use)) throw new Error(`duplicate urban use component: ${item.use}`);
    uses.add(item.use);
    if (!Number.isInteger(item.areaShareBps) || item.areaShareBps <= 0) {
      throw new Error('areaShareBps must be a positive integer');
    }
    finiteNonNegative('residentCapacity', item.residentCapacity);
    finiteNonNegative('jobCapacity', item.jobCapacity);
    finiteNonNegative('taxBase', item.taxBase);
    if (item.use === 'residential' && item.jobCapacity !== 0) {
      throw new Error('residential component cannot own job capacity');
    }
    if (item.use !== 'residential' && item.residentCapacity !== 0) {
      throw new Error('non-residential component cannot own resident capacity');
    }
  }
}

function validateState(state: UrbanBuildingState): void {
  if (state.buildingId.length === 0) throw new Error('buildingId must be non-empty');
  validateUseComponents(state.useComponents);

  if (!(BUILDING_QUALITY_TIERS as readonly string[]).includes(state.qualityTier)) {
    throw new Error(`invalid building quality tier: ${state.qualityTier}`);
  }
  if (!(URBAN_LIFECYCLE_STATES as readonly string[]).includes(state.lifecycleState)) {
    throw new Error(`invalid urban lifecycle state: ${state.lifecycleState}`);
  }
  if (!Number.isFinite(state.conditionScore) || state.conditionScore < 0 || state.conditionScore > 100) {
    throw new Error('conditionScore must be finite within [0, 100]');
  }

  nonNegativeInteger('conditionEstablishedTick', state.conditionEstablishedTick);
  nonNegativeInteger('lastConditionTick', state.lastConditionTick);
  if (state.lastConditionTick < state.conditionEstablishedTick) {
    throw new Error('lastConditionTick cannot precede conditionEstablishedTick');
  }
  nonNegativeInteger('renovationCount', state.renovationCount);

  if (!(PRIVATE_PARKING_PROFILES as readonly string[]).includes(state.parking.profile)) {
    throw new Error(`invalid parking profile: ${state.parking.profile}`);
  }
  nonNegativeInteger('parking spaces', state.parking.spaces);
  if (state.parking.profile === 'legacy-none' && state.parking.spaces !== 0) {
    throw new Error('legacy-none parking must have zero spaces');
  }
}

function cloneComponent(item: UrbanUseComponent): UrbanUseComponent {
  return Object.freeze({ ...item });
}

function cloneState(state: UrbanBuildingState): UrbanBuildingState {
  return Object.freeze({
    ...state,
    useComponents: Object.freeze(state.useComponents.map(cloneComponent)),
    parking: Object.freeze({ ...state.parking }),
  });
}

export class UrbanFabricDomain {
  private readonly buildings = new Map<string, UrbanBuildingState>();

  install(state: UrbanBuildingState): UrbanBuildingState {
    validateState(state);
    if (this.buildings.has(state.buildingId)) throw new Error(`urban building already exists: ${state.buildingId}`);
    const stored = cloneState(state);
    this.buildings.set(stored.buildingId, stored);
    return cloneState(stored);
  }

  get(buildingId: string): UrbanBuildingState | undefined {
    const state = this.buildings.get(buildingId);
    return state ? cloneState(state) : undefined;
  }

  list(): UrbanBuildingState[] {
    return [...this.buildings.values()]
      .sort((a, b) => a.buildingId.localeCompare(b.buildingId))
      .map(cloneState);
  }

  remove(buildingId: string): UrbanBuildingState | undefined {
    const prior = this.buildings.get(buildingId);
    if (!prior) return undefined;
    this.buildings.delete(buildingId);
    return cloneState(prior);
  }

  replace(state: UrbanBuildingState): UrbanBuildingState {
    validateState(state);
    if (!this.buildings.has(state.buildingId)) throw new Error(`urban building does not exist: ${state.buildingId}`);
    const stored = cloneState(state);
    this.buildings.set(stored.buildingId, stored);
    return cloneState(stored);
  }

  snapshotState(): UrbanFabricStateSnapshot {
    return Object.freeze({ buildings: Object.freeze(this.list()) });
  }

  restoreState(
    snapshot: UrbanFabricStateSnapshot,
    liveBuildingIds?: ReadonlySet<string>,
    options: UrbanFabricValidationOptions = {},
  ): void {
    const next = new Map<string, UrbanBuildingState>();
    for (const state of snapshot.buildings) {
      validateState(state);
      if (next.has(state.buildingId)) throw new Error(`duplicate urban building id: ${state.buildingId}`);
      next.set(state.buildingId, cloneState(state));
    }
    this.buildings.clear();
    for (const [id, state] of next) this.buildings.set(id, state);
    if (liveBuildingIds) this.validateAgainst(liveBuildingIds, options);
  }

  validateAgainst(
    liveBuildingIds: ReadonlySet<string>,
    options: UrbanFabricValidationOptions = {},
  ): void {
    for (const id of [...this.buildings.keys()].sort((a, b) => a.localeCompare(b))) {
      if (!liveBuildingIds.has(id)) throw new Error(`urban semantic record references missing building: ${id}`);
    }
    if (options.requireAllLiveBuildings) {
      for (const id of [...liveBuildingIds].sort((a, b) => a.localeCompare(b))) {
        if (!this.buildings.has(id)) throw new Error(`live building missing urban semantic record: ${id}`);
      }
    }
  }
}
