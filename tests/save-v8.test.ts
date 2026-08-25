import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCore, serializeCore, serializeCoreV7 } from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { TerrainPhysicalSample } from '../src/world/terrain/TerrainTypes.ts';

function flat(width = 14, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

function legacyCity(): SimulationCore {
  const core = new SimulationCore({ terrain: flat(), seed: 61, startingFunds: 200_000 });
  assert.equal(core.buildRoad([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }], 'local').ok, true);
  core.paintZone([{ x: 3, y: 4 }], 'residential');
  return core;
}

test('default generated Save V8 round-trips exactly with authoritative world state', () => {
  const core = new SimulationCore({ width: 18, height: 12, seed: 42 });
  core.step(25);
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 8);
  assert.equal(save.gameVersion, '0.8.0-world-foundation');
  assert.equal(save.world.mode, 'generated-1r');
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(serializeCore(loaded), save);
  assert.deepEqual(loaded.world.snapshotAuthoritative(), core.world.snapshotAuthoritative());
});

test('Save V8 persists last design-storm result without mutating terrain or hydrology', () => {
  const core = new SimulationCore({ width: 16, height: 10, seed: 19 });
  const terrainBefore = core.world.terrain.snapshotAuthoritative();
  const hydrologyBefore = core.world.hydrology.snapshotAuthoritative();
  const result = core.world.runDesignStorm({ id: 'design:80mm', rainfallMm: 80, durationHours: 2 });
  const loaded = hydrateCore(structuredClone(serializeCore(core)));
  assert.deepEqual(loaded.world.snapshotAuthoritative().lastFloodResult, result);
  assert.deepEqual(loaded.world.terrain.snapshotAuthoritative(), terrainBefore);
  assert.deepEqual(loaded.world.hydrology.snapshotAuthoritative(), hydrologyBefore);
});

test('legacy-explicit V8 round-trip preserves exact compatibility terrain', () => {
  const core = legacyCity();
  const terrainBefore = core.terrain.snapshot();
  const save = serializeCore(core);
  assert.equal(save.world.mode, 'legacy-explicit');
  const loaded = hydrateCore(structuredClone(save));
  assert.equal(loaded.world.mode, 'legacy-explicit');
  assert.deepEqual(loaded.terrain.snapshot(), terrainBefore);
  assert.deepEqual(serializeCore(loaded), save);
});

test('V7 current-load migration creates deterministic neutral legacy-flat world and preserves city state', () => {
  const core = legacyCity();
  const v7 = serializeCoreV7(core);
  const first = hydrateCore(structuredClone(v7));
  const second = hydrateCore(structuredClone(v7));
  assert.equal(first.world.mode, 'legacy-flat');
  assert.equal(first.world.snapshotAuthoritative().lastFloodResult, null);
  assert.equal(first.world.preparationMultiplierAt(3, 4), 1);
  assert.deepEqual(first.roads.list(), core.roads.list());
  assert.deepEqual(first.zoning.list(), core.zoning.list());
  assert.deepEqual(first.buildings.list(), core.buildings.list());
  assert.equal(first.treasury.balance, core.treasury.balance);
  assert.deepEqual(serializeCore(first), serializeCore(second));
});

test('V8 rejects corrupt world terrain length and compatibility divergence', () => {
  const save = structuredClone(serializeCore(new SimulationCore({ width: 12, height: 8, seed: 33 })));
  const badTerrain = structuredClone(save);
  (badTerrain.world.terrain.samples as TerrainPhysicalSample[]).pop();
  assert.throws(() => hydrateCore(badTerrain), /terrain sample count|terrain/i);

  const badCompatibility = structuredClone(save);
  (badCompatibility.terrain.cells[0] as { elevation: number }).elevation += 0.01;
  assert.throws(() => hydrateCore(badCompatibility), /compatibility terrain differs/i);
});

test('V8 rejects corrupt geography hierarchy before constructing simulation domains', () => {
  const save = structuredClone(serializeCore(new SimulationCore({ width: 12, height: 8, seed: 34 })));
  const district = save.world.geography.entities.find((entity) => entity.kind === 'district');
  assert.ok(district);
  (district as { parentId: string | null }).parentId = 'missing-parent';
  assert.throws(() => hydrateCore(save), /orphan geography|parent/i);
});
