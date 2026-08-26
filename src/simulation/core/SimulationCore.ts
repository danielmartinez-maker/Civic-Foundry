import { SimulationCore as LegacySimulationCore } from './LegacySimulationCore.ts';
import type { CellCoord, ZoneType } from './types.ts';
import { RandomStreamRegistry } from '../kernel/RandomStreamRegistry.ts';
import { DevelopmentFeasibilitySystem } from '../development/DevelopmentFeasibilitySystem.ts';
import type { DevelopmentAward, DevelopmentFeasibilityResult, PhysicalDevelopmentContext } from '../development/DevelopmentTypes.ts';
import { HighestBestUseSystem } from '../development/HighestBestUseSystem.ts';
import { PropertyMarketSystem } from '../development/PropertyMarketSystem.ts';
import { SiteAssemblySystem } from '../development/SiteAssemblySystem.ts';
import { BuildableEnvelopeSystem } from '../zoning/BuildableEnvelopeSystem.ts';
import { ZoningComplianceSystem } from '../zoning/ZoningComplianceSystem.ts';
import { districtForLegacyZone } from '../zoning/ZoningDistrictCatalog.ts';
import { BuildingMassingSystem } from '../buildings/BuildingMassingSystem.ts';
import { projectLegacyBuildingCandidate } from '../buildings/LegacyBuildingProjection.ts';
import { BuildingLifecycleSystem } from '../buildings/BuildingLifecycleSystem.ts';
import { RenovationSystem } from '../buildings/RenovationSystem.ts';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../buildings/BuildingTypes.ts';
import { BUILDING_VARIANTS, getBuildingDefinition } from '../../data/buildings.ts';
import { typologyForLegacyDefinition } from '../../data/buildingTypologies.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';
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
const LEGACY_CELL_AREA_M2 = LEGACY_CELL_SIZE_METERS * LEGACY_CELL_SIZE_METERS;

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

  protected override collectVacantDevelopmentOpportunities(
    lots: readonly Lot[],
    occupiedLots: ReadonlySet<string>,
  ): DevelopmentFeasibilityResult[] {
    const opportunities: DevelopmentFeasibilityResult[] = [];
    const parcels = [...this.cadastre.listParcels()].sort((left, right) => left.id.localeCompare(right.id));

    for (const parcel of parcels) {
      const zone = legacyZoneForParcel(parcel);
      if (!zone || this.demandSnapshot[zone] <= 0.05) continue;
      const parcelLots = this.compatibilityLotsForParcel(parcel, lots);
      if (parcelLots.length === 0 || parcelLots.some((lot) => occupiedLots.has(lot.id))) continue;
      const compatibilityLot = parcelLots[0]!;
      const legacyEvaluations = super.collectVacantDevelopmentOpportunities([compatibilityLot], occupiedLots);
      if (legacyEvaluations.length === 0) continue;

      const legalDefinitionIds = new Set(
        legacyEvaluations.filter((evaluation) => evaluation.legal).map((evaluation) => evaluation.definitionId),
      );
      const typologies = BUILDING_VARIANTS[zone]
        .filter((definition) => legalDefinitionIds.has(definition.id))
        .map((definition) => typologyForLegacyDefinition(definition.id));
      if (typologies.length === 0) continue;

      const district = districtForLegacyZone(zone);
      const envelope = this.buildableEnvelopes.evaluate(parcel.id, this.cadastre, district);
      const candidates = this.buildingMassing.generate(parcel, envelope, typologies);
      const legacyByDefinitionId = new Map(legacyEvaluations.map((evaluation) => [evaluation.definitionId, evaluation] as const));
      const marketContext = this.developmentContextForLot(compatibilityLot);
      const siteScale = parcel.areaM2 / LEGACY_CELL_AREA_M2;

      for (const candidate of candidates) {
        const typology = typologies.find((item) => item.id === candidate.typologyId);
        const legacyDefinitionId = typology?.legacyDefinitionId;
        if (!typology || !legacyDefinitionId) continue;
        const legacyEvaluation = legacyByDefinitionId.get(legacyDefinitionId);
        if (!legacyEvaluation) continue;
        const definition = getBuildingDefinition(legacyDefinitionId);
        const rentableCapacity = Math.max(1, definition.residentCapacity + definition.jobCapacity);
        const prePolicyGrossPotentialRent = definition.baseRent
          * marketContext.marketRentMultiplier
          * rentableCapacity
          * siteScale;
        const averageMarketRentPerM2 = prePolicyGrossPotentialRent / candidate.usableFloorAreaM2;
        const marketRentPerM2ByUse = Object.freeze(Object.fromEntries(
          candidate.uses.map((use) => [use, averageMarketRentPerM2]),
        )) as PhysicalDevelopmentContext['marketRentPerM2ByUse'];
        const constructionCostIndex = legacyEvaluation.hardConstructionCost
          / Math.max(1, definition.baseConstructionCost * definition.complexityFactor);
        const physicalContext: PhysicalDevelopmentContext = {
          taxRate: marketContext.taxRate,
          personAccessibility: marketContext.personAccessibility,
          freightAccessibility: marketContext.freightAccessibility,
          serviceQuality: marketContext.serviceQuality,
          neighborhoodQuality: marketContext.neighborhoodQuality,
          utilityRatio: marketContext.utilityRatio,
          constructionCostIndex,
          marketInterestRate: marketContext.marketInterestRate,
          marketVacancyRate: marketContext.marketVacancyRate,
          landValuePerM2: legacyEvaluation.landValue / LEGACY_CELL_AREA_M2,
          marketRentPerM2ByUse,
          demolitionCost: 0,
          relocationCost: 0,
          sitePreparationCost: legacyEvaluation.sitePreparationCost * siteScale,
          developerLeverage: 0.55,
          financingSpread: 0,
          policyAffordableHousingShare: marketContext.policyAffordableHousingShare,
          policyDevelopmentFeeRate: marketContext.policyDevelopmentFeeRate,
          policyPermittingCostReduction: marketContext.policyPermittingCostReduction,
        };
        opportunities.push(this.developmentFeasibility.evaluateCandidate(candidate, parcel, physicalContext));
      }
    }

    return opportunities;
  }

  protected override developmentLotForAward(
    award: DevelopmentAward,
    lotsById: ReadonlyMap<string, Lot>,
  ): Lot | undefined {
    const direct = super.developmentLotForAward(award, lotsById);
    if (direct) return direct;
    if (!award.physicalCandidateId) return undefined;
    const parcel = this.cadastre.getParcel(award.lotId);
    if (!parcel) return undefined;
    return this.compatibilityLotsForParcel(parcel, [...lotsById.values()])[0];
  }

  protected override compatibilityAwardForLot(award: DevelopmentAward, lot: Lot): DevelopmentAward {
    if (award.lotId === lot.id) return award;
    if (!award.physicalCandidateId || !this.cadastre.getParcel(award.lotId)) return award;
    const definition = getBuildingDefinition(award.definitionId);
    if (definition.zone !== lot.zone) throw new Error(`canonical award zone does not match compatibility lot: ${award.lotId}`);
    const completionTick = this.clock.tick + definition.constructionTicks;
    return Object.freeze({
      ...award,
      lotId: lot.id,
      buildingId: `building:${lot.id}`,
      completionTick,
      releaseTick: completionTick + 100,
    });
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

  private compatibilityLotsForParcel(parcel: Parcel, lots: readonly Lot[]): Lot[] {
    const polygon = this.cadastre.parcelPolygon(parcel.id);
    return lots
      .filter((lot) => pointInPolygon({
        x: (lot.x + 0.5) * LEGACY_CELL_SIZE_METERS,
        y: (lot.y + 0.5) * LEGACY_CELL_SIZE_METERS,
      }, polygon))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private reconcileCanonicalBuildingProjection(): void {
    const canonical: BuildingV2[] = [];
    const existingById = new Map(this.buildings.listV2().map((building) => [building.id, building] as const));
    const parcels = [...this.cadastre.listParcels()].sort((left, right) => left.id.localeCompare(right.id));
    const legacyBuildings = this.buildings.list().sort((left, right) => left.id.localeCompare(right.id));
    const compatibilityLots = this.lots.list();
    const primaryLotIdByParcel = new Map<string, string>();
    for (const parcel of parcels) {
      const primaryLot = this.compatibilityLotsForParcel(parcel, compatibilityLots)[0];
      if (primaryLot) primaryLotIdByParcel.set(parcel.id, primaryLot.id);
    }
    const primaryAssignedParcels = new Set<string>();

    for (const building of legacyBuildings) {
      const center = {
        x: (building.x + 0.5) * LEGACY_CELL_SIZE_METERS,
        y: (building.y + 0.5) * LEGACY_CELL_SIZE_METERS,
      };
      const parcel = parcels.find((candidate) => pointInPolygon(center, this.cadastre.parcelPolygon(candidate.id)));
      if (!parcel) continue;
      const zone = legacyZoneForParcel(parcel);
      if (!zone) continue;
      const typology = typologyForLegacyDefinition(building.definitionId);
      const district = districtForLegacyZone(zone);
      const envelope = this.buildableEnvelopes.evaluate(parcel.id, this.cadastre, district);
      const projection = projectLegacyBuildingCandidate(building, parcel, typology);
      const compliance = this.zoningCompliance.evaluate(projection, envelope);
      const preferredPrimary = primaryLotIdByParcel.get(parcel.id);
      const isPrimary = !primaryAssignedParcels.has(parcel.id)
        && (building.lotId === preferredPrimary || preferredPrimary === undefined);
      const canonicalBuildingId = isPrimary
        ? `building:${parcel.id}`
        : `building:${parcel.id}:legacy:${building.lotId}`;
      if (isPrimary) primaryAssignedParcels.add(parcel.id);

      const existing = existingById.get(canonicalBuildingId);
      if (existing) {
        const legacyStatus = building.status === 'occupied' ? 'occupied' : 'construction';
        const status = existing.status === 'construction' && legacyStatus === 'occupied'
          ? 'occupied'
          : existing.status;
        canonical.push(Object.freeze({ ...existing, status }));
        continue;
      }

      canonical.push(Object.freeze({
        id: canonicalBuildingId,
        parcelIds: Object.freeze([parcel.id]),
        typologyId: typology.id,
        footprint: projection.footprint,
        grossFloorAreaM2: projection.grossFloorAreaM2,
        usableFloorAreaM2: projection.usableFloorAreaM2,
        heightMeters: projection.heightMeters,
        stories: projection.stories,
        realizedFAR: projection.realizedFAR,
        coverageRatio: projection.coverageRatio,
        floors: projection.floors,
        status: building.status === 'occupied' ? 'occupied' : 'construction',
        yearBuilt: building.constructionStartedTick,
        ...(building.developerId ? { developerId: building.developerId } : {}),
        projectCost: building.projectCost ?? 0,
        entitlement: Object.freeze({
          approvalTick: building.constructionStartedTick,
          zoningDistrictId: district.id,
          approvedFAR: compliance.legal ? envelope.effectiveFAR : projection.realizedFAR,
          approvedHeightMeters: compliance.legal ? envelope.maxHeightMeters : projection.heightMeters,
          approvedUses: Object.freeze([...(compliance.legal ? envelope.permittedUses : projection.uses)]),
          ...(compliance.legal ? {} : { legalNonconforming: true }),
        }),
        lifecycle: NEW_BUILDING_LIFECYCLE,
      }));
    }

    this.buildings.restoreV2(canonical);
  }
}
