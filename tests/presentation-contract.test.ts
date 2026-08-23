import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { collectHudMetrics } from '../src/ui/Hud.ts';
import { inspectCell } from '../src/ui/Inspector.ts';
import { mapTrafficOverlay, type TrafficOverlayMode } from '../src/rendering/TrafficOverlayLayer.ts';

function flatTerrain(width = 24, height = 14): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function managedCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 73 });
  core.buildRoad(Array.from({ length: 18 }, (_, i) => ({ x: i + 2, y: 7 })), 'collector');
  core.paintZone([{ x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }], 'residential');
  core.paintZone([{ x: 10, y: 6 }, { x: 11, y: 6 }], 'commercial');
  core.paintZone([{ x: 15, y: 6 }, { x: 16, y: 6 }], 'industrial');
  assert.equal(core.placeUtility('power', 4, 8).ok, true);
  assert.equal(core.placeUtility('water', 9, 8).ok, true);
  assert.equal(core.placeUtility('landfill', 14, 8).ok, true);
  core.step(500);
  return core;
}

test('HUD metrics mirror authoritative simulation snapshots', () => {
  const core = managedCore();
  const metrics = collectHudMetrics(core);
  assert.equal(metrics.treasury, core.treasury.balance);
  assert.equal(metrics.population, core.population.population);
  assert.equal(metrics.employed, core.employmentSnapshot.employed);
  assert.equal(metrics.jobs, core.employmentSnapshot.totalJobs);
  assert.equal(metrics.powerRatio, core.utilitySnapshot.power.serviceRatio);
  assert.equal(metrics.waterRatio, core.utilitySnapshot.water.serviceRatio);
  assert.equal(metrics.garbageRatio, core.garbageSnapshot.serviceRatio);
  assert.equal(metrics.activeVehicles, core.trafficSnapshot.activeVehicleCount);
  assert.equal(metrics.congestionIndex, core.trafficSnapshot.congestionIndex);
  assert.equal(metrics.jobAccessibility, core.trafficSnapshot.jobAccessibility);
  assert.deepEqual(metrics.taxRates, core.taxes.getRates());
});

test('cell inspector explains road and building state from authoritative systems', () => {
  const core = managedCore();
  const road = inspectCell(core, 8, 7);
  assert.equal(road.kind, 'road');
  assert.match(road.title, /collector/i);
  assert.ok(road.lines.some((line) => /capacity/i.test(line)));
  assert.ok(road.lines.some((line) => /congestion/i.test(line)));

  const building = core.buildings.occupied().find((item) => item.zone === 'residential');
  assert.ok(building);
  const inspected = inspectCell(core, building.x, building.y);
  assert.equal(inspected.kind, 'building');
  assert.ok(inspected.lines.some((line) => /power/i.test(line)));
  assert.ok(inspected.lines.some((line) => /water/i.test(line)));
});

test('traffic overlay mapping is deterministic and mode-specific', () => {
  const core = managedCore();
  const modes: TrafficOverlayMode[] = ['congestion', 'speed', 'volume', 'bottlenecks'];
  for (const mode of modes) {
    const snapshot = mapTrafficOverlay(core.transportationGraph, core.traffic.edgeMetrics, core.trafficSnapshot, mode);
    assert.equal(snapshot.mode, mode);
    assert.equal(snapshot.edges.length, core.transportationGraph.edges.length);
    assert.ok(snapshot.legend.length > 0);
    assert.ok(snapshot.edges.every((edge) => Number.isFinite(edge.value) && edge.value >= 0));
  }
});

import { ToolController } from '../src/ui/ToolController.ts';

test('tool controller routes player mutations through SimulationCore and bulldoze refreshes city geometry', () => {
  const core = new SimulationCore({ terrain: flatTerrain(12, 10), startingFunds: 100_000, seed: 9 });
  const tools = new ToolController();
  tools.setTool('road-collector');
  const built = tools.applyPath(core, [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
  assert.equal(built.ok, true);
  assert.equal(core.roads.list().length, 3);
  tools.setTool('zone-residential');
  assert.equal(tools.applyCell(core, 3, 4).ok, true);
  assert.equal(core.zoning.get(3, 4), 'residential');
  tools.setTool('bulldoze');
  assert.equal(tools.applyCell(core, 3, 5).ok, true);
  assert.equal(core.roads.has(3, 5), false);
});
