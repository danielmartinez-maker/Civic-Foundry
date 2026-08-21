import type { ZoneType } from '../core/types.ts';
import { BUILDING_DEFINITIONS } from '../../data/buildings.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';

export type BuildingStatus = 'construction' | 'occupied';
export type Building = {
  id: string;
  lotId: string;
  x: number;
  y: number;
  zone: ZoneType;
  definitionId: string;
  status: BuildingStatus;
  constructionStartedTick: number;
  completionTick: number;
};

export type ZoneDemand = Readonly<Record<ZoneType, number>>;

export class BuildingSystem {
  private readonly buildings = new Map<string, Building>();

  evaluateDevelopment(tick: number, lots: readonly Lot[], demand: ZoneDemand): void {
    for (const lot of lots) {
      if (this.buildings.has(lot.id) || demand[lot.zone] <= 0.05) continue;
      const definition = BUILDING_DEFINITIONS[lot.zone];
      this.buildings.set(lot.id, {
        id: `building:${lot.id}`,
        lotId: lot.id,
        x: lot.x,
        y: lot.y,
        zone: lot.zone,
        definitionId: definition.id,
        status: 'construction',
        constructionStartedTick: tick,
        completionTick: tick + definition.constructionTicks,
      });
    }
  }

  tick(tick: number): void {
    for (const building of this.buildings.values()) {
      if (building.status === 'construction' && tick >= building.completionTick) building.status = 'occupied';
    }
  }

  getById(id: string): Building | undefined {
    for (const building of this.buildings.values()) if (building.id === id) return { ...building };
    return undefined;
  }

  getAt(x: number, y: number): Building | undefined {
    for (const building of this.buildings.values()) if (building.x === x && building.y === y) return { ...building };
    return undefined;
  }

  removeAt(x: number, y: number): Building | undefined {
    for (const [lotId, building] of this.buildings.entries()) {
      if (building.x === x && building.y === y) {
        this.buildings.delete(lotId);
        return { ...building };
      }
    }
    return undefined;
  }

  list(): Building[] {
    return [...this.buildings.values()].map((building) => ({ ...building })).sort((a, b) => a.y - b.y || a.x - b.x);
  }

  occupied(): Building[] {
    return this.list().filter((building) => building.status === 'occupied');
  }

  residentialCapacity(): number {
    return this.occupied().reduce((sum, building) => sum + BUILDING_DEFINITIONS[building.zone].residentCapacity, 0);
  }

  jobCapacity(): number {
    return this.occupied().reduce((sum, building) => sum + BUILDING_DEFINITIONS[building.zone].jobCapacity, 0);
  }
}
