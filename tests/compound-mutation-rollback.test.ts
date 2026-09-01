import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { serializeCoreV9 } from '../src/save/saveV9.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function servicedVacantCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 300_000, seed: 7 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, index) => ({ x: index + 2, y: 6 })), 'local').ok, true);
  assert.equal(core.paintZone([
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 5, y: 5 },
  ], 'residential').painted, 3);
  assert.equal(core.placeUtility('power', 4, 7).ok, true);
  assert.equal(core.placeUtility('water', 8, 7).ok, true);
  return core;
}

function occupiedResidentialCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(10, 8), startingFunds: 300_000, seed: 73 });
  assert.equal(core.buildRoad([
    { x: 1, y: 4 },
    { x: 2, y: 4 },
    { x: 3, y: 4 },
    { x: 4, y: 4 },
  ], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 3 }], 'residential').painted, 1);
  const lot = core.lots.list().find((item) => item.zone === 'residential');
  assert.ok(lot);
  core.buildings.restore([{
    id: `building:${lot.id}`,
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone: 'residential',
    definitionId: 'residential_cottage',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  }]);
  core.rebuildCadastreFromLegacyState();
  return core;
}

test('development award failure rolls back the entire authoritative tick', () => {
  const core = servicedVacantCore();
  const originalStartDevelopment = core.buildings.startDevelopment.bind(core.buildings);
  core.buildings.startDevelopment = (tick, lot, award) => {
    originalStartDevelopment(tick, lot, award);
    throw new Error('forced development award failure');
  };

  let observedFailure = false;
  for (let attempt = 0; attempt < 600 && !observedFailure; attempt++) {
    const before = serializeCoreV9(core);
    const beforeTick = core.clock.tick;
    try {
      core.step(1);
    } catch (error) {
      assert.match(error instanceof Error ? error.message : String(error), /forced development award failure/);
      assert.equal(core.clock.tick, beforeTick);
      assert.deepEqual(serializeCoreV9(core), before);
      observedFailure = true;
    }
  }

  assert.equal(observedFailure, true, 'expected a development award to exercise the forced failure path');
});

test('bulldoze failure rolls back building, housing, economy, and cadastral state', () => {
  const core = occupiedResidentialCore();
  const building = core.buildings.list()[0];
  assert.ok(building);
  const before = serializeCoreV9(core);
  const originalRemoveBuilding = core.economyDomain.removeBuilding.bind(core.economyDomain);
  core.economyDomain.removeBuilding = (buildingId, tick) => {
    originalRemoveBuilding(buildingId, tick);
    throw new Error('forced bulldoze failure');
  };

  assert.throws(() => core.bulldozeAt(building.x, building.y), /forced bulldoze failure/);
  assert.deepEqual(serializeCoreV9(core), before);
});