import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { ROAD_DEFINITIONS } from '../data/roads.ts';
import { BUILDING_DEFINITIONS } from '../data/buildings.ts';
import { SERVICE_DEFINITIONS } from '../data/services.ts';

export type Inspection = Readonly<{
  kind: 'road' | 'building' | 'utility' | 'service' | 'terrain';
  title: string;
  lines: readonly string[];
}>;

export function inspectCell(core: SimulationCore, x: number, y: number): Inspection {
  const building = core.buildings.getAt(x, y);
  if (building) {
    const definition = BUILDING_DEFINITIONS[building.zone];
    const service = core.utilitySnapshot.perBuilding[building.id] ?? { power: 0, water: 0 };
    return {
      kind: 'building',
      title: `${building.zone[0]?.toUpperCase() ?? ''}${building.zone.slice(1)} building`,
      lines: [
        `Status: ${building.status}`,
        `Residents capacity: ${definition.residentCapacity}`,
        `Jobs capacity: ${definition.jobCapacity}`,
        `Power service: ${Math.round(service.power * 100)}%`,
        `Water service: ${Math.round(service.water * 100)}%`,
        `Garbage backlog: ${core.garbage.getBacklog(building.id).toFixed(1)}`,
        `Service quality: ${Math.round((core.neighborhoodSnapshot.perBuilding[building.id]?.combinedServiceQuality ?? 0) * 100)}%`,
        `Primary service issue: ${core.neighborhoodSnapshot.perBuilding[building.id]?.primaryIssue ?? 'none'}`,
        `Fire access: ${Math.round((core.serviceAccessByBuilding[building.id]?.fire ?? 0) * 100)}%`,
        `Police access: ${Math.round((core.serviceAccessByBuilding[building.id]?.police ?? 0) * 100)}%`,
        `Healthcare access: ${Math.round((core.serviceAccessByBuilding[building.id]?.healthcare ?? 0) * 100)}%`,
        `Education access: ${Math.round((core.serviceAccessByBuilding[building.id]?.education ?? 0) * 100)}%`,
        `Garbage access: ${Math.round((core.serviceAccessByBuilding[building.id]?.garbage ?? 0) * 100)}%`,
        `Collectible waste: ${(core.wasteCollection.getBuildingWaste(building.id)?.currentCollectibleWaste ?? 0).toFixed(1)}`,
      ],
    };
  }

  const serviceFacility = core.services.getAt(x, y);
  if (serviceFacility) {
    const definition = SERVICE_DEFINITIONS[serviceFacility.type];
    const openJobs = core.serviceDispatch.listJobs().filter((job) => job.assignedFacilityId === serviceFacility.id && !['completed', 'failed'].includes(job.status)).length;
    return {
      kind: 'service',
      title: definition.label,
      lines: [
        `ID: ${serviceFacility.id}`,
        `Department: ${serviceFacility.department}`,
        `Funding: ${core.services.getFunding(serviceFacility.department)}%`,
        `Fiscal payment: ${Math.round(core.services.getFiscalPaymentRatio() * 100)}%`,
        `Effective staffing: ${core.services.effectiveStaffing(serviceFacility.id).toFixed(1)}`,
        `Effective capacity: ${core.services.effectiveCapacity(serviceFacility.id).toFixed(1)}`,
        `Active vehicles: ${core.services.activeVehicleCount(serviceFacility.id)}`,
        `Open jobs: ${openJobs}`,
        `Operating cost: $${Math.round(definition.monthlyOperatingCost * core.services.getFunding(serviceFacility.department) / 100).toLocaleString()}`,
      ],
    };
  }

  const facility = core.utilities.listFacilities().find((item) => item.x === x && item.y === y);
  if (facility) {
    return {
      kind: 'utility',
      title: `${facility.type[0]?.toUpperCase() ?? ''}${facility.type.slice(1)} facility`,
      lines: [`ID: ${facility.id}`, `Operating cost is included in recurring city expenses.`],
    };
  }

  const road = core.roads.get(x, y);
  if (road) {
    core.transportationGraph.rebuildIfNeeded(core.roads);
    const node = core.transportationGraph.findNodeAt(x, y);
    const edges = node ? core.transportationGraph.outgoingEdges(node.id) : [];
    const metricByEdge = new Map(core.traffic.edgeMetrics.map((metric) => [metric.edgeId, metric]));
    const metrics = edges.map((edge) => metricByEdge.get(edge.id)).filter((metric) => metric !== undefined);
    const avg = (selector: (metric: NonNullable<(typeof metrics)[number]>) => number): number =>
      metrics.length === 0 ? 0 : metrics.reduce((sum, metric) => sum + selector(metric), 0) / metrics.length;
    const definition = ROAD_DEFINITIONS[road.type];
    return {
      kind: 'road',
      title: `${road.type[0]?.toUpperCase() ?? ''}${road.type.slice(1)} road`,
      lines: [
        `Capacity: ${definition.weightedVehicleCapacityPerMinute} weighted vehicles/min`,
        `Free-flow speed: ${definition.freeFlowSpeedCellsPerSecond.toFixed(1)} cells/s`,
        `Traffic volume: ${avg((metric) => metric.weightedVehicles).toFixed(1)}`,
        `Congestion: ${Math.round(avg((metric) => metric.congestion) * 100)}%`,
        `Average speed: ${avg((metric) => metric.averageSpeedCellsPerSecond).toFixed(2)} cells/s`,
      ],
    };
  }

  const terrain = core.terrain.get(x, y);
  return {
    kind: 'terrain',
    title: terrain.biome[0]!.toUpperCase() + terrain.biome.slice(1),
    lines: [`Elevation: ${terrain.elevation.toFixed(2)}`, `Buildable: ${terrain.buildable ? 'yes' : 'no'}`],
  };
}
