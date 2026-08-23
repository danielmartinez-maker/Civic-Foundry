import { SERVICE_DEFINITIONS, type ServiceDepartment } from '../../data/services.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem } from '../traffic/PathfindingSystem.ts';

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
    const targetNode = this.accessNode(graph, building.x, building.y);
    if (!targetNode) return this.unreachable(department);
    const candidates = facilities.listFacilities().filter((facility) => facility.department === department);
    let best: ServiceAccessResult | null = null;
    for (const facility of candidates) {
      const facilityNode = this.accessNode(graph, facility.x, facility.y);
      if (!facilityNode) continue;
      const route = pathfinding.findRoute(graph, facilityNode, targetNode, {
        edgeCost,
        costKey: options.costKey ?? `service:${department}`,
      });
      if (!route) continue;
      const definition = SERVICE_DEFINITIONS[facility.type];
      const intersectionDelay = Math.max(0, options.predictedIntersectionDelayTicks?.(route.edgeIds) ?? 0);
      const turnaround = department === 'education' ? 0 : definition.dispatchTurnaroundTicks / facilities.fundingEffectiveness(department);
      const candidateCostTicks = route.totalCost + intersectionDelay + turnaround;
      const accessibility = clamp01(1 - route.totalCost / MAX_USEFUL_TRAVEL[department]);
      const utilization = clamp01(options.utilizationByFacility?.[facility.id] ?? 0);
      const availableCapacity = facilities.effectiveCapacity(facility.id) * (1 - utilization);
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

  private accessNode(graph: TransportationGraph, x: number, y: number): string | undefined {
    const candidates = CARDINAL
      .map(([dx, dy]) => graph.findNodeAt(x + dx, y + dy))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id));
    return candidates[0]?.id;
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
