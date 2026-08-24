import { SeededRandom } from './SeededRandom.ts';
import { SimulationClock } from './SimulationClock.ts';
import { TreasurySystem } from '../treasury/TreasurySystem.ts';
import { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadPlacementResult } from '../../world/roads/RoadSystem.ts';
import { ZoningSystem } from '../zoning/ZoningSystem.ts';
import { LotSystem, type Lot } from '../../world/lots/LotSystem.ts';
import { BuildingSystem, definitionForBuilding } from '../buildings/BuildingSystem.ts';
import { PopulationSystem } from '../population/PopulationSystem.ts';
import { EmploymentSystem, type EmploymentSnapshot } from '../employment/EmploymentSystem.ts';
import { TaxSystem, type TaxRevenue } from '../tax/TaxSystem.ts';
import { DemandSystem, type DemandSnapshot } from '../demand/DemandSystem.ts';
import { UtilitySystem, type UtilitySnapshot } from '../utilities/UtilitySystem.ts';
import { GarbageSystem, type GarbageSnapshot } from '../garbage/GarbageSystem.ts';
import { EconomySystem, type EconomySnapshot } from '../economy/EconomySystem.ts';
import type { CellCoord, ZoneType } from './types.ts';
import { clamp, clamp01 } from './types.ts';
import type { RoadType } from '../../data/roads.ts';
import type { UtilityFacilityType } from '../../data/utilities.ts';
import { BUILDING_VARIANTS, type BuildingIntensity } from '../../data/buildings.ts';
import { TransportationGraph } from '../traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../traffic/PathfindingSystem.ts';
import { TripGenerationSystem } from '../traffic/TripGenerationSystem.ts';
import { IntersectionSystem } from '../traffic/IntersectionSystem.ts';
import { TrafficSystem } from '../traffic/TrafficSystem.ts';
import { TrafficAnalytics, type TrafficAnalyticsSnapshot } from '../traffic/TrafficAnalytics.ts';
import { ServiceFacilitySystem } from '../services/ServiceFacilitySystem.ts';
import { ServiceDemandSystem, type ServiceDemandSnapshot, type UnresolvedServiceInputs } from '../services/ServiceDemandSystem.ts';
import { ServiceAccessibilitySystem } from '../services/ServiceAccessibilitySystem.ts';
import { ServiceDispatchSystem } from '../services/ServiceDispatchSystem.ts';
import { ServiceVehicleSystem } from '../services/ServiceVehicleSystem.ts';
import { IncidentSystem } from '../services/IncidentSystem.ts';
import { WasteCollectionSystem } from '../services/WasteCollectionSystem.ts';
import { EducationSystem, type EducationSnapshot } from '../services/EducationSystem.ts';
import { NeighborhoodQualitySystem, type NeighborhoodQualitySnapshot, type BuildingServiceAccess } from '../services/NeighborhoodQualitySystem.ts';
import type { ServiceDepartment, ServiceFacilityType } from '../../data/services.ts';
import { TransitNetworkSystem } from '../transit/TransitNetworkSystem.ts';
import { PersonTripSystem } from '../mobility/PersonTripSystem.ts';
import { MobilityScheduler, type MobilitySnapshot } from '../mobility/MobilityScheduler.ts';
import { EconomyScheduler } from '../economy/EconomyScheduler.ts';
import { DevelopmentFeasibilitySystem } from '../development/DevelopmentFeasibilitySystem.ts';
import { DeveloperMarketSystem } from '../development/DeveloperMarketSystem.ts';
import { LandHousingMarketSystem, type LandHousingMarketSnapshot } from '../development/LandHousingMarketSystem.ts';
import { RedevelopmentPressureSystem, type RedevelopmentPressureSnapshot, type ResidentialRedevelopmentInput } from '../development/RedevelopmentPressureSystem.ts';
import { RedevelopmentExecutionSystem, type RedevelopmentExecutionInput, type RedevelopmentExecutionSnapshot } from '../development/RedevelopmentExecutionSystem.ts';
import { DevelopmentPolicySystem, type DevelopmentPolicyPatch, type DevelopmentPolicyState } from '../development/DevelopmentPolicySystem.ts';
import type { DevelopmentFeasibilityResult, DevelopmentParcelContext } from '../development/DevelopmentTypes.ts';
import { HousingChoiceSystem, type HousingChoiceSnapshot } from '../housing/HousingChoiceSystem.ts';
import { HousingTenureSystem, type HousingTenureSnapshot } from '../housing/HousingTenureSystem.ts';
import { HousingRelocationSystem, type HousingRelocationSnapshot, type HousingRelocationState } from '../housing/HousingRelocationSystem.ts';
import { housingAffordabilityScore } from '../housing/HousingEconomics.ts';

export type SimulationCoreOptions = Readonly<{
  width?: number;
  height?: number;
  seed?: number;
  startingFunds?: number;
  terrain?: TerrainGrid;
}>;

type LocalParcelContext = Readonly<{
  roadAccessBonus: number;
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
  constructionCostIndex: number;
  zoningMaxIntensity: BuildingIntensity;
}>;

const DEPARTMENTS: readonly ServiceDepartment[] = ['fire', 'police', 'healthcare', 'education', 'garbage'];
const INTENSITY_RANK: Readonly<Record<BuildingIntensity, number>> = Object.freeze({ low: 0, medium: 1, high: 2 });

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
  readonly employment: EmploymentSystem;
  readonly taxes: TaxSystem;
  readonly demand: DemandSystem;
  readonly utilities: UtilitySystem;
  readonly garbage: GarbageSystem;
  readonly economy: EconomySystem;
  readonly transportationGraph: TransportationGraph;
  readonly pathfinding: PathfindingSystem;
  readonly tripGeneration: TripGenerationSystem;
  readonly intersections: IntersectionSystem;
  readonly traffic: TrafficSystem;
  readonly trafficAnalytics: TrafficAnalytics;
  readonly services: ServiceFacilitySystem;
  readonly serviceDemand: ServiceDemandSystem;
  readonly serviceAccessibility: ServiceAccessibilitySystem;
  readonly serviceDispatch: ServiceDispatchSystem;
  readonly serviceVehicles: ServiceVehicleSystem;
  readonly incidents: IncidentSystem;
  readonly wasteCollection: WasteCollectionSystem;
  readonly education: EducationSystem;
  readonly neighborhoodQuality: NeighborhoodQualitySystem;
  readonly transit: TransitNetworkSystem;
  readonly personTrips: PersonTripSystem;
  readonly mobility: MobilityScheduler;
  readonly economyDomain: EconomyScheduler;
  readonly developmentFeasibility: DevelopmentFeasibilitySystem;
  readonly developerMarket: DeveloperMarketSystem;
  readonly landHousingMarket: LandHousingMarketSystem;
  readonly housingChoice: HousingChoiceSystem;
  readonly housingTenure: HousingTenureSystem;
  readonly housingRelocation: HousingRelocationSystem;
  readonly redevelopmentPressure: RedevelopmentPressureSystem;
  readonly redevelopmentExecution: RedevelopmentExecutionSystem;
  readonly developmentPolicy: DevelopmentPolicySystem;
  private readonly redevelopmentFeasibility: DevelopmentFeasibilitySystem;

  employmentSnapshot: EmploymentSnapshot;
  utilitySnapshot: UtilitySnapshot;
  garbageSnapshot: GarbageSnapshot;
  demandSnapshot: DemandSnapshot;
  taxRevenue: TaxRevenue;
  economySnapshot: EconomySnapshot;
  trafficSnapshot: TrafficAnalyticsSnapshot;
  serviceDemandSnapshot: ServiceDemandSnapshot;
  educationSnapshot: EducationSnapshot;
  neighborhoodSnapshot: NeighborhoodQualitySnapshot;
  mobilitySnapshot: MobilitySnapshot;
  serviceAccessByBuilding: Readonly<Record<string, BuildingServiceAccess>> = Object.freeze({});
  lastServiceGeneratedWaste = 0;

  get landHousingMarketSnapshot(): LandHousingMarketSnapshot {
    return this.landHousingMarket.snapshot();
  }

  get housingChoiceSnapshot(): HousingChoiceSnapshot {
    return this.housingChoice.snapshot();
  }

  get housingTenureSnapshot(): HousingTenureSnapshot {
    return this.housingTenure.snapshot();
  }

  get housingRelocationSnapshot(): HousingRelocationSnapshot {
    return this.housingRelocation.snapshot();
  }

  get redevelopmentPressureSnapshot(): RedevelopmentPressureSnapshot {
    return this.redevelopmentPressure.snapshot();
  }

  get redevelopmentExecutionSnapshot(): RedevelopmentExecutionSnapshot {
    return this.redevelopmentExecution.snapshot();
  }

  get developmentPolicySnapshot(): DevelopmentPolicyState {
    return this.developmentPolicy.snapshot();
  }

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
    this.employment = new EmploymentSystem();
    this.taxes = new TaxSystem();
    this.demand = new DemandSystem();
    this.utilities = new UtilitySystem(this.terrain, this.roads);
    this.garbage = new GarbageSystem();
    this.economy = new EconomySystem();
    this.transportationGraph = new TransportationGraph();
    this.pathfinding = new PathfindingSystem();
    this.tripGeneration = new TripGenerationSystem(this.seed);
    this.intersections = new IntersectionSystem();
    this.traffic = new TrafficSystem();
    this.trafficAnalytics = new TrafficAnalytics();
    this.services = new ServiceFacilitySystem(this.terrain, this.roads, (x, y) =>
      this.buildings.getAt(x, y) !== undefined || this.utilities.listFacilities().some((facility) => facility.x === x && facility.y === y),
    );
    this.serviceDemand = new ServiceDemandSystem();
    this.serviceAccessibility = new ServiceAccessibilitySystem();
    this.serviceDispatch = new ServiceDispatchSystem();
    this.serviceVehicles = new ServiceVehicleSystem();
    this.incidents = new IncidentSystem(this.seed);
    this.wasteCollection = new WasteCollectionSystem();
    this.education = new EducationSystem();
    this.neighborhoodQuality = new NeighborhoodQualitySystem();
    this.transit = new TransitNetworkSystem(this.terrain, this.roads, (x, y) =>
      this.buildings.getAt(x, y) !== undefined
      || this.utilities.listFacilities().some((facility) => facility.x === x && facility.y === y)
      || this.services.getAt(x, y) !== undefined,
    );
    this.personTrips = new PersonTripSystem(this.tripGeneration);
    this.mobility = new MobilityScheduler();
    this.economyDomain = new EconomyScheduler(this.seed);
    this.developmentFeasibility = new DevelopmentFeasibilitySystem();
    this.redevelopmentFeasibility = new DevelopmentFeasibilitySystem();
    this.developerMarket = new DeveloperMarketSystem();
    this.landHousingMarket = new LandHousingMarketSystem();
    this.housingChoice = new HousingChoiceSystem();
    this.housingTenure = new HousingTenureSystem();
    this.housingRelocation = new HousingRelocationSystem();
    this.redevelopmentPressure = new RedevelopmentPressureSystem();
    this.redevelopmentExecution = new RedevelopmentExecutionSystem();
    this.developmentPolicy = new DevelopmentPolicySystem();

    this.employmentSnapshot = this.employment.evaluate(0, 0);
    this.utilitySnapshot = this.utilities.evaluate([]);
    this.garbageSnapshot = { generated: 0, processed: 0, backlog: 0, serviceRatio: 1 };
    this.taxRevenue = this.taxes.calculateRevenue([]);
    this.demandSnapshot = this.demand.evaluate({
      population: 0, housingCapacity: 0, workforce: 0, employed: 0, totalJobs: 0,
      powerRatio: 1, waterRatio: 1, garbageRatio: 1, taxRates: this.taxes.getRates(),
      trafficJobAccessibility: 1, trafficCommercialAccessibility: 1, personAccessibility: 1,
      serviceQuality: 0.7, commercialServiceQuality: 0.7,
    });
    this.economySnapshot = { ...this.economy.lastSettlement, cashBalance: this.treasury.balance };
    this.trafficSnapshot = this.trafficAnalytics.evaluate([], [], 0);
    this.serviceDemandSnapshot = { eligibleStudents: 0, perBuilding: Object.freeze({}) };
    this.educationSnapshot = { eligibleStudents: 0, reachableStudents: 0, enrolledStudents: 0, effectiveSeats: 0, overcrowdedStudents: 0, averageSchoolAccessTicks: 0, educationServiceRatio: 1 };
    this.neighborhoodSnapshot = { perBuilding: Object.freeze({}), citywideServiceQuality: 1, commercialServiceQuality: 1 };
    this.mobilitySnapshot = this.mobility.snapshot();
    this.refreshLandHousingMarket();
    this.refreshHousingTenure();
    this.housingRelocation.initialize(this.population.population, this.housingTenureSnapshot.options);
    this.refreshHousingChoice();
    this.refreshRedevelopmentPressure();
    this.refreshRedevelopmentExecution();
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

  placeUtility(type: UtilityFacilityType, x: number, y: number): { ok: boolean; cost: number; reason?: string } {
    return this.utilities.placeFacility(type, x, y, this.treasury);
  }

  placeServiceFacility(type: ServiceFacilityType, x: number, y: number): { ok: boolean; cost: number; reason?: string } {
    const result = this.services.placeFacility(type, x, y, this.treasury);
    if (result.ok) this.serviceVehicles.syncFleet(this.services);
    return result;
  }

  setServiceFunding(department: ServiceDepartment, percent: number): number {
    const result = this.services.setFunding(department, percent);
    this.serviceVehicles.syncFleet(this.services);
    return result;
  }

  setDevelopmentPolicy(patch: DevelopmentPolicyPatch): DevelopmentPolicyState {
    const state = this.developmentPolicy.update(patch);
    this.refreshHousingTenure();
    this.syncHousingPopulationWithoutVoluntaryMoves();
    this.refreshHousingChoice();
    this.refreshRedevelopmentPressure();
    this.refreshRedevelopmentExecution();
    return state;
  }

  restoreHousingState(state?: HousingRelocationState): HousingRelocationState {
    this.refreshLandHousingMarket();
    this.refreshHousingTenure();
    if (state === undefined) {
      this.housingRelocation.initialize(this.population.population, this.housingTenureSnapshot.options);
    } else {
      const buildingZones = new Map(this.buildings.occupied().map((building) => [building.id, building.zone] as const));
      const optionCapacities = new Map<string, number>(this.housingTenureSnapshot.options.map((option) => [`${option.buildingId}|${option.tenure}`, option.capacity] as const));
      const assigned = new Map<string, number>();
      for (const allocation of state.allocations) {
        if (buildingZones.get(allocation.buildingId) !== 'residential') throw new Error('invalid housing allocation building reference');
        const key = `${allocation.buildingId}|${allocation.tenure}`;
        if (!optionCapacities.has(key)) throw new Error('invalid housing allocation tenure reference');
        assigned.set(key, (assigned.get(key) ?? 0) + allocation.residents);
      }
      for (const [key, residents] of assigned) {
        if (residents > (optionCapacities.get(key) ?? 0) + 1e-9) throw new Error('housing allocation exceeds tenure capacity');
      }
      this.housingRelocation.restoreState(state);
      const represented = state.allocations.reduce((sum, item) => sum + item.residents, 0)
        + state.unplaced.reduce((sum, item) => sum + item.residents, 0);
      if (Math.abs(represented - this.population.population) > 1e-6) {
        this.housingRelocation.reconcile({ population: this.population.population, options: this.housingTenureSnapshot.options, allowVoluntaryMoves: false });
      } else {
        this.housingRelocation.refreshSnapshot(this.population.population, this.housingTenureSnapshot.options);
      }
    }
    this.refreshHousingChoice();
    this.refreshRedevelopmentPressure();
    this.refreshRedevelopmentExecution();
    return this.housingRelocation.snapshotState();
  }

  bulldozeAt(x: number, y: number): { ok: boolean; kind?: 'road' | 'building' | 'zone'; reason?: string } {
    const road = this.roads.remove(x, y);
    if (road) {
      this.lots.rebuild(this.roads, this.zoning);
      return { ok: true, kind: 'road' };
    }
    const buildingBeforeRemoval = this.buildings.getAt(x, y);
    const housingBeforeRemoval = buildingBeforeRemoval?.zone === 'residential'
      ? this.housingRelocation.snapshotState()
      : undefined;
    if (buildingBeforeRemoval?.zone === 'residential') this.housingRelocation.displaceBuilding(buildingBeforeRemoval.id);
    const building = this.buildings.removeAt(x, y);
    if (building) {
      this.economyDomain.removeBuilding(building.id, this.clock.tick);
      this.developerMarket.cancelProject(building.id, 0.50);
      if (building.zone === 'residential') {
        this.refreshLandHousingMarket();
        this.refreshHousingTenure();
        this.housingRelocation.reconcile({ population: this.population.population, options: this.housingTenureSnapshot.options, allowVoluntaryMoves: false });
        this.refreshHousingChoice();
        this.refreshRedevelopmentPressure();
        this.refreshRedevelopmentExecution();
      }
      return { ok: true, kind: 'building' };
    }
    if (housingBeforeRemoval) {
      this.housingRelocation.restoreState(housingBeforeRemoval);
      this.housingRelocation.refreshSnapshot(this.population.population, this.housingTenureSnapshot.options);
    }
    if (this.zoning.get(x, y)) {
      this.zoning.clear(x, y);
      this.lots.rebuild(this.roads, this.zoning);
      return { ok: true, kind: 'zone' };
    }
    return { ok: false, reason: 'nothing to bulldoze' };
  }

  step(ticks = 1): void {
    if (!Number.isInteger(ticks) || ticks < 0) throw new Error('ticks must be a non-negative integer');
    for (let i = 0; i < ticks; i++) {
      this.clock.step(1);
      this.transportationGraph.rebuildIfNeeded(this.roads);
      this.serviceVehicles.syncFleet(this.services);

      const serviceEvents = this.serviceVehicles.step(
        this.transportationGraph, this.intersections, this.pathfinding,
        (edge) => this.traffic.getEdgeTravelTime(edge), this.clock.tick,
      );
      this.serviceDispatch.applyVehicleEvents(serviceEvents, this.clock.tick);
      this.wasteCollection.applyJobs(this.serviceDispatch.listJobs(), this.services, this.clock.tick);
      this.incidents.advance(this.clock.tick, this.serviceDispatch.listJobs(), this.buildings.occupied(), this.serviceDispatch);

      const economyDomainSnapshot = this.economyDomain.tick({
        tick: this.clock.tick,
        ...(this.clock.tick % 250 === 0 ? { buildings: this.buildings.occupied() } : {}),
        population: this.population.population,
        graph: this.transportationGraph,
        pathfinding: this.pathfinding,
        roadTravelTime: (edge) => this.traffic.getEdgeTravelTime(edge),
        utilityRatio: Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio),
        serviceRatio: this.services.listFacilities().length > 0 ? this.neighborhoodSnapshot.citywideServiceQuality : 0.7,
        personAccessibility: this.mobilitySnapshot.personAccessibility,
        localDemand: Math.max(0.25, Math.min(2, this.population.population / 100)),
        width: this.terrain.width, height: this.terrain.height,
        taxRate: (this.taxes.getRate('commercial') + this.taxes.getRate('industrial')) / 2,
      });
      this.employmentSnapshot = economyDomainSnapshot.employment;

      this.mobilitySnapshot = this.mobility.tick({
        tick: this.clock.tick,
        roadGraph: this.transportationGraph,
        transit: this.transit,
        pathfinding: this.pathfinding,
        roadTravelTime: (edge) => this.traffic.getEdgeTravelTime(edge),
        costEpoch: this.traffic.congestionEpoch,
        generateTrips: () => this.clock.tick % 100 === 0
          ? this.personTrips.generate(this.clock.tick, this.buildings.occupied(), this.population.population, this.employmentSnapshot.employed, this.transportationGraph)
          : [],
        submitCarTrip: (trip, travelerWeight, route) => {
          const freeFlowTicks = route.edgeIds.reduce((sum, edgeId) => sum + (this.transportationGraph.getEdge(edgeId)?.freeFlowTicks ?? 0), 0);
          this.traffic.submitTrip({
            id: trip.sourceTripId,
            originBuildingId: trip.originBuildingId,
            destinationBuildingId: trip.destinationBuildingId,
            departureTick: trip.departureTick,
            travelerWeight,
            purpose: trip.purpose,
          }, route, this.clock.tick, freeFlowTicks);
        },
      });

      const edgeLoads = this.mergeEdgeLoads(this.serviceVehicles.edgeLoads(), this.mobility.vehicles.edgeLoads(), this.economyDomain.freightVehicles.edgeLoads());
      this.traffic.step(this.transportationGraph, this.intersections, this.clock.tick, edgeLoads);
      this.trafficSnapshot = this.trafficAnalytics.evaluate(this.traffic.edgeMetrics, this.traffic.recentOutcomes, this.traffic.activeVehicles.length);
      this.buildings.tick(this.clock.tick);
      this.developerMarket.advance(this.clock.tick);

      if (this.clock.tick % 10 === 0) {
        this.evaluateServiceLoop();
        this.evaluateDevelopmentMarket();
      }
      if (this.clock.tick % 50 === 0) this.evaluateCoreCityLoop();
    }
  }

  private evaluateServiceLoop(): void {
    const occupied = this.buildings.occupied();
    this.utilitySnapshot = this.utilities.evaluate(occupied);
    this.lastServiceGeneratedWaste = this.clock.tick % 50 === 0 ? this.wasteCollection.generate(occupied, this.clock.tick) : 0;
    if (this.clock.tick % 50 !== 0) this.wasteCollection.syncBuildings(occupied, this.clock.tick);

    const wasteByBuilding: Record<string, number> = {};
    for (const building of occupied) wasteByBuilding[building.id] = this.wasteCollection.getBuildingWaste(building.id)?.currentCollectibleWaste ?? 0;
    const unresolvedByBuilding: Record<string, UnresolvedServiceInputs> = {};
    for (const incident of this.incidents.listIncidents().filter((item) => item.status === 'active')) {
      const target = unresolvedByBuilding[incident.targetBuildingId] ?? {};
      const key = incident.kind === 'medical' ? 'healthcare' : incident.kind;
      unresolvedByBuilding[incident.targetBuildingId] = { ...target, [key]: (target[key] ?? 0) + incident.severity };
    }

    this.serviceDemandSnapshot = this.serviceDemand.evaluate(occupied, {
      population: this.population.population,
      workforce: this.employmentSnapshot.workforce,
      unemployed: Math.max(0, this.employmentSnapshot.workforce - this.employmentSnapshot.employed),
      utilityByBuilding: this.utilitySnapshot.perBuilding,
      wasteByBuilding,
      unresolvedByBuilding,
      priorAccessByBuilding: this.serviceAccessByBuilding,
    });

    if (this.clock.tick % 100 === 0) this.incidents.generateFromDemand(this.clock.tick, occupied, this.serviceDemandSnapshot, this.serviceDispatch);
    this.wasteCollection.createCollectionJobs(this.clock.tick, this.serviceDispatch);
    this.serviceDispatch.assignWaiting(
      occupied, this.services, this.serviceVehicles, this.transportationGraph, this.pathfinding,
      (edge) => this.traffic.getEdgeTravelTime(edge), this.clock.tick,
    );

    const accessByBuilding: Record<string, BuildingServiceAccess> = {};
    const utilizationByFacility: Record<string, number> = {};
    for (const job of this.serviceDispatch.listJobs().filter((item) => !['completed', 'failed'].includes(item.status))) {
      if (job.assignedFacilityId) utilizationByFacility[job.assignedFacilityId] = (utilizationByFacility[job.assignedFacilityId] ?? 0) + 1;
    }
    for (const building of occupied) {
      const demand = this.serviceDemandSnapshot.perBuilding[building.id];
      const access: Partial<Record<ServiceDepartment, number>> = {};
      for (const department of DEPARTMENTS) {
        const localDemand = department === 'education' ? (demand?.educationStudents ?? 0)
          : department === 'garbage' ? Math.max(1, wasteByBuilding[building.id] ?? 0)
          : (demand?.[department] ?? 0);
        const result = this.serviceAccessibility.evaluateBuilding(
          department, building, localDemand, this.services, this.transportationGraph, this.pathfinding,
          (edge) => this.traffic.getEdgeTravelTime(edge),
          { utilizationByFacility, costKey: `service:${department}:${this.traffic.congestionEpoch}` },
        );
        access[department] = result.serviceAccess;
      }
      accessByBuilding[building.id] = Object.freeze(access);
    }
    this.serviceAccessByBuilding = Object.freeze(accessByBuilding);
    this.educationSnapshot = this.education.evaluate(
      occupied, this.serviceDemandSnapshot.eligibleStudents, this.services, this.transportationGraph, this.pathfinding,
      (edge) => this.traffic.getEdgeTravelTime(edge),
    );
    this.neighborhoodSnapshot = this.neighborhoodQuality.evaluate(occupied, {
      accessByBuilding: this.serviceAccessByBuilding,
      incidentOutcome: {
        fire: this.incidents.recentOutcomeScore('fire'),
        police: this.incidents.recentOutcomeScore('police'),
        healthcare: this.incidents.recentOutcomeScore('medical'),
      },
      wasteByBuilding,
    });

    if (this.services.listFacilities().some((facility) => facility.department === 'garbage')) {
      this.garbageSnapshot = this.garbage.snapshotDetailed(this.lastServiceGeneratedWaste, this.wasteCollection.processedTotal, this.wasteCollection.totalBacklog());
    }
  }

  private evaluateCoreCityLoop(): void {
    const occupied = this.buildings.occupied();
    this.utilitySnapshot = this.utilities.evaluate(occupied);
    if (!this.services.listFacilities().some((facility) => facility.department === 'garbage')) {
      this.garbageSnapshot = this.garbage.evaluate(occupied, this.roads, this.utilities.listFacilities());
    }
    this.employmentSnapshot = this.economyDomain.snapshot(this.clock.tick).employment;
    this.taxRevenue = this.taxes.calculateRevenue(occupied);
    const hasServices = this.services.listFacilities().length > 0;
    const serviceQuality = hasServices ? this.neighborhoodSnapshot.citywideServiceQuality : 0.7;
    const commercialServiceQuality = hasServices ? this.neighborhoodSnapshot.commercialServiceQuality : 0.7;
    this.refreshLandHousingMarket();
    this.refreshHousingTenure();
    this.syncHousingPopulationWithoutVoluntaryMoves();
    this.refreshHousingChoice();
    this.demandSnapshot = this.demand.evaluate({
      population: this.population.population,
      housingCapacity: this.housingChoiceSnapshot.effectiveAffordableCapacity,
      workforce: this.employmentSnapshot.workforce,
      employed: this.employmentSnapshot.employed,
      totalJobs: this.employmentSnapshot.totalJobs,
      powerRatio: this.utilitySnapshot.power.serviceRatio,
      waterRatio: this.utilitySnapshot.water.serviceRatio,
      garbageRatio: this.garbageSnapshot.serviceRatio,
      taxRates: this.taxes.getRates(),
      trafficJobAccessibility: this.trafficSnapshot.jobAccessibility,
      trafficCommercialAccessibility: this.trafficSnapshot.commercialAccessibility,
      personAccessibility: this.mobilitySnapshot.personAccessibility,
      serviceQuality,
      commercialServiceQuality,
    });

    const transitFiscal = this.mobility.consumeFiscalDelta();
    this.economySnapshot = this.economy.settle(
      this.treasury,
      this.taxRevenue,
      this.utilities.operatingCost(),
      this.services.totalOperatingCost(),
      transitFiscal.operatingCost,
      transitFiscal.fareRevenue,
    );
    const paymentRatio = this.economySnapshot.facilityOperatingCost <= 0 ? 1 : this.economySnapshot.paidOperatingCost / this.economySnapshot.facilityOperatingCost;
    this.services.setFiscalPaymentRatio(paymentRatio);
    this.serviceVehicles.syncFleet(this.services);

    const essential = Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio);
    const employmentQuality = this.employmentSnapshot.workforce === 0 ? 1 : this.employmentSnapshot.employed / Math.max(1, this.employmentSnapshot.workforce);
    const fiscalQuality = this.economySnapshot.unpaidOperatingCost > 0 ? paymentRatio : 1;
    const serviceFactor = hasServices ? this.neighborhoodSnapshot.citywideServiceQuality : 0.7;
    let attractiveness = clamp01(0.45 * essential + 0.18 * employmentQuality + 0.12 * fiscalQuality + 0.25 * serviceFactor);
    if (this.utilitySnapshot.power.serviceRatio < 0.5 || this.utilitySnapshot.water.serviceRatio < 0.5) attractiveness = Math.min(attractiveness, 0.2);
    const affordabilityFactor = 0.85 + 0.15 * this.housingChoiceSnapshot.affordabilityIndex;
    attractiveness = clamp01(attractiveness * affordabilityFactor);
    this.population.update(this.buildings.residentialCapacity(), attractiveness);
    this.refreshLandHousingMarket();
    this.refreshHousingTenure();
    this.housingRelocation.reconcile({ population: this.population.population, options: this.housingTenureSnapshot.options, allowVoluntaryMoves: true });
    this.refreshHousingChoice();
    this.refreshRedevelopmentPressure();
    this.refreshRedevelopmentExecution();
  }

  private evaluateDevelopmentMarket(): void {
    this.refreshLandHousingMarket();
    this.refreshHousingTenure();
    this.syncHousingPopulationWithoutVoluntaryMoves();
    this.refreshHousingChoice();
    this.refreshRedevelopmentPressure();
    const redevelopment = this.refreshRedevelopmentExecution();
    const lots = this.lots.list().sort((a, b) => a.id.localeCompare(b.id));
    const occupiedLots = new Set(this.buildings.list().map((building) => building.lotId));
    const opportunities: DevelopmentFeasibilityResult[] = [];
    for (const lot of lots) {
      if (occupiedLots.has(lot.id) || this.demandSnapshot[lot.zone] <= 0.05) continue;
      opportunities.push(...this.developmentFeasibility.evaluateLot(
        lot,
        BUILDING_VARIANTS[lot.zone],
        this.developmentContextForLot(lot),
      ));
    }
    opportunities.push(...redevelopment.opportunities);

    const marketInterestRate = this.currentDevelopmentInterestRate();
    const awards = this.developerMarket.allocate(opportunities, { tick: this.clock.tick, marketInterestRate });
    const lotsById = new Map(lots.map((lot) => [lot.id, lot] as const));
    const redevelopmentLotIds = new Set(redevelopment.opportunities.map((item) => item.lotId));
    for (const award of awards) {
      const lot = lotsById.get(award.lotId);
      if (!lot) {
        this.developerMarket.cancelProject(award.buildingId, 1);
        continue;
      }
      const housingBeforeAward = this.housingRelocation.snapshotState();
      try {
        if (redevelopmentLotIds.has(award.lotId)) {
          const existing = this.buildings.occupied().find((building) => building.lotId === award.lotId);
          if (existing?.zone === 'residential') this.housingRelocation.displaceBuilding(existing.id);
          const { removed } = this.buildings.replaceDevelopment(this.clock.tick, lot, award);
          this.economyDomain.removeBuilding(removed.id, this.clock.tick);
          if (removed.zone === 'residential') {
            this.refreshLandHousingMarket();
            this.refreshHousingTenure();
            this.housingRelocation.reconcile({ population: this.population.population, options: this.housingTenureSnapshot.options, allowVoluntaryMoves: false });
            this.refreshHousingChoice();
          }
        } else {
          this.buildings.startDevelopment(this.clock.tick, lot, award);
        }
      } catch (error) {
        this.housingRelocation.restoreState(housingBeforeAward);
        this.refreshHousingTenure();
        this.housingRelocation.refreshSnapshot(this.population.population, this.housingTenureSnapshot.options);
        this.developerMarket.cancelProject(award.buildingId, 1);
        throw error;
      }
    }

    if (awards.length > 0) {
      this.refreshLandHousingMarket();
      this.refreshHousingTenure();
      this.housingRelocation.refreshSnapshot(this.population.population, this.housingTenureSnapshot.options);
      this.refreshHousingChoice();
      this.refreshRedevelopmentPressure();
      this.refreshRedevelopmentExecution();
    }
  }

  private localParcelContextForLot(lot: Lot): LocalParcelContext {
    const [roadXText, roadYText] = lot.frontageRoadKey.split(',');
    const frontage = this.roads.get(Number(roadXText), Number(roadYText));
    const roadAccessBonus = frontage?.type === 'arterial' ? 0.12 : frontage?.type === 'collector' ? 0.07 : 0.02;
    const personAccessibility = clamp01(this.mobilitySnapshot.personAccessibility + roadAccessBonus);
    const freightAccessibility = clamp01(this.trafficSnapshot.jobAccessibility + roadAccessBonus);
    const facilities = this.utilities.listFacilities();
    const hasPower = facilities.some((facility) => facility.type === 'power');
    const hasWater = facilities.some((facility) => facility.type === 'water');
    const utilityRatio = hasPower && hasWater
      ? Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio)
      : 0;
    const hasServices = this.services.listFacilities().length > 0;
    const serviceQuality = hasServices
      ? (lot.zone === 'commercial' ? this.neighborhoodSnapshot.commercialServiceQuality : this.neighborhoodSnapshot.citywideServiceQuality)
      : 0.7;
    const neighborhoodQuality = clamp01(serviceQuality * 0.7 + personAccessibility * 0.3);
    const constructionCostIndex = clamp(1 + (1 - utilityRatio) * 0.20 + (1 - serviceQuality) * 0.10, 0.85, 1.50);
    const baseZoningMaxIntensity: BuildingIntensity = personAccessibility >= 0.78 && utilityRatio >= 0.85
      ? 'high'
      : personAccessibility >= 0.55 ? 'medium' : 'low';
    const zoningMaxIntensity = this.developmentPolicy.adjustMaxIntensity(lot.zone, baseZoningMaxIntensity);
    return {
      roadAccessBonus,
      personAccessibility,
      freightAccessibility,
      serviceQuality,
      neighborhoodQuality,
      utilityRatio,
      constructionCostIndex,
      zoningMaxIntensity,
    };
  }

  private developmentContextForLot(lot: Lot): DevelopmentParcelContext {
    const local = this.localParcelContextForLot(lot);
    const marketSignal = this.landHousingMarket.parcelSignal(lot.zone, {
      personAccessibility: local.personAccessibility,
      freightAccessibility: local.freightAccessibility,
      serviceQuality: local.serviceQuality,
      neighborhoodQuality: local.neighborhoodQuality,
      utilityRatio: local.utilityRatio,
      frontageAccessBonus: local.roadAccessBonus,
    });
    const policy = this.developmentPolicy.snapshot();
    return {
      demand: this.demandSnapshot[lot.zone],
      taxRate: this.taxes.getRate(lot.zone),
      personAccessibility: local.personAccessibility,
      freightAccessibility: local.freightAccessibility,
      serviceQuality: local.serviceQuality,
      neighborhoodQuality: local.neighborhoodQuality,
      utilityRatio: local.utilityRatio,
      constructionCostIndex: local.constructionCostIndex,
      marketInterestRate: this.currentDevelopmentInterestRate(),
      zoningMaxIntensity: local.zoningMaxIntensity,
      policyAffordableHousingShare: lot.zone === 'residential' ? policy.affordableHousingShare : 0,
      policyDevelopmentFeeRate: policy.developmentFeeRate,
      policyPermittingCostReduction: policy.permittingCostReduction,
      ...marketSignal,
    };
  }

  private refreshHousingTenure(): HousingTenureSnapshot {
    const lotsById = new Map(this.lots.list().map((lot) => [lot.id, lot] as const));
    const inputs = [];
    const rentFactor = this.developmentPolicy.residentialRentFactor();
    for (const building of this.buildings.occupied()) {
      if (building.zone !== 'residential') continue;
      const lot = lotsById.get(building.lotId);
      if (!lot) continue;
      const definition = definitionForBuilding(building);
      const local = this.localParcelContextForLot(lot);
      const market = this.landHousingMarket.parcelSignal('residential', {
        personAccessibility: local.personAccessibility,
        freightAccessibility: local.freightAccessibility,
        serviceQuality: local.serviceQuality,
        neighborhoodQuality: local.neighborhoodQuality,
        utilityRatio: local.utilityRatio,
        frontageAccessBonus: local.roadAccessBonus,
      });
      inputs.push({
        buildingId: building.id,
        intensity: definition.intensity,
        capacity: definition.residentCapacity,
        askingRent: definition.baseRent * market.marketRentMultiplier * rentFactor,
        personAccessibility: local.personAccessibility,
        serviceQuality: local.serviceQuality,
        neighborhoodQuality: local.neighborhoodQuality,
        utilityRatio: local.utilityRatio,
      });
    }
    return this.housingTenure.evaluate(this.currentDevelopmentInterestRate(), inputs);
  }

  private syncHousingPopulationWithoutVoluntaryMoves(): HousingRelocationSnapshot {
    const state = this.housingRelocation.snapshotState();
    const represented = state.allocations.reduce((sum, item) => sum + item.residents, 0)
      + state.unplaced.reduce((sum, item) => sum + item.residents, 0);
    if (Math.abs(represented - this.population.population) > 1e-6) {
      return this.housingRelocation.reconcile({
        population: this.population.population,
        options: this.housingTenureSnapshot.options,
        allowVoluntaryMoves: false,
      });
    }
    return this.housingRelocation.refreshSnapshot(this.population.population, this.housingTenureSnapshot.options);
  }

  private refreshHousingChoice(): HousingChoiceSnapshot {
    return this.housingChoice.evaluateFromRelocation(
      this.population.population,
      this.housingTenureSnapshot.options,
      this.housingRelocation.snapshotState(),
      this.housingRelocationSnapshot,
    );
  }

  private lowerIncomeAffordableSlackExcluding(buildingId: string): number {
    const state = this.housingRelocation.snapshotState();
    let slack = 0;
    for (const option of this.housingTenureSnapshot.options) {
      if (option.buildingId === buildingId || housingAffordabilityScore(option.monthlyCost, 'lower') <= 0) continue;
      const assigned = state.allocations
        .filter((allocation) => allocation.buildingId === option.buildingId && allocation.tenure === option.tenure)
        .reduce((sum, allocation) => sum + allocation.residents, 0);
      slack += Math.max(0, option.capacity - assigned);
    }
    return slack;
  }

  private refreshRedevelopmentPressure(): RedevelopmentPressureSnapshot {
    const lotsById = new Map(this.lots.list().map((lot) => [lot.id, lot] as const));
    const inputs: ResidentialRedevelopmentInput[] = [];
    const occupiedResidential = this.buildings.occupied()
      .filter((building) => building.zone === 'residential')
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const building of occupiedResidential) {
      const lot = lotsById.get(building.lotId);
      if (!lot) continue;
      const existingDefinition = definitionForBuilding(building);
      const context = this.developmentContextForLot(lot);
      const existingEvaluation = this.redevelopmentFeasibility.evaluateLot(lot, [existingDefinition], context)[0];
      if (!existingEvaluation) continue;
      const replacements = BUILDING_VARIANTS.residential
        .filter((candidate) => INTENSITY_RANK[candidate.intensity] > INTENSITY_RANK[existingDefinition.intensity]);
      const replacementEvaluations = replacements.length > 0
        ? this.redevelopmentFeasibility.evaluateLot(lot, replacements, context)
        : [];
      inputs.push({
        buildingId: building.id,
        lotId: lot.id,
        existingDefinitionId: existingDefinition.id,
        existingBaseConstructionCost: existingDefinition.baseConstructionCost,
        assignedResidents: this.housingChoiceSnapshot.byBuilding[building.id]?.assignedResidents ?? 0,
        existingEvaluation,
        replacementEvaluations,
      });
    }

    return this.redevelopmentPressure.evaluate(inputs);
  }

  private refreshRedevelopmentExecution(): RedevelopmentExecutionSnapshot {
    const lotsById = new Map(this.lots.list().map((lot) => [lot.id, lot] as const));
    const buildingsById = new Map(this.buildings.occupied().map((building) => [building.id, building] as const));
    const committedBuildingIds = new Set(this.developerMarket.listCommitments().map((commitment) => commitment.buildingId));
    const inputs: RedevelopmentExecutionInput[] = [];

    for (const pressure of this.redevelopmentPressure.snapshot().parcels) {
      if (!pressure.bestReplacementDefinitionId) continue;
      const building = buildingsById.get(pressure.buildingId);
      const lot = lotsById.get(pressure.lotId);
      if (!building || !lot || building.zone !== 'residential') continue;
      const replacement = BUILDING_VARIANTS.residential.find((candidate) => candidate.id === pressure.bestReplacementDefinitionId);
      if (!replacement) continue;
      const replacementEvaluation = this.redevelopmentFeasibility.evaluateLot(
        lot,
        [replacement],
        this.developmentContextForLot(lot),
      )[0];
      if (!replacementEvaluation) continue;
      const existingDefinition = definitionForBuilding(building);
      const displacedLowerIncomeResidents = this.housingRelocation.snapshotState().allocations
        .filter((allocation) => allocation.buildingId === building.id && allocation.band === 'lower')
        .reduce((sum, allocation) => sum + allocation.residents, 0);
      inputs.push({
        pressure,
        residentCapacity: existingDefinition.residentCapacity,
        affordabilityScore: this.housingChoiceSnapshot.byBuilding[building.id]?.affordabilityScore ?? 1,
        displacedLowerIncomeResidents,
        lowerIncomeAffordableSlack: this.lowerIncomeAffordableSlackExcluding(building.id),
        replacementEvaluation,
        activeCommitment: committedBuildingIds.has(building.id),
      });
    }

    return this.redevelopmentExecution.evaluate({
      population: this.population.population,
      physicalCapacity: this.housingChoiceSnapshot.physicalCapacity,
      effectiveAffordableCapacity: this.housingChoiceSnapshot.effectiveAffordableCapacity,
      unplacedResidents: this.housingChoiceSnapshot.unplacedResidents,
      minimumAffordableShare: this.developmentPolicy.snapshot().redevelopmentAffordableFloor,
      lowerIncomeRelocationProtection: this.developmentPolicy.snapshot().lowerIncomeRelocationProtection,
    }, inputs);
  }

  private refreshLandHousingMarket(): LandHousingMarketSnapshot {
    const hasServices = this.services.listFacilities().length > 0;
    const serviceQuality = hasServices ? this.neighborhoodSnapshot.citywideServiceQuality : 0.7;
    return this.landHousingMarket.evaluate({
      demand: this.demandSnapshot,
      population: this.population.population,
      residentialCapacity: this.buildings.residentialCapacity(),
      employmentUtilization: this.employmentSnapshot.totalJobs === 0
        ? 0
        : this.employmentSnapshot.employed / this.employmentSnapshot.totalJobs,
      personAccessibility: this.mobilitySnapshot.personAccessibility,
      freightAccessibility: this.trafficSnapshot.jobAccessibility,
      serviceQuality,
      utilityRatio: Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio),
    });
  }

  private currentDevelopmentInterestRate(): number {
    return clamp(0.045 + Math.max(0, this.economySnapshot.unpaidOperatingCost) / 1_000_000, 0.03, 0.12);
  }

  private mergeEdgeLoads(...sources: Readonly<Record<string, number>>[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const source of sources) {
      for (const [edgeId, load] of Object.entries(source)) result[edgeId] = (result[edgeId] ?? 0) + Math.max(0, load);
    }
    return result;
  }
}