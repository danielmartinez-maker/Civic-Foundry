import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { IntersectionSystem } from '../src/simulation/traffic/IntersectionSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';
import { PathfindingSystem, type RouteResult } from '../src/simulation/traffic/PathfindingSystem.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import { ServiceDemandSystem } from '../src/simulation/services/ServiceDemandSystem.ts';
import { ServiceFacilitySystem } from '../src/simulation/services/ServiceFacilitySystem.ts';
import { ServiceAccessibilitySystem } from '../src/simulation/services/ServiceAccessibilitySystem.ts';
import { ServiceDispatchSystem } from '../src/simulation/services/ServiceDispatchSystem.ts';
import { ServiceVehicleSystem } from '../src/simulation/services/ServiceVehicleSystem.ts';
import { IncidentSystem } from '../src/simulation/services/IncidentSystem.ts';
import { WasteCollectionSystem } from '../src/simulation/services/WasteCollectionSystem.ts';
import { EducationSystem } from '../src/simulation/services/EducationSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';
import { TransitOperationsSystem } from '../src/simulation/transit/TransitOperationsSystem.ts';
import { TransitVehicleSystem } from '../src/simulation/transit/TransitVehicleSystem.ts';
import { PassengerQueueSystem } from '../src/simulation/transit/PassengerQueueSystem.ts';
import { MobilityScheduler, type MobilityPersonTrip } from '../src/simulation/mobility/MobilityScheduler.ts';
import { GarbageSystem } from '../src/simulation/garbage/GarbageSystem.ts';
import { ProductionSystem } from '../src/simulation/economy/ProductionSystem.ts';
import { InventorySystem } from '../src/simulation/economy/InventorySystem.ts';
import type { Firm } from '../src/simulation/economy/FirmSystem.ts';
import { SystemScheduler } from '../src/simulation/kernel/SystemScheduler.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function occupiedBuilding(id: string, x: number, y: number, definitionId = 'residential_cottage'): Building {
  const zone = definitionId.startsWith('commercial_') ? 'commercial' : definitionId.startsWith('industrial_') ? 'industrial' : 'residential';
  return {
    id,
    lotId: `lot:${x},${y}`,
    x,
    y,
    zone,
    definitionId,
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  };
}

function roadLine(terrain: TerrainGrid, y: number, fromX = 1, toX = 10): { roads: RoadSystem; treasury: TreasurySystem; graph: TransportationGraph } {
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  assert.equal(roads.placePath(Array.from({ length: toX - fromX + 1 }, (_, i) => ({ x: fromX + i, y })), 'local', treasury).ok, true);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  return { roads, treasury, graph };
}

function intersectionFixture(): { graph: TransportationGraph; nodeId: string; incomingEdgeId: string } {
  const terrain = flatTerrain(7, 7);
  const roads = new RoadSystem(terrain);
  const treasury = new TreasurySystem(1_000_000);
  assert.equal(roads.placePath([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }], 'local', treasury).ok, true);
  assert.equal(roads.placePath([{ x: 3, y: 2 }], 'local', treasury).ok, true);
  assert.equal(roads.placePath([{ x: 3, y: 4 }], 'local', treasury).ok, true);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const node = graph.findNodeAt(3, 3);
  assert.ok(node);
  const incoming = graph.edges.find((edge) => edge.to === node.id);
  assert.ok(incoming);
  return { graph, nodeId: node.id, incomingEdgeId: incoming.id };
}

function developedCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 1_000_000, seed: 31 });
  assert.equal(core.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 3 }], 'residential').painted, 1);
  assert.equal(core.placeUtility('power', 2, 5).ok, true);
  assert.equal(core.placeUtility('water', 3, 5).ok, true);
  core.step(140);
  assert.equal(core.buildings.occupied().length, 1);
  return core;
}

test('intersection releases survive an unrelated consumer pass', () => {
  const { graph, nodeId, incomingEdgeId } = intersectionFixture();
  const intersections = new IntersectionSystem();
  intersections.enqueue(nodeId, incomingEdgeId, { vehicleId: 'vehicle:1', travelerWeight: 1, queuedTick: 1 });
  intersections.enqueue(nodeId, incomingEdgeId, { vehicleId: 'service-vehicle:1', travelerWeight: 1, queuedTick: 1, priority: 'emergency' });
  const firstPass = intersections.stepNode(graph, nodeId);
  assert.ok(firstPass.includes('vehicle:1'));
  intersections.removeVehicle('service-vehicle:1');
  const secondPass = intersections.stepNode(graph, nodeId);
  assert.ok(secondPass.includes('vehicle:1'));
});

test('intersection services cohorts heavier than one-tick capacity over multiple ticks', () => {
  const { graph, nodeId, incomingEdgeId } = intersectionFixture();
  const intersections = new IntersectionSystem();
  intersections.enqueue(nodeId, incomingEdgeId, { vehicleId: 'vehicle:heavy', travelerWeight: 100, queuedTick: 0 });
  let released = false;
  for (let tick = 0; tick < 100 && !released; tick++) released = intersections.stepNode(graph, nodeId).includes('vehicle:heavy');
  assert.equal(released, true);
});

test('roads cannot be built through occupied buildings', () => {
  const core = developedCore();
  const building = core.buildings.occupied()[0]!;
  assert.equal(core.buildRoad([{ x: building.x, y: building.y }], 'local').ok, false);
});

test('occupied building cells cannot be rezoned or occupied by utilities', () => {
  const core = developedCore();
  const building = core.buildings.occupied()[0]!;
  assert.equal(core.paintZone([{ x: building.x, y: building.y }], 'commercial').painted, 0);
  assert.equal(core.placeUtility('power', building.x, building.y).ok, false);
});

test('removing sole frontage cannot orphan an existing building from its lot', () => {
  const core = developedCore();
  const building = core.buildings.occupied()[0]!;
  const lot = core.lots.list().find((candidate) => candidate.id === building.lotId)!;
  const [x, y] = lot.frontageRoadKey.split(',').map(Number);
  const result = core.bulldozeAt(x!, y!);
  assert.equal(result.ok, false);
  assert.ok(core.lots.list().some((candidate) => candidate.id === building.lotId));
  assert.ok(core.buildings.getById(building.id));
});

test('service demand uses the instantiated building definition', () => {
  const cottage = occupiedBuilding('building:cottage', 2, 2, 'residential_cottage');
  const apartment = occupiedBuilding('building:apartment', 3, 2, 'residential_apartment');
  const system = new ServiceDemandSystem();
  const snapshot = system.evaluate([cottage, apartment], {
    population: 82,
    workforce: 50,
    unemployed: 0,
    utilityByBuilding: {
      [cottage.id]: { power: 1, water: 1 },
      [apartment.id]: { power: 1, water: 1 },
    },
    wasteByBuilding: {},
    unresolvedByBuilding: {},
    priorAccessByBuilding: {},
  });
  assert.equal(snapshot.perBuilding[cottage.id]?.garbage, 2);
  assert.equal(snapshot.perBuilding[apartment.id]?.garbage, 12);
  assert.ok((snapshot.perBuilding[apartment.id]?.educationStudents ?? 0) > (snapshot.perBuilding[cottage.id]?.educationStudents ?? 0));
});

test('education uses all reachable school capacity instead of only the nearest school', () => {
  const terrain = flatTerrain(12, 6);
  const { roads, treasury, graph } = roadLine(terrain, 3);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  assert.equal(facilities.placeFacility('elementary_school', 2, 2, treasury).ok, true);
  assert.equal(facilities.placeFacility('elementary_school', 8, 2, treasury).ok, true);
  const home = occupiedBuilding('building:home', 5, 2, 'residential_apartment');
  const snapshot = new EducationSystem().evaluate([home], 200, facilities, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks);
  assert.equal(snapshot.enrolledStudents, 200);
  assert.equal(snapshot.overcrowdedStudents, 0);
});

test('one assigned service job does not imply one hundred percent facility utilization', () => {
  const terrain = flatTerrain(12, 6);
  const { roads, treasury, graph } = roadLine(terrain, 3);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  const placed = facilities.placeFacility('fire_station', 2, 2, treasury);
  assert.equal(placed.ok, true);
  const facility = facilities.listFacilities()[0]!;
  const target = occupiedBuilding('building:target', 8, 2);
  const result = new ServiceAccessibilitySystem().evaluateBuilding(
    'fire', target, 1, facilities, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks,
    { utilizationByFacility: { [facility.id]: 1 } },
  );
  assert.ok(result.serviceAccess > 0);
});

test('enabling a transit line late does not replay departures from tick zero', () => {
  const terrain = flatTerrain(12, 5);
  const { roads, treasury, graph } = roadLine(terrain, 2);
  const transit = new TransitNetworkSystem(terrain, roads);
  const a = transit.placeStop('surface_stop', 2, 1, treasury).id!;
  const b = transit.placeStop('surface_stop', 8, 1, treasury).id!;
  const lineId = transit.createLine('bus', 'Late Line');
  assert.equal(transit.setLineStops(lineId, [a, b]).ok, true);
  transit.setHeadway(lineId, 20);
  transit.setEnabled(lineId, true);
  const operations = new TransitOperationsSystem();
  const vehicles = new TransitVehicleSystem();
  operations.step(1000, transit, vehicles, new PassengerQueueSystem(), graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks);
  const snapshot = operations.snapshotLineWithVehicles(lineId, vehicles);
  assert.equal(snapshot.dispatchedRuns, 1);
  assert.equal(snapshot.missedRuns, 0);
});

test('transit passenger direction follows route order rather than lexical stop ids', () => {
  const terrain = flatTerrain(12, 5);
  const { roads, treasury, graph } = roadLine(terrain, 2);
  const transit = new TransitNetworkSystem(terrain, roads);
  const a = transit.placeStop('metro_station', 2, 1, treasury).id!;
  const b = transit.placeStop('metro_station', 8, 1, treasury).id!;
  const lineId = transit.createLine('metro', 'Reverse IDs');
  assert.equal(transit.setLineStops(lineId, [b, a]).ok, true);
  transit.setHeadway(lineId, 20);
  transit.setFare(lineId, 0);
  transit.setEnabled(lineId, true);
  const trip: MobilityPersonTrip = {
    id: 'person:reverse-id',
    sourceTripId: 'trip:reverse-id',
    originBuildingId: 'origin',
    destinationBuildingId: 'destination',
    originRoadNodeId: graph.findNodeAt(8, 2)!.id,
    destinationRoadNodeId: graph.findNodeAt(2, 2)!.id,
    departureTick: 20,
    travelerWeight: 5,
    purpose: 'commute',
  };
  const mobility = new MobilityScheduler();
  const snapshot = mobility.tick({
    tick: 20,
    roadGraph: graph,
    transit,
    pathfinding: new PathfindingSystem(),
    roadTravelTime: (edge) => edge.freeFlowTicks * 100,
    costEpoch: 1,
    generateTrips: () => [trip],
    submitCarTrip: () => {},
  });
  assert.equal(snapshot.transitModeShare, 1);
  const queued = mobility.passengers.snapshot().queues.flatMap((queue) => queue.cohorts);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.directionKey, 'forward');
});

test('same-node person trips are treated as successful zero-cost travel', () => {
  const terrain = flatTerrain(4, 4);
  const { roads, graph } = roadLine(terrain, 2, 1, 1);
  const transit = new TransitNetworkSystem(terrain, roads);
  const nodeId = graph.findNodeAt(1, 2)!.id;
  const trip: MobilityPersonTrip = {
    id: 'person:local', sourceTripId: 'trip:local', originBuildingId: 'a', destinationBuildingId: 'b',
    originRoadNodeId: nodeId, destinationRoadNodeId: nodeId, departureTick: 1, travelerWeight: 3, purpose: 'commute',
  };
  const mobility = new MobilityScheduler();
  const snapshot = mobility.tick({
    tick: 1, roadGraph: graph, transit, pathfinding: new PathfindingSystem(), roadTravelTime: (edge) => edge.freeFlowTicks,
    generateTrips: () => [trip], submitCarTrip: () => {},
  });
  assert.equal(snapshot.unmetShare, 0);
  assert.equal(snapshot.carModeShare, 1);
  assert.equal(snapshot.personAccessibility, 1);
});

test('traffic records a same-node trip as completed without spawning a vehicle', () => {
  const traffic = new TrafficSystem();
  const route: RouteResult = { nodeIds: ['n:1,1'], edgeIds: [], totalCost: 0 };
  const id = traffic.submitTrip({ id: 'trip:local', originBuildingId: 'a', destinationBuildingId: 'b', departureTick: 5, travelerWeight: 2, purpose: 'commute' }, route, 5, 0);
  assert.equal(id, null);
  assert.equal(traffic.completedTrips, 1);
  assert.equal(traffic.recentOutcomes.at(-1)?.success, true);
});

test('garbage metrics purge removed buildings and current backlog is not masked by lifetime processing', () => {
  const garbage = new GarbageSystem();
  garbage.restoreBacklog([['building:gone', 50]]);
  const terrain = flatTerrain(4, 4);
  const roads = new RoadSystem(terrain);
  assert.equal(garbage.evaluate([], roads, []).backlog, 0);
  const current = garbage.snapshotDetailed(10, 10_000, 100);
  assert.ok(current.serviceRatio < 0.5);
});

test('completed garbage cargo reaches processing even if its source building was demolished', () => {
  const waste = new WasteCollectionSystem();
  waste.restore([], 0, 0, [['service-job:1', 10]], [['building:gone', 'service-job:1']]);
  const terrain = flatTerrain(4, 4);
  const roads = new RoadSystem(terrain);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  waste.applyJobs([{
    id: 'service-job:1', type: 'garbage_collection', department: 'garbage', targetBuildingId: 'building:gone', createdTick: 0,
    severity: 1, status: 'completed', accumulatedDelayTicks: 0,
  }], facilities, 10);
  assert.equal(waste.processingQueue, 10);
});

test('orphaned service jobs and incidents resolve as failures after demolition', () => {
  const terrain = flatTerrain(4, 4);
  const roads = new RoadSystem(terrain);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  const vehicles = new ServiceVehicleSystem();
  const dispatch = new ServiceDispatchSystem();
  const incidents = new IncidentSystem(5);
  const target = occupiedBuilding('building:gone', 1, 1);
  const incidentId = incidents.createIncident('police', target, 1, 0, dispatch);
  dispatch.assignWaiting([], facilities, vehicles, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks, 10);
  assert.equal(dispatch.listJobs()[0]?.status, 'failed');
  incidents.advance(10, dispatch.listJobs(), [], dispatch);
  assert.equal(incidents.getIncident(incidentId)?.status, 'resolved');
});

test('full output storage is not misreported as an input shortage', () => {
  const firm: Firm = {
    id: 'firm:1', buildingId: 'building:1', zone: 'industrial', archetype: 'light_manufacturing', status: 'operating',
    jobCapacity: 14, filledJobs: 14, vacancies: 0, productivity: 1, cashHealth: 1,
    consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: 0, lastOperatingMargin: 0,
  };
  const inventories = new InventorySystem();
  inventories.syncFirm(firm);
  inventories.seed(firm.id, 'industrial_inputs', 50);
  inventories.seed(firm.id, 'manufactured_goods', 90);
  const result = new ProductionSystem().runFirmCycle(firm, inventories, { utilityRatio: 1, serviceRatio: 1, localDemand: 1 });
  assert.equal(result.throughput, 0);
  assert.equal(result.lostOutputFromInputShortage, 0);
});

test('scheduler rejects unordered writer-reader conflicts on overlapping cadences', () => {
  const scheduler = new SystemScheduler();
  scheduler.register({ id: 'writer', reads: [], writes: ['population'], cadence: { every: 1 }, execute: () => {} });
  scheduler.register({ id: 'reader', reads: ['population'], writes: [], cadence: { every: 1 }, execute: () => {} });
  assert.throws(() => scheduler.compile(), /ambiguous .* conflict/i);
});

test('same-node pathfinding participates in cache diagnostics', () => {
  const terrain = flatTerrain(4, 4);
  const { graph } = roadLine(terrain, 2, 1, 1);
  const nodeId = graph.findNodeAt(1, 2)!.id;
  const pathfinding = new PathfindingSystem();
  assert.ok(pathfinding.findRoute(graph, nodeId, nodeId));
  assert.equal(pathfinding.diagnostics.requests, 1);
  assert.equal(pathfinding.diagnostics.cacheMisses, 1);
  assert.equal(pathfinding.diagnostics.cacheHits, 0);
});
