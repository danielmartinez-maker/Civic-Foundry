import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { hydrateCore, serializeCore, serializeCoreV4 } from '../src/save/save.ts';
import { hydrateCoreV5, serializeCoreV5 } from '../src/save/saveV5.ts';
import type { TransitPassengerCohort } from '../src/simulation/transit/PassengerQueueSystem.ts';

function flatTerrain(width = 16, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

function transitCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 55, startingFunds: 1_000_000 });
  core.buildRoad(Array.from({ length: 12 }, (_, i) => ({ x: i + 1, y: 3 })), 'local');
  core.transportationGraph.rebuildIfNeeded(core.roads);
  const a = core.transit.placeStop('surface_stop', 2, 2, core.treasury).id!;
  const b = core.transit.placeStop('surface_stop', 10, 2, core.treasury).id!;
  const line = core.transit.createLine('bus', 'V5 Line');
  assert.equal(core.transit.setLineStops(line, [a, b]).ok, true);
  core.transit.setHeadway(line, 20);
  core.transit.setFare(line, 2);
  core.transit.setEnabled(line, true);
  core.mobility.operations.setFleetLimit(line, 1);
  const passenger: TransitPassengerCohort = {
    id: 'save-passenger:1', personTripId: 'save-trip:1', travelerWeight: 25,
    lineId: line, directionKey: 'forward', boardingStopId: a, alightingStopId: b,
    destinationRoadNodeId: 'n:10,3', enqueuedTick: 0, transferLegs: [],
  };
  core.mobility.passengers.enqueue(a, line, 'forward', passenger);
  core.step(14);
  assert.ok(core.mobility.vehicles.listVehicles().length > 0);
  return core;
}

test('default save API is V5 and round-trips authoritative transit state exactly', () => {
  const core = transitCore();
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 5);
  const defaultRestored = hydrateCore(save);
  assert.deepEqual(serializeCore(defaultRestored), save);
  const explicit = serializeCoreV5(core);
  assert.deepEqual(explicit, save);
  const saveV5 = explicit;
  assert.equal(saveV5.saveVersion, 5);
  const restored = hydrateCoreV5(saveV5);
  assert.deepEqual(serializeCoreV5(restored), saveV5);
});

test('Save V5 active transit continuation is deterministic', () => {
  const uninterrupted = transitCore();
  const save = serializeCoreV5(uninterrupted);
  const restored = hydrateCoreV5(save);
  uninterrupted.step(120);
  restored.step(120);
  assert.deepEqual(serializeCoreV5(restored), serializeCoreV5(uninterrupted));
});

test('Save V5 rejects corrupt transit references before returning a core', () => {
  const save = structuredClone(serializeCoreV5(transitCore()));
  const first = save.transit.mobility.vehicles.vehicles[0];
  assert.ok(first);
  if (first) (first as { lineId: string }).lineId = 'transit-line:missing';
  assert.throws(() => hydrateCoreV5(save), /invalid transit vehicle line reference/);
});

test('V4 migrates honestly to empty V5 transit state', () => {
  const legacyCore = new SimulationCore({ terrain: flatTerrain(), seed: 99, startingFunds: 100_000 });
  legacyCore.buildRoad([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], 'local');
  const v4 = serializeCoreV4(legacyCore);
  assert.equal(v4.saveVersion, 4);
  const migrated = hydrateCoreV5(v4);
  assert.deepEqual(migrated.transit.listStops(), []);
  assert.deepEqual(migrated.transit.listLines(), []);
  assert.equal(migrated.mobility.vehicles.listVehicles().length, 0);
  assert.equal(serializeCoreV5(migrated).saveVersion, 5);
});
