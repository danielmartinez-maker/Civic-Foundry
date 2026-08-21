import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph, type TransportationEdge } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { TripGenerationSystem } from '../src/simulation/traffic/TripGenerationSystem.ts';
import { IntersectionSystem } from '../src/simulation/traffic/IntersectionSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flatTerrain(width = 16, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function makeGraph(): { graph: TransportationGraph; roads: RoadSystem; treasury: TreasurySystem } {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath([
    { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
  ], 'local', treasury);
  roads.placePath([
    { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 2, y: 5 }, { x: 6, y: 5 },
  ], 'collector', treasury);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  return { graph, roads, treasury };
}

test('A* finds deterministic free-flow route and returns null when unreachable', () => {
  const { graph, roads } = makeGraph();
  const pathfinding = new PathfindingSystem();
  const start = graph.findNodeAt(2, 5)!;
  const end = graph.findNodeAt(6, 5)!;
  const route = pathfinding.findRoute(graph, start.id, end.id);
  assert.ok(route);
  assert.equal(route.nodeIds[0], start.id);
  assert.equal(route.nodeIds.at(-1), end.id);
  assert.equal(route.edgeIds.length, route.nodeIds.length - 1);
  assert.ok(route.totalCost > 0);

  roads.remove(4, 5);
  roads.remove(4, 4);
  graph.rebuildIfNeeded(roads);
  assert.equal(pathfinding.findRoute(graph, start.id, end.id), null);
});

test('A* generalized cost can prefer a longer but lower-cost route', () => {
  const { graph } = makeGraph();
  const pathfinding = new PathfindingSystem();
  const start = graph.findNodeAt(2, 5)!;
  const end = graph.findNodeAt(6, 5)!;
  const localPenalty = (edge: TransportationEdge): number => edge.roadType === 'local' ? 100 : edge.freeFlowTicks;
  const route = pathfinding.findRoute(graph, start.id, end.id, { edgeCost: localPenalty, costKey: 'avoid-local' });
  assert.ok(route);
  assert.ok(route.edgeIds.some((id) => graph.getEdge(id)?.roadType === 'collector'));
  assert.ok(route.edgeIds.every((id) => graph.getEdge(id)?.roadType !== 'local' || id.includes('n:2,5>n:2,4') || id.includes('n:6,4>n:6,5')));
});

test('pathfinding caches revision-stable routes and invalidates after graph rebuild', () => {
  const { graph, roads } = makeGraph();
  const pathfinding = new PathfindingSystem();
  const start = graph.findNodeAt(2, 5)!.id;
  const end = graph.findNodeAt(6, 5)!.id;
  assert.ok(pathfinding.findRoute(graph, start, end));
  assert.ok(pathfinding.findRoute(graph, start, end));
  assert.equal(pathfinding.diagnostics.requests, 2);
  assert.equal(pathfinding.diagnostics.cacheHits, 1);
  assert.equal(pathfinding.diagnostics.cacheMisses, 1);
  roads.remove(4, 5);
  graph.rebuildIfNeeded(roads);
  pathfinding.findRoute(graph, start, end);
  assert.equal(pathfinding.diagnostics.cacheMisses, 2);
});

function building(id: string, x: number, y: number, zone: Building['zone']): Building {
  return {
    id,
    lotId: `lot:${id}`,
    x,
    y,
    zone,
    definitionId: `${zone}_fixture`,
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  };
}

test('trip generation deterministically derives commute and shopping cohorts from occupied buildings', () => {
  const generator = new TripGenerationSystem(77);
  const buildings = [
    building('home-a', 2, 2, 'residential'),
    building('home-b', 3, 2, 'residential'),
    building('shop-a', 7, 2, 'commercial'),
    building('job-a', 8, 2, 'industrial'),
  ];
  const first = generator.generate(500, buildings, 14, 7);
  const secondGenerator = new TripGenerationSystem(77);
  const second = secondGenerator.generate(500, buildings, 14, 7);
  assert.deepEqual(first, second);
  assert.ok(first.some((trip) => trip.purpose === 'commute' && trip.destinationBuildingId === 'job-a'));
  assert.ok(first.some((trip) => trip.purpose === 'shopping' && trip.destinationBuildingId === 'shop-a'));
  assert.ok(first.every((trip) => trip.travelerWeight > 0 && trip.departureTick === 500));
  assert.ok(first.every((trip) => trip.originBuildingId.startsWith('home-')));
});

test('intersection queues are FIFO and bounded by deterministic service capacity', () => {
  const { graph } = makeGraph();
  const intersections = new IntersectionSystem();
  const node = graph.findNodeAt(2, 5)!;
  const incoming = graph.outgoingEdges(node.id)[0]!;
  intersections.enqueue(node.id, incoming.id, { vehicleId: 'v1', travelerWeight: 4, queuedTick: 10 });
  intersections.enqueue(node.id, incoming.id, { vehicleId: 'v2', travelerWeight: 4, queuedTick: 11 });
  intersections.enqueue(node.id, incoming.id, { vehicleId: 'v3', travelerWeight: 1, queuedTick: 12 });
  const released = intersections.stepNode(graph, node.id);
  assert.deepEqual(released, ['v1']);
  assert.equal(intersections.queueLength(node.id), 2);
  intersections.removeVehicle('v2');
  assert.equal(intersections.queueLength(node.id), 1);
  assert.deepEqual(intersections.stepNode(graph, node.id), ['v3']);
});
