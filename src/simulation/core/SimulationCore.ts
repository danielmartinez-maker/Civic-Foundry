import { SimulationCore as LegacySimulationCore } from './LegacySimulationCore.ts';
import { RandomStreamRegistry } from '../kernel/RandomStreamRegistry.ts';
import { DevelopmentFeasibilitySystem } from '../development/DevelopmentFeasibilitySystem.ts';
import { PersonBootstrapSystem } from '../people/PersonBootstrapSystem.ts';
import { PersonEntityBridge } from '../people/PersonEntityBridge.ts';
import { parsePersonSavePayload, serializePeople, type PersonSavePayload } from '../people/PersonPersistence.ts';
import { PersonPopulationProjection } from '../people/PersonPopulationProjection.ts';
import { buildPersonSnapshot, type PersonSnapshot } from '../people/PersonSnapshot.ts';
import { PersonStore } from '../people/PersonStore.ts';
import { WorldFoundation } from '../../world/foundation/WorldFoundation.ts';
import type { WorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import { resolveWorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import type { ScenarioWorldDefinition } from '../../world/generation/ScenarioWorldDefinition.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { DesignStormEvent, FloodResult } from '../../world/hydrology/HydrologyTypes.ts';
import type { FloodEventResolvedPayload, FloodEventStartedPayload, WorldGeneratedPayload, WorldMigratedTo1RPayload } from '../../world/foundation/WorldFoundationTypes.ts';
import { EntityRegistry } from '../../entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../../entities/EntityReferenceGraph.ts';
import { LegacyV7EntityProjector } from '../../entities/LegacyV7EntityProjector.ts';
import { commitEntityProjectionPartitions, type EntityProjectionPartition } from '../../entities/EntityProjection.ts';
import { assertEntityIntegrity, buildEntityDiagnostics, type EntityDiagnosticsSnapshot } from '../../entities/EntityDiagnostics.ts';
import type { UnresolvedEntityReference } from '../../entities/EntityTypes.ts';

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

function clampConstructionCostIndex(value: number): number {
  return Math.max(0.85, Math.min(1.50, value));
}

function installTerrainDevelopmentCosts(
  system: DevelopmentFeasibilitySystem,
  preparationMultiplierAt: (x: number, y: number) => number,
): void {
  const evaluateLot = system.evaluateLot.bind(system);
  system.evaluateLot = (lot, definitions, context) => {
    const multiplier = preparationMultiplierAt(lot.x, lot.y);
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error(`invalid development terrain cost multiplier at ${lot.x},${lot.y}`);
    return evaluateLot(lot, definitions, {
      ...context,
      constructionCostIndex: clampConstructionCostIndex(context.constructionCostIndex * multiplier),
    });
  };
}

export class SimulationCore extends LegacySimulationCore {
  readonly world: WorldFoundation;
  readonly entityRegistry: EntityRegistry;
  readonly entityReferences: EntityReferenceGraph;
  private readonly entityProjector: LegacyV7EntityProjector;
  private readonly personStore: PersonStore;
  private readonly personEntityBridge: PersonEntityBridge;
  private readonly personPopulationProjection: PersonPopulationProjection;
  private personhoodAuthorityEnabled = false;
  private lastSyncedEntityPartitions: readonly EntityProjectionPartition[] | undefined;
  private lastSyncedEntitySourceRevisionKey: string | undefined;
  private lastUnresolvedEntityReferences: readonly UnresolvedEntityReference[] = Object.freeze([]);

  get entityDiagnostics(): EntityDiagnosticsSnapshot {
    return buildEntityDiagnostics(this.entityRegistry, this.entityReferences, this.lastUnresolvedEntityReferences);
  }

  constructor(options: SimulationCoreOptions = {}) {
    const hydration = activeHydrationOverride();
    if (options.world && hydration?.world && options.world !== hydration.world) throw new Error('conflicting world hydration override');
    const injectedWorld = options.world ?? hydration?.world;
    const seed = options.seed ?? injectedWorld?.seed ?? 1;
    if (injectedWorld && injectedWorld.seed !== seed) throw new Error('world seed does not match simulation seed');

    let world: WorldFoundation;
    let generationRegistry: RandomStreamRegistry | null = null;
    const generatedHere = injectedWorld === undefined && options.terrain === undefined;
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
    this.entityRegistry = new EntityRegistry();
    this.personStore = new PersonStore();
    this.personEntityBridge = new PersonEntityBridge(this.personStore, this.entityRegistry);
    this.personPopulationProjection = new PersonPopulationProjection(this.personStore);
    this.entityReferences = new EntityReferenceGraph();
    this.entityProjector = new LegacyV7EntityProjector();
    const preparationMultiplierAt = (x: number, y: number): number => this.world.preparationMultiplierAt(x, y);
    this.roads.setCostMultiplierProvider(preparationMultiplierAt);
    installTerrainDevelopmentCosts(this.developmentFeasibility, preparationMultiplierAt);
    const redevelopmentFeasibility = (this as unknown as { redevelopmentFeasibility: DevelopmentFeasibilitySystem }).redevelopmentFeasibility;
    installTerrainDevelopmentCosts(redevelopmentFeasibility, preparationMultiplierAt);

    if (generationRegistry) this.kernel.random.restore(generationRegistry.snapshot());
    this.syncEntityProjection();
    this.kernel.registerSystem({
      id: 'entity-registry-sync',
      reads: ['legacy-v7-city'],
      writes: ['entity-registry'],
      cadence: { every: 1 },
      after: ['legacy-v7-city'],
      execute: () => this.syncEntityProjection(),
    });
    this.kernel.invariants.register({
      id: 'entity-referential-integrity',
      cadence: { every: 1 },
      check: () => assertEntityIntegrity(this.entityRegistry, this.entityReferences),
    });
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
    if (generatedHere) {
      const payload: WorldGeneratedPayload = {
        seed: this.world.seed,
        preset: this.world.config.preset,
        width: this.world.config.width,
        height: this.world.config.height,
        scenarioId: this.world.scenarioId,
      };
      this.kernel.events.append(this.clock.tick, { type: 'WorldGenerated', source: 'world', payload });
    }
  }

  enablePersonhoodAuthority(): void {
    if (this.personhoodAuthorityEnabled) return;

    const legacyPopulation = this.population.population;
    const bootstrapSeed = this.kernel.random.stream('demographics/person-bootstrap').getState();
    const people = new PersonBootstrapSystem(bootstrapSeed).bootstrapPopulation({
      population: legacyPopulation,
      simulationStartTick: this.clock.tick,
    });

    this.personEntityBridge.createPeople(people);
    this.kernel.registerPersonDiagnostics(this.personStore, this.entityRegistry);
    this.population.attachPersonProjection(this.personPopulationProjection);
    this.personhoodAuthorityEnabled = true;
  }

  isPersonhoodAuthorityEnabled(): boolean {
    return this.personhoodAuthorityEnabled;
  }

  getPersonSnapshot(): PersonSnapshot {
    return buildPersonSnapshot(this.personStore);
  }

  getPersonSavePayload(): PersonSavePayload {
    if (!this.personhoodAuthorityEnabled) throw new Error('personhood authority is not enabled');
    return serializePeople(this.personStore);
  }

  restorePersonhoodAuthority(input: unknown): void {
    if (this.personhoodAuthorityEnabled) throw new Error('personhood authority is already enabled');

    const payload = parsePersonSavePayload(input);
    const expectedPopulation = this.population.population;
    const personPopulation = payload.people.reduce(
      (count, person) => count + (person.alive && person.resident ? 1 : 0),
      0,
    );
    if (personPopulation !== expectedPopulation) {
      throw new Error(`person population mismatch: expected ${expectedPopulation}, received ${personPopulation}`);
    }

    this.personEntityBridge.createPeople(payload.people);
    this.kernel.registerPersonDiagnostics(this.personStore, this.entityRegistry);
    this.population.attachPersonProjection(this.personPopulationProjection);
    this.personhoodAuthorityEnabled = true;
  }

  rebuildEntityProjection(): void {
    this.lastSyncedEntitySourceRevisionKey = undefined;
    this.entityProjector.invalidate();
    this.syncEntityProjection();
  }

  private syncEntityProjection(): void {
    const sourceRevisionKey = this.entityProjector.sourceRevisionKey(this);
    if (sourceRevisionKey !== undefined && sourceRevisionKey === this.lastSyncedEntitySourceRevisionKey) return;

    const partitions = this.entityProjector.projectPartitions(this);
    if (partitions === this.lastSyncedEntityPartitions) {
      this.lastSyncedEntitySourceRevisionKey = sourceRevisionKey;
      return;
    }
    const result = commitEntityProjectionPartitions(
      this.entityRegistry,
      this.entityReferences,
      partitions,
    );
    this.lastUnresolvedEntityReferences = result.unresolved;
    this.lastSyncedEntityPartitions = partitions;
    this.lastSyncedEntitySourceRevisionKey = sourceRevisionKey;
  }

  runDesignStorm(event: DesignStormEvent): FloodResult {
    const started: FloodEventStartedPayload = { eventId: event.id, rainfallMm: event.rainfallMm, durationHours: event.durationHours };
    this.kernel.events.append(this.clock.tick, { type: 'FloodEventStarted', source: 'world', payload: started });
    const result = this.world.runDesignStorm(event);
    const resolved: FloodEventResolvedPayload = {
      eventId: result.eventId,
      floodedCells: result.depthMeters.filter((depth) => depth > 0).length,
      balanceError: result.balanceError,
    };
    this.kernel.events.append(this.clock.tick, { type: 'FloodEventResolved', source: 'world', payload: resolved });
    return result;
  }

  recordWorldMigrationDiagnostic(fromSaveVersion: number): void {
    if (!Number.isInteger(fromSaveVersion) || fromSaveVersion < 0) throw new Error('migration source save version must be a non-negative integer');
    const payload: WorldMigratedTo1RPayload = { fromSaveVersion, mode: 'legacy-flat' };
    this.kernel.events.append(this.clock.tick, { type: 'WorldMigratedTo1R', source: 'world', payload });
  }
}
