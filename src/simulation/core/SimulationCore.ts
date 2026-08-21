import { SeededRandom } from './SeededRandom.ts';
import { SimulationClock } from './SimulationClock.ts';
import { TreasurySystem } from '../treasury/TreasurySystem.ts';
import { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadPlacementResult } from '../../world/roads/RoadSystem.ts';
import { ZoningSystem } from '../zoning/ZoningSystem.ts';
import { LotSystem } from '../../world/lots/LotSystem.ts';
import { BuildingSystem } from '../buildings/BuildingSystem.ts';
import { PopulationSystem } from '../population/PopulationSystem.ts';
import type { CellCoord, ZoneType } from './types.ts';
import type { RoadType } from '../../data/roads.ts';

export type SimulationCoreOptions = Readonly<{
  width?: number;
  height?: number;
  seed?: number;
  startingFunds?: number;
  terrain?: TerrainGrid;
}>;

export class SimulationCore {
  readonly seed: number;
  readonly random: SeededRandom;
  readonly clock: SimulationClock;
  readonly terrain: TerrainGrid;
  readonly treasury: TreasurySystem;
  readonly roads: RoadSystem;
  readonly zoning: ZoningSystem;
  readonly lots: LotSystem;
  readonly buildings: BuildingSystem;
  readonly population: PopulationSystem;

  constructor(options: SimulationCoreOptions = {}) {
    this.seed = options.seed ?? 1;
    this.random = new SeededRandom(this.seed);
    this.clock = new SimulationClock();
    this.terrain = options.terrain ?? TerrainGrid.generate(options.width ?? 40, options.height ?? 24, this.seed);
    this.treasury = new TreasurySystem(options.startingFunds ?? 125_000);
    this.roads = new RoadSystem(this.terrain);
    this.zoning = new ZoningSystem(this.terrain, this.roads);
    this.lots = new LotSystem();
    this.buildings = new BuildingSystem();
    this.population = new PopulationSystem();
  }

  buildRoad(cells: readonly CellCoord[], type: RoadType): RoadPlacementResult {
    const result = this.roads.placePath(cells, type, this.treasury);
    if (result.ok) this.lots.rebuild(this.roads, this.zoning);
    return result;
  }

  paintZone(cells: readonly CellCoord[], zone: ZoneType): { painted: number } {
    const result = this.zoning.paint(cells, zone);
    if (result.painted > 0) this.lots.rebuild(this.roads, this.zoning);
    return result;
  }

  step(ticks = 1): void {
    if (!Number.isInteger(ticks) || ticks < 0) throw new Error('ticks must be a non-negative integer');
    for (let i = 0; i < ticks; i++) {
      this.clock.step(1);
      this.buildings.tick(this.clock.tick);
      if (this.clock.tick % 10 === 0) {
        this.buildings.evaluateDevelopment(this.clock.tick, this.lots.list(), {
          residential: 1,
          commercial: 1,
          industrial: 1,
        });
        this.population.update(this.buildings.residentialCapacity(), 1);
      }
    }
  }
}
