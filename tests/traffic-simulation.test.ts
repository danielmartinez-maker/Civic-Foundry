import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { IntersectionSystem } from '../src/simulation/traffic/IntersectionSystem.ts';
import { TrafficSystem } from '../src/simulation/traffic/TrafficSystem.ts';
import { TrafficAnalytics } from '../src/simulation/traffic/TrafficAnalytics.ts';
import type { TripRequest } from '../src/simulation/traffic/TripGenerationSystem.ts';
import type { RoadType } from '../src/data/roads.ts';
import { DemandSystem } from '../src/simulation/demand/DemandSystem.ts';

function flatTerrain(width = 20, height = 14): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function linearGraph(type: RoadType): { graph: TransportationGraph; roads: RoadSystem } {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath(Array.from({ length: 8 }, (_, i) => ({ x: i + 2, y: 6 })), type, treasury);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  return { graph, roads };
}

function trip(id: string, weight = 1, purpose: TripRequest['purpose'] = 'commute'): TripRequest {
  return { id, originBuildingId: 'home', destinationBuildingId: 'job', departureTick: 0, travelerWeight: weight, purpose };
}

test('traffic vehicle progresses along a real route and records a completed outcome', () => {
  const { graph } = linearGraph('collector');
  const pathfinding = new PathfindingSystem();
  const intersections = new IntersectionSystem();
  const traffic = new TrafficSystem();
  const route = pathfinding.findRoute(graph, graph.findNodeAt(2, 6)!.id, graph.findNodeAt(9, 6)!.id)!;
  const vehicleId = traffic.submitTrip(trip('t1'), route, 0);
  assert.ok(vehicleId);
  for (let tick = 1; tick <= 200 && traffic.activeVehicles.length > 0; tick++) traffic.step(graph, intersections, tick);
  assert.equal(traffic.activeVehicles.length, 0);
  const outcome = traffic.recentOutcomes.at(-1);
  assert.ok(outcome);
  assert.equal(outcome.tripId, 't1');
  assert.equal(outcome.success, true);
  assert.ok(outcome.actualTravelTicks >= outcome.freeFlowTicks);
});

test('same weighted traffic produces more congestion on local roads than arterials', () => {
  function loaded(type: RoadType): number {
    const { graph } = linearGraph(type);
    const pathfinding = new PathfindingSystem();
    const intersections = new IntersectionSystem();
    const traffic = new TrafficSystem();
    const route = pathfinding.findRoute(graph, graph.findNodeAt(2, 6)!.id, graph.findNodeAt(9, 6)!.id)!;
    for (let i = 0; i < 10; i++) traffic.submitTrip(trip(`t${i}`, 6), route, 0);
    traffic.step(graph, intersections, 1);
    return Math.max(...traffic.edgeMetrics.map((metric) => metric.congestion));
  }
  assert.ok(loaded('local') > loaded('arterial'));
});

test('road demolition invalidates a queued vehicle and removes its intersection queue entry', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }], 'local', treasury);
  roads.placePath([{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }], 'local', treasury);
  const graph = new TransportationGraph();
  graph.rebuildIfNeeded(roads);
  const pathfinding = new PathfindingSystem();
  const intersections = new IntersectionSystem();
  const traffic = new TrafficSystem();
  const route = pathfinding.findRoute(graph, graph.findNodeAt(2, 6)!.id, graph.findNodeAt(6, 6)!.id)!;
  const vehicleId = traffic.submitTrip(trip('queued', 1), route, 0)!;
  for (let tick = 1; tick <= 100; tick++) {
    traffic.step(graph, intersections, tick);
    if (traffic.getVehicle(vehicleId)?.status === 'queued') break;
  }
  assert.equal(traffic.getVehicle(vehicleId)?.status, 'queued');
  assert.equal(intersections.queueLength(), 1);
  roads.remove(3, 6);
  graph.rebuildIfNeeded(roads);
  traffic.step(graph, intersections, 101);
  assert.equal(traffic.getVehicle(vehicleId), undefined);
  assert.equal(intersections.queueLength(), 0);
  assert.equal(traffic.recentOutcomes.at(-1)?.success, false);
});

test('traffic analytics turn delays and failures into lower purpose accessibility', () => {
  const analytics = new TrafficAnalytics();
  const healthy = analytics.evaluate([], [
    { tripId: 'c1', purpose: 'commute', travelerWeight: 10, success: true, freeFlowTicks: 20, actualTravelTicks: 22 },
    { tripId: 's1', purpose: 'shopping', travelerWeight: 5, success: true, freeFlowTicks: 10, actualTravelTicks: 11 },
  ], 0);
  const failing = analytics.evaluate([], [
    { tripId: 'c2', purpose: 'commute', travelerWeight: 10, success: false, freeFlowTicks: 20, actualTravelTicks: 100 },
    { tripId: 's2', purpose: 'shopping', travelerWeight: 5, success: true, freeFlowTicks: 10, actualTravelTicks: 50 },
  ], 0);
  assert.ok(healthy.jobAccessibility > failing.jobAccessibility);
  assert.ok(healthy.commercialAccessibility > failing.commercialAccessibility);
  assert.ok(failing.delayedTripShare > healthy.delayedTripShare);
});

test('accessibility penalizes objectively longer successful trips even without relative congestion', () => {
  const analytics = new TrafficAnalytics();
  const slow = analytics.evaluate([], [
    { tripId: 'c-slow', purpose: 'commute', travelerWeight: 10, success: true, freeFlowTicks: 140, actualTravelTicks: 140 },
    { tripId: 's-slow', purpose: 'shopping', travelerWeight: 5, success: true, freeFlowTicks: 110, actualTravelTicks: 110 },
  ], 0);
  const fast = analytics.evaluate([], [
    { tripId: 'c-fast', purpose: 'commute', travelerWeight: 10, success: true, freeFlowTicks: 60, actualTravelTicks: 60 },
    { tripId: 's-fast', purpose: 'shopping', travelerWeight: 5, success: true, freeFlowTicks: 45, actualTravelTicks: 45 },
  ], 0);
  assert.ok(fast.jobAccessibility > slow.jobAccessibility);
  assert.ok(fast.commercialAccessibility > slow.commercialAccessibility);
});

test('traffic accessibility causally changes demand through the existing demand system', () => {
  const demand = new DemandSystem();
  const base = {
    population: 20, housingCapacity: 20, workforce: 10, employed: 10, totalJobs: 12,
    powerRatio: 1, waterRatio: 1, garbageRatio: 1,
    taxRates: { residential: 0.1, commercial: 0.1, industrial: 0.1 },
  } as const;
  const accessible = demand.evaluate({ ...base, trafficJobAccessibility: 1, trafficCommercialAccessibility: 1 });
  const isolated = demand.evaluate({ ...base, trafficJobAccessibility: 0, trafficCommercialAccessibility: 0 });
  assert.ok(accessible.residential > isolated.residential);
  assert.ok(accessible.commercial > isolated.commercial);
});

import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';

test('SimulationCore generates, routes, and advances traffic from the managed city loop', () => {
  const core = new SimulationCore({ terrain: flatTerrain(22, 14), startingFunds: 250_000, seed: 33 });
  assert.equal(core.buildRoad(Array.from({ length: 16 }, (_, i) => ({ x: i + 2, y: 7 })), 'collector').ok, true);
  core.paintZone([{ x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }], 'residential');
  core.paintZone([{ x: 10, y: 6 }, { x: 11, y: 6 }], 'commercial');
  core.paintZone([{ x: 14, y: 6 }, { x: 15, y: 6 }], 'industrial');
  assert.equal(core.placeUtility('power', 4, 8).ok, true);
  assert.equal(core.placeUtility('water', 8, 8).ok, true);
  assert.equal(core.placeUtility('landfill', 13, 8).ok, true);
  core.step(1600);
  assert.ok(core.transportationGraph.edges.length > 0);
  assert.ok(core.pathfinding.diagnostics.requests > 0);
  assert.ok(core.traffic.completedTrips + core.traffic.activeVehicles.length > 0);
  assert.ok(core.trafficSnapshot.jobAccessibility >= 0 && core.trafficSnapshot.jobAccessibility <= 1);
  assert.ok(core.trafficSnapshot.commercialAccessibility >= 0 && core.trafficSnapshot.commercialAccessibility <= 1);
});
