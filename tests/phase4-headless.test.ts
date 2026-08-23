import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { RoadType } from '../src/data/roads.ts';
import { serializeCoreV4 as serializeCore } from '../src/save/save.ts';

function flatTerrain(width = 30, height = 18): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function buildServiceCity(roadType: RoadType, seed = 123): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), seed, startingFunds: 2_000_000 });
  assert.equal(core.buildRoad(Array.from({ length: 25 }, (_, i) => ({ x: i + 2, y: 9 })), roadType).ok, true);
  const buildings = [] as Parameters<typeof core.buildings.restore>[0];
  const mutable = [] as Array<Parameters<typeof core.buildings.restore>[0][number]>;
  for (let i = 0; i < 8; i++) mutable.push({ id: `home:${i}`, lotId: `lot:home:${i}`, x: 14 + i, y: 8, zone: 'residential', definitionId: 'residential_cottage', status: 'occupied', constructionStartedTick: 0, completionTick: 0 });
  mutable.push({ id: 'shop:1', lotId: 'lot:shop:1', x: 22, y: 10, zone: 'commercial', definitionId: 'commercial_shop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 });
  mutable.push({ id: 'factory:1', lotId: 'lot:factory:1', x: 23, y: 10, zone: 'industrial', definitionId: 'industrial_workshop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 });
  core.buildings.restore(mutable);
  core.population.restore(70);
  core.utilities.restore([
    { id: 'utility:1', type: 'power', x: 8, y: 10 },
    { id: 'utility:2', type: 'water', x: 9, y: 10 },
  ], 3);
  core.services.restore([
    { id: 'service:1', type: 'fire_station', department: 'fire', x: 2, y: 10 },
    { id: 'service:2', type: 'police_station', department: 'police', x: 3, y: 10 },
    { id: 'service:3', type: 'clinic', department: 'healthcare', x: 4, y: 10 },
    { id: 'service:4', type: 'elementary_school', department: 'education', x: 5, y: 10 },
    { id: 'service:5', type: 'landfill', department: 'garbage', x: 6, y: 10 },
  ], {}, 6, 1);
  core.serviceVehicles.syncFleet(core.services);
  core.incidents.createIncident('fire', mutable[0]!, 0.85, 0, core.serviceDispatch);
  return core;
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

function runServiceScenario(roadType: RoadType) {
  const core = buildServiceCity(roadType);
  let fireArrivalTick = 0;
  for (let i = 0; i < 1_200; i++) {
    core.step(1);
    const fireJob = core.serviceDispatch.listJobs().find((job) => job.type === 'fire_response');
    if (!fireArrivalTick && fireJob?.arrivalTick) fireArrivalTick = fireJob.arrivalTick;
  }
  return {
    fireArrivalTick,
    serviceQuality: core.neighborhoodSnapshot.citywideServiceQuality,
    educationQuality: core.educationSnapshot.educationServiceRatio,
    garbageBacklog: core.garbageSnapshot.backlog,
    processedWaste: core.wasteCollection.processedTotal,
    waitingJobs: core.serviceDispatch.listJobs().filter((job) => job.status === 'waiting').length,
    completedJobs: core.serviceDispatch.listJobs().filter((job) => job.status === 'completed').length,
    residentialDemand: core.demandSnapshot.residential,
    commercialDemand: core.demandSnapshot.commercial,
  };
}

test('otherwise-equivalent neighborhoods with better roads receive materially better public-service outcomes', () => {
  const local = runServiceScenario('local');
  const arterial = runServiceScenario('arterial');
  assert.ok(local.fireArrivalTick > arterial.fireArrivalTick, `${local.fireArrivalTick} should exceed ${arterial.fireArrivalTick}`);
  assert.ok(arterial.processedWaste > local.processedWaste);
  assert.ok(arterial.garbageBacklog < local.garbageBacklog);
  assert.ok(arterial.completedJobs > local.completedJobs);
  assert.ok(arterial.waitingJobs <= local.waitingJobs);
  assert.ok(arterial.serviceQuality > local.serviceQuality + 0.1);
  assert.ok(arterial.educationQuality > local.educationQuality);
  assert.ok(arterial.residentialDemand > local.residentialDemand);
  assert.ok(arterial.commercialDemand > local.commercialDemand);
  console.log('PHASE4_COMPARISON', JSON.stringify({ local, arterial }));
});

test('same Phase 4 city, seed, incidents, and commands produce identical V4 state hashes', () => {
  const first = buildServiceCity('collector', 777);
  const second = buildServiceCity('collector', 777);
  first.step(1_500);
  second.step(1_500);
  const firstHash = stableHash(serializeCore(first));
  const secondHash = stableHash(serializeCore(second));
  assert.equal(firstHash, secondHash);
  console.log('PHASE4_DETERMINISTIC_HASH', firstHash);
});

test('service accessibility reuses the Phase 3 route cache under repeated real network requests', () => {
  const core = buildServiceCity('collector', 444);
  core.step(20);
  const home = core.buildings.getById('home:0')!;
  const beforeRequests = core.pathfinding.diagnostics.requests;
  const beforeHits = core.pathfinding.diagnostics.cacheHits;
  const started = performance.now();
  for (let i = 0; i < 5_000; i++) {
    const result = core.serviceAccessibility.evaluateBuilding('fire', home, 1, core.services, core.transportationGraph, core.pathfinding, (edge) => edge.freeFlowTicks, { costKey: 'phase4-service-benchmark' });
    assert.equal(result.reachable, true);
  }
  const elapsedMs = performance.now() - started;
  const requests = core.pathfinding.diagnostics.requests - beforeRequests;
  const hits = core.pathfinding.diagnostics.cacheHits - beforeHits;
  assert.equal(requests, 5_000);
  assert.ok(hits >= 4_999);
  console.log('PHASE4_PATHFINDING_BENCHMARK', JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)), requests, hits, hitRatio: hits / requests }));
});

test('2,000 active public-service ticks remain finite and expose agent/queue diagnostics', () => {
  const core = buildServiceCity('collector', 999);
  const started = performance.now();
  core.step(2_000);
  const elapsedMs = performance.now() - started;
  const serviceVehicles = core.serviceVehicles.listVehicles();
  const jobs = core.serviceDispatch.listJobs();
  assert.ok(Number.isFinite(core.neighborhoodSnapshot.citywideServiceQuality));
  assert.ok(Number.isFinite(core.garbageSnapshot.backlog));
  assert.ok(Number.isFinite(core.educationSnapshot.educationServiceRatio));
  assert.ok(serviceVehicles.length > 0);
  assert.ok(jobs.length > 0);
  assert.equal(serializeCore(core).saveVersion, 4);
  console.log('PHASE4_SERVICE_BENCHMARK', JSON.stringify({
    elapsedMs: Number(elapsedMs.toFixed(2)), msPer1000Ticks: Number((elapsedMs / 2).toFixed(2)),
    serviceVehicles: serviceVehicles.length, activeServiceVehicles: serviceVehicles.filter((vehicle) => !['idle', 'unavailable'].includes(vehicle.state)).length,
    jobs: jobs.length, waitingJobs: jobs.filter((job) => job.status === 'waiting').length,
    intersectionQueues: Object.values(core.intersections.snapshot()).reduce((sum, approaches) => sum + approaches.reduce((inner, approach) => inner + approach.entries.length, 0), 0),
  }));
});
