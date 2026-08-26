import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { hydrateCore, serializeCore } from '../src/save/save.ts';
import { hydrateCoreV9, serializeCoreV9 } from '../src/save/saveV9.ts';
import { serializeCoreV8 } from '../src/save/saveV8.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function urbanFabricCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 91, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 2 }], 'residential').painted, 1);
  core.buildings.restore([{
    id: 'building:lot:2,2',
    lotId: 'lot:2,2',
    x: 2,
    y: 2,
    zone: 'residential',
    definitionId: 'residential_cottage',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  }]);
  core.rebuildCadastreFromLegacyState();

  const parcel = core.cadastre.listParcels()[0];
  assert.ok(parcel);
  core.zoning.assignParcel(parcel.id, 'R5');
  core.propertyMarket.restore({
    holdings: [{ parcelId: parcel.id, ownerId: 'owner:a', reservationValue: 100_000 }],
    transactions: [],
    nextTransactionId: 1,
  });
  core.propertyMarket.transact({
    tick: 3,
    parcelIds: [parcel.id],
    buyerId: 'owner:b',
    sellerId: 'owner:a',
    purpose: 'sale',
    price: 120_000,
    landValue: 80_000,
    improvementValue: 40_000,
  });
  return core;
}

test('Save V9 round-trip preserves Urban Fabric authority exactly', () => {
  const core = urbanFabricCore();
  const save = serializeCoreV9(core);

  assert.equal(save.saveVersion, 9);
  assert.equal(save.gameVersion, '0.9.0-urban-fabric');
  assert.deepEqual(save.urbanFabric, core.cadastre.snapshot());
  assert.deepEqual(save.zoningV2.parcelAssignments, core.zoning.listParcelAssignments());
  assert.deepEqual(save.buildingsV2, core.buildings.listV2());
  assert.deepEqual(save.propertyMarket, core.propertyMarket.snapshot());

  const restored = hydrateCoreV9(structuredClone(save));
  assert.deepEqual(restored.cadastre.snapshot(), core.cadastre.snapshot());
  assert.deepEqual(restored.zoning.listParcelAssignments(), core.zoning.listParcelAssignments());
  assert.deepEqual(restored.buildings.listV2(), core.buildings.listV2());
  assert.deepEqual(restored.propertyMarket.snapshot(), core.propertyMarket.snapshot());
});

test('Save V8 migrates deterministically into Save V9 Urban Fabric state', () => {
  const source = urbanFabricCore();
  const v8 = serializeCoreV8(source);
  assert.equal(v8.saveVersion, 8);

  const first = hydrateCoreV9(structuredClone(v8));
  const second = hydrateCoreV9(structuredClone(v8));
  assert.deepEqual(first.cadastre.snapshot(), second.cadastre.snapshot());
  assert.deepEqual(first.buildings.listV2(), second.buildings.listV2());
  assert.deepEqual(first.zoning.listParcelAssignments(), []);
  assert.deepEqual(first.propertyMarket.snapshot(), {
    holdings: [],
    transactions: [],
    nextTransactionId: 1,
  });
  assert.equal(serializeCoreV9(first).saveVersion, 9);
});

test('default save API advances to V9 while explicit V8 remains available', () => {
  const core = urbanFabricCore();
  const current = serializeCore(core);
  assert.equal(current.saveVersion, 9);
  assert.equal(current.gameVersion, '0.9.0-urban-fabric');
  const restored = hydrateCore(structuredClone(current));
  assert.deepEqual(restored.cadastre.snapshot(), core.cadastre.snapshot());
  assert.deepEqual(restored.propertyMarket.snapshot(), core.propertyMarket.snapshot());
  assert.equal(serializeCoreV8(core).saveVersion, 8);

  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
  assert.equal(packageJson.version, '0.9.0-urban-fabric');
});
