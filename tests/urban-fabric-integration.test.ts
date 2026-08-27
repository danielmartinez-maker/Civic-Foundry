import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { LEGACY_CELL_SIZE_METERS, pointInPolygon } from '../src/world/cadastre/Geometry.ts';
import { districtForLegacyZone } from '../src/simulation/zoning/ZoningDistrictCatalog.ts';
import { BUILDING_TYPOLOGIES } from '../src/data/buildingTypologies.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('simulation owns cadastral parcels while legacy lot view preserves cell identity', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 150_000, seed: 7 });
  core.buildRoad(Array.from({ length: 8 }, (_, index) => ({ x: index + 2, y: 4 })), 'local');
  core.paintZone([
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 5, y: 3 },
  ], 'residential');
  core.step(1);

  const cadastre = (core as SimulationCore & { readonly cadastre?: CadastralGraph }).cadastre;
  assert.ok(cadastre, 'SimulationCore must expose the canonical cadastral graph');

  const frontageParcels = cadastre.listParcels().filter((parcel) => parcel.frontageEdgeIds.length > 0);
  assert.equal(frontageParcels.length, 1, 'three contiguous compatible frontage cells should form one canonical parcel');
  const legacyLots = core.lots.list();
  assert.deepEqual(
    legacyLots.map((lot) => lot.id),
    ['lot:3,3', 'lot:4,3', 'lot:5,3'],
    'legacy lot facade must preserve V7/V8 cell IDs while deriving from cadastral frontage',
  );
  assert.equal(
    legacyLots.some((lot) => Object.prototype.hasOwnProperty.call(lot, 'parcelId')),
    false,
    'legacy lot facade must not gain a Task 13-only identity field',
  );
  const canonicalPolygon = cadastre.parcelPolygon(frontageParcels[0]!.id);
  for (const lot of legacyLots) {
    assert.equal(
      pointInPolygon({
        x: (lot.x + 0.5) * LEGACY_CELL_SIZE_METERS,
        y: (lot.y + 0.5) * LEGACY_CELL_SIZE_METERS,
      }, canonicalPolygon),
      true,
      `${lot.id} should resolve geometrically inside ${frontageParcels[0]!.id}`,
    );
  }
});

test('SimulationCore exposes the parcel envelope and massing runtime pipeline', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 150_000, seed: 11 });
  assert.equal(core.buildRoad([{ x: 3, y: 4 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 3, y: 3 }], 'residential').painted, 1);

  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  const district = districtForLegacyZone('residential');
  const envelope = core.buildableEnvelopes.evaluate(parcel.id, core.cadastre, district);
  assert.equal(envelope.parcelId, parcel.id);
  assert.ok(envelope.maxGrossFloorAreaM2 > 0);

  const candidates = core.buildingMassing.generate(parcel, envelope, BUILDING_TYPOLOGIES);
  assert.ok(candidates.length > 0);
  const candidate = candidates[0]!;
  assert.equal(core.zoningCompliance.evaluate(candidate, envelope).legal, true);

  assert.ok(core.buildingLifecycle);
  assert.ok(core.renovation);
  assert.ok(core.highestBestUse);
  assert.ok(core.propertyMarket);
  assert.ok(core.siteAssembly);
});
