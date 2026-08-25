import { clamp01 } from '../core/types.ts';
import type { RouteResult } from './PathfindingSystem.ts';
import type { TripPurpose, TripRequest } from './TripGenerationSystem.ts';
import type { IntersectionSystem } from './IntersectionSystem.ts';
import type { TransportationEdge, TransportationGraph } from './TransportationGraph.ts';

export type TrafficVehicleStatus = 'moving' | 'queued';

export type TrafficVehicle = Readonly<{
  id: string;
  tripId: string;
  purpose: TripPurpose;
  travelerWeight: number;
  originBuildingId: string;
  destinationBuildingId: string;
  edgeIds: readonly string[];
  currentEdgeIndex: number;
  edgeProgressTicks: number;
  departureTick: number;
  accumulatedDelayTicks: number;
  freeFlowTicks: number;
  status: TrafficVehicleStatus;
  queuedNodeId?: string;
}>;

type MutableTrafficVehicle = {
  id: string;
  tripId: string;
  purpose: TripPurpose;
  travelerWeight: number;
  originBuildingId: string;
  destinationBuildingId: string;
  edgeIds: string[];
  currentEdgeIndex: number;
  edgeProgressTicks: number;
  departureTick: number;
  accumulatedDelayTicks: number;
  freeFlowTicks: number;
  status: TrafficVehicleStatus;
  queuedNodeId?: string;
};

export type EdgeTrafficMetric = Readonly<{
  edgeId: string;
  weightedVehicles: number;
  utilization: number;
  congestion: number;
  averageSpeedCellsPerSecond: number;
  travelTimeTicks: number;
}>;

export type TripOutcome = Readonly<{
  tripId: string;
  purpose: TripPurpose;
  travelerWeight: number;
  success: boolean;
  freeFlowTicks: number;
  actualTravelTicks: number;
}>;

export type TrafficStateSnapshot = Readonly<{
  vehicles: readonly TrafficVehicle[];
  outcomes: readonly TripOutcome[];
  nextVehicleId: number;
  completedTrips: number;
  failedTrips: number;
  congestionEpoch: number;
}>;

export class TrafficSystem {
  private readonly vehicles = new Map<string, MutableTrafficVehicle>();
  private readonly outcomes: TripOutcome[] = [];
  private nextVehicleId = 1;
  edgeMetrics: EdgeTrafficMetric[] = [];
  completedTrips = 0;
  failedTrips = 0;
  congestionEpoch = 0;

  get activeVehicles(): TrafficVehicle[] {
    return [...this.vehicles.values()].map((vehicle) => this.copyVehicle(vehicle)).sort((a, b) => a.id.localeCompare(b.id));
  }

  get recentOutcomes(): readonly TripOutcome[] {
    return this.outcomes.map((outcome) => ({ ...outcome }));
  }

  getVehicle(id: string): TrafficVehicle | undefined {
    const vehicle = this.vehicles.get(id);
    return vehicle ? this.copyVehicle(vehicle) : undefined;
  }

  submitTrip(trip: TripRequest, route: RouteResult, tick: number, freeFlowTicks = route.totalCost): string | null {
    if (trip.travelerWeight <= 0) return null;
    if (route.edgeIds.length === 0) {
      this.completedTrips++;
      this.recordOutcome({
        tripId: trip.id,
        purpose: trip.purpose,
        travelerWeight: trip.travelerWeight,
        success: true,
        freeFlowTicks: Math.max(0, freeFlowTicks),
        actualTravelTicks: 0,
      });
      return null;
    }
    const id = `vehicle:${this.nextVehicleId++}`;
    this.vehicles.set(id, {
      id,
      tripId: trip.id,
      purpose: trip.purpose,
      travelerWeight: trip.travelerWeight,
      originBuildingId: trip.originBuildingId,
      destinationBuildingId: trip.destinationBuildingId,
      edgeIds: [...route.edgeIds],
      currentEdgeIndex: 0,
      edgeProgressTicks: 0,
      departureTick: tick,
      accumulatedDelayTicks: 0,
      freeFlowTicks: Math.max(0, freeFlowTicks),
      status: 'moving',
    });
    return id;
  }

  step(graph: TransportationGraph, intersections: IntersectionSystem, tick: number, extraEdgeLoads: Readonly<Record<string, number>> = {}): void {
    this.invalidateMissingRoutes(graph, intersections, tick);
    this.recoverOrphanedQueues(intersections, tick);

    for (const vehicle of this.vehicles.values()) {
      if (vehicle.status === 'queued') vehicle.accumulatedDelayTicks++;
    }

    const queuedNodes = Object.keys(intersections.snapshot()).sort();
    for (const nodeId of queuedNodes) {
      const released = intersections.stepNode(graph, nodeId, tick);
      for (const vehicleId of released) {
        const vehicle = this.vehicles.get(vehicleId);
        if (!vehicle || vehicle.status !== 'queued') continue;
        vehicle.currentEdgeIndex++;
        vehicle.edgeProgressTicks = 0;
        vehicle.status = 'moving';
        delete vehicle.queuedNodeId;
        intersections.removeVehicle(vehicleId);
      }
    }

    this.edgeMetrics = this.calculateEdgeMetrics(graph, extraEdgeLoads);
    if (tick % 10 === 0) this.congestionEpoch++;
    const metricByEdge = new Map(this.edgeMetrics.map((metric) => [metric.edgeId, metric]));

    const moving = [...this.vehicles.values()].filter((vehicle) => vehicle.status === 'moving').sort((a, b) => a.id.localeCompare(b.id));
    for (const vehicle of moving) {
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      if (!edgeId) {
        this.complete(vehicle, tick);
        continue;
      }
      const edge = graph.getEdge(edgeId);
      if (!edge) {
        this.fail(vehicle, intersections, tick);
        continue;
      }
      const travelTimeTicks = metricByEdge.get(edge.id)?.travelTimeTicks ?? edge.freeFlowTicks;
      vehicle.edgeProgressTicks += 1;
      if (vehicle.edgeProgressTicks + 1e-9 < travelTimeTicks) continue;

      const isLastEdge = vehicle.currentEdgeIndex >= vehicle.edgeIds.length - 1;
      if (isLastEdge) {
        this.complete(vehicle, tick);
        continue;
      }

      const nextEdgeId = vehicle.edgeIds[vehicle.currentEdgeIndex + 1];
      const nextEdge = nextEdgeId ? graph.getEdge(nextEdgeId) : undefined;
      if (!nextEdge) {
        this.fail(vehicle, intersections, tick);
        continue;
      }

      const isIntersection = graph.outgoingEdges(edge.to).length > 2;
      if (isIntersection) {
        vehicle.status = 'queued';
        vehicle.queuedNodeId = edge.to;
        vehicle.edgeProgressTicks = travelTimeTicks;
        intersections.enqueue(edge.to, edge.id, {
          vehicleId: vehicle.id,
          travelerWeight: vehicle.travelerWeight,
          queuedTick: tick,
        });
      } else {
        vehicle.currentEdgeIndex++;
        vehicle.edgeProgressTicks = 0;
      }
    }
  }

  getEdgeTravelTime(edge: TransportationEdge): number {
    return this.edgeMetrics.find((metric) => metric.edgeId === edge.id)?.travelTimeTicks ?? edge.freeFlowTicks;
  }

  snapshotState(): TrafficStateSnapshot {
    return {
      vehicles: this.activeVehicles,
      outcomes: this.recentOutcomes,
      nextVehicleId: this.nextVehicleId,
      completedTrips: this.completedTrips,
      failedTrips: this.failedTrips,
      congestionEpoch: this.congestionEpoch,
    };
  }

  restoreState(state: TrafficStateSnapshot): void {
    this.vehicles.clear();
    for (const vehicle of state.vehicles) {
      const restored: MutableTrafficVehicle = {
        id: vehicle.id,
        tripId: vehicle.tripId,
        purpose: vehicle.purpose,
        travelerWeight: vehicle.travelerWeight,
        originBuildingId: vehicle.originBuildingId,
        destinationBuildingId: vehicle.destinationBuildingId,
        edgeIds: [...vehicle.edgeIds],
        currentEdgeIndex: vehicle.currentEdgeIndex,
        edgeProgressTicks: vehicle.edgeProgressTicks,
        departureTick: vehicle.departureTick,
        accumulatedDelayTicks: vehicle.accumulatedDelayTicks,
        freeFlowTicks: vehicle.freeFlowTicks,
        status: vehicle.status,
      };
      if (vehicle.queuedNodeId !== undefined) restored.queuedNodeId = vehicle.queuedNodeId;
      this.vehicles.set(restored.id, restored);
    }
    this.outcomes.length = 0;
    this.outcomes.push(...state.outcomes.map((outcome) => ({ ...outcome })));
    this.nextVehicleId = Math.max(1, Math.floor(state.nextVehicleId));
    this.completedTrips = Math.max(0, Math.floor(state.completedTrips));
    this.failedTrips = Math.max(0, Math.floor(state.failedTrips));
    this.congestionEpoch = Math.max(0, Math.floor(state.congestionEpoch));
  }

  refreshMetrics(graph: TransportationGraph, extraEdgeLoads: Readonly<Record<string, number>> = {}): void {
    this.edgeMetrics = this.calculateEdgeMetrics(graph, extraEdgeLoads);
  }

  private calculateEdgeMetrics(graph: TransportationGraph, extraEdgeLoads: Readonly<Record<string, number>> = {}): EdgeTrafficMetric[] {
    const weightByEdge = new Map<string, number>();
    for (const vehicle of this.vehicles.values()) {
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      if (!edgeId || !graph.getEdge(edgeId)) continue;
      weightByEdge.set(edgeId, (weightByEdge.get(edgeId) ?? 0) + vehicle.travelerWeight);
    }

    return graph.edges.map((edge) => {
      const weightedVehicles = (weightByEdge.get(edge.id) ?? 0) + Math.max(0, extraEdgeLoads[edge.id] ?? 0);
      const utilization = edge.capacityPerMinute <= 0 ? 0 : weightedVehicles / edge.capacityPerMinute;
      const delayMultiplier = 1 + 3 * Math.pow(Math.max(0, utilization), 4);
      const averageSpeedCellsPerSecond = edge.freeFlowSpeedCellsPerSecond / delayMultiplier;
      const travelTimeTicks = edge.freeFlowTicks * delayMultiplier;
      const congestion = clamp01(1 - averageSpeedCellsPerSecond / edge.freeFlowSpeedCellsPerSecond);
      return { edgeId: edge.id, weightedVehicles, utilization, congestion, averageSpeedCellsPerSecond, travelTimeTicks };
    });
  }

  private recoverOrphanedQueues(intersections: IntersectionSystem, tick: number): void {
    const represented = new Set<string>();
    for (const approaches of Object.values(intersections.snapshot())) {
      for (const approach of approaches) for (const entry of approach.entries) represented.add(entry.vehicleId);
    }
    for (const vehicle of [...this.vehicles.values()]) {
      if (vehicle.status === 'queued' && !represented.has(vehicle.id)) this.fail(vehicle, intersections, tick);
    }
  }

  private invalidateMissingRoutes(graph: TransportationGraph, intersections: IntersectionSystem, tick: number): void {
    for (const vehicle of [...this.vehicles.values()]) {
      const remaining = vehicle.edgeIds.slice(vehicle.currentEdgeIndex);
      if (remaining.some((edgeId) => !graph.getEdge(edgeId))) this.fail(vehicle, intersections, tick);
    }
  }

  private complete(vehicle: MutableTrafficVehicle, tick: number): void {
    this.vehicles.delete(vehicle.id);
    this.completedTrips++;
    this.recordOutcome({
      tripId: vehicle.tripId,
      purpose: vehicle.purpose,
      travelerWeight: vehicle.travelerWeight,
      success: true,
      freeFlowTicks: vehicle.freeFlowTicks,
      actualTravelTicks: Math.max(vehicle.freeFlowTicks, tick - vehicle.departureTick + 1),
    });
  }

  private fail(vehicle: MutableTrafficVehicle, intersections: IntersectionSystem, tick: number): void {
    intersections.removeVehicle(vehicle.id);
    this.vehicles.delete(vehicle.id);
    this.failedTrips++;
    this.recordOutcome({
      tripId: vehicle.tripId,
      purpose: vehicle.purpose,
      travelerWeight: vehicle.travelerWeight,
      success: false,
      freeFlowTicks: vehicle.freeFlowTicks,
      actualTravelTicks: Math.max(1, tick - vehicle.departureTick + 1),
    });
  }

  private recordOutcome(outcome: TripOutcome): void {
    this.outcomes.push(Object.freeze({ ...outcome }));
    while (this.outcomes.length > 128) this.outcomes.shift();
  }

  private copyVehicle(vehicle: MutableTrafficVehicle): TrafficVehicle {
    const base = {
      id: vehicle.id,
      tripId: vehicle.tripId,
      purpose: vehicle.purpose,
      travelerWeight: vehicle.travelerWeight,
      originBuildingId: vehicle.originBuildingId,
      destinationBuildingId: vehicle.destinationBuildingId,
      edgeIds: [...vehicle.edgeIds],
      currentEdgeIndex: vehicle.currentEdgeIndex,
      edgeProgressTicks: vehicle.edgeProgressTicks,
      departureTick: vehicle.departureTick,
      accumulatedDelayTicks: vehicle.accumulatedDelayTicks,
      freeFlowTicks: vehicle.freeFlowTicks,
      status: vehicle.status,
    } as const;
    return vehicle.queuedNodeId === undefined ? base : { ...base, queuedNodeId: vehicle.queuedNodeId };
  }
}
