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

function copyUtilitySnapshot(snapshot: UtilitySnapshot): UtilitySnapshot {
  const perBuilding: Record<string, { power: number; water: number }> = {};
  for (const [id, service] of Object.entries(snapshot.perBuilding)) perBuilding[id] = { ...service };
  return { power: { ...snapshot.power }, water: { ...snapshot.water }, perBuilding };
}

export function serializeCore(core: SimulationCore): SaveV3 {
  const traffic = core.traffic.snapshotState();
  const intersections = core.intersections.snapshot();
  const intersectionCopy: Record<string, Array<{ incomingEdgeId: string; entries: Array<{ vehicleId: string; travelerWeight: number; queuedTick: number }> }>> = {};
  for (const [nodeId, approaches] of Object.entries(intersections)) {
    intersectionCopy[nodeId] = approaches.map((approach) => ({
      incomingEdgeId: approach.incomingEdgeId,
      entries: approach.entries.map((entry) => ({ ...entry })),
    }));
  }

  return {
    saveVersion: 3,
    gameVersion: '0.3.0-rebuild',
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
      employment: { ...core.employmentSnapshot },
      utilities: copyUtilitySnapshot(core.utilitySnapshot),
      garbage: { ...core.garbageSnapshot },
      demand: { ...core.demandSnapshot },
      taxRevenue: { ...core.taxRevenue },
      economy: { ...core.economySnapshot },
    },
    tripGeneration: { rngState: core.tripGeneration.getRandomState(), nextTripId: core.tripGeneration.getNextTripId() },
    traffic: {
      vehicles: traffic.vehicles.map((vehicle) => ({ ...vehicle, edgeIds: [...vehicle.edgeIds] })),
      outcomes: traffic.outcomes.map((outcome) => ({ ...outcome })),
      nextVehicleId: traffic.nextVehicleId,
      completedTrips: traffic.completedTrips,
      failedTrips: traffic.failedTrips,
      congestionEpoch: traffic.congestionEpoch,
    },
    intersections: intersectionCopy,
  };
}

export function hydrateCore(input: unknown): SimulationCore {
  const record = requireRecord(input, 'save');
  const saveVersion = requireInteger(record.saveVersion, 'saveVersion');
  if (saveVersion !== 2 && saveVersion !== 3) throw new Error(`unsupported save version: ${saveVersion}`);
  const base = record as unknown as SaveV3 | SaveV2Like;
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
  core.utilities.restore(base.utilities.facilities, base.utilities.nextId);
  core.garbage.restoreBacklog(base.garbage.backlog);
  core.economy.restore(base.economy.lastSettlement);

  core.employmentSnapshot = { ...base.cached.employment };
  core.utilitySnapshot = copyUtilitySnapshot(base.cached.utilities);
  core.garbageSnapshot = { ...base.cached.garbage };
  core.demandSnapshot = { ...base.cached.demand };
  core.taxRevenue = { ...base.cached.taxRevenue };
  core.economySnapshot = { ...base.cached.economy };

  core.transportationGraph.rebuildIfNeeded(core.roads);

  if (saveVersion === 3) {
    const v3 = base as SaveV3;
    validateTraffic(v3, core);
    core.tripGeneration.restoreRandomState(v3.tripGeneration.rngState, v3.tripGeneration.nextTripId);
    core.traffic.restoreState({
      vehicles: v3.traffic.vehicles.map((vehicle) => ({ ...vehicle, edgeIds: [...vehicle.edgeIds] })),
      outcomes: v3.traffic.outcomes.map((outcome) => ({ ...outcome })),
      nextVehicleId: v3.traffic.nextVehicleId,
      completedTrips: v3.traffic.completedTrips,
      failedTrips: v3.traffic.failedTrips,
      congestionEpoch: v3.traffic.congestionEpoch,
    });
    core.intersections.restore(v3.intersections);
  }

  core.traffic.refreshMetrics(core.transportationGraph);
  core.trafficSnapshot = core.trafficAnalytics.evaluate(core.traffic.edgeMetrics, core.traffic.recentOutcomes, core.traffic.activeVehicles.length);
  return core;
}

function validateBase(save: SaveV3 | SaveV2Like): void {
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

function validateTraffic(save: SaveV3, core: SimulationCore): void {
  if (!Array.isArray(save.traffic.vehicles) || !Array.isArray(save.traffic.outcomes)) throw new Error('invalid traffic state');
  const vehicleIds = new Set<string>();
  for (const vehicle of save.traffic.vehicles) {
    if (vehicleIds.has(vehicle.id)) throw new Error('duplicate traffic vehicle');
    vehicleIds.add(vehicle.id);
    if (!Array.isArray(vehicle.edgeIds) || vehicle.edgeIds.length === 0) throw new Error('invalid traffic route');
    if (vehicle.currentEdgeIndex < 0 || vehicle.currentEdgeIndex >= vehicle.edgeIds.length) throw new Error('invalid traffic edge index');
    for (const edgeId of vehicle.edgeIds) {
      if (!core.transportationGraph.getEdge(edgeId)) throw new Error(`invalid traffic edge reference: ${edgeId}`);
    }
    if (vehicle.status === 'queued') {
      if (!vehicle.queuedNodeId || !core.transportationGraph.getNode(vehicle.queuedNodeId)) throw new Error('invalid queued traffic node');
    }
  }
  for (const [nodeId, approaches] of Object.entries(save.intersections)) {
    if (!core.transportationGraph.getNode(nodeId)) throw new Error('invalid intersection node');
    for (const approach of approaches) {
      if (!core.transportationGraph.getEdge(approach.incomingEdgeId)) throw new Error('invalid intersection traffic edge');
      for (const entry of approach.entries) if (!vehicleIds.has(entry.vehicleId)) throw new Error('intersection references missing vehicle');
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
