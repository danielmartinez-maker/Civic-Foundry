import type { SimulationCore } from '../../../simulation/core/SimulationCore.ts';
import { BuildingVisualResolver } from './BuildingVisualResolver.ts';
import type {
  BuildingVisualState,
  PresentationRevision,
  VisualTime,
  WorldPresentationSnapshot,
} from './PresentationTypes.ts';

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function freezeIds<T extends string>(ids: T[]): readonly T[] {
  ids.sort(compareIds);
  return Object.freeze(ids);
}

export class WorldPresentationSnapshotBuilder {
  readonly #resolver: BuildingVisualResolver;
  #previousBuildings = new Map<string, BuildingVisualState>();
  #previousVisualTime: VisualTime | null = null;
  #revision: PresentationRevision = Object.freeze({ world: 0, buildings: 0, environment: 0 });

  constructor(resolver = new BuildingVisualResolver()) {
    this.#resolver = resolver;
  }

  build(core: SimulationCore, visualTime: VisualTime): WorldPresentationSnapshot {
    const buildings = [...core.buildings.listV2()]
      .sort((left, right) => compareIds(left.id, right.id))
      .map((building) =>
        this.#resolver.resolve(building, {
          powerRatio: core.utilitySnapshot.perBuilding[building.id]?.power ?? 0,
          visualTime,
        }),
      );

    const nextBuildings = new Map<string, BuildingVisualState>();
    const structuralBuildings: `building:${string}`[] = [];
    const appearanceBuildings: `building:${string}`[] = [];
    const removedBuildings: `building:${string}`[] = [];

    for (const state of buildings) {
      nextBuildings.set(state.canonicalBuildingId, state);
      const previous = this.#previousBuildings.get(state.canonicalBuildingId);
      if (!previous || previous.structuralFingerprint !== state.structuralFingerprint) {
        structuralBuildings.push(state.presentationId);
        continue;
      }
      if (previous.appearanceFingerprint !== state.appearanceFingerprint) {
        appearanceBuildings.push(state.presentationId);
      }
    }

    for (const previous of this.#previousBuildings.values()) {
      if (!nextBuildings.has(previous.canonicalBuildingId)) {
        removedBuildings.push(previous.presentationId);
      }
    }

    const buildingContentChanged =
      structuralBuildings.length > 0 ||
      appearanceBuildings.length > 0 ||
      removedBuildings.length > 0;
    const environmentChanged =
      this.#previousVisualTime !== null && this.#previousVisualTime !== visualTime;

    this.#revision = Object.freeze({
      world: this.#revision.world,
      buildings: this.#revision.buildings + (buildingContentChanged ? 1 : 0),
      environment: this.#revision.environment + (environmentChanged ? 1 : 0),
    });
    this.#previousBuildings = nextBuildings;
    this.#previousVisualTime = visualTime;

    return Object.freeze({
      revision: this.#revision,
      visualTime,
      buildings: Object.freeze(buildings),
      dirty: Object.freeze({
        structuralBuildings: freezeIds(structuralBuildings),
        appearanceBuildings: freezeIds(appearanceBuildings),
        removedBuildings: freezeIds(removedBuildings),
      }),
    });
  }
}
