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
  core.step(1_200);
  return core;
}

test('HUD metrics mirror authoritative simulation snapshots', () => {
  const core = managedCore();
  const hud = collectHudMetrics(core);
  assert.equal(hud.treasury, core.treasury.balance);
  assert.equal(hud.population, core.population.population);
  assert.equal(hud.activeVehicles, core.trafficSnapshot.activeVehicleCount);
  assert.equal(hud.congestionIndex, core.trafficSnapshot.congestionIndex);
  assert.equal(hud.averageCommuteTicks, core.trafficSnapshot.averageCommuteTicks);
  assert.equal(hud.jobAccessibility, core.trafficSnapshot.jobAccessibility);
});

test('cell inspector explains road and building state from authoritative systems', () => {
  const core = managedCore();
  const road = inspectCell(core, 6, 7);
  assert.equal(road.kind, 'road');
  assert.match(road.title, /Collector/);
  assert.ok(road.lines.some((line) => /Capacity/i.test(line)));

  const building = core.buildings.occupied()[0]!;
  const inspected = inspectCell(core, building.x, building.y);
  assert.equal(inspected.kind, 'building');
  assert.ok(inspected.lines.some((line) => /Status/i.test(line)));
});

test('traffic overlay mapping is deterministic and mode-specific', () => {
  const core = managedCore();
  const modes: TrafficOverlayMode[] = ['congestion', 'speed', 'volume', 'bottlenecks'];
  for (const mode of modes) {
    const first = mapTrafficOverlay(core.transportationGraph, core.traffic.edgeMetrics, core.trafficSnapshot, mode);
    const second = mapTrafficOverlay(core.transportationGraph, core.traffic.edgeMetrics, core.trafficSnapshot, mode);
    assert.deepEqual(second, first);
    assert.equal(first.mode, mode);
    assert.ok(first.legend.length > 0);
    assert.equal(first.edges.length, core.transportationGraph.edges.length);
  }
});

test('tool controller routes player mutations through SimulationCore and bulldoze refreshes city geometry', async () => {
  const { ToolController } = await import('../src/ui/ToolController.ts');
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 81 });
  const tools = new ToolController(core);
  tools.setRoadType('arterial');
  tools.setTool('road');
  assert.equal(tools.applyCell(4, 7).ok, true);
  assert.equal(core.roads.get(4, 7)?.type, 'arterial');
  tools.setTool('bulldoze');
  assert.equal(tools.applyCell(4, 7).ok, true);
  assert.equal(core.roads.has(4, 7), false);
});
