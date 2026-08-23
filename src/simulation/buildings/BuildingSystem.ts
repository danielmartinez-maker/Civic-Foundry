import type { ZoneType } from '../core/types.ts';
import { BUILDING_DEFINITIONS, BUILDING_DEFINITION_BY_ID, type BuildingDefinition } from '../../data/buildings.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';
import type { DevelopmentAward } from '../development/DevelopmentTypes.ts';

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
  developerId?: string;
  projectCost?: number;
  requiredEquity?: number;
  awardScore?: number;
};

export type ZoneDemand = Readonly<Record<ZoneType, number>>;

export function definitionForBuilding(building: Pick<Building, 'definitionId' | 'zone'>): BuildingDefinition {
  return BUILDING_DEFINITION_BY_ID[building.definitionId] ?? BUILDING_DEFINITIONS[building.zone];
}

export class BuildingSystem {
  private readonly buildings = new Map<string, Building>();

  startDevelopment(tick: number, lot: Lot, award: DevelopmentAward): Building {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
    if (this.buildings.has(lot.id)) throw new Error(`lot already developed: ${lot.id}`);
    if (award.lotId !== lot.id) throw new Error(`award lot does not match parcel: ${award.lotId}`);
    if (award.zone !== lot.zone) throw new Error(`award zone does not match parcel zone: ${award.zone}`);
    const definition = BUILDING_DEFINITION_BY_ID[award.definitionId];
    if (!definition) throw new Error(`unknown awarded building definition: ${award.definitionId}`);
    if (definition.zone !== lot.zone) throw new Error(`building definition zone does not match parcel zone: ${definition.zone}`);
    const expectedBuildingId = `building:${lot.id}`;
    if (award.buildingId !== expectedBuildingId) throw new Error(`award building id does not match lot: ${award.buildingId}`);
    const expectedCompletionTick = tick + definition.constructionTicks;
    if (award.completionTick !== expectedCompletionTick) throw new Error('award completion tick does not match building definition');

    const building: Building = {
      id: award.buildingId,
      lotId: lot.id,
      x: lot.x,
      y: lot.y,
      zone: lot.zone,
      definitionId: award.definitionId,
      status: 'construction',
      constructionStartedTick: tick,
      completionTick: award.completionTick,
      developerId: award.developerId,
      projectCost: award.totalDevelopmentCost,
      requiredEquity: award.requiredEquity,
      awardScore: award.rankScore,
    };
    this.buildings.set(lot.id, building);
    return { ...building };
  }

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
    return this.occupied().reduce((sum, building) => sum + definitionForBuilding(building).residentCapacity, 0);
  }

  jobCapacity(): number {
    return this.occupied().reduce((sum, building) => sum + definitionForBuilding(building).jobCapacity, 0);
  }

  restore(buildings: readonly Building[]): void {
    this.buildings.clear();
    for (const building of buildings) this.buildings.set(building.lotId, { ...building });
  }
}
