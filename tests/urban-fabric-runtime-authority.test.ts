import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width: number, height: number): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildServicedParcelCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(20, 12), startingFunds: 300_000, seed: 7 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, index) => ({ x: index + 2, y: 6 })), 'local').ok, true);
  core.paintZone([
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 5, y: 5 },
  ], 'residential');
  assert.equal(core.placeUtility('power', 4, 7).ok, true);
  assert.equal(core.placeUtility('water', 8, 7).ok, true);
  return core;
}

test('simulation development materializes canonical buildings from cadastral parcels while lots stay derived', () => {
  const core = buildServicedParcelCore();
  const parcels = core.cadastre.listParcels();
  const parcelIds = new Set(parcels.map((parcel) => parcel.id));
  const lotViewBefore = core.lots.list();

  assert.ok(parcels.length > 0);
  assert.ok(lotViewBefore.length > 0);

  core.step(600);

  const canonicalBuildings = core.buildings.listV2();
  assert.ok(canonicalBuildings.length > 0, 'runtime development must create canonical BuildingV2 state');
  assert.ok(canonicalBuildings.every((building) => building.parcelIds.length > 0));
  assert.ok(canonicalBuildings.every((building) => building.parcelIds.every((parcelId) => parcelIds.has(parcelId))));
  assert.deepEqual(core.lots.list(), lotViewBefore, 'legacy LotSystem must remain a derived compatibility view');
});
