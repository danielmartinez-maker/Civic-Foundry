import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { ROAD_DEFINITIONS } from '../data/roads.ts';
import { BUILDING_DEFINITIONS } from '../data/buildings.ts';
import { SERVICE_DEFINITIONS } from '../data/services.ts';

export type Inspection = Readonly<{
  kind: 'road' | 'building' | 'utility' | 'service' | 'transit-stop' | 'transit-line' | 'transit-vehicle' | 'terrain';
  title: string;
  lines: readonly string[];
}>;

export function inspectCell(core: SimulationCore, x: number, y: number): Inspection {
  const transitStop = core.transit.getStopAt(x, y);
  if (transitStop) {
    const servedLines = core.transit.listLines().filter((line) => line.stopIds.includes(transitStop.id));
    const queues = core.mobility.passengers.snapshot().queues.filter((queue) => queue.stopId === transitStop.id);
    const waiting = queues.reduce((sum, queue) => sum + queue.cohorts.reduce((inner, cohort) => inner + cohort.travelerWeight, 0), 0);
    const waitNumerator = queues.reduce((sum, queue) => sum + queue.cohorts.reduce((inner, cohort) => inner + Math.max(0, core.clock.tick - cohort.enqueuedTick) * cohort.travelerWeight, 0), 0);
    const transferWeight = queues.reduce((sum, queue) => sum + queue.cohorts.reduce((inner, cohort) => inner + (cohort.transferLegs.length > 0 ? cohort.travelerWeight : 0), 0), 0);
    const nearbyVehicles = core.mobility.vehicles.listVehicles().filter((vehicle) => {
      const line = core.transit.getLine(vehicle.lineId);
      return line?.stopIds[vehicle.stopIndex] === transitStop.id;
    });
    const onboard = nearbyVehicles.reduce((sum, vehicle) => sum + vehicle.onboard.reduce((inner, cohort) => inner + cohort.travelerWeight, 0), 0);
    const capacity = nearbyVehicles.reduce((sum, vehicle) => sum + vehicle.capacity, 0);
    return {
      kind: 'transit-stop',
      title: transitStop.type === 'metro_station' ? 'Metro station' : 'Transit stop',
      lines: [
        `ID: ${transitStop.id}`,
        `Lines: ${servedLines.length > 0 ? servedLines.map((line) => line.name).join(', ') : 'none'}`,
        `Waiting passengers: ${waiting.toFixed(1)}`,
        `Average wait: ${waiting > 0 ? (waitNumerator / waiting).toFixed(1) : '0.0'} ticks`,
        `Waiting transfers: ${transferWeight.toFixed(1)}`,
        `Vehicles at stop: ${nearbyVehicles.length}`,
        `Current platform crowding: ${capacity > 0 ? Math.round(onboard / capacity * 100) : 0}%`,
      ],
    };
  }
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


export function inspectTransitLine(core: SimulationCore, lineId: string): Inspection {
  const line = core.transit.getLine(lineId);
  if (!line) return { kind: 'transit-line', title: 'Unknown transit line', lines: [`ID: ${lineId}`] };
  const operations = core.mobility.operations.snapshotLineWithVehicles(line.id, core.mobility.vehicles);
  const stopNames = line.stopIds.map((stopId) => core.transit.getStop(stopId)?.id ?? stopId);
  return {
    kind: 'transit-line',
    title: line.name,
    lines: [
      `ID: ${line.id}`,
      `Mode: ${line.mode}`,
      `Status: ${line.enabled ? 'enabled' : 'disabled'}`,
      `Stops: ${stopNames.length} · ${stopNames.join(' → ') || 'none'}`,
      `Headway: ${line.headwayTicks} ticks`,
      `Fare: $${line.fare.toFixed(2)}`,
      `Fleet: ${operations.activeVehicles} active / ${operations.fleetLimit} limit`,
      `Ridership: ${operations.completedPassengerWeight.toFixed(1)}`,
      `Boardings: ${operations.boardings.toFixed(1)}`,
      `Reliability: ${Math.round(operations.reliability * 100)}%`,
      `Delay: ${operations.delayTicks.toFixed(1)} ticks`,
      `Operating cost: $${operations.operatingCost.toFixed(2)}`,
      `Fare revenue: $${operations.fareRevenue.toFixed(2)}`,
      `Cost recovery: ${Math.round(operations.costRecovery * 100)}%`,
    ],
  };
}

export function inspectTransitVehicle(core: SimulationCore, vehicleId: string): Inspection {
  const vehicle = core.mobility.vehicles.getVehicle(vehicleId);
  if (!vehicle) return { kind: 'transit-vehicle', title: 'Unknown transit vehicle', lines: [`ID: ${vehicleId}`] };
  const line = core.transit.getLine(vehicle.lineId);
  const onboard = vehicle.onboard.reduce((sum, cohort) => sum + cohort.travelerWeight, 0);
  const nextIndex = vehicle.state === 'moving'
    ? vehicle.stopIndex + (vehicle.directionKey === 'forward' ? 1 : -1)
    : vehicle.stopIndex + (vehicle.directionKey === 'forward' ? 1 : -1);
  const nextStopId = line?.stopIds[nextIndex] ?? line?.stopIds[vehicle.stopIndex];
  const nextStop = nextStopId ? core.transit.getStop(nextStopId) : undefined;
  return {
    kind: 'transit-vehicle',
    title: `${vehicle.mode.toUpperCase()} vehicle`,
    lines: [
      `ID: ${vehicle.id}`,
      `Line: ${line?.name ?? vehicle.lineId}`,
      `State: ${vehicle.state}`,
      `Direction: ${vehicle.directionKey}`,
      `Load: ${onboard.toFixed(1)} / ${vehicle.capacity}`,
      `Delay: ${vehicle.delayTicks.toFixed(1)} ticks`,
      `Next stop: ${nextStop?.id ?? 'terminus'}`,
    ],
  };
}
