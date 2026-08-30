import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { ROAD_DEFINITIONS } from '../data/roads.ts';
import { BUILDING_DEFINITIONS, BUILDING_DEFINITION_BY_ID } from '../data/buildings.ts';
import { SERVICE_DEFINITIONS } from '../data/services.ts';
import { LEGACY_CELL_SIZE_METERS, pointInPolygon } from '../world/cadastre/Geometry.ts';
import { ParcelInspector } from './ParcelInspector.ts';


export type FirmInspectionDto = Readonly<{
  id: string; archetype: string; status: string; filledJobs: number; jobCapacity: number; vacancies: number; throughput?: number;
  inputShortage: number; logisticsCost: number; operatingMargin: number; cashHealth: number; distressReason?: string;
  inventories: Readonly<{ industrial_inputs: number; manufactured_goods: number; consumer_goods: number }>;
  inboundShipments: number; outboundShipments: number;
}>;

export function renderFirmInspection(firm: FirmInspectionDto): string {
  const pct = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  return [
    `<h3>${firm.id} · ${firm.archetype}</h3>`,
    `<p>Status: ${firm.status}${firm.distressReason ? ` · ${firm.distressReason}` : ''}</p>`,
    `<p>Jobs: ${firm.filledJobs}/${firm.jobCapacity} · ${firm.vacancies} vacancies</p>`,
    `<p>Input shortage: ${pct(firm.inputShortage)}</p>`,
    `<p>Logistics cost: ${firm.logisticsCost.toFixed(2)}</p>`,
    `<p>Operating margin: ${firm.operatingMargin.toFixed(2)}</p>`,
    `<p>Cash health: ${pct(firm.cashHealth)}</p>`,
    `<p>Inventory: inputs ${firm.inventories.industrial_inputs.toFixed(1)} · manufactured ${firm.inventories.manufactured_goods.toFixed(1)} · consumer ${firm.inventories.consumer_goods.toFixed(1)}</p>`,
    `<p>Shipments: ${firm.inboundShipments} inbound · ${firm.outboundShipments} outbound</p>`,
  ].join('');
}

export type Inspection = Readonly<{
  kind: 'road' | 'building' | 'utility' | 'service' | 'transit-stop' | 'transit-line' | 'transit-vehicle' | 'terrain';
  title: string;
  lines: readonly string[];
}>;

export function inspectParcelAt(core: SimulationCore, x: number, y: number): string | null {
  const point = {
    x: (x + 0.5) * LEGACY_CELL_SIZE_METERS,
    y: (y + 0.5) * LEGACY_CELL_SIZE_METERS,
  };
  const parcel = core.cadastre.listParcels()
    .filter((candidate) => pointInPolygon(point, core.cadastre.parcelPolygon(candidate.id)))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return parcel ? new ParcelInspector().render(parcel.id, core) : null;
}

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
    const definition = BUILDING_DEFINITION_BY_ID[building.definitionId] ?? BUILDING_DEFINITIONS[building.zone];
    const service = core.utilitySnapshot.perBuilding[building.id] ?? { power: 0, water: 0 };
    const firm = core.economyDomain.getFirmAtBuilding(building.id);
    const firmLines: string[] = [];
    const housingLines: string[] = [];
    if (firm) {
      const inventories = core.economyDomain.getFirmInventories(firm.id);
      const financials = core.economyDomain.getFirmFinancials(firm.id);
      const vehicles = core.economyDomain.freightVehicles.listVehicles();
      firmLines.push(
        `Firm: ${firm.id} · ${firm.archetype} · ${firm.status}`,
        `Firm jobs: ${firm.filledJobs}/${firm.jobCapacity} · ${firm.vacancies} vacancies`,
        `Input shortage: ${Math.round(core.economyDomain.inventories.shortageRatio(firm.id) * 100)}%`,
        `Logistics cost: ${financials.logisticsCost.toFixed(2)}`,
        `Operating margin: ${firm.lastOperatingMargin.toFixed(2)}`,
        `Cash health: ${Math.round(firm.cashHealth * 100)}%`,
        `Inventory inputs / manufactured / consumer: ${inventories.industrial_inputs.onHand.toFixed(1)} / ${inventories.manufactured_goods.onHand.toFixed(1)} / ${inventories.consumer_goods.onHand.toFixed(1)}`,
        `Active shipments in / out: ${vehicles.filter((v) => v.shipment.destinationId === firm.id).length} / ${vehicles.filter((v) => v.shipment.originId === firm.id).length}`,
      );
    }
    if (building.zone === 'residential' && building.status === 'occupied') {
      const allocation = core.housingChoiceSnapshot.byBuilding[building.id];
      const tenure = core.housingTenureSnapshot.byBuilding[building.id];
      const relocation = core.housingRelocationSnapshot.byBuilding[building.id];
      const pressure = core.redevelopmentPressureSnapshot.parcels.find((item) => item.buildingId === building.id);
      const decision = core.redevelopmentExecutionSnapshot.decisions.find((item) => item.buildingId === building.id);
      if (allocation) {
        housingLines.push(
          `Housing occupancy: ${Math.round(allocation.occupancyRate * 100)}% · ${allocation.assignedResidents.toFixed(1)}/${definition.residentCapacity} residents`,
          `Affordability: ${Math.round(allocation.affordabilityScore * 100)}%`,
          `Average rent burden: ${Math.round(allocation.averageRentBurden * 100)}%`,
          `Cost-burdened residents: ${allocation.costBurdenedResidents.toFixed(1)}`,
        );
      }
      if (relocation) {
        const assigned = Math.max(0, relocation.assignedResidents);
        const renterShare = assigned > 0 ? relocation.renterResidents / assigned : 0;
        const ownerShare = assigned > 0 ? relocation.ownerResidents / assigned : 0;
        housingLines.push(
          `Tenure mix: ${Math.round(renterShare * 100)}% renter · ${Math.round(ownerShare * 100)}% owner`,
          `Rental occupancy: ${Math.round(relocation.rentalOccupancyRate * 100)}%`,
          `Ownership occupancy: ${Math.round(relocation.ownershipOccupancyRate * 100)}%`,
          `Moved in this cycle: ${relocation.movedInResidentsThisCycle.toFixed(1)}`,
          `Moved out this cycle: ${relocation.movedOutResidentsThisCycle.toFixed(1)}`,
          `Displaced this cycle: ${relocation.displacedResidentsThisCycle.toFixed(1)}`,
        );
      }
      if (tenure) {
        housingLines.push(
          `Asking rent: $${Math.round(tenure.askingRent).toLocaleString()}`,
          `Owner monthly cost: $${Math.round(tenure.monthlyOwnerCost).toLocaleString()}`,
        );
      }
      housingLines.push(
        `Redevelopment pressure: ${pressure ? pressure.pressure.toFixed(2) : 'n/a'}`,
        `Redevelopment status: ${decision ? decision.reason.replaceAll('-', ' ') : 'not evaluated'}`,
      );
    }
    return {
      kind: 'building',
      title: `${building.zone[0]?.toUpperCase() ?? ''}${building.zone.slice(1)} building`,
      lines: [
        `Status: ${building.status}`,
        ...firmLines,
        ...housingLines,
        `Residents capacity: ${definition.residentCapacity}`,
        `Jobs capacity: ${definition.jobCapacity}`,
        `Power service: ${Math.round(service.power * 100)}%`,
        `Water service: ${Math.round(service.water * 100)}%`,
        `Waste backlog: ${core.garbage.getBacklog(building.id).toFixed(1)}`,
        `Service quality: ${Math.round((core.neighborhoodSnapshot.perBuilding[building.id]?.combinedServiceQuality ?? 0) * 100)}%`,
        `Primary service issue: ${core.neighborhoodSnapshot.perBuilding[building.id]?.primaryIssue ?? 'none'}`,
        `Fire access: ${Math.round((core.serviceAccessByBuilding[building.id]?.fire ?? 0) * 100)}%`,
        `Police access: ${Math.round((core.serviceAccessByBuilding[building.id]?.police ?? 0) * 100)}%`,
        `Healthcare access: ${Math.round((core.serviceAccessByBuilding[building.id]?.healthcare ?? 0) * 100)}%`,
        `Education access: ${Math.round((core.serviceAccessByBuilding[building.id]?.education ?? 0) * 100)}%`,
        `Waste access: ${Math.round((core.serviceAccessByBuilding[building.id]?.garbage ?? 0) * 100)}%`,
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


export function inspectFreightVehicle(core: SimulationCore, vehicleId: string): Inspection {
  const vehicle = core.economyDomain.freightVehicles.getVehicle(vehicleId);
  if (!vehicle) return { kind: 'road', title: 'Unknown freight vehicle', lines: [`ID: ${vehicleId}`] };
  return { kind: 'road', title: 'Freight shipment', lines: [
    `Vehicle: ${vehicle.id}`, `Commodity: ${vehicle.shipment.commodity}`, `Quantity: ${vehicle.shipment.quantity.toFixed(1)}`,
    `Origin: ${vehicle.shipment.originId}`, `Destination: ${vehicle.shipment.destinationId}`,
    `Route progress: ${vehicle.currentEdgeIndex + 1}/${vehicle.routeEdgeIds.length}`, `Delay: ${vehicle.delayTicks.toFixed(1)} ticks`,
    `Logistics cost: ${vehicle.shipment.generalizedCost.toFixed(2)}`,
  ] };
}

export function inspectFreightGateway(core: SimulationCore, gatewayId: string): Inspection {
  const gateway = core.economyDomain.trade.getGateway(gatewayId);
  if (!gateway) return { kind: 'road', title: 'Unknown freight gateway', lines: [`ID: ${gatewayId}`] };
  const vehicles = core.economyDomain.freightVehicles.listVehicles();
  const inbound = vehicles.filter((v) => v.shipment.originKind === 'gateway' && v.shipment.originId === gatewayId).reduce((s, v) => s + v.shipment.quantity, 0);
  const outbound = vehicles.filter((v) => v.shipment.destinationKind === 'gateway' && v.shipment.destinationId === gatewayId).reduce((s, v) => s + v.shipment.quantity, 0);
  return { kind: 'road', title: 'Freight gateway', lines: [
    `ID: ${gateway.id}`, `Import / export capacity: ${gateway.importCapacity} / ${gateway.exportCapacity}`,
    `Current inbound / outbound cargo: ${inbound.toFixed(1)} / ${outbound.toFixed(1)}`,
    `External demand index: ${gateway.externalDemandIndex.toFixed(2)}`,
  ] };
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