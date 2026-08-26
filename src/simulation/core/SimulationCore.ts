import { SimulationCore as LegacySimulationCore } from './LegacySimulationCore.ts';
import type { CellCoord, ZoneType } from './types.ts';
import { RandomStreamRegistry } from '../kernel/RandomStreamRegistry.ts';
import { DevelopmentFeasibilitySystem } from '../development/DevelopmentFeasibilitySystem.ts';
import { HighestBestUseSystem } from '../development/HighestBestUseSystem.ts';
import { PropertyMarketSystem } from '../development/PropertyMarketSystem.ts';
import { SiteAssemblySystem } from '../development/SiteAssemblySystem.ts';
import { BuildableEnvelopeSystem } from '../zoning/BuildableEnvelopeSystem.ts';
import { ZoningComplianceSystem } from '../zoning/ZoningComplianceSystem.ts';
import { districtForLegacyZone } from '../zoning/ZoningDistrictCatalog.ts';
import { BuildingMassingSystem } from '../buildings/BuildingMassingSystem.ts';
import { BuildingLifecycleSystem } from '../buildings/BuildingLifecycleSystem.ts';
import { RenovationSystem } from '../buildings/RenovationSystem.ts';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../buildings/BuildingTypes.ts';
import { typologyForLegacyDefinition } from '../../data/buildingTypologies.ts';
import { WorldFoundation } from '../../world/foundation/WorldFoundation.ts';
import { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import { ParcelGenerationSystem } from '../../world/cadastre/ParcelGenerationSystem.ts';
import { LEGACY_CELL_SIZE_METERS, pointInPolygon } from '../../world/cadastre/Geometry.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { WorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import { resolveWorldGenerationConfig } from '../../world/generation/WorldGenerationConfig.ts';
import type { ScenarioWorldDefinition } from '../../world/generation/ScenarioWorldDefinition.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadType } from '../../data/roads.ts';
import type { DesignStormEvent, FloodResult } from '../../world/hydrology/HydrologyTypes.ts';
import type { FloodEventResolvedPayload, FloodEventStartedPayload, WorldGeneratedPayload, WorldMigratedTo1RPayload } from '../../world/foundation/WorldFoundationTypes.ts';

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

function legacyZoneForParcel(parcel: Parcel): ZoneType | undefined {
  const zone = parcel.zoningDistrictId;
  return zone === 'residential' || zone === 'commercial' || zone === 'industrial' ? zone : undefined;
}

export class SimulationCore extends LegacySimulationCore {
  readonly world: WorldFoundation;
  readonly cadastre: CadastralGraph;
  readonly parcelGeneration: ParcelGenerationSystem;
  readonly buildableEnvelopes: BuildableEnvelopeSystem;
  readonly zoningCompliance: ZoningComplianceSystem;
  readonly buildingMassing: BuildingMassingSystem;
  readonly buildingLifecycle: BuildingLifecycleSystem;
  readonly renovation: RenovationSystem;
  readonly highestBestUse: HighestBestUseSystem;
  readonly propertyMarket: PropertyMarketSystem;
  readonly siteAssembly: SiteAssemblySystem;

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
    this.parcelGeneration = new ParcelGenerationSystem();
    this.cadastre = new CadastralGraph();
    this.buildableEnvelopes = new BuildableEnvelopeSystem();
    this.zoningCompliance = new ZoningComplianceSystem();
    this.buildingMassing = new BuildingMassingSystem();
    this.buildingLifecycle = new BuildingLifecycleSystem();
    this.renovation = new RenovationSystem();
    this.highestBestUse = new HighestBestUseSystem();
    this.propertyMarket = new PropertyMarketSystem();
    this.siteAssembly = new SiteAssemblySystem();
    this.rebuildCadastreFromLegacyState();

    const preparationMultiplierAt = (x: number, y: number): number => this.world.preparationMultiplierAt(x, y);
    this.roads.setCostMultiplierProvider(preparationMultiplierAt);
    installTerrainDevelopmentCosts(this.developmentFeasibility, preparationMultiplierAt);
    const redevelopmentFeasibility = (this as unknown as { redevelopmentFeasibility: DevelopmentFeasibilitySystem }).redevelopmentFeasibility;
    installTerrainDevelopmentCosts(redevelopmentFeasibility, preparationMultiplierAt);

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

  override buildRoad(cells: readonly CellCoord[], type: RoadType) {
    const result = super.buildRoad(cells, type);
    if (result.ok) this.rebuildCadastreFromLegacyState();
    return result;
  }

  override paintZone(cells: readonly CellCoord[], zone: ZoneType): { painted: number } {
    const result = super.paintZone(cells, zone);
    if (result.painted > 0) this.rebuildCadastreFromLegacyState();
    return result;
  }

  override bulldozeAt(x: number, y: number): { ok: boolean; kind?: 'road' | 'building' | 'zone'; reason?: string } {
    const result = super.bulldozeAt(x, y);
    if (result.ok && (result.kind === 'road' || result.kind === 'zone')) this.rebuildCadastreFromLegacyState();
    if (result.ok) this.reconcileCanonicalBuildingProjection();
    return result;
  }

  override step(ticks = 1): void {
    super.step(ticks);
    this.reconcileCanonicalBuildingProjection();
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

  rebuildCadastreFromLegacyState(): void {
    this.cadastre.replaceSnapshot(this.parcelGeneration.rebuild(this.terrain, this.roads, this.zoning));
    this.lots.rebuildFromCadastre(this.cadastre, legacyZoneForParcel);
    this.reconcileCanonicalBuildingProjection();
  }

  private reconcileCanonicalBuildingProjection(): void {
    const canonical: BuildingV2[] = [];
    const claimedParcels = new Set<string>();
    const parcels = [...this.cadastre.listParcels()].sort((left, right) => left.id.localeCompare(right.id));
    const legacyBuildings = this.buildings.list().sort((left, right) => left.id.localeCompare(right.id));

    for (const building of legacyBuildings) {
      const center = {
        x: (building.x + 0.5) * LEGACY_CELL_SIZE_METERS,
        y: (building.y + 0.5) * LEGACY_CELL_SIZE_METERS,
      };
      const parcel = parcels.find((candidate) => pointInPolygon(center, this.cadastre.parcelPolygon(candidate.id)));
      if (!parcel || claimedParcels.has(parcel.id)) continue;
      const zone = legacyZoneForParcel(parcel);
      if (!zone) continue;
      const typology = typologyForLegacyDefinition(building.definitionId);
      const district = districtForLegacyZone(zone);
      const envelope = this.buildableEnvelopes.evaluate(parcel.id, this.cadastre, district);
      const candidate = this.buildingMassing.generate(parcel, envelope, [typology])[0];
      if (!candidate) continue;

      claimedParcels.add(parcel.id);
      canonical.push(Object.freeze({
        id: `building:${parcel.id}`,
        parcelIds: Object.freeze([parcel.id]),
        typologyId: typology.id,
        footprint: candidate.footprint,
        grossFloorAreaM2: candidate.grossFloorAreaM2,
        usableFloorAreaM2: candidate.usableFloorAreaM2,
        heightMeters: candidate.heightMeters,
        stories: candidate.stories,
        realizedFAR: candidate.realizedFAR,
        coverageRatio: candidate.coverageRatio,
        floors: candidate.floors,
        status: building.status === 'occupied' ? 'occupied' : 'construction',
        yearBuilt: building.constructionStartedTick,
        ...(building.developerId ? { developerId: building.developerId } : {}),
        projectCost: building.projectCost ?? 0,
        entitlement: Object.freeze({
          approvalTick: building.constructionStartedTick,
          zoningDistrictId: district.id,
          approvedFAR: envelope.effectiveFAR,
          approvedHeightMeters: envelope.maxHeightMeters,
          approvedUses: Object.freeze([...envelope.permittedUses]),
        }),
        lifecycle: NEW_BUILDING_LIFECYCLE,
      }));
    }

    this.buildings.restoreV2(canonical);
  }
}
