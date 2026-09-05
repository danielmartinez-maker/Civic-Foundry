import { desktopNativeEngineAddonFromGlobal, hasDesktopNativeHost } from "./DesktopNativeEngineAddon.ts";
import { NativeEngineBridge } from "./NativeEngineBridge.ts";
import type { NativeTransportationSnapshot } from "./NativeEngineTypes.ts";
import type { MobilityPersonTrip } from "../simulation/mobility/MobilityScheduler.ts";
import type { TrafficStateSnapshot, TrafficVehicle, TrafficSystem } from "../simulation/traffic/TrafficSystem.ts";
import type { TransportationGraph } from "../simulation/traffic/TransportationGraph.ts";
import type { RoadSystem } from "../world/roads/RoadSystem.ts";

function legacyJunctionId(nodeId: string): string {
  if (!nodeId.startsWith("n:")) throw new Error(`native transportation requires legacy road node id, got ${nodeId}`);
  return `j:legacy:${nodeId.slice(2)}`;
}

function legacyNodeId(junctionId: string): string {
  if (!junctionId.startsWith("j:legacy:")) throw new Error(`native transportation cannot project non-legacy junction ${junctionId}`);
  return `n:${junctionId.slice("j:legacy:".length)}`;
}

function tripPurpose(cause: string): "commute" | "shopping" {
  return cause === "home_to_shopping" ? "shopping" : "commute";
}

export class NativeTransportationRuntime {
  private readonly bridge: NativeEngineBridge;
  private nextSequence = 1;

  constructor(bridge: NativeEngineBridge) { this.bridge = bridge; }

  static fromDesktopGlobal(seed: number, scope: unknown = globalThis): NativeTransportationRuntime | null {
    const addon = desktopNativeEngineAddonFromGlobal(scope);
    if (!addon) {
      if (hasDesktopNativeHost(scope)) throw new Error("Civic Foundry desktop requires the native transportation addon");
      return null;
    }
    return new NativeTransportationRuntime(new NativeEngineBridge(addon, { seed, startTick: 0, speed: 1 }));
  }

  dispose(): void { this.bridge.dispose(); }
  get tick(): number { return this.bridge.snapshot().tick; }

  snapshot(): NativeTransportationSnapshot {
    const transportation = this.bridge.snapshot().transportation;
    if (!transportation) throw new Error("native transportation snapshot is missing");
    return transportation;
  }

  syncRoads(roads: RoadSystem): void {
    this.submitAt(this.tick, "transport.legacy_roads.replace", {
      revision: roads.revision,
      cells: roads.list().map((cell) => ({ x: cell.x, y: cell.y, roadClass: cell.type })),
    });
  }

  submitCarTrip(trip: MobilityPersonTrip, travelerWeight: number): void {
    if (!trip.originRoadNodeId || !trip.destinationRoadNodeId) throw new Error("native car trip requires road endpoints");
    this.submitAt(trip.departureTick, "transport.road_trip.submit", {
      tripId: trip.id,
      cause: trip.purpose,
      travelerWeight,
      originId: trip.originBuildingId,
      destinationId: trip.destinationBuildingId,
      startJunctionId: legacyJunctionId(trip.originRoadNodeId),
      endJunctionId: legacyJunctionId(trip.destinationRoadNodeId),
    });
  }

  step(ticks = 1): void { this.bridge.step(ticks); }
  loadV9(save: unknown): void { this.bridge.loadV9(save); }
  saveV9<T = unknown>(): T { return this.bridge.saveV9<T>(); }

  projectTraffic(
    graph: TransportationGraph,
    traffic: TrafficSystem,
    extraEdgeLoads: Readonly<Record<string, number>> = {},
  ): void {
    const transportation = this.snapshot();
    const edgeByCarriageway = new Map<string, string>();
    for (const carriageway of transportation.carriageways) {
      const edgeId = `e:${legacyNodeId(carriageway.fromJunctionId)}>${legacyNodeId(carriageway.toJunctionId)}`;
      if (!graph.getEdge(edgeId)) throw new Error(`native carriageway ${carriageway.id} has no compatibility edge ${edgeId}`);
      edgeByCarriageway.set(carriageway.id, edgeId);
    }
    const vehicles: TrafficVehicle[] = transportation.roadTraffic.vehicles.map((vehicle) => {
      const edgeIds = vehicle.carriagewayIds.map((id) => {
        const edgeId = edgeByCarriageway.get(id);
        if (!edgeId) throw new Error(`native vehicle ${vehicle.id} references unprojectable carriageway ${id}`);
        return edgeId;
      });
      const base = {
        id: vehicle.id,
        tripId: vehicle.tripId,
        purpose: tripPurpose(vehicle.cause),
        travelerWeight: vehicle.travelerWeight,
        originBuildingId: vehicle.originId,
        destinationBuildingId: vehicle.destinationId,
        edgeIds: Object.freeze(edgeIds),
        currentEdgeIndex: vehicle.currentCarriagewayIndex,
        edgeProgressTicks: vehicle.carriagewayProgressTicks,
        departureTick: vehicle.departureTick,
        accumulatedDelayTicks: vehicle.accumulatedDelayTicks,
        freeFlowTicks: vehicle.freeFlowTicks,
        status: vehicle.status,
      } as const;
      return vehicle.queuedJunctionId === null ? base : Object.freeze({ ...base, queuedNodeId: legacyNodeId(vehicle.queuedJunctionId) });
    });
    const state: TrafficStateSnapshot = Object.freeze({
      vehicles: Object.freeze(vehicles),
      outcomes: Object.freeze([]),
      nextVehicleId: transportation.roadTraffic.nextVehicleId,
      completedTrips: transportation.roadTraffic.completedTrips,
      failedTrips: transportation.roadTraffic.failedTrips,
      congestionEpoch: transportation.roadTraffic.congestionEpoch,
    });
    traffic.restoreState(state);
    traffic.refreshMetrics(graph, extraEdgeLoads);
  }

  private submitAt(tick: number, type: string, payload: unknown): void {
    this.bridge.submit([{ sequence: this.nextSequence++, tick, type, payload }]);
  }
}
