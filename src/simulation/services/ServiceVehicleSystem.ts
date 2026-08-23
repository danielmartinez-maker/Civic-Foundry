import { SERVICE_DEFINITIONS, type ServiceDepartment, type ServiceVehicleType } from '../../data/services.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';
import type { RouteResult, PathfindingSystem } from '../traffic/PathfindingSystem.ts';
import type { IntersectionSystem } from '../traffic/IntersectionSystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';

export type ServiceVehicleState = 'idle' | 'outbound' | 'servicing' | 'returning' | 'unavailable';

export type ServiceVehicle = Readonly<{
  id: string;
  facilityId: string;
  department: ServiceDepartment;
  vehicleType: ServiceVehicleType;
  currentJobId: string | null;
  edgeIds: readonly string[];
  returnEdgeIds: readonly string[];
  currentEdgeIndex: number;
  edgeProgressTicks: number;
  currentSpeed: number;
  state: ServiceVehicleState;
  accumulatedDelayTicks: number;
  currentNodeId: string | null;
  destinationNodeId: string | null;
  homeNodeId: string | null;
  queuedNodeId?: string;
  serviceRemainingTicks: number;
}>;

type MutableVehicle = {
  id: string;
  facilityId: string;
  department: ServiceDepartment;
  vehicleType: ServiceVehicleType;
  currentJobId: string | null;
  edgeIds: string[];
  returnEdgeIds: string[];
  currentEdgeIndex: number;
  edgeProgressTicks: number;
  currentSpeed: number;
  state: ServiceVehicleState;
  accumulatedDelayTicks: number;
  currentNodeId: string | null;
  destinationNodeId: string | null;
  homeNodeId: string | null;
  queuedNodeId?: string;
  serviceRemainingTicks: number;
};

export type ServiceVehicleEvent = Readonly<{
  type: 'arrived' | 'returning' | 'completed' | 'failed';
  vehicleId: string;
  jobId: string;
}>;

const isEmergency = (type: ServiceVehicleType): boolean => type !== 'garbage_truck';

export class ServiceVehicleSystem {
  private readonly vehicles = new Map<string, MutableVehicle>();

  syncFleet(facilities: ServiceFacilitySystem): void {
    const valid = new Set<string>();
    for (const facility of facilities.listFacilities()) {
      const definition = SERVICE_DEFINITIONS[facility.type];
      if (!definition.vehicleType) continue;
      const active = facilities.activeVehicleCount(facility.id);
      for (let i = 1; i <= definition.baseVehicleCount; i++) {
        const id = `service-vehicle:${facility.id}:${i}`;
        valid.add(id);
        const existing = this.vehicles.get(id);
        const shouldBeAvailable = i <= active;
        if (!existing) {
          this.vehicles.set(id, {
            id, facilityId: facility.id, department: facility.department, vehicleType: definition.vehicleType,
            currentJobId: null, edgeIds: [], returnEdgeIds: [], currentEdgeIndex: 0, edgeProgressTicks: 0,
            currentSpeed: 0, state: shouldBeAvailable ? 'idle' : 'unavailable', accumulatedDelayTicks: 0,
            currentNodeId: null, destinationNodeId: null, homeNodeId: null, serviceRemainingTicks: 0,
          });
        } else if (existing.currentJobId === null) {
          existing.state = shouldBeAvailable ? 'idle' : 'unavailable';
        }
      }
    }
    for (const id of [...this.vehicles.keys()]) if (!valid.has(id)) this.vehicles.delete(id);
  }

  listVehicles(): ServiceVehicle[] {
    return [...this.vehicles.values()].map((vehicle) => this.copy(vehicle)).sort((a, b) => a.id.localeCompare(b.id));
  }

  getVehicle(id: string): ServiceVehicle | undefined {
    const vehicle = this.vehicles.get(id);
    return vehicle ? this.copy(vehicle) : undefined;
  }

  restore(vehicles: readonly ServiceVehicle[]): void {
    this.vehicles.clear();
    for (const vehicle of vehicles) {
      const restored: MutableVehicle = {
        ...vehicle, edgeIds: [...vehicle.edgeIds], returnEdgeIds: [...vehicle.returnEdgeIds],
      };
      this.vehicles.set(restored.id, restored);
    }
  }

  availableVehicleIds(facilityId: string): string[] {
    return [...this.vehicles.values()]
      .filter((vehicle) => vehicle.facilityId === facilityId && vehicle.state === 'idle' && vehicle.currentJobId === null)
      .map((vehicle) => vehicle.id)
      .sort();
  }

  dispatchVehicle(
    vehicleId: string,
    jobId: string,
    outbound: RouteResult,
    returnRoute: RouteResult,
    homeNodeId: string,
    destinationNodeId: string,
  ): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle || vehicle.state !== 'idle' || vehicle.currentJobId !== null || outbound.edgeIds.length === 0) return false;
    vehicle.currentJobId = jobId;
    vehicle.edgeIds = [...outbound.edgeIds];
    vehicle.returnEdgeIds = [...returnRoute.edgeIds];
    vehicle.currentEdgeIndex = 0;
    vehicle.edgeProgressTicks = 0;
    vehicle.currentSpeed = 0;
    vehicle.state = 'outbound';
    vehicle.accumulatedDelayTicks = 0;
    vehicle.currentNodeId = homeNodeId;
    vehicle.homeNodeId = homeNodeId;
    vehicle.destinationNodeId = destinationNodeId;
    vehicle.serviceRemainingTicks = 0;
    delete vehicle.queuedNodeId;
    return true;
  }

  step(
    graph: TransportationGraph,
    intersections: IntersectionSystem,
    pathfinding: PathfindingSystem,
    edgeCost: (edge: TransportationEdge) => number,
    _tick: number,
  ): ServiceVehicleEvent[] {
    const events: ServiceVehicleEvent[] = [];

    for (const vehicle of this.vehicles.values()) {
      if (vehicle.queuedNodeId) vehicle.accumulatedDelayTicks++;
      if ((vehicle.state === 'outbound' || vehicle.state === 'returning') && !this.ensureValidRoute(vehicle, graph, pathfinding, edgeCost)) {
        if (vehicle.currentJobId) events.push({ type: 'failed', vehicleId: vehicle.id, jobId: vehicle.currentJobId });
        intersections.removeVehicle(vehicle.id);
        this.resetIdle(vehicle);
      }
    }

    for (const nodeId of Object.keys(intersections.snapshot()).sort()) {
      for (const vehicleId of intersections.stepNode(graph, nodeId)) {
        const vehicle = this.vehicles.get(vehicleId);
        if (!vehicle || !vehicle.queuedNodeId) continue;
        vehicle.currentEdgeIndex++;
        vehicle.edgeProgressTicks = 0;
        vehicle.currentNodeId = vehicle.queuedNodeId;
        delete vehicle.queuedNodeId;
      }
    }

    for (const vehicle of [...this.vehicles.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (vehicle.state === 'servicing') {
        vehicle.serviceRemainingTicks--;
        if (vehicle.serviceRemainingTicks <= 0 && vehicle.currentJobId) {
          vehicle.state = 'returning';
          vehicle.currentEdgeIndex = 0;
          vehicle.edgeProgressTicks = 0;
          vehicle.currentNodeId = vehicle.destinationNodeId;
          delete vehicle.queuedNodeId;
          events.push({ type: 'returning', vehicleId: vehicle.id, jobId: vehicle.currentJobId });
        }
        continue;
      }
      if (vehicle.state !== 'outbound' && vehicle.state !== 'returning') continue;
      if (vehicle.queuedNodeId) continue;
      const route = vehicle.state === 'outbound' ? vehicle.edgeIds : vehicle.returnEdgeIds;
      const edgeId = route[vehicle.currentEdgeIndex];
      if (!edgeId) {
        this.finishLeg(vehicle, events);
        continue;
      }
      const edge = graph.getEdge(edgeId);
      if (!edge) continue;
      const travelTicks = this.edgeTravelTicks(vehicle, edge, edgeCost);
      vehicle.currentSpeed = edge.lengthCells / Math.max(0.1, travelTicks / 10);
      vehicle.edgeProgressTicks++;
      if (vehicle.edgeProgressTicks + 1e-9 < travelTicks) continue;
      vehicle.currentNodeId = edge.to;
      const isLast = vehicle.currentEdgeIndex >= route.length - 1;
      if (isLast) {
        this.finishLeg(vehicle, events);
        continue;
      }
      const isIntersection = graph.outgoingEdges(edge.to).length > 2;
      if (isIntersection) {
        vehicle.queuedNodeId = edge.to;
        vehicle.edgeProgressTicks = travelTicks;
        intersections.enqueue(edge.to, edge.id, {
          vehicleId: vehicle.id,
          travelerWeight: vehicle.vehicleType === 'garbage_truck' ? 2 : 1,
          queuedTick: _tick,
          priority: isEmergency(vehicle.vehicleType) ? 'emergency' : 'normal',
        });
      } else {
        vehicle.currentEdgeIndex++;
        vehicle.edgeProgressTicks = 0;
      }
    }
    return events;
  }

  edgeLoads(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.state !== 'outbound' && vehicle.state !== 'returning') continue;
      const route = vehicle.state === 'outbound' ? vehicle.edgeIds : vehicle.returnEdgeIds;
      const edgeId = route[vehicle.currentEdgeIndex];
      if (!edgeId) continue;
      result[edgeId] = (result[edgeId] ?? 0) + (vehicle.vehicleType === 'garbage_truck' ? 2 : 1);
    }
    return result;
  }

  private ensureValidRoute(vehicle: MutableVehicle, graph: TransportationGraph, pathfinding: PathfindingSystem, edgeCost: (edge: TransportationEdge) => number): boolean {
    const route = vehicle.state === 'outbound' ? vehicle.edgeIds : vehicle.returnEdgeIds;
    if (route.slice(vehicle.currentEdgeIndex).every((edgeId) => graph.getEdge(edgeId))) return true;
    const start = vehicle.currentNodeId;
    const end = vehicle.state === 'outbound' ? vehicle.destinationNodeId : vehicle.homeNodeId;
    if (!start || !end || !graph.getNode(start) || !graph.getNode(end)) return false;
    const reroute = pathfinding.findRoute(graph, start, end, {
      edgeCost: (edge) => this.edgeTravelTicks(vehicle, edge, edgeCost),
      costKey: `service-reroute:${vehicle.vehicleType}`,
    });
    if (!reroute || reroute.edgeIds.length === 0) return false;
    if (vehicle.state === 'outbound') vehicle.edgeIds = [...reroute.edgeIds];
    else vehicle.returnEdgeIds = [...reroute.edgeIds];
    vehicle.currentEdgeIndex = 0;
    vehicle.edgeProgressTicks = 0;
    delete vehicle.queuedNodeId;
    return true;
  }

  private edgeTravelTicks(vehicle: MutableVehicle, edge: TransportationEdge, edgeCost: (edge: TransportationEdge) => number): number {
    const raw = Math.max(edge.freeFlowTicks, edgeCost(edge));
    if (!isEmergency(vehicle.vehicleType)) return raw;
    return edge.freeFlowTicks + (raw - edge.freeFlowTicks) * 0.55;
  }

  private finishLeg(vehicle: MutableVehicle, events: ServiceVehicleEvent[]): void {
    const jobId = vehicle.currentJobId;
    if (!jobId) return;
    if (vehicle.state === 'outbound') {
      vehicle.state = 'servicing';
      vehicle.currentEdgeIndex = 0;
      vehicle.edgeProgressTicks = 0;
      vehicle.currentNodeId = vehicle.destinationNodeId;
      vehicle.serviceRemainingTicks = 10;
      events.push({ type: 'arrived', vehicleId: vehicle.id, jobId });
    } else if (vehicle.state === 'returning') {
      events.push({ type: 'completed', vehicleId: vehicle.id, jobId });
      this.resetIdle(vehicle);
    }
  }

  private resetIdle(vehicle: MutableVehicle): void {
    vehicle.currentJobId = null;
    vehicle.edgeIds = [];
    vehicle.returnEdgeIds = [];
    vehicle.currentEdgeIndex = 0;
    vehicle.edgeProgressTicks = 0;
    vehicle.currentSpeed = 0;
    vehicle.state = 'idle';
    vehicle.currentNodeId = vehicle.homeNodeId;
    vehicle.destinationNodeId = null;
    vehicle.serviceRemainingTicks = 0;
    delete vehicle.queuedNodeId;
  }

  private copy(vehicle: MutableVehicle): ServiceVehicle {
    const base: ServiceVehicle = {
      id: vehicle.id, facilityId: vehicle.facilityId, department: vehicle.department, vehicleType: vehicle.vehicleType,
      currentJobId: vehicle.currentJobId, edgeIds: [...vehicle.edgeIds], returnEdgeIds: [...vehicle.returnEdgeIds],
      currentEdgeIndex: vehicle.currentEdgeIndex, edgeProgressTicks: vehicle.edgeProgressTicks, currentSpeed: vehicle.currentSpeed,
      state: vehicle.state, accumulatedDelayTicks: vehicle.accumulatedDelayTicks, currentNodeId: vehicle.currentNodeId,
      destinationNodeId: vehicle.destinationNodeId, homeNodeId: vehicle.homeNodeId, serviceRemainingTicks: vehicle.serviceRemainingTicks,
      ...(vehicle.queuedNodeId ? { queuedNodeId: vehicle.queuedNodeId } : {}),
    };
    return base;
  }
}
