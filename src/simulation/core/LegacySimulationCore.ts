import {
  SimulationCore as LegacySimulationCoreBase,
  type SimulationCoreOptions,
} from './LegacySimulationCoreBase.ts';
import { IntersectionControlSystem, type IntersectionControlDemandSnapshot } from '../transportation/IntersectionControlSystem.ts';
import { LegacyRoadNetworkAdapter } from '../transportation/LegacyRoadNetworkAdapter.ts';
import { buildLaneGroups } from '../transportation/LaneGroupBuilder.ts';
import { LegacyRouteMovementResolver } from '../transportation/LegacyRouteMovementResolver.ts';
import type {
  CarriagewayId,
  LaneGroup,
  TransportNetworkAuthority,
  TurnMovementId,
} from '../transportation/TransportNetworkTypes.ts';

export type { SimulationCoreOptions } from './LegacySimulationCoreBase.ts';

type TransportControlRuntime = Readonly<{
  authority: TransportNetworkAuthority;
  laneGroups: readonly LaneGroup[];
  resolver: LegacyRouteMovementResolver;
}>;

type LegacyPrivateBridge = Readonly<{
  mergeEdgeLoads(...sources: Readonly<Record<string, number>>[]): Record<string, number>;
  evaluateServiceLoop(): void;
  evaluateDevelopmentMarket(): void;
  evaluateCoreCityLoop(): void;
}> & {
  runLegacyV7Tick: () => void;
};

function canonicalNumberRecord(values: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
  ));
}

/**
 * Live SimulationCore entry point.
 *
 * The inherited implementation retains the V3-V8 surface and hydration state.
 * This layer replaces its registered tick callback with the 3R-B controller path,
 * leaving `intersections` as compatibility state only.
 */
export class SimulationCore extends LegacySimulationCoreBase {
  readonly intersectionControl = new IntersectionControlSystem();
  private readonly transportNetworkAdapter = new LegacyRoadNetworkAdapter();
  private controlRuntimeRoadRevision = -1;
  private controlRuntime: TransportControlRuntime | undefined;

  constructor(options: SimulationCoreOptions = {}) {
    super(options);
    const bridge = this as unknown as LegacyPrivateBridge;
    bridge.runLegacyV7Tick = () => this.runLive3RTick();
  }

  private runLive3RTick(): void {
    const bridge = this as unknown as LegacyPrivateBridge;
    this.transportationGraph.rebuildIfNeeded(this.roads);
    this.serviceVehicles.syncFleet(this.services);

    const runtime = this.syncTransportControlRuntime();
    this.intersectionControl.syncNetwork(
      runtime.authority,
      runtime.laneGroups,
      this.buildIntersectionDemand(runtime),
      this.clock.tick,
    );
    const released = new Set(this.intersectionControl.step(this.clock.tick));

    const serviceEvents = this.serviceVehicles.step(
      this.transportationGraph,
      this.intersectionControl,
      runtime.resolver,
      released,
      this.pathfinding,
      (edge) => this.traffic.getEdgeTravelTime(edge),
      this.clock.tick,
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
      width: this.terrain.width,
      height: this.terrain.height,
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
        ? this.personTrips.generate(
          this.clock.tick,
          this.buildings.occupied(),
          this.population.population,
          this.employmentSnapshot.employed,
          this.transportationGraph,
        )
        : [],
      submitCarTrip: (trip, travelerWeight, route) => {
        const freeFlowTicks = route.edgeIds.reduce(
          (sum, edgeId) => sum + (this.transportationGraph.getEdge(edgeId)?.freeFlowTicks ?? 0),
          0,
        );
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

    const edgeLoads = bridge.mergeEdgeLoads(
      this.serviceVehicles.edgeLoads(),
      this.mobility.vehicles.edgeLoads(),
      this.economyDomain.freightVehicles.edgeLoads(),
    );
    this.traffic.step(
      this.transportationGraph,
      this.intersectionControl,
      runtime.resolver,
      released,
      this.clock.tick,
      edgeLoads,
    );
    this.trafficSnapshot = this.trafficAnalytics.evaluate(
      this.traffic.edgeMetrics,
      this.traffic.recentOutcomes,
      this.traffic.activeVehicles.length,
    );
    this.buildings.tick(this.clock.tick);
    this.developerMarket.advance(this.clock.tick);

    if (this.clock.tick % 10 === 0) {
      bridge.evaluateServiceLoop();
      bridge.evaluateDevelopmentMarket();
    }
    if (this.clock.tick % 50 === 0) bridge.evaluateCoreCityLoop();
  }

  private syncTransportControlRuntime(): TransportControlRuntime {
    if (this.controlRuntime && this.controlRuntimeRoadRevision === this.roads.revision) {
      return this.controlRuntime;
    }

    const projection = this.transportNetworkAdapter.projectAuthorityIfNeeded(this.roads);
    const laneGroups = buildLaneGroups(projection.authority);
    this.controlRuntime = Object.freeze({
      authority: projection.authority,
      laneGroups,
      resolver: new LegacyRouteMovementResolver(projection.authority, laneGroups),
    });
    this.controlRuntimeRoadRevision = this.roads.revision;
    return this.controlRuntime;
  }

  private buildIntersectionDemand(runtime: TransportControlRuntime): IntersectionControlDemandSnapshot {
    const approachDemandPerMinute: Record<CarriagewayId, number> = {};
    const movementDemandPerMinute: Record<TurnMovementId, number> = {};
    const pedestrianDemandPerMinute: Record<string, number> = {};
    const movementById = new Map(runtime.authority.movements.map((movement) => [movement.id, movement] as const));
    const congestionByEdge = new Map(this.traffic.edgeMetrics.map((metric) => [metric.edgeId, metric.congestion] as const));

    for (const junction of [...runtime.authority.junctions].sort((a, b) => a.id.localeCompare(b.id))) {
      pedestrianDemandPerMinute[junction.id] = 0;
    }

    const addMovementDemand = (movementId: TurnMovementId, weight: number): void => {
      if (!Number.isFinite(weight) || weight <= 0) return;
      const movement = movementById.get(movementId);
      if (!movement) return;
      movementDemandPerMinute[movementId] = (movementDemandPerMinute[movementId] ?? 0) + weight;
      approachDemandPerMinute[movement.fromCarriagewayId] = (approachDemandPerMinute[movement.fromCarriagewayId] ?? 0) + weight;
    };

    for (const queued of [...this.intersectionControl.snapshot().queues]
      .sort((a, b) => a.queuedTick - b.queuedTick || a.vehicleId.localeCompare(b.vehicleId))) {
      const queuedTicks = Math.max(0, this.clock.tick - queued.queuedTick);
      const queuePressure = 1 + Math.min(1, queuedTicks / 600);
      addMovementDemand(queued.movementId, queued.travelerWeight * queuePressure);
    }

    for (const vehicle of this.traffic.activeVehicles) {
      if (vehicle.status !== 'moving') continue;
      const currentEdgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      const nextEdgeId = vehicle.edgeIds[vehicle.currentEdgeIndex + 1];
      if (!currentEdgeId || !nextEdgeId) continue;
      const resolved = runtime.resolver.resolve(currentEdgeId, nextEdgeId);
      if (!resolved) continue;
      const congestion = congestionByEdge.get(currentEdgeId) ?? 0;
      addMovementDemand(resolved.movementId, vehicle.travelerWeight * (1 + congestion));
    }

    for (const vehicle of this.serviceVehicles.listVehicles()) {
      if (vehicle.queuedNodeId || (vehicle.state !== 'outbound' && vehicle.state !== 'returning')) continue;
      const route = vehicle.state === 'outbound' ? vehicle.edgeIds : vehicle.returnEdgeIds;
      const currentEdgeId = route[vehicle.currentEdgeIndex];
      const nextEdgeId = route[vehicle.currentEdgeIndex + 1];
      if (!currentEdgeId || !nextEdgeId) continue;
      const resolved = runtime.resolver.resolve(currentEdgeId, nextEdgeId);
      if (!resolved) continue;
      const baseWeight = vehicle.vehicleType === 'garbage_truck' ? 2 : 1;
      const congestion = congestionByEdge.get(currentEdgeId) ?? 0;
      addMovementDemand(resolved.movementId, baseWeight * (1 + congestion));
    }

    return Object.freeze({
      approachDemandPerMinute: canonicalNumberRecord(approachDemandPerMinute),
      movementDemandPerMinute: canonicalNumberRecord(movementDemandPerMinute),
      pedestrianDemandPerMinute: canonicalNumberRecord(pedestrianDemandPerMinute),
    });
  }
}
