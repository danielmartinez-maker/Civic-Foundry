import type { RoadSystem } from "../../world/roads/RoadSystem.ts";
import type { EdgeTrafficMetric } from "../traffic/TrafficSystem.ts";
import type { RouteResult } from "../traffic/PathfindingSystem.ts";
import type {
  TransportationEdge,
  TransportationGraph,
} from "../traffic/TransportationGraph.ts";
import {
  DynamicRoutingSystem,
  type DynamicRouteOptions,
} from "./DynamicRoutingSystem.ts";
import { GeneralizedTravelCostSystem } from "./GeneralizedTravelCostSystem.ts";
import { IntersectionControlSystem } from "./IntersectionControlSystem.ts";
import { buildLaneGroups } from "./LaneGroupBuilder.ts";
import {
  LegacyRoadNetworkAdapter,
  type LegacyAuthorityProjection,
} from "./LegacyRoadNetworkAdapter.ts";
import { LegacyTransportationGraphAdapter } from "./LegacyTransportationGraphAdapter.ts";
import { ParkingAuthoritySystem } from "./ParkingAuthoritySystem.ts";
import {
  buildRoutingTopology,
  type RoutingTopology,
} from "./RoutingTopology.ts";
import { TransportationIncidentSystem } from "./TransportationIncidentSystem.ts";
import { TransportNetworkStore } from "./TransportNetworkStore.ts";
import type {
  Carriageway,
  CarriagewayId,
  JunctionId,
  RoadSegment,
  TransportNetworkSnapshot,
  TurnMovement,
  TurnMovementId,
} from "./TransportNetworkTypes.ts";

export type LegacyDynamicRouteOptions = DynamicRouteOptions &
  Readonly<{
    edgeCost?: (edge: TransportationEdge) => number;
  }>;

function legacyNodeId(x: number, y: number): string {
  return `n:${x},${y}`;
}

function legacyEdgeId(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): string {
  return `e:${legacyNodeId(fromX, fromY)}>${legacyNodeId(toX, toY)}`;
}

export class Transportation3RRuntime {
  readonly dynamicRouting = new DynamicRoutingSystem();
  readonly generalizedCosts = new GeneralizedTravelCostSystem();
  readonly incidents = new TransportationIncidentSystem();
  readonly parking = new ParkingAuthoritySystem();
  readonly intersections = new IntersectionControlSystem();

  private readonly networkAdapter = new LegacyRoadNetworkAdapter();
  private readonly graphAdapter = new LegacyTransportationGraphAdapter();
  private readonly networkStore = new TransportNetworkStore();
  private projection: LegacyAuthorityProjection | undefined;
  private topology: RoutingTopology | undefined;
  private currentSnapshot: TransportNetworkSnapshot | undefined;
  private readonly carriagewayByLegacyEdge = new Map<string, CarriagewayId>();
  private readonly legacyEdgeByCarriageway = new Map<CarriagewayId, string>();
  private readonly junctionByLegacyNode = new Map<string, JunctionId>();
  private readonly legacyNodeByJunction = new Map<JunctionId, string>();
  private readonly segmentByCarriageway = new Map<CarriagewayId, RoadSegment>();
  private readonly movementByTurn = new Map<string, TurnMovementId>();

  refreshNetwork(roads: RoadSystem, graph: TransportationGraph): boolean {
    const projection = this.networkAdapter.projectAuthorityIfNeeded(roads);
    const mutation = this.networkStore.replaceAuthority(projection.authority);
    if (!mutation.ok)
      throw new Error(mutation.reason ?? "transport authority rejected");

    const graphChanged = graph.loadProjection(
      this.graphAdapter.project(projection),
    );
    const topologyChanged =
      mutation.changed ||
      this.currentSnapshot === undefined ||
      this.currentSnapshot.topologyRevision !==
        this.networkStore.topologyRevision;
    this.projection = projection;

    if (topologyChanged) {
      this.currentSnapshot = this.networkStore.snapshot();
      const laneGroups = buildLaneGroups(this.currentSnapshot);
      this.topology = buildRoutingTopology(this.currentSnapshot, laneGroups);
      this.intersections.configure(this.currentSnapshot);
      this.rebuildIndexes(this.currentSnapshot);
    }

    return topologyChanged || graphChanged;
  }

  networkSnapshot(): TransportNetworkSnapshot {
    return this.currentSnapshot ?? this.networkStore.snapshot();
  }

  updateCosts(
    graph: TransportationGraph,
    edgeMetrics: readonly EdgeTrafficMetric[],
    simulationTick: number,
  ): number {
    this.incidents.advance(simulationTick);
    const metricByEdge = new Map(
      edgeMetrics.map((metric) => [metric.edgeId, metric]),
    );
    const travelTimeTicksByCarriageway: Record<CarriagewayId, number> = {};
    const congestionPenaltyTicksByCarriageway: Record<CarriagewayId, number> =
      {};
    const incidentPenaltyTicksByCarriageway: Record<CarriagewayId, number> = {};
    const blockedCarriagewayIds: CarriagewayId[] = [];

    for (const carriageway of this.networkSnapshot().carriageways) {
      const edgeId = this.legacyEdgeByCarriageway.get(carriageway.id);
      const edge = edgeId ? graph.getEdge(edgeId) : undefined;
      const metric = edgeId ? metricByEdge.get(edgeId) : undefined;
      const freeFlow = edge?.freeFlowTicks ?? 0;
      travelTimeTicksByCarriageway[carriageway.id] = freeFlow;
      congestionPenaltyTicksByCarriageway[carriageway.id] = Math.max(
        0,
        (metric?.travelTimeTicks ?? freeFlow) - freeFlow,
      );

      const segment = this.segmentByCarriageway.get(carriageway.id);
      const effects = segment
        ? this.incidents.effectsForSegment(segment.id)
        : {
            capacityMultiplier: 1,
            closedLaneIds: [],
            traversalPenaltyTicks: 0,
          };
      incidentPenaltyTicksByCarriageway[carriageway.id] =
        effects.traversalPenaltyTicks;
      const closed = new Set(effects.closedLaneIds);
      const allLanesClosed =
        carriageway.laneIds.length > 0 &&
        carriageway.laneIds.every((laneId) => closed.has(laneId));
      if (effects.capacityMultiplier <= 0 || allLanesClosed)
        blockedCarriagewayIds.push(carriageway.id);
    }

    return this.dynamicRouting.updateState({
      travelTimeTicksByCarriageway,
      congestionPenaltyTicksByCarriageway,
      incidentPenaltyTicksByCarriageway,
      blockedCarriagewayIds,
    });
  }

  findLegacyRoute(
    graph: TransportationGraph,
    startNodeId: string,
    endNodeId: string,
    options: LegacyDynamicRouteOptions,
  ): RouteResult | null {
    const topology = this.topology;
    const startJunctionId = this.junctionByLegacyNode.get(startNodeId);
    const endJunctionId = this.junctionByLegacyNode.get(endNodeId);
    if (!topology || !startJunctionId || !endJunctionId) return null;

    const route = this.dynamicRouting.findRoute(
      topology,
      startJunctionId,
      endJunctionId,
      {
        permissions: options.permissions,
        destinationAccessible: options.destinationAccessible,
        ...(options.costKey === undefined ? {} : { costKey: options.costKey }),
        ...(options.edgeCost
          ? {
              carriagewayCost: (carriagewayId: CarriagewayId): number => {
                const edgeId = this.legacyEdgeByCarriageway.get(carriagewayId);
                const edge = edgeId ? graph.getEdge(edgeId) : undefined;
                return edge ? options.edgeCost!(edge) : Number.NaN;
              },
            }
          : {}),
      },
    );
    if (!route) return null;

    const nodeIds = route.junctionIds.map((junctionId) =>
      this.legacyNodeByJunction.get(junctionId),
    );
    const edgeIds = route.carriagewayIds.map((carriagewayId) =>
      this.legacyEdgeByCarriageway.get(carriagewayId),
    );
    if (
      nodeIds.some((nodeId) => nodeId === undefined) ||
      edgeIds.some((edgeId) => edgeId === undefined)
    )
      return null;
    return Object.freeze({
      nodeIds: Object.freeze(nodeIds as string[]),
      edgeIds: Object.freeze(edgeIds as string[]),
      totalCost: route.totalCost,
    });
  }

  segmentIdForLegacyEdge(edgeId: string): string | undefined {
    const carriagewayId = this.carriagewayByLegacyEdge.get(edgeId);
    return carriagewayId
      ? this.segmentByCarriageway.get(carriagewayId)?.id
      : undefined;
  }

  carriagewayIdForLegacyEdge(edgeId: string): CarriagewayId | undefined {
    return this.carriagewayByLegacyEdge.get(edgeId);
  }

  junctionIdForLegacyNode(nodeId: string): JunctionId | undefined {
    return this.junctionByLegacyNode.get(nodeId);
  }

  movementIdForLegacyTurn(
    nodeId: string,
    incomingEdgeId: string,
    outgoingEdgeId: string,
  ): TurnMovementId | undefined {
    const junctionId = this.junctionByLegacyNode.get(nodeId);
    const incoming = this.carriagewayByLegacyEdge.get(incomingEdgeId);
    const outgoing = this.carriagewayByLegacyEdge.get(outgoingEdgeId);
    if (!junctionId || !incoming || !outgoing) return undefined;
    return this.movementByTurn.get(`${junctionId}|${incoming}|${outgoing}`);
  }

  legacyNodeIdForJunction(junctionId: JunctionId): string | undefined {
    return this.legacyNodeByJunction.get(junctionId);
  }

  legacyEdgeIdForCarriageway(carriagewayId: CarriagewayId): string | undefined {
    return this.legacyEdgeByCarriageway.get(carriagewayId);
  }

  incidentCapacityMultipliers(): Readonly<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const segment of this.networkSnapshot().segments) {
      result[segment.id] = this.incidents.effectsForSegment(
        segment.id,
      ).capacityMultiplier;
    }
    return Object.freeze(result);
  }

  incidentAdjustedEdgeCost(edge: TransportationEdge, baseCost: number): number {
    const carriagewayId = this.carriagewayByLegacyEdge.get(edge.id);
    const segment = carriagewayId
      ? this.segmentByCarriageway.get(carriagewayId)
      : undefined;
    if (!segment) return baseCost;
    const effects = this.incidents.effectsForSegment(segment.id);
    if (effects.capacityMultiplier <= 0) return Number.POSITIVE_INFINITY;
    return (
      Math.max(edge.freeFlowTicks, baseCost) + effects.traversalPenaltyTicks
    );
  }

  private rebuildIndexes(snapshot: TransportNetworkSnapshot): void {
    this.carriagewayByLegacyEdge.clear();
    this.legacyEdgeByCarriageway.clear();
    this.junctionByLegacyNode.clear();
    this.legacyNodeByJunction.clear();
    this.segmentByCarriageway.clear();
    this.movementByTurn.clear();

    const junctionById = new Map(
      snapshot.junctions.map((junction) => [junction.id, junction]),
    );
    const segmentById = new Map(
      snapshot.segments.map((segment) => [segment.id, segment]),
    );
    for (const junction of snapshot.junctions) {
      const nodeId = legacyNodeId(junction.x, junction.y);
      this.junctionByLegacyNode.set(nodeId, junction.id);
      this.legacyNodeByJunction.set(junction.id, nodeId);
    }
    for (const carriageway of snapshot.carriageways) {
      const from = junctionById.get(carriageway.fromJunctionId);
      const to = junctionById.get(carriageway.toJunctionId);
      if (!from || !to) continue;
      const edgeId = legacyEdgeId(from.x, from.y, to.x, to.y);
      this.carriagewayByLegacyEdge.set(edgeId, carriageway.id);
      this.legacyEdgeByCarriageway.set(carriageway.id, edgeId);
      const segment = segmentById.get(carriageway.segmentId);
      if (segment) this.segmentByCarriageway.set(carriageway.id, segment);
    }
    for (const movement of snapshot.movements) {
      this.movementByTurn.set(
        `${movement.junctionId}|${movement.fromCarriagewayId}|${movement.toCarriagewayId}`,
        movement.id,
      );
    }
  }
}
