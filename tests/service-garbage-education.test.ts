import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { IntersectionSystem } from '../src/simulation/traffic/IntersectionSystem.ts';
import { ServiceFacilitySystem } from '../src/simulation/services/ServiceFacilitySystem.ts';
import { ServiceDispatchSystem } from '../src/simulation/services/ServiceDispatchSystem.ts';
import { ServiceVehicleSystem } from '../src/simulation/services/ServiceVehicleSystem.ts';
import { WasteCollectionSystem } from '../src/simulation/services/WasteCollectionSystem.ts';
import { EducationSystem } from '../src/simulation/services/EducationSystem.ts';
import { GarbageSystem } from '../src/simulation/garbage/GarbageSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flatTerrain(width = 28, height = 16): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function building(id: string, x: number, y: number, zone: Building['zone'] = 'residential'): Building {
  return { id, lotId: `lot:${id}`, x, y, zone, definitionId: `${zone}_fixture`, status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
}

test('building waste accumulates deterministically and creates one collection target after threshold', () => {
  const waste = new WasteCollectionSystem();
  const buildings = [building('home', 4, 5), building('shop', 5, 5, 'commercial')];
  waste.syncBuildings(buildings, 0);
  for (let tick = 10; tick <= 30; tick += 10) waste.generate(buildings, tick);
  assert.equal(waste.getBuildingWaste('home')?.currentCollectibleWaste, 6);
  assert.equal(waste.getBuildingWaste('shop')?.currentCollectibleWaste, 12);
  assert.deepEqual(waste.pendingCollectionTargets(), ['home', 'shop']);
  const first = waste.snapshot();
  const repeat = new WasteCollectionSystem();
  repeat.syncBuildings(buildings, 0);
  for (let tick = 10; tick <= 30; tick += 10) repeat.generate(buildings, tick);
  assert.deepEqual(repeat.snapshot(), first);
});

test('garbage truck physically routes to a building, collects waste, returns, and unloads into processing capacity', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(500_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 20 }, (_, i) => ({ x: i + 2, y: 8 })), 'collector', treasury);
  const graph = new TransportationGraph(); graph.rebuildIfNeeded(roads);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  facilities.restore([{ id: 'service:1', type: 'landfill', department: 'garbage', x: 3, y: 7 }], {}, 2);
  const vehicles = new ServiceVehicleSystem(); vehicles.syncFleet(facilities);
  const dispatch = new ServiceDispatchSystem();
  const waste = new WasteCollectionSystem();
  const target = building('factory', 18, 7, 'industrial');
  waste.syncBuildings([target], 0);
  waste.generate([target], 10);
  const jobIds = waste.createCollectionJobs(10, dispatch);
  assert.equal(jobIds.length, 1);
  dispatch.assignWaiting([target], facilities, vehicles, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks, 11);

  const pathfinding = new PathfindingSystem();
  const intersections = new IntersectionSystem();
  for (let tick = 12; tick < 500 && dispatch.getJob(jobIds[0]!)?.status !== 'completed'; tick++) {
    const events = vehicles.step(graph, intersections, pathfinding, (edge) => edge.freeFlowTicks, tick);
    dispatch.applyVehicleEvents(events, tick);
    waste.applyJobs(dispatch.listJobs(), facilities, tick);
  }
  const state = waste.getBuildingWaste('factory')!;
  assert.equal(state.currentCollectibleWaste, 0);
  assert.ok(waste.processedTotal > 0);
  assert.equal(waste.processingQueue, 0);
  assert.equal(dispatch.getJob(jobIds[0]!)?.status, 'completed');
});

test('finite garbage processing capacity leaves excess unloaded waste queued and raises compatibility backlog', () => {
  const terrain = flatTerrain();
  const roads = new RoadSystem(terrain);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  facilities.restore([{ id: 'service:1', type: 'recycling_center', department: 'garbage', x: 2, y: 2 }], { garbage: 50 }, 2);
  const waste = new WasteCollectionSystem();
  waste.restore([], 100, 0, []);
  waste.processQueue(facilities);
  assert.ok(waste.processingQueue > 0);
  assert.ok(waste.processedTotal > 0);
  const compatibility = new GarbageSystem().snapshotDetailed(0, waste.processedTotal, waste.totalBacklog());
  assert.equal(compatibility.backlog, waste.totalBacklog());
  assert.ok(compatibility.serviceRatio < 1);
});

test('education quality derives from reachable effective seats, access time, and funding', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(500_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 8 })), 'collector', treasury);
  const graph = new TransportationGraph(); graph.rebuildIfNeeded(roads);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  facilities.restore([{ id: 'service:1', type: 'elementary_school', department: 'education', x: 10, y: 7 }], {}, 2);
  const homes = [building('home-a', 3, 7), building('home-b', 4, 7)];
  const education = new EducationSystem();
  const full = education.evaluate(homes, 100, facilities, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks);
  assert.equal(full.eligibleStudents, 100);
  assert.equal(full.reachableStudents, 100);
  assert.equal(full.enrolledStudents, 100);
  assert.equal(full.overcrowdedStudents, 0);
  assert.ok(full.averageSchoolAccessTicks > 0);
  assert.ok(full.educationServiceRatio > 0.5);

  facilities.setFunding('education', 50);
  const lowFunding = education.evaluate(homes, 100, facilities, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks);
  assert.ok(lowFunding.effectiveSeats < full.effectiveSeats);
  assert.ok(lowFunding.overcrowdedStudents > 0);
  assert.ok(lowFunding.educationServiceRatio < full.educationServiceRatio);
});

test('disconnected school seats do not count as education coverage', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(500_000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }], 'local', treasury);
  roads.placePath([{ x: 18, y: 8 }, { x: 19, y: 8 }], 'local', treasury);
  const graph = new TransportationGraph(); graph.rebuildIfNeeded(roads);
  const facilities = new ServiceFacilitySystem(terrain, roads);
  facilities.restore([{ id: 'service:1', type: 'elementary_school', department: 'education', x: 18, y: 7 }], {}, 2);
  const snapshot = new EducationSystem().evaluate([building('home', 3, 7)], 20, facilities, graph, new PathfindingSystem(), (edge) => edge.freeFlowTicks);
  assert.equal(snapshot.reachableStudents, 0);
  assert.equal(snapshot.enrolledStudents, 0);
  assert.equal(snapshot.educationServiceRatio, 0);
});
