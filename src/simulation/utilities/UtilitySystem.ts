import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import { definitionForBuilding } from '../buildings/BuildingSystem.ts';
import { UTILITY_DEFINITIONS, type UtilityFacilityType } from '../../data/utilities.ts';
import { cellKey } from '../core/types.ts';

export type UtilityFacility = Readonly<{ id: string; type: UtilityFacilityType; x: number; y: number }>;
export type ResourceSnapshot = Readonly<{ production: number; demand: number; served: number; unserved: number; serviceRatio: number }>;
export type UtilitySnapshot = Readonly<{
  power: ResourceSnapshot;
  water: ResourceSnapshot;
  perBuilding: Readonly<Record<string, Readonly<{ power: number; water: number }>>>;
}>;

const CARDINAL = [[0,-1],[1,0],[0,1],[-1,0]] as const;

export type RoadComponentIndex = Readonly<{
  byRoadKey: Map<string, number>;
  adjacentComponent(x: number, y: number): number | undefined;
  adjacentComponents(x: number, y: number): readonly number[];
}>;

export function buildRoadComponentIndex(roads: RoadSystem): RoadComponentIndex {
  const roadList = roads.list();
  const roadKeys = new Set(roadList.map((road) => cellKey(road.x, road.y)));
  const byRoadKey = new Map<string, number>();
  let nextComponent = 1;
  for (const road of roadList) {
    const startKey = cellKey(road.x, road.y);
    if (byRoadKey.has(startKey)) continue;
    const component = nextComponent++;
    const queue: Array<[number, number]> = [[road.x, road.y]];
    byRoadKey.set(startKey, component);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (!current) continue;
      const [x, y] = current;
      for (const [dx, dy] of CARDINAL) {
        const key = cellKey(x + dx, y + dy);
        if (roadKeys.has(key) && !byRoadKey.has(key)) {
          byRoadKey.set(key, component);
          queue.push([x + dx, y + dy]);
        }
      }
    }
  }
  const adjacentComponents = (x: number, y: number): number[] => [...new Set(CARDINAL
    .map(([dx, dy]) => byRoadKey.get(cellKey(x + dx, y + dy)))
    .filter((component): component is number => component !== undefined))].sort((a, b) => a - b);
  return {
    byRoadKey,
    adjacentComponent(x: number, y: number): number | undefined {
      return adjacentComponents(x, y)[0];
    },
    adjacentComponents,
  };
}

export class UtilitySystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly externallyOccupied: (x: number, y: number) => boolean;
  private readonly facilities: UtilityFacility[] = [];
  private nextId = 1;
  private _entityRevision = 0;

  constructor(terrain: TerrainGrid, roads: RoadSystem, externallyOccupied: (x: number, y: number) => boolean = () => false) {
    this.terrain = terrain;
    this.roads = roads;
    this.externallyOccupied = externallyOccupied;
  }

  get entityRevision(): number {
    return this._entityRevision;
  }

  placeFacility(type: UtilityFacilityType, x: number, y: number, treasury: TreasurySystem): { ok: boolean; cost: number; reason?: string } {
    const definition = UTILITY_DEFINITIONS[type];
    if (!this.terrain.isBuildable(x, y)) return { ok: false, cost: definition.constructionCost, reason: 'unbuildable terrain' };
    if (this.roads.has(x, y)) return { ok: false, cost: definition.constructionCost, reason: 'road occupies cell' };
    if (this.externallyOccupied(x, y) || this.facilities.some((facility) => facility.x === x && facility.y === y)) return { ok: false, cost: definition.constructionCost, reason: 'cell occupied' };
    const components = buildRoadComponentIndex(this.roads);
    if (components.adjacentComponents(x, y).length === 0) return { ok: false, cost: definition.constructionCost, reason: 'road access required' };
    if (!treasury.tryDebit(definition.constructionCost, `Build ${type}`)) return { ok: false, cost: definition.constructionCost, reason: 'insufficient funds' };
    this.facilities.push({ id: `utility:${this.nextId++}`, type, x, y });
    this._entityRevision++;
    return { ok: true, cost: definition.constructionCost };
  }

  listFacilities(): UtilityFacility[] {
    return this.facilities.map((facility) => ({ ...facility }));
  }

  operatingCost(): number {
    return this.facilities.reduce((sum, facility) => sum + UTILITY_DEFINITIONS[facility.type].operatingCost, 0);
  }

  getNextId(): number {
    return this.nextId;
  }

  restore(facilities: readonly UtilityFacility[], nextId: number): void {
    this.facilities.length = 0;
    this.facilities.push(...facilities.map((facility) => ({ ...facility })));
    this.nextId = Math.max(1, Math.floor(nextId));
    this._entityRevision++;
  }

  evaluate(buildings: readonly Building[]): UtilitySnapshot {
    const components = buildRoadComponentIndex(this.roads);
    const componentPower = new Map<number, number>();
    const componentWater = new Map<number, number>();
    for (const facility of this.facilities) {
      const component = components.adjacentComponent(facility.x, facility.y);
      if (component === undefined) continue;
      if (facility.type === 'power') componentPower.set(component, (componentPower.get(component) ?? 0) + UTILITY_DEFINITIONS.power.capacity);
      if (facility.type === 'water') componentWater.set(component, (componentWater.get(component) ?? 0) + UTILITY_DEFINITIONS.water.capacity);
    }

    const occupied = buildings.filter((building) => building.status === 'occupied');
    const powerAssignment = new Map<string, number>();
    const waterAssignment = new Map<string, number>();
    const powerDemandByComponent = new Map<number, number>();
    const waterDemandByComponent = new Map<number, number>();
    let totalPowerDemand = 0;
    let totalWaterDemand = 0;
    for (const building of occupied) {
      const definition = definitionForBuilding(building);
      totalPowerDemand += definition.powerDemand;
      totalWaterDemand += definition.waterDemand;
      const candidates = components.adjacentComponents(building.x, building.y);
      const powerComponent = this.bestComponent(candidates, componentPower);
      const waterComponent = this.bestComponent(candidates, componentWater);
      if (powerComponent !== undefined) {
        powerAssignment.set(building.id, powerComponent);
        powerDemandByComponent.set(powerComponent, (powerDemandByComponent.get(powerComponent) ?? 0) + definition.powerDemand);
      }
      if (waterComponent !== undefined) {
        waterAssignment.set(building.id, waterComponent);
        waterDemandByComponent.set(waterComponent, (waterDemandByComponent.get(waterComponent) ?? 0) + definition.waterDemand);
      }
    }

    const perBuilding: Record<string, { power: number; water: number }> = {};
    let servedPower = 0;
    let servedWater = 0;
    for (const building of occupied) {
      const powerComponent = powerAssignment.get(building.id);
      const waterComponent = waterAssignment.get(building.id);
      const powerDemand = powerComponent === undefined ? 0 : powerDemandByComponent.get(powerComponent) ?? 0;
      const waterDemand = waterComponent === undefined ? 0 : waterDemandByComponent.get(waterComponent) ?? 0;
      const powerRatio = powerComponent === undefined ? 0 : powerDemand === 0 ? 1 : Math.min(1, (componentPower.get(powerComponent) ?? 0) / powerDemand);
      const waterRatio = waterComponent === undefined ? 0 : waterDemand === 0 ? 1 : Math.min(1, (componentWater.get(waterComponent) ?? 0) / waterDemand);
      perBuilding[building.id] = { power: powerRatio, water: waterRatio };
      const definition = definitionForBuilding(building);
      servedPower += definition.powerDemand * powerRatio;
      servedWater += definition.waterDemand * waterRatio;
    }

    const productionPower = [...componentPower.values()].reduce((a, b) => a + b, 0);
    const productionWater = [...componentWater.values()].reduce((a, b) => a + b, 0);
    return {
      power: {
        production: productionPower,
        demand: totalPowerDemand,
        served: servedPower,
        unserved: Math.max(0, totalPowerDemand - servedPower),
        serviceRatio: totalPowerDemand === 0 ? 1 : servedPower / totalPowerDemand,
      },
      water: {
        production: productionWater,
        demand: totalWaterDemand,
        served: servedWater,
        unserved: Math.max(0, totalWaterDemand - servedWater),
        serviceRatio: totalWaterDemand === 0 ? 1 : servedWater / totalWaterDemand,
      },
      perBuilding,
    };
  }

  private bestComponent(candidates: readonly number[], capacity: ReadonlyMap<number, number>): number | undefined {
    return [...candidates].sort((a, b) => (capacity.get(b) ?? 0) - (capacity.get(a) ?? 0) || a - b)[0];
  }
}
