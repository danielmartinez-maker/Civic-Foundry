import { SERVICE_DEFINITIONS, type ServiceDepartment } from '../../data/services.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';

export type ServiceAccessResult = Readonly<{
  department: ServiceDepartment;
  facilityId: string | null;
  reachable: boolean;
  travelTicks: number;
  candidateCostTicks: number;
  accessibility: number;
  capacityFactor: number;
  serviceAccess: number;
  routeEdgeIds: readonly string[];
}>;

export type ServiceAccessibilityOptions = Readonly<{
  /** Absolute committed workload units at each facility, not a normalized ratio. */
  utilizationByFacility?: Readonly<Record<string, number>>;
  predictedIntersectionDelayTicks?: (edgeIds: readonly string[]) => number;
  costKey?: string;
}>;

const MAX_USEFUL_TRAVEL: Readonly<Record<ServiceDepartment, number>> = Object.freeze({
  fire: 180,
  police: 220,
  healthcare: 240,
  education: 300,
  garbage: 300,
});

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export class ServiceAccessibilitySystem {
  evaluateBuilding(
    department: ServiceDepartment,
    building: Building,
    localDemand: number,
    facilities: ServiceFacilitySystem,
    graph: TransportationGraph,
    pathfinding: PathfindingSystem,
    edgeCost: (edge: TransportationEdge) => number,
    options: ServiceAccessibilityOptions = {},
  ): ServiceAccessResult {
    const targetNodes = this.accessNodes(graph, building.x, building.y);
    if (targetNodes.length === 0) return this.unreachable(department);
    const candidates = facilities.listFacilities().filter((facility) => facility.department === department);
    let best: ServiceAccessResult | null = null;
    for (const facility of candidates) {
      const facilityNodes = this.accessNodes(graph, facility.x, facility.y);
      if (facilityNodes.length === 0) continue;
      const route = this.bestRoute(graph, pathfinding, facilityNodes, targetNodes, edgeCost, options.costKey);
      if (!route) continue;
      const definition = SERVICE_DEFINITIONS[facility.type];
      const intersectionDelay = Math.max(0, options.predictedIntersectionDelayTicks?.(route.edgeIds) ?? 0);
      const turnaround = department === 'education' ? 0 : definition.dispatchTurnaroundTicks / facilities.fundingEffectiveness(department);
      const candidateCostTicks = route.totalCost + intersectionDelay + turnaround;
      const accessibility = clamp01(1 - route.totalCost / MAX_USEFUL_TRAVEL[department]);
      const effectiveCapacity = facilities.effectiveCapacity(facility.id);
      const committed = Math.max(0, Number.isFinite(options.utilizationByFacility?.[facility.id]) ? options.utilizationByFacility?.[facility.id] ?? 0 : 0);
      const availableCapacity = Math.max(0, effectiveCapacity - committed);
      const capacityFactor = localDemand <= 0 ? 1 : clamp01(availableCapacity / localDemand);
      const result: ServiceAccessResult = Object.freeze({
        department,
        facilityId: facility.id,
        reachable: true,
        travelTicks: route.totalCost,
        candidateCostTicks,
        accessibility,
        capacityFactor,
        serviceAccess: accessibility * capacityFactor,
        routeEdgeIds: Object.freeze([...route.edgeIds]),
      });
      if (!best || result.candidateCostTicks < best.candidateCostTicks - 1e-9
        || (Math.abs(result.candidateCostTicks - best.candidateCostTicks) <= 1e-9 && (result.facilityId ?? '').localeCompare(best.facilityId ?? '') < 0)) {
        best = result;
      }
    }
    return best ?? this.unreachable(department);
  }

  private accessNodes(graph: TransportationGraph, x: number, y: number): string[] {
    return CARDINAL
      .map(([dx, dy]) => graph.findNodeAt(x + dx, y + dy)?.id)
      .filter((id): id is string => id !== undefined)
      .sort();
  }

  private bestRoute(
    graph: TransportationGraph,
    pathfinding: PathfindingSystem,
    starts: readonly string[],
    ends: readonly string[],
    edgeCost: (edge: TransportationEdge) => number,
    costKey?: string,
  ): RouteResult | null {
    let best: RouteResult | null = null;
    for (const start of starts) {
      for (const end of ends) {
        const route = pathfinding.findRoute(graph, start, end, {
          edgeCost,
          ...(costKey !== undefined ? { costKey } : {}),
        });
        if (!route) continue;
        if (!best || route.totalCost < best.totalCost - 1e-9
          || (Math.abs(route.totalCost - best.totalCost) <= 1e-9 && route.edgeIds.join('|').localeCompare(best.edgeIds.join('|')) < 0)) best = route;
      }
    }
    return best;
  }

  private unreachable(department: ServiceDepartment): ServiceAccessResult {
    return Object.freeze({
      department,
      facilityId: null,
      reachable: false,
      travelTicks: Number.POSITIVE_INFINITY,
      candidateCostTicks: Number.POSITIVE_INFINITY,
      accessibility: 0,
      capacityFactor: 0,
      serviceAccess: 0,
      routeEdgeIds: Object.freeze([]),
    });
  }
}
