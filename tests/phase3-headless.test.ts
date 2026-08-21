import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import type { RoadType } from '../src/data/roads.ts';
import { serializeCore } from '../src/save/save.ts';

function flatTerrain(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function buildComparisonCity(roadType: RoadType, seed = 123): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 1_000_000, seed });
  assert.equal(core.buildRoad(Array.from({ length: 34 }, (_, i) => ({ x: i + 2, y: 12 })), roadType).ok, true);
  for (let x = 3; x <= 12; x++) core.paintZone([{ x, y: 11 }], 'residential');
  for (let x = 24; x <= 28; x++) core.paintZone([{ x, y: 11 }], 'commercial');
  for (let x = 29; x <= 33; x++) core.paintZone([{ x, y: 11 }], 'industrial');
  for (const [x, y] of [[5, 13], [8, 13], [11, 13]] as const) assert.equal(core.placeUtility('power', x, y).ok, true);
  for (const [x, y] of [[14, 13], [17, 13], [20, 13]] as const) assert.equal(core.placeUtility('water', x, y).ok, true);
  for (const [x, y] of [[23, 13], [26, 13], [29, 13]] as const) assert.equal(core.placeUtility('landfill', x, y).ok, true);
  core.taxes.setRate('residential', 0.12);
  core.taxes.setRate('commercial', 0.12);
  core.taxes.setRate('industrial', 0.12);
  return core;
}

function sampleTraffic(core: SimulationCore, warmupTicks = 5_000, sampleTicks = 5_000) {
  core.step(warmupTicks);
  let congestion = 0;
  let speed = 0;
  let jobAccessibility = 0;
  let samples = 0;
  for (let elapsed = 0; elapsed < sampleTicks; elapsed += 10) {
    core.step(10);
    congestion += core.trafficSnapshot.congestionIndex;
    speed += core.trafficSnapshot.averageNetworkSpeed;
    jobAccessibility += core.trafficSnapshot.jobAccessibility;
    samples++;
  }
  return {
    averageCongestion: congestion / samples,
    averageSpeed: speed / samples,
    averageJobAccessibility: jobAccessibility / samples,
    averageCommuteTicks: core.trafficSnapshot.averageCommuteTicks,
    residentialDemand: core.demandSnapshot.residential,
    completedTrips: core.traffic.completedTrips,
  };
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

test('road hierarchy produces measurable transportation consequences in otherwise-equivalent cities', () => {
  const local = sampleTraffic(buildComparisonCity('local'));
  const arterial = sampleTraffic(buildComparisonCity('arterial'));

  assert.ok(local.completedTrips > 100, 'local-road city should produce completed real trips');
  assert.ok(arterial.completedTrips > 100, 'arterial city should produce completed real trips');
  assert.ok(local.averageCongestion > arterial.averageCongestion * 10, `${local.averageCongestion} should materially exceed ${arterial.averageCongestion}`);
  assert.ok(local.averageSpeed < arterial.averageSpeed);
  assert.ok(local.averageCommuteTicks > arterial.averageCommuteTicks);
  assert.ok(local.averageJobAccessibility < arterial.averageJobAccessibility);
  assert.ok(local.residentialDemand < arterial.residentialDemand);

  console.log('PHASE3_COMPARISON', JSON.stringify({ local, arterial }));
});

test('same seed and commands produce identical final V3 authoritative state hash', () => {
  const first = buildComparisonCity('collector', 777);
  const second = buildComparisonCity('collector', 777);
  first.step(8_000);
  second.step(8_000);
  const firstHash = stableHash(serializeCore(first));
  const secondHash = stableHash(serializeCore(second));
  assert.equal(firstHash, secondHash);
  console.log('PHASE3_DETERMINISTIC_HASH', firstHash);
});

test('pathfinding cache handles 10,000 repeated real graph route requests', () => {
  const core = buildComparisonCity('collector', 333);
  core.step(100);
  core.transportationGraph.rebuildIfNeeded(core.roads);
  const start = core.transportationGraph.findNodeAt(3, 12);
  const end = core.transportationGraph.findNodeAt(33, 12);
  assert.ok(start && end);

  const beforeRequests = core.pathfinding.diagnostics.requests;
  const beforeHits = core.pathfinding.diagnostics.cacheHits;
  const started = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const route = core.pathfinding.findRoute(core.transportationGraph, start.id, end.id, {
      edgeCost: (edge) => edge.freeFlowTicks,
      costKey: 'headless-benchmark',
    });
    assert.ok(route);
  }
  const elapsedMs = performance.now() - started;
  const requests = core.pathfinding.diagnostics.requests - beforeRequests;
  const hits = core.pathfinding.diagnostics.cacheHits - beforeHits;
  assert.equal(requests, 10_000);
  assert.ok(hits >= 9_999);
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
  console.log('PHASE3_PATHFINDING_BENCHMARK', JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)), requests, hits, hitRatio: hits / requests }));
});

test('5,000 active simulation ticks remain finite and report traffic timing', () => {
  const core = buildComparisonCity('collector', 444);
  const started = performance.now();
  core.step(5_000);
  const elapsedMs = performance.now() - started;
  const save = serializeCore(core);
  assert.ok(Number.isFinite(core.population.population));
  assert.ok(Number.isFinite(core.trafficSnapshot.congestionIndex));
  assert.ok(Number.isFinite(core.treasury.balance));
  assert.ok(core.treasury.balance >= 0);
  assert.equal(save.saveVersion, 4);
  console.log('PHASE3_TICK_BENCHMARK', JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)), msPer1000Ticks: Number((elapsedMs / 5).toFixed(2)), activeVehicles: core.traffic.activeVehicles.length }));
});
