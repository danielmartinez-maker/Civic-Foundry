import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { hydrateCore, serializeCore, type SaveV3 } from '../src/save/save.ts';

function flatTerrain(width = 24, height = 14): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function managedCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 91 });
  core.buildRoad(Array.from({ length: 18 }, (_, i) => ({ x: i + 2, y: 7 })), 'collector');
  core.paintZone([{ x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }], 'residential');
  core.paintZone([{ x: 10, y: 6 }, { x: 11, y: 6 }], 'commercial');
  core.paintZone([{ x: 15, y: 6 }, { x: 16, y: 6 }], 'industrial');
  assert.equal(core.placeUtility('power', 4, 8).ok, true);
  assert.equal(core.placeUtility('water', 9, 8).ok, true);
  assert.equal(core.placeUtility('landfill', 14, 8).ok, true);
  core.taxes.setRate('residential', 0.12);
  core.step(200);
  return core;
}

test('Save V3 round-trips authoritative city and active traffic state', () => {
  const core = managedCore();
  assert.ok(core.traffic.activeVehicles.length > 0);
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 5);
  const hydrated = hydrateCore(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(serializeCore(hydrated), save);
});

test('Save V3 deterministic continuation produces identical authoritative state', () => {
  const original = managedCore();
  const hydrated = hydrateCore(serializeCore(original));
  original.step(500);
  hydrated.step(500);
  assert.deepEqual(serializeCore(hydrated), serializeCore(original));
});

test('hydrate rejects corrupt active traffic edge references before returning a live core', () => {
  const save = serializeCore(managedCore());
  assert.ok(save.traffic.vehicles.length > 0);
  const corrupt: SaveV3 = JSON.parse(JSON.stringify(save));
  const first = corrupt.traffic.vehicles[0]!;
  first.edgeIds[0] = 'e:missing>edge';
  assert.throws(() => hydrateCore(corrupt), /traffic edge/i);
});

test('V2 migration initializes empty traffic state without inventing successful history', () => {
  const v3 = serializeCore(managedCore());
  const { traffic: _traffic, intersections: _intersections, tripGeneration: _tripGeneration, ...base } = v3;
  const v2 = { ...base, saveVersion: 2 };
  const hydrated = hydrateCore(v2);
  assert.equal(hydrated.traffic.activeVehicles.length, 0);
  assert.equal(hydrated.traffic.recentOutcomes.length, 0);
  assert.equal(hydrated.traffic.completedTrips, 0);
  assert.equal(hydrated.traffic.failedTrips, 0);
  assert.equal(hydrated.intersections.queueLength(), 0);
});
