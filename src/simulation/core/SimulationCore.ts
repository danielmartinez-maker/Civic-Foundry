import { SeededRandom } from './SeededRandom.ts';
import { SimulationClock } from './SimulationClock.ts';
import { TreasurySystem } from '../treasury/TreasurySystem.ts';
import { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';

export type SimulationCoreOptions = Readonly<{
  width?: number;
  height?: number;
  seed?: number;
  startingFunds?: number;
}>;

export class SimulationCore {
  readonly seed: number;
  readonly random: SeededRandom;
  readonly clock: SimulationClock;
  readonly terrain: TerrainGrid;
  readonly treasury: TreasurySystem;

  constructor(options: SimulationCoreOptions = {}) {
    this.seed = options.seed ?? 1;
    this.random = new SeededRandom(this.seed);
    this.clock = new SimulationClock();
    this.terrain = TerrainGrid.generate(options.width ?? 40, options.height ?? 24, this.seed);
    this.treasury = new TreasurySystem(options.startingFunds ?? 125_000);
  }

  step(ticks = 1): void {
    this.clock.step(ticks);
  }
}
