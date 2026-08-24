import { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { SpeedMode, ZoneType } from '../simulation/core/types.ts';
import { TerrainGrid, type TerrainCell } from '../world/terrain/TerrainGrid.ts';
import type { RoadCell } from '../world/roads/RoadSystem.ts';
import type { ZonedCell } from '../simulation/zoning/ZoningSystem.ts';
import type { Building } from '../simulation/buildings/BuildingSystem.ts';
import type { TreasuryTransaction } from '../simulation/treasury/TreasurySystem.ts';
import type { TaxRates, TaxRevenue } from '../simulation/tax/TaxSystem.ts';
import type { UtilityFacility, UtilitySnapshot } from '../simulation/utilities/UtilitySystem.ts';
import type { GarbageSnapshot } from '../simulation/garbage/GarbageSystem.ts';
import type { EconomySnapshot } from '../simulation/economy/EconomySystem.ts';
import type { EmploymentSnapshot } from '../simulation/employment/EmploymentSystem.ts';
import type { DemandSnapshot } from '../simulation/demand/DemandSystem.ts';
import type { TrafficVehicle, TripOutcome } from '../simulation/traffic/TrafficSystem.ts';
import type { IntersectionSnapshot } from '../simulation/traffic/IntersectionSystem.ts';
import type { DepartmentFunding, ServiceFacility } from '../simulation/services/ServiceFacilitySystem.ts';
import type { ServiceJob } from '../simulation/services/ServiceDispatchSystem.ts';
import type { ServiceVehicle } from '../simulation/services/ServiceVehicleSystem.ts';
import type { IncidentOutcome, ServiceIncident } from '../simulation/services/IncidentSystem.ts';
import type { WasteCollectionSnapshot } from '../simulation/services/WasteCollectionSystem.ts';
import type { ServiceDemandSnapshot } from '../simulation/services/ServiceDemandSystem.ts';
import type { EducationSnapshot } from '../simulation/services/EducationSystem.ts';
import type { BuildingServiceAccess, NeighborhoodQualitySnapshot } from '../simulation/services/NeighborhoodQualitySystem.ts';

export type SaveTrafficVehicle = Omit<TrafficVehicle, 'edgeIds'> & { edgeIds: string[] };

export type SaveV3 = {
  saveVersion: 3;
  gameVersion: '0.3.0-rebuild';
  seed: number;
  rngState: number;
  clock: { tick: number; speed: SpeedMode };
  terrain: { width: number; height: number; cells: TerrainCell[] };
  treasury: { balance: number; transactions: TreasuryTransaction[] };
  roads: { revision: number; cells: RoadCell[] };
  zoning: { cells: ZonedCell[] };
  buildings: { items: Building[] };
  population: number;
  taxes: { rates: TaxRates };
  utilities: { facilities: UtilityFacility[]; nextId: number };
  garbage: { backlog: Array<[string, number]> };
  economy: { lastSettlement: EconomySnapshot };
  cached: {
    employment: EmploymentSnapshot;
    utilities: UtilitySnapshot;
    garbage: GarbageSnapshot;
    demand: DemandSnapshot;
    taxRevenue: TaxRevenue;
    economy: EconomySnapshot;
  };
  tripGeneration: { rngState: number; nextTripId: number };
  traffic: {
    vehicles: SaveTrafficVehicle[];
    outcomes: TripOutcome[];
    nextVehicleId: number;
    completedTrips: number;
    failedTrips: number;
    congestionEpoch: number;
  };
  intersections: IntersectionSnapshot;
};

type SaveV2Like = Omit<SaveV3, 'saveVersion' | 'traffic' | 'intersections' | 'tripGeneration'> & { saveVersion: 2 };

export type SaveV4 = Omit<SaveV3, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 4;
  gameVersion: '0.4.0-rebuild';
  services: {
    facilities: ServiceFacility[];
    funding: DepartmentFunding;
    fiscalPaymentRatio: number;
    nextFacilityId: number;
    jobs: ServiceJob[];
    nextJobId: number;
    vehicles: ServiceVehicle[];
    incidents: ServiceIncident[];
    incidentOutcomes: IncidentOutcome[];
    incidentRngState: number;
    nextIncidentId: number;
    waste: WasteCollectionSnapshot;
  };
  serviceCached: {
    demand: ServiceDemandSnapshot;
    education: EducationSnapshot;
    neighborhood: NeighborhoodQualitySnapshot;
    accessByBuilding: Readonly<Record<string, BuildingServiceAccess>>;
    lastGeneratedWaste: number;
  };
};

type AnySave = SaveV2Like | SaveV3 | SaveV4;

function copyUtilitySnapshot(snapshot: UtilitySnapshot): UtilitySnapshot {
  const perBuilding: Record<string, { power: number; water: number }> = {};
  for (const [id, service] of Object.entries(snapshot.perBuilding)) perBuilding[id] = { power: service.power, water: service.water };
  return {
    power: { ...snapshot.power },
    water: { ...snapshot.water },
    perBuilding,
    powerNetwork: snapshot.powerNetwork ?? { segments: Object.freeze({}), edgeFlow: Object.freeze({}) },
    waterNetwork: snapshot.waterNetwork ?? { segments: Object.freeze({}), edgeFlow: Object.freeze({}) },
    networkOperatingCost: snapshot.networkOperatingCost ?? 0,
    saturatedSegments: snapshot.saturatedSegments ?? 0,
    trippedSegments: snapshot.trippedSegments ?? 0,
  };
}

function copyIntersectionSnapshot(snapshot: IntersectionSnapshot): IntersectionSnapshot {
  const result: Record<string, Array<{ incomingEdgeId: string; entries: Array<{ vehicleId: string; travelerWeight: number; queuedTick: number; priority?: 'normal' | 'emergency' }> }>> = {};
  for (const [nodeId, approaches] of Object.entries(snapshot)) {
    result[nodeId] = approaches.map((approach) => ({ incomingEdgeId: approach.incomingEdgeId, entries: approach.entries.map((entry) => ({ ...entry })) }));
  }
  return result;
}

function copyAccess(source: Readonly<Record<string, BuildingServiceAccess>>): Readonly<Record<string, BuildingServiceAccess>> {
  const result: Record<string, BuildingServiceAccess> = {};
  for (const [id, access] of Object.entries(source)) result[id] = { ...access };
  return result;
}

export function serializeCore(core: SimulationCore): SaveV4 {
  const traffic = core.traffic.snapshotState();
  const waste = core.wasteCollection.snapshot();
  return {
    saveVersion: 4,
    gameVersion: '0.4.0-rebuild',
    seed: core.seed,
    rngState: core.random.getState(),
    clock: { tick: core.clock.tick, speed: core.clock.speed },
    terrain: { width: core.terrain.width, height: core.terrain.height, cells: core.terrain.snapshot() },
    treasury: { balance: core.treasury.balance, transactions: core.treasury.transactions.map((tx) => ({ ...tx })) },
    roads: { revision: core.roads.revision, cells: core.roads.list().map((road) => ({ ...road })) },
    zoning: { cells: core.zoning.list().map((cell) => ({ ...cell })) },
    buildings: { items: core.buildings.list().map((building) => ({ ...building })) },
    population: core.population.population,
    taxes: { rates: core.taxes.getRates() },
    utilities: { facilities: core.utilities.listFacilities(), nextId: core.utilities.getNextId() },
    garbage: { backlog: core.garbage.snapshotBacklog().map(([id, value]) => [id, value]) },
    economy: { lastSettlement: { ...core.economy.lastSettlement } },
    cached: {
      employment: { ...core.employmentSnapshot }, utilities: copyUtilitySnapshot(core.utilitySnapshot), garbage: { ...core.garbageSnapshot },
      demand: { ...core.demandSnapshot }, taxRevenue: { ...core.taxRevenue }, economy: { ...core.economySnapshot },
    },
    tripGeneration: { rngState: core.tripGeneration.getRandomState(), nextTripId: core.tripGeneration.getNextTripId() },
    traffic: {
      vehicles: traffic.vehicles.map((vehicle) => ({ ...vehicle, edgeIds: [...vehicle.edgeIds] })), outcomes: traffic.outcomes.map((outcome) => ({ ...outcome })),
      nextVehicleId: traffic.nextVehicleId, completedTrips: traffic.completedTrips, failedTrips: traffic.failedTrips, congestionEpoch: traffic.congestionEpoch,
    },
    intersections: copyIntersectionSnapshot(core.intersections.snapshot()),
    services: {
      facilities: core.services.listFacilities(), funding: core.services.fundingSnapshot(), fiscalPaymentRatio: core.services.getFiscalPaymentRatio(), nextFacilityId: core.services.getNextId(),
      jobs: core.serviceDispatch.listJobs(), nextJobId: core.serviceDispatch.getNextJobId(), vehicles: core.serviceVehicles.listVehicles(),
      incidents: core.incidents.listIncidents(), incidentOutcomes: core.incidents.snapshotOutcomes(), incidentRngState: core.incidents.getRandomState(), nextIncidentId: core.incidents.getNextIncidentId(),
      waste: { buildings: waste.buildings.map((item) => ({ ...item })), processingQueue: waste.processingQueue, processedTotal: waste.processedTotal, jobCargo: waste.jobCargo.map(([id, value]) => [id, value] as const), jobAssignments: waste.jobAssignments.map(([buildingId, jobId]) => [buildingId, jobId] as const) },
    },
    serviceCached: {
      demand: { eligibleStudents: core.serviceDemandSnapshot.eligibleStudents, perBuilding: Object.fromEntries(Object.entries(core.serviceDemandSnapshot.perBuilding).map(([id, value]) => [id, { ...value }])) },
      education: { ...core.educationSnapshot },
      neighborhood: { perBuilding: Object.fromEntries(Object.entries(core.neighborhoodSnapshot.perBuilding).map(([id, value]) => [id, { ...value }])), citywideServiceQuality: core.neighborhoodSnapshot.citywideServiceQuality, commercialServiceQuality: core.neighborhoodSnapshot.commercialServiceQuality },
      accessByBuilding: copyAccess(core.serviceAccessByBuilding), lastGeneratedWaste: core.lastServiceGeneratedWaste,
    },
  };
}

export function hydrateCore(input: unknown): SimulationCore {
  const record = requireRecord(input, 'save');
  const saveVersion = requireInteger(record.saveVersion, 'saveVersion');
  if (saveVersion !== 2 && saveVersion !== 3 && saveVersion !== 4) throw new Error(`unsupported save version: ${saveVersion}`);
  const base = record as unknown as AnySave;
  validateBase(base);

  const terrain = new TerrainGrid(base.terrain.width, base.terrain.height, base.terrain.cells.map((cell) => ({ ...cell })));
  const core = new SimulationCore({ terrain, seed: base.seed, startingFunds: base.treasury.balance });
  core.random.setState(base.rngState);
  core.clock.restore(base.clock.tick, base.clock.speed);
  core.treasury.restore(base.treasury.balance, base.treasury.transactions);
  core.roads.restore(base.roads.cells, base.roads.revision);
  core.zoning.restore(base.zoning.cells);
  core.lots.rebuild(core.roads, core.zoning);
  core.buildings.restore(base.buildings.items);
  core.population.restore(base.population);
  core.taxes.restoreRates(base.taxes.rates);

  const legacyLandfills = saveVersion < 4 ? base.utilities.facilities.filter((facility) => facility.type === 'landfill').sort((a, b) => a.id.localeCompare(b.id)) : [];
  const utilityFacilities = saveVersion < 4 ? base.utilities.facilities.filter((facility) => facility.type !== 'landfill') : base.utilities.facilities;
  core.utilities.restore(utilityFacilities, base.utilities.nextId);
  core.garbage.restoreBacklog(base.garbage.backlog);
  core.economy.restore(normalizeEconomy(base.economy.lastSettlement));

  core.employmentSnapshot = { ...base.cached.employment };
  core.utilitySnapshot = copyUtilitySnapshot(base.cached.utilities);
  core.garbageSnapshot = { ...base.cached.garbage };
  core.demandSnapshot = { ...base.cached.demand };
  core.taxRevenue = { ...base.cached.taxRevenue };
  core.economySnapshot = normalizeEconomy(base.cached.economy);
  core.transportationGraph.rebuildIfNeeded(core.roads);

  if (saveVersion >= 3) {
    const v3 = base as SaveV3 | SaveV4;
    core.tripGeneration.restoreRandomState(v3.tripGeneration.rngState, v3.tripGeneration.nextTripId);
    core.traffic.restoreState({
      vehicles: v3.traffic.vehicles.map((vehicle) => ({ ...vehicle, edgeIds: [...vehicle.edgeIds] })), outcomes: v3.traffic.outcomes.map((outcome) => ({ ...outcome })),
      nextVehicleId: v3.traffic.nextVehicleId, completedTrips: v3.traffic.completedTrips, failedTrips: v3.traffic.failedTrips, congestionEpoch: v3.traffic.congestionEpoch,
    });
  }

  if (saveVersion === 4) {
    const v4 = base as SaveV4;
    validateServices(v4, core);
    core.services.restore(v4.services.facilities, v4.services.funding, v4.services.nextFacilityId, v4.services.fiscalPaymentRatio);
    core.serviceDispatch.restore(v4.services.jobs, v4.services.nextJobId);
    core.serviceVehicles.restore(v4.services.vehicles);
    core.incidents.restore(v4.services.incidents, v4.services.incidentOutcomes, v4.services.incidentRngState, v4.services.nextIncidentId);
    core.wasteCollection.restore(v4.services.waste.buildings, v4.services.waste.processingQueue, v4.services.waste.processedTotal, v4.services.waste.jobCargo, v4.services.waste.jobAssignments ?? []);
    core.serviceDemandSnapshot = { eligibleStudents: v4.serviceCached.demand.eligibleStudents, perBuilding: Object.fromEntries(Object.entries(v4.serviceCached.demand.perBuilding).map(([id, value]) => [id, { ...value }])) };
    core.educationSnapshot = { ...v4.serviceCached.education };
    core.neighborhoodSnapshot = { perBuilding: Object.fromEntries(Object.entries(v4.serviceCached.neighborhood.perBuilding).map(([id, value]) => [id, { ...value }])), citywideServiceQuality: v4.serviceCached.neighborhood.citywideServiceQuality, commercialServiceQuality: v4.serviceCached.neighborhood.commercialServiceQuality };
    core.serviceAccessByBuilding = copyAccess(v4.serviceCached.accessByBuilding);
    core.lastServiceGeneratedWaste = v4.serviceCached.lastGeneratedWaste;
  } else {
    const migrated = legacyLandfills.map((facility, index): ServiceFacility => ({ id: `service:${index + 1}`, type: 'landfill', department: 'garbage', x: facility.x, y: facility.y }));
    core.services.restore(migrated, {}, migrated.length + 1, 1);
    core.serviceVehicles.syncFleet(core.services);
  }

  if (saveVersion >= 3) {
    const v3 = base as SaveV3 | SaveV4;
    validateTrafficAndQueues(v3, core);
    core.intersections.restore(v3.intersections);
  }
  core.traffic.refreshMetrics(core.transportationGraph, core.serviceVehicles.edgeLoads());
  core.trafficSnapshot = core.trafficAnalytics.evaluate(core.traffic.edgeMetrics, core.traffic.recentOutcomes, core.traffic.activeVehicles.length);
  return core;
}

function normalizeEconomy(snapshot: EconomySnapshot): EconomySnapshot {
  const record = snapshot as EconomySnapshot & { utilityOperatingCost?: number; serviceOperatingCost?: number };
  return {
    ...snapshot,
    utilityOperatingCost: Number.isFinite(record.utilityOperatingCost) ? record.utilityOperatingCost! : snapshot.facilityOperatingCost,
    serviceOperatingCost: Number.isFinite(record.serviceOperatingCost) ? record.serviceOperatingCost! : 0,
  };
}

function validateBase(save: AnySave): void {
  if (!Number.isInteger(save.seed)) throw new Error('invalid seed');
  if (!Number.isInteger(save.rngState) || save.rngState < 0) throw new Error('invalid rng state');
  if (!Number.isInteger(save.clock.tick) || save.clock.tick < 0 || ![0, 1, 2, 4].includes(save.clock.speed)) throw new Error('invalid clock');
  if (!Number.isInteger(save.terrain.width) || !Number.isInteger(save.terrain.height) || save.terrain.width <= 0 || save.terrain.height <= 0) throw new Error('invalid terrain dimensions');
  if (!Array.isArray(save.terrain.cells) || save.terrain.cells.length !== save.terrain.width * save.terrain.height) throw new Error('invalid terrain cells');
  if (!Number.isFinite(save.treasury.balance) || save.treasury.balance < 0) throw new Error('invalid treasury');
  if (!Array.isArray(save.roads.cells) || !Array.isArray(save.zoning.cells) || !Array.isArray(save.buildings.items)) throw new Error('invalid entity collections');
  if (!Number.isFinite(save.population) || save.population < 0) throw new Error('invalid population');
  for (const zone of ['residential', 'commercial', 'industrial'] as const satisfies readonly ZoneType[]) {
    const rate = save.taxes.rates[zone];
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.25) throw new Error('invalid tax rate');
  }
  if (!Array.isArray(save.utilities.facilities) || !Number.isInteger(save.utilities.nextId)) throw new Error('invalid utilities');
  if (!Array.isArray(save.garbage.backlog)) throw new Error('invalid garbage state');
}

function validateServices(save: SaveV4, core: SimulationCore): void {
  if (!Array.isArray(save.services.facilities) || !Array.isArray(save.services.jobs) || !Array.isArray(save.services.vehicles) || !Array.isArray(save.services.incidents)) throw new Error('invalid service state');
  const facilityIds = new Set(save.services.facilities.map((facility) => facility.id));
  const jobIds = new Set(save.services.jobs.map((job) => job.id));
  const vehicleIds = new Set(save.services.vehicles.map((vehicle) => vehicle.id));
  const buildingIds = new Set(core.buildings.list().map((building) => building.id));
  for (const job of save.services.jobs) {
    if (!buildingIds.has(job.targetBuildingId)) throw new Error('service job target missing building');
    if (job.assignedFacilityId && !facilityIds.has(job.assignedFacilityId)) throw new Error('service job facility reference');
    if (job.assignedVehicleId && !vehicleIds.has(job.assignedVehicleId)) throw new Error('service job vehicle reference');
  }
  for (const vehicle of save.services.vehicles) {
    if (!facilityIds.has(vehicle.facilityId)) throw new Error('service vehicle facility reference');
    if (vehicle.currentJobId && !jobIds.has(vehicle.currentJobId)) throw new Error('service vehicle job reference');
    for (const edgeId of [...vehicle.edgeIds, ...vehicle.returnEdgeIds]) if (!core.transportationGraph.getEdge(edgeId)) throw new Error(`invalid service vehicle edge reference: ${edgeId}`);
    if (vehicle.queuedNodeId && !core.transportationGraph.getNode(vehicle.queuedNodeId)) throw new Error('invalid service vehicle queued node');
  }
  for (const incident of save.services.incidents) {
    if (!buildingIds.has(incident.targetBuildingId) || !jobIds.has(incident.serviceJobId)) throw new Error('service incident reference');
  }
  for (const state of save.services.waste.buildings) if (!buildingIds.has(state.buildingId)) throw new Error('building waste reference');
  for (const [jobId] of save.services.waste.jobCargo) if (!jobIds.has(jobId)) throw new Error('waste cargo job reference');
  for (const [buildingId, jobId] of save.services.waste.jobAssignments ?? []) if (!buildingIds.has(buildingId) || !jobIds.has(jobId)) throw new Error('waste assignment reference');
}

function validateTrafficAndQueues(save: SaveV3 | SaveV4, core: SimulationCore): void {
  if (!Array.isArray(save.traffic.vehicles) || !Array.isArray(save.traffic.outcomes)) throw new Error('invalid traffic state');
  const trafficVehicleIds = new Set<string>();
  for (const vehicle of save.traffic.vehicles) {
    if (trafficVehicleIds.has(vehicle.id)) throw new Error('duplicate traffic vehicle');
    trafficVehicleIds.add(vehicle.id);
    if (!Array.isArray(vehicle.edgeIds) || vehicle.edgeIds.length === 0) throw new Error('invalid traffic route');
    if (vehicle.currentEdgeIndex < 0 || vehicle.currentEdgeIndex >= vehicle.edgeIds.length) throw new Error('invalid traffic edge index');
    for (const edgeId of vehicle.edgeIds) if (!core.transportationGraph.getEdge(edgeId)) throw new Error(`invalid traffic edge reference: ${edgeId}`);
    if (vehicle.status === 'queued' && (!vehicle.queuedNodeId || !core.transportationGraph.getNode(vehicle.queuedNodeId))) throw new Error('invalid queued traffic node');
  }
  const serviceVehicleIds = new Set(core.serviceVehicles.listVehicles().map((vehicle) => vehicle.id));
  for (const [nodeId, approaches] of Object.entries(save.intersections)) {
    if (!core.transportationGraph.getNode(nodeId)) throw new Error('invalid intersection node');
    for (const approach of approaches) {
      if (!core.transportationGraph.getEdge(approach.incomingEdgeId)) throw new Error('invalid intersection traffic edge');
      for (const entry of approach.entries) if (!trafficVehicleIds.has(entry.vehicleId) && !serviceVehicleIds.has(entry.vehicleId)) throw new Error('intersection references missing vehicle');
    }
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`invalid ${label}`);
  return value as Record<string, unknown>;
}

function requireInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`invalid ${label}`);
  return value as number;
}
