import { TrafficSystem } from "../simulation/traffic/TrafficSystem.ts";
import type { TripRequest } from "../simulation/traffic/TripGenerationSystem.ts";
import type { RouteResult } from "../simulation/traffic/PathfindingSystem.ts";
import type { TransportationGraph } from "../simulation/traffic/TransportationGraph.ts";
import type { IntersectionSystem } from "../simulation/traffic/IntersectionSystem.ts";
import type { NativeTransportationRuntime } from "./NativeTransportationRuntime.ts";

export class NativeBackedTrafficSystem extends TrafficSystem {
  private readonly native: NativeTransportationRuntime;

  constructor(native: NativeTransportationRuntime) {
    super();
    this.native = native;
  }

  override submitTrip(trip: TripRequest, route: RouteResult, tick: number, _freeFlowTicks = route.totalCost): string | null {
    const start = route.nodeIds[0];
    const end = route.nodeIds.at(-1);
    if (!start || !end) throw new Error("native traffic trip requires route endpoints");
    this.native.submitCarTrip({
      id: trip.id,
      sourceTripId: trip.id,
      originBuildingId: trip.originBuildingId,
      destinationBuildingId: trip.destinationBuildingId,
      originRoadNodeId: start,
      destinationRoadNodeId: end,
      departureTick: tick,
      travelerWeight: trip.travelerWeight,
      purpose: trip.purpose,
    }, trip.travelerWeight);
    const vehicle = this.native.snapshot().roadTraffic.vehicles.find((candidate) => candidate.tripId === trip.id);
    return vehicle?.id ?? null;
  }

  override step(
    graph: TransportationGraph,
    _intersections: IntersectionSystem,
    _tick: number,
    extraEdgeLoads: Readonly<Record<string, number>> = {},
  ): void {
    this.native.step(1);
    this.native.projectTraffic(graph, this, extraEdgeLoads);
  }
}
