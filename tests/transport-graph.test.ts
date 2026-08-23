import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { ROAD_DEFINITIONS } from '../src/data/roads.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';

function flatTerrain(width = 14, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

test('road hierarchy has increasing capacity and speed with higher construction cost', () => {
  assert.ok(ROAD_DEFINITIONS.collector.weightedVehicleCapacityPerMinute > ROAD_DEFINITIONS.local.weightedVehicleCapacityPerMinute);
  assert.ok(ROAD_DEFINITIONS.arterial.weightedVehicleCapacityPerMinute > ROAD_DEFINITIONS.collector.weightedVehicleCapacityPerMinute);
  assert.ok(ROAD_DEFINITIONS.collector.freeFlowSpeedCellsPerSecond > ROAD_DEFINITIONS.local.freeFlowSpeedCellsPerSecond);
  assert.ok(ROAD_DEFINITIONS.arterial.freeFlowSpeedCellsPerSecond > ROAD_DEFINITIONS.collector.freeFlowSpeedCellsPerSecond);
  assert.ok(ROAD_DEFINITIONS.arterial.constructionCostPerCell > ROAD_DEFINITIONS.local.constructionCostPerCell);
});

test('new road path may cross an existing road cell and only charges new cells', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(10_000);
  const roads = new RoadSystem(terrain);
  assert.equal(roads.placePath([{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }], 'local', treasury).ok, true);
  const before = treasury.balance;
  const crossing = roads.placePath([{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }], 'collector', treasury);
  assert.equal(crossing.ok, true);
  assert.equal(crossing.cost, ROAD_DEFINITIONS.collector.constructionCostPerCell * 2);
  assert.equal(before - treasury.balance, crossing.cost);
  assert.equal(roads.list().length, 5);
});

test('transportation graph derives deterministic road nodes and bidirectional edges', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(10_000);
  const roads = new RoadSystem(terrain);
  roads.placePath([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }], 'local', treasury);
  const graph = new TransportationGraph();
  assert.equal(graph.rebuildIfNeeded(roads), true);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 4);
  assert.ok(graph.findNodeAt(2, 5));
  const revision = graph.revision;
  assert.equal(graph.rebuildIfNeeded(roads), false);
  assert.equal(graph.revision, revision);
  roads.remove(3, 5);
  assert.equal(graph.rebuildIfNeeded(roads), true);
  assert.equal(graph.edges.length, 0);
});
