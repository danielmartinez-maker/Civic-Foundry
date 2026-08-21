import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { serializeCore } from '../src/save/save.ts';

function flatTerrain(width = 28, height = 16): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function buildCity(roadType: 'local' | 'arterial', seed = 44): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 400_000, seed });
  core.buildRoad(Array.from({ length: 22 }, (_, i) => ({ x: i + 2, y: 8 })), roadType);
  core.paintZone(Array.from({ length: 6 }, (_, i) => ({ x: i + 3, y: 7 })), 'residential');
  core.paintZone(Array.from({ length: 4 }, (_, i) => ({ x: i + 13, y: 7 })), 'commercial');
  core.paintZone(Array.from({ length: 3 }, (_, i) => ({ x: i + 19, y: 7 })), 'industrial');
  assert.equal(core.placeUtility('power', 4, 9).ok, true);
  assert.equal(core.placeUtility('water', 10, 9).ok, true);
  assert.equal(core.placeUtility('landfill', 18, 9).ok, true);
  core.step(6_000);
  return core;
}

function stateHash(core: SimulationCore): string {
  const text = JSON.stringify(serializeCore(core));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

test('otherwise-equivalent cities diverge causally by road hierarchy', () => {
  const local = buildCity('local');
  const arterial = buildCity('arterial');
  assert.ok(local.trafficSnapshot.averageCommuteTicks > arterial.trafficSnapshot.averageCommuteTicks);
  assert.ok(local.trafficSnapshot.jobAccessibility < arterial.trafficSnapshot.jobAccessibility);
  assert.ok(local.demandSnapshot.residential < arterial.demandSnapshot.residential);
  assert.ok(local.trafficSnapshot.congestionIndex >= arterial.trafficSnapshot.congestionIndex);
});

test('same seed and inputs produce identical V3 state hash', () => {
  const a = buildCity('arterial', 51);
  const b = buildCity('arterial', 51);
  assert.equal(stateHash(a), stateHash(b));
});

test('10,000 repeated route queries reuse the deterministic cache', () => {
  const core = buildCity('collector' as 'local' | 'arterial');
  const graph = core.transportationGraph;
  const start = graph.findNodeAt(2, 8)!;
  const goal = graph.findNodeAt(23, 8)!;
  core.pathfinding.clearCache();
  const started = performance.now();
  for (let i = 0; i < 10_000; i++) core.pathfinding.findRoute(graph, start.id, goal.id, (edge) => core.traffic.generalizedCost(edge));
  const elapsedMs = performance.now() - started;
  const diagnostics = core.pathfinding.diagnostics;
  assert.equal(diagnostics.requests, 10_000);
  assert.equal(diagnostics.cacheHits, 9_999);
  assert.ok(Number.isFinite(elapsedMs));
});

test('active-city traffic performance sample remains finite and bounded', () => {
  const core = buildCity('arterial', 61);
  const started = performance.now();
  core.step(5_000);
  const elapsedMs = performance.now() - started;
  assert.ok(Number.isFinite(elapsedMs));
  assert.ok(core.traffic.activeVehicles.length < 10_000);
  assert.ok(core.traffic.recentOutcomes.length <= 128);
});
