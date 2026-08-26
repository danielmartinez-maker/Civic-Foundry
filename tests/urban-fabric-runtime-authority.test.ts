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

test('runtime developer awards use one cadastral parcel identity instead of derived frontage lots', () => {
  const core = buildServicedParcelCore();
  const parcels = core.cadastre.listParcels();
  assert.equal(parcels.length, 1, 'the three frontage cells must form one canonical cadastral parcel');
  const parcel = parcels[0]!;

  let commitments = core.developerMarket.listCommitments();
  for (let step = 0; step < 600 && commitments.length === 0; step += 1) {
    core.step(1);
    commitments = core.developerMarket.listCommitments();
  }

  assert.equal(commitments.length, 1, 'one canonical parcel must create at most one active development commitment');
  assert.equal(commitments[0]!.lotId, parcel.id);
  assert.equal(commitments[0]!.buildingId, `building:${parcel.id}`);
  const award = core.developerMarket.lastAwards().find((item) => item.buildingId === commitments[0]!.buildingId);
  assert.ok(award?.physicalCandidateId, 'parcel-authoritative award must retain the winning massing candidate identity');
});
