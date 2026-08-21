import type { Building } from '../buildings/BuildingSystem.ts';
import { BUILDING_DEFINITIONS } from '../../data/buildings.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import { buildRoadComponentIndex, type UtilityFacility } from '../utilities/UtilitySystem.ts';
import { UTILITY_DEFINITIONS } from '../../data/utilities.ts';

export type GarbageSnapshot = Readonly<{ generated: number; processed: number; backlog: number; serviceRatio: number }>;

export class GarbageSystem {
  private readonly backlogByBuilding = new Map<string, number>();

  evaluate(buildings: readonly Building[], roads: RoadSystem, facilities: readonly UtilityFacility[]): GarbageSnapshot {
    const occupied = buildings.filter((building) => building.status === 'occupied').slice().sort((a, b) => a.id.localeCompare(b.id));
    let generated = 0;
    for (const building of occupied) {
      const amount = BUILDING_DEFINITIONS[building.zone].garbageGeneration;
      generated += amount;
      this.backlogByBuilding.set(building.id, (this.backlogByBuilding.get(building.id) ?? 0) + amount);
    }

    const components = buildRoadComponentIndex(roads);
    const capacityByComponent = new Map<number, number>();
    for (const facility of facilities) {
      if (facility.type !== 'landfill') continue;
      const component = components.adjacentComponent(facility.x, facility.y);
      if (component !== undefined) capacityByComponent.set(component, (capacityByComponent.get(component) ?? 0) + UTILITY_DEFINITIONS.landfill.capacity);
    }

    let processed = 0;
    for (const building of occupied) {
      const component = components.adjacentComponent(building.x, building.y);
      if (component === undefined) continue;
      let capacity = capacityByComponent.get(component) ?? 0;
      if (capacity <= 0) continue;
      const backlog = this.backlogByBuilding.get(building.id) ?? 0;
      const amount = Math.min(backlog, capacity);
      this.backlogByBuilding.set(building.id, backlog - amount);
      capacityByComponent.set(component, capacity - amount);
      processed += amount;
    }

    const backlog = [...this.backlogByBuilding.values()].reduce((a, b) => a + b, 0);
    const demandThisCycle = generated + Math.max(0, backlog - generated);
    const serviceRatio = demandThisCycle === 0 ? 1 : Math.min(1, processed / Math.max(1, generated));
    return { generated, processed, backlog, serviceRatio };
  }

  getBacklog(buildingId: string): number {
    return this.backlogByBuilding.get(buildingId) ?? 0;
  }

  snapshotBacklog(): Array<readonly [string, number]> {
    return [...this.backlogByBuilding.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, value]) => [id, value] as const);
  }

  restoreBacklog(entries: readonly (readonly [string, number])[]): void {
    this.backlogByBuilding.clear();
    for (const [id, value] of entries) {
      if (!Number.isFinite(value) || value < 0) throw new Error('invalid garbage backlog');
      this.backlogByBuilding.set(id, value);
    }
  }
}
