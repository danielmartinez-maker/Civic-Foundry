import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { ServiceFacilitySystem } from '../src/simulation/services/ServiceFacilitySystem.ts';
import { ServiceDemandSystem } from '../src/simulation/services/ServiceDemandSystem.ts';
import { ServiceAccessibilitySystem } from '../src/simulation/services/ServiceAccessibilitySystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

function flatTerrain(width = 24, height = 14): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function building(id: string, x: number, y: number, zone: Building['zone']): Building {
  return { id, lotId: `lot:${id}`, x, y, zone, definitionId: `${zone}_fixture`, status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
}

test('service demand derives deterministic fire, police, healthcare, education, and waste loads from real city state', () => {
  const system = new ServiceDemandSystem();
  const buildings = [
    building('home-a', 3, 5, 'residential'), building('home-b', 4, 5, 'residential'),
    building('shop', 8, 5, 'commercial'), building('factory', 10, 5, 'industrial'),
  ];
  const input = {
    population: 20,
    workforce: 10,
    unemployed: 4,
    utilityByBuilding: {
      'home-a': { power: 1, water: 1 }, 'home-b': { power: 1, water: 0.5 }, shop: { power: 1, water: 1 }, factory: { power: 1, water: 1 },
    },
    wasteByBuilding: { 'home-a': 0, 'home-b': 5, shop: 1, factory: 8 },
    unresolvedByBuilding: {},
    priorAccessByBuilding: {},
  };
  const first = system.evaluate(buildings, input);
  const second = system.evaluate(buildings, input);
  assert.deepEqual(second, first);
  assert.equal(first.eligibleStudents, 4);
  assert.equal(Object.values(first.perBuilding).reduce((sum, item) => sum + item.educationStudents, 0), 4);
  assert.ok(first.perBuilding.factory!.fire > first.perBuilding['home-a']!.fire);
  assert.ok(first.perBuilding.shop!.police > first.perBuilding['home-a']!.police);
  assert.ok(first.perBuilding['home-b']!.healthcare > first.perBuilding['home-a']!.healthcare);
  assert.equal(first.perBuilding.factory!.garbage, 8);
});

function accessibilityFixture() {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(500_000);
  const roads = new RoadSystem(terrain);
  const services = new ServiceFacilitySystem(terrain, roads);
  const graph = new TransportationGraph();
  const pathfinding = new PathfindingSystem();
  const accessibility = new ServiceAccessibilitySystem();
  return { terrain, treasury, roads, services, graph, pathfinding, accessibility };
}

test('network accessibility ignores a closer disconnected facility and selects a farther reachable facility', () => {
  const { treasury, roads, services, graph, pathfinding, accessibility } = accessibilityFixture();
  roads.placePath(Array.from({ length: 10 }, (_, i) => ({ x: i + 2, y: 6 })), 'collector', treasury);
  roads.placePath([{ x: 14, y: 5 }, { x: 15, y: 5 }], 'collector', treasury);
  graph.rebuildIfNeeded(roads);
  services.restore([
    { id: 'service:1', type: 'fire_station', department: 'fire', x: 14, y: 4 },
    { id: 'service:2', type: 'fire_station', department: 'fire', x: 10, y: 5 },
  ], {}, 3);
  const target = building('home', 3, 5, 'residential');
  const result = accessibility.evaluateBuilding('fire', target, 1, services, graph, pathfinding, (edge) => edge.freeFlowTicks);
  assert.equal(result.reachable, true);
  assert.equal(result.facilityId, 'service:2');
  assert.ok(result.travelTicks > 0);
  assert.ok(result.serviceAccess > 0);
});

test('service candidate selection uses travel time before straight-line distance', () => {
  const { treasury, roads, services, graph, pathfinding, accessibility } = accessibilityFixture();
  roads.placePath([{ x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }], 'local', treasury);
  roads.placePath([{ x: 2, y: 7 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }, { x: 7, y: 8 }], 'arterial', treasury);
  graph.rebuildIfNeeded(roads);
  services.restore([
    { id: 'service:1', type: 'clinic', department: 'healthcare', x: 6, y: 6 },
    { id: 'service:2', type: 'clinic', department: 'healthcare', x: 7, y: 9 },
  ], {}, 3);
  const target = building('home', 2, 6, 'residential');
  const result = accessibility.evaluateBuilding('healthcare', target, 2, services, graph, pathfinding, (edge) => edge.freeFlowTicks);
  assert.equal(result.facilityId, 'service:2');
});

test('service accessibility is zero when no compatible facility has a road route', () => {
  const { treasury, roads, services, graph, pathfinding, accessibility } = accessibilityFixture();
  roads.placePath([{ x: 2, y: 6 }, { x: 3, y: 6 }], 'local', treasury);
  roads.placePath([{ x: 10, y: 6 }, { x: 11, y: 6 }], 'local', treasury);
  graph.rebuildIfNeeded(roads);
  services.restore([{ id: 'service:1', type: 'police_station', department: 'police', x: 10, y: 5 }], {}, 2);
  const result = accessibility.evaluateBuilding('police', building('home', 2, 5, 'residential'), 1, services, graph, pathfinding, (edge) => edge.freeFlowTicks);
  assert.equal(result.reachable, false);
  assert.equal(result.facilityId, null);
  assert.equal(result.accessibility, 0);
  assert.equal(result.serviceAccess, 0);
});
