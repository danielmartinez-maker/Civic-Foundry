import { SimulationCore as LegacySimulationCore } from './LegacySimulationCore.ts';
import { RandomStreamRegistry } from '../kernel/RandomStreamRegistry.ts';
import { WorldFoundation } from '../../world/foundation/WorldFoundation.ts';
import type { WorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import { resolveWorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import type { ScenarioWorldDefinition } from '../../world/generation/ScenarioWorldDefinition.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';

export type SimulationCoreOptions = Readonly<{
  width?: number;
  height?: number;
  seed?: number;
  startingFunds?: number;
  terrain?: TerrainGrid;
  world?: WorldFoundation;
  worldConfig?: Partial<WorldGenerationConfig>;
  scenarioWorld?: ScenarioWorldDefinition;
  terrainMode?: 'legacy-flat' | 'legacy-explicit';
}>;

type HydrationOverride = Readonly<{
  world?: WorldFoundation;
  terrainMode?: 'legacy-flat' | 'legacy-explicit';
}>;

const hydrationOverrides: HydrationOverride[] = [];

export function withSimulationCoreHydrationOverride<T>(override: HydrationOverride, operation: () => T): T {
  hydrationOverrides.push(override);
  try {
    return operation();
  } finally {
    hydrationOverrides.pop();
  }
}

function activeHydrationOverride(): HydrationOverride | undefined {
  return hydrationOverrides[hydrationOverrides.length - 1];
}

export class SimulationCore extends LegacySimulationCore {
  readonly world: WorldFoundation;

  constructor(options: SimulationCoreOptions = {}) {
    const hydration = activeHydrationOverride();
    if (options.world && hydration?.world && options.world !== hydration.world) throw new Error('conflicting world hydration override');
    const injectedWorld = options.world ?? hydration?.world;
    const seed = options.seed ?? injectedWorld?.seed ?? 1;
    if (injectedWorld && injectedWorld.seed !== seed) throw new Error('world seed does not match simulation seed');

    let world: WorldFoundation;
    let generationRegistry: RandomStreamRegistry | null = null;
    if (injectedWorld) {
      if (options.terrain) {
        const compatibility = injectedWorld.legacyTerrain();
        if (compatibility.width !== options.terrain.width || compatibility.height !== options.terrain.height) {
          throw new Error('hydrated world dimensions do not match compatibility terrain');
        }
      }
      world = injectedWorld;
    } else if (options.terrain) {
      world = WorldFoundation.fromLegacyTerrain(options.terrain, seed, options.terrainMode ?? hydration?.terrainMode ?? 'legacy-explicit');
    } else {
      const config = resolveWorldGenerationConfig({
        ...options.worldConfig,
        ...(options.width !== undefined ? { width: options.width } : {}),
        ...(options.height !== undefined ? { height: options.height } : {}),
      });
      generationRegistry = new RandomStreamRegistry(seed);
      world = WorldFoundation.generate({
        seed,
        config,
        randomRegistry: generationRegistry,
        ...(options.scenarioWorld ? { scenario: options.scenarioWorld } : {}),
      });
    }

    super({ seed, terrain: world.legacyTerrain(), ...(options.startingFunds !== undefined ? { startingFunds: options.startingFunds } : {}) });
    this.world = world;
    if (generationRegistry) this.kernel.random.restore(generationRegistry.snapshot());
    this.kernel.snapshots.register('world', () => this.world.diagnosticSnapshot());
    this.kernel.invariants.register({
      id: 'world-foundation-dimensions',
      cadence: { every: 100 },
      check: () => {
        if (this.world.terrain.width !== this.terrain.width || this.world.terrain.height !== this.terrain.height) {
          throw new Error('world compatibility terrain dimensions diverged');
        }
      },
    });
  }
}
