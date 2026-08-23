import { SeededRandom } from './SeededRandom.ts';
import { SimulationClock } from './SimulationClock.ts';
import { TreasurySystem } from '../treasury/TreasurySystem.ts';
import { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadPlacementResult } from '../../world/roads/RoadSystem.ts';
import { ZoningSystem } from '../zoning/ZoningSystem.ts';
import { LotSystem, type Lot } from '../../world/lots/LotSystem.ts';
import { BuildingSystem } from '../buildings/BuildingSystem.ts';
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
import { BUILDING_VARIANTS } from '../../data/buildings.ts';
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
import type { DevelopmentFeasibilityResult, DevelopmentParcelContext } from '../development/DevelopmentTypes.ts';
import { HousingMarketSystem } from '../housing/HousingMarketSystem.ts';
import type { HousingBuildingConditions, HousingMarketSnapshot } from '../housing/HousingTypes.ts';

export type SimulationCoreOptions = Readonly<{
  width?: number;
  height?: number;
  seed?: number;
  startingFunds?: number;
  terrain?: TerrainGrid;
}>;

const DEPARTMENTS: readonly ServiceDepartment[] = ['fire', 'police', 'healthcare', 'education', 'garbage'];

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
  readonly housing: HousingMarketSystem;

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
  housingSnapshot: HousingMarketSnapshot;
  serviceAccessByBuilding: Readonly<Record<string, BuildingServiceAccess>> = Object.freeze({});
  lastServiceGeneratedWaste = 0;

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
    this.developerMarket = new DeveloperMarketSystem();
    this.housing = new HousingMarketSystem();

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
    this.housingSnapshot = this.housing.snapshot();
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

  bulldozeAt(x: number, y: number): { ok: boolean; kind?: 'road' | 'building' | 'zone'; reason?: string } {
    const road = this.roads.remove(x, y);
    if (road) {
      this.lots.rebuild(this.roads, this.zoning);
      return { ok: true, kind: 'road' };
    }
    const building = this.buildings.removeAt(x, y);
    if (building) {
      this.economyDomain.removeBuilding(building.id, this.clock.tick);
      this.developerMarket.cancelProject(building.id, 0.50);
      return { ok: true, kind: 'building' };
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
        generateTrips: () => {
          if (this.clock.tick % 100 !== 0) return [];
          const occupied = this.buildings.occupied();
          const householdDemand = this.housing.travelDemand(this.economyDomain.firms.list());
          return this.personTrips.generate(
            this.clock.tick,
            occupied,
            this.population.population,
            this.employmentSnapshot.employed,
            this.transportationGraph,
            householdDemand.length > 0 ? householdDemand : undefined,
          );
        },
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
        this.evaluateHousingLoop();
        this.population.sync(this.housing.population());
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

  private evaluateHousingLoop(): void {
    const occupied = this.buildings.occupied();
    const hasServices = this.services.listFacilities().length > 0;
    const conditionsByBuilding: Record<string, HousingBuildingConditions> = {};
    for (const building of occupied.filter((item) => item.zone === 'residential')) {
      const utility = this.utilitySnapshot.perBuilding[building.id] ?? { power: 0, water: 0 };
      const serviceQuality = hasServices
        ? (this.neighborhoodSnapshot.perBuilding[building.id]?.combinedServiceQuality ?? this.neighborhoodSnapshot.citywideServiceQuality)
        : 0.7;
      const accessibility = clamp01(this.mobilitySnapshot.personAccessibility);
      conditionsByBuilding[building.id] = Object.freeze({
        quality: clamp01(serviceQuality),
        accessibility,
        services: clamp01(serviceQuality),
        neighborhood: clamp01(serviceQuality * 0.7 + accessibility * 0.3),
        habitability: clamp01(Math.min(utility.power, utility.water)),
      });
    }
    this.housingSnapshot = this.housing.tick({
      tick: this.clock.tick,
      buildings: occupied,
      firms: this.economyDomain.firms.list(),
      marketInterestRate: this.currentDevelopmentInterestRate(),
      employmentVacancies: this.employmentSnapshot.vacancies,
      conditionsByBuilding: Object.freeze(conditionsByBuilding),
    });
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
    this.demandSnapshot = this.demand.evaluate({
      population: this.population.population,
      housingCapacity: this.buildings.residentialCapacity(),
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
    this.population.sync(this.housing.population());
  }

  private evaluateDevelopmentMarket(): void {
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

    const marketInterestRate = this.currentDevelopmentInterestRate();
    const awards = this.developerMarket.allocate(opportunities, { tick: this.clock.tick, marketInterestRate });
    const lotsById = new Map(lots.map((lot) => [lot.id, lot] as const));
    for (const award of awards) {
      const lot = lotsById.get(award.lotId);
      if (!lot) {
        this.developerMarket.cancelProject(award.buildingId, 1);
        continue;
      }
      try {
        this.buildings.startDevelopment(this.clock.tick, lot, award);
      } catch (error) {
        this.developerMarket.cancelProject(award.buildingId, 1);
        throw error;
      }
    }
  }

  private developmentContextForLot(lot: Lot): DevelopmentParcelContext {
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
    const zoningMaxIntensity = personAccessibility >= 0.78 && utilityRatio >= 0.85
      ? 'high'
      : personAccessibility >= 0.55 ? 'medium' : 'low';
    return {
      demand: this.demandSnapshot[lot.zone],
      taxRate: this.taxes.getRate(lot.zone),
      personAccessibility,
      freightAccessibility,
      serviceQuality,
      neighborhoodQuality,
      utilityRatio,
      constructionCostIndex,
      marketInterestRate: this.currentDevelopmentInterestRate(),
      zoningMaxIntensity,
    };
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
