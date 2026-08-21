import { SeededRandom } from './SeededRandom.ts';
import { SimulationClock } from './SimulationClock.ts';
import { TreasurySystem } from '../treasury/TreasurySystem.ts';
import { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadPlacementResult } from '../../world/roads/RoadSystem.ts';
import { ZoningSystem } from '../zoning/ZoningSystem.ts';
import { LotSystem } from '../../world/lots/LotSystem.ts';
import { BuildingSystem } from '../buildings/BuildingSystem.ts';
import { PopulationSystem } from '../population/PopulationSystem.ts';
import { EmploymentSystem, type EmploymentSnapshot } from '../employment/EmploymentSystem.ts';
import { TaxSystem, type TaxRevenue } from '../tax/TaxSystem.ts';
import { DemandSystem, type DemandSnapshot } from '../demand/DemandSystem.ts';
import { UtilitySystem, type UtilitySnapshot } from '../utilities/UtilitySystem.ts';
import { GarbageSystem, type GarbageSnapshot } from '../garbage/GarbageSystem.ts';
import { EconomySystem, type EconomySnapshot } from '../economy/EconomySystem.ts';
import type { CellCoord, ZoneType } from './types.ts';
import { clamp01 } from './types.ts';
import type { RoadType } from '../../data/roads.ts';
import type { UtilityFacilityType } from '../../data/utilities.ts';
import { TransportationGraph } from '../traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../traffic/PathfindingSystem.ts';
import { TripGenerationSystem, type TripRequest } from '../traffic/TripGenerationSystem.ts';
import { IntersectionSystem } from '../traffic/IntersectionSystem.ts';
import { TrafficSystem } from '../traffic/TrafficSystem.ts';
import { TrafficAnalytics, type TrafficAnalyticsSnapshot } from '../traffic/TrafficAnalytics.ts';
import type { Building } from '../buildings/BuildingSystem.ts';

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

  employmentSnapshot: EmploymentSnapshot;
  utilitySnapshot: UtilitySnapshot;
  garbageSnapshot: GarbageSnapshot;
  demandSnapshot: DemandSnapshot;
  taxRevenue: TaxRevenue;
  economySnapshot: EconomySnapshot;
  trafficSnapshot: TrafficAnalyticsSnapshot;

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

    this.employmentSnapshot = this.employment.evaluate(0, 0);
    this.utilitySnapshot = this.utilities.evaluate([]);
    this.garbageSnapshot = { generated: 0, processed: 0, backlog: 0, serviceRatio: 1 };
    this.taxRevenue = this.taxes.calculateRevenue([]);
    this.demandSnapshot = this.demand.evaluate({
      population: 0,
      housingCapacity: 0,
      workforce: 0,
      employed: 0,
      totalJobs: 0,
      powerRatio: 1,
      waterRatio: 1,
      garbageRatio: 1,
      taxRates: this.taxes.getRates(),
      trafficJobAccessibility: 1,
      trafficCommercialAccessibility: 1,
    });
    this.economySnapshot = { ...this.economy.lastSettlement, cashBalance: this.treasury.balance };
    this.trafficSnapshot = this.trafficAnalytics.evaluate([], [], 0);
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

  bulldozeAt(x: number, y: number): { ok: boolean; kind?: 'road' | 'building' | 'zone'; reason?: string } {
    const road = this.roads.remove(x, y);
    if (road) {
      this.lots.rebuild(this.roads, this.zoning);
      return { ok: true, kind: 'road' };
    }
    const building = this.buildings.removeAt(x, y);
    if (building) return { ok: true, kind: 'building' };
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
      this.traffic.step(this.transportationGraph, this.intersections, this.clock.tick);
      this.trafficSnapshot = this.trafficAnalytics.evaluate(
        this.traffic.edgeMetrics,
        this.traffic.recentOutcomes,
        this.traffic.activeVehicles.length,
      );

      this.buildings.tick(this.clock.tick);

      if (this.clock.tick % 10 === 0) {
        this.buildings.evaluateDevelopment(this.clock.tick, this.lots.list(), this.demandSnapshot);
      }

      if (this.clock.tick % 50 === 0) {
        this.evaluateCoreCityLoop();
      }

      if (this.clock.tick % 100 === 0) {
        this.generateTraffic();
      }
    }
  }


  private generateTraffic(): void {
    const occupied = this.buildings.occupied();
    const trips = this.tripGeneration.generate(
      this.clock.tick,
      occupied,
      this.population.population,
      this.employmentSnapshot.employed,
    );
    for (const trip of trips) this.routeTrip(trip);
  }

  private routeTrip(trip: TripRequest): void {
    const origin = this.buildings.getById(trip.originBuildingId);
    const destination = this.buildings.getById(trip.destinationBuildingId);
    if (!origin || !destination) return;
    const start = this.accessNodeForBuilding(origin);
    const end = this.accessNodeForBuilding(destination);
    if (!start || !end || start === end) return;
    const route = this.pathfinding.findRoute(this.transportationGraph, start, end, {
      edgeCost: (edge) => this.traffic.getEdgeTravelTime(edge),
      costKey: `traffic:${this.traffic.congestionEpoch}`,
    });
    if (!route) return;
    const freeFlowTicks = route.edgeIds.reduce((sum, edgeId) => sum + (this.transportationGraph.getEdge(edgeId)?.freeFlowTicks ?? 0), 0);
    this.traffic.submitTrip(trip, route, this.clock.tick, freeFlowTicks);
  }

  private accessNodeForBuilding(building: Building): string | undefined {
    const candidates = [
      this.transportationGraph.findNodeAt(building.x, building.y - 1),
      this.transportationGraph.findNodeAt(building.x + 1, building.y),
      this.transportationGraph.findNodeAt(building.x, building.y + 1),
      this.transportationGraph.findNodeAt(building.x - 1, building.y),
    ].filter((node): node is NonNullable<typeof node> => node !== undefined);
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    return candidates[0]?.id;
  }

  private evaluateCoreCityLoop(): void {
    const occupied = this.buildings.occupied();
    this.utilitySnapshot = this.utilities.evaluate(occupied);
    this.garbageSnapshot = this.garbage.evaluate(occupied, this.roads, this.utilities.listFacilities());
    this.employmentSnapshot = this.employment.evaluate(this.population.population, this.buildings.jobCapacity());
    this.taxRevenue = this.taxes.calculateRevenue(occupied);

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
    });

    this.economySnapshot = this.economy.settle(this.treasury, this.taxRevenue, this.utilities.operatingCost());

    const essential = Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio, this.garbageSnapshot.serviceRatio);
    const employmentQuality = this.employmentSnapshot.workforce === 0 ? 1 : this.employmentSnapshot.employed / Math.max(1, this.employmentSnapshot.workforce);
    const fiscalQuality = this.economySnapshot.unpaidOperatingCost > 0 ? 0 : 1;
    let attractiveness = clamp01(0.6 * essential + 0.2 * employmentQuality + 0.2 * fiscalQuality);
    if (this.utilitySnapshot.power.serviceRatio < 0.5 || this.utilitySnapshot.water.serviceRatio < 0.5 || this.garbageSnapshot.serviceRatio < 0.5) {
      attractiveness = Math.min(attractiveness, 0.2);
    }
    this.population.update(this.buildings.residentialCapacity(), attractiveness);
  }
}
