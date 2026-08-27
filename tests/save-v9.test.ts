import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { hydrateCore, serializeCore } from '../src/save/save.ts';
import { hydrateCoreV9, serializeCoreV9 } from '../src/save/saveV9.ts';
import { serializeCoreV8 } from '../src/save/saveV8.ts';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { CadastralMutationSystem } from '../src/world/cadastre/CadastralMutationSystem.ts';

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

function runtimeMutationSaveCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 93, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }, { x: 3, y: 3 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 2 }, { x: 3, y: 2 }], 'residential').painted, 2);
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

  const building = core.buildings.listV2()[0];
  assert.ok(building);
  const parcelId = building.parcelIds[0];
  assert.ok(parcelId);
  const parcel = core.cadastre.getParcel(parcelId);
  assert.ok(parcel);
  assert.ok(parcel.areaM2 >= 8_000, 'fixture must create one two-cell parcel large enough for a legal split');

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

test('Save V9 preserves historical property transactions across runtime parcel retirement', () => {
  const core = runtimeMutationSaveCore();
  const buildingBefore = core.buildings.listV2()[0];
  assert.ok(buildingBefore);
  const sourceParcelId = buildingBefore.parcelIds[0];
  assert.ok(sourceParcelId);
  const transactionBefore = structuredClone(core.propertyMarket.listTransactions()[0]);
  assert.ok(transactionBefore);

  const parcelPolygon = core.cadastre.parcelPolygon(sourceParcelId);
  const buildingMaxX = Math.max(...buildingBefore.footprint.map((point) => point.x));
  const parcelMaxX = Math.max(...parcelPolygon.map((point) => point.x));
  assert.ok(parcelMaxX - buildingMaxX > 0.2, 'fixture must leave a safe split corridor beside the building');
  const safeX = buildingMaxX + (parcelMaxX - buildingMaxX) / 2;
  const ys = parcelPolygon.map((point) => point.y);

  const mutation = core.cadastralMutations.splitParcel(sourceParcelId, [
    { x: safeX, y: Math.min(...ys) },
    { x: safeX, y: Math.max(...ys) },
  ]);
  assert.equal(mutation.committed, true, mutation.rejectionReasons.join('; '));
  assert.equal(core.cadastre.getParcel(sourceParcelId), undefined);
  assert.ok(
    core.cadastre.listLineage().some((event) => event.sourceParcelIds.includes(sourceParcelId)),
    'retired source parcel must remain represented in cadastral lineage',
  );

  const save = serializeCoreV9(core);
  assert.equal(save.saveVersion, 9);
  assert.deepEqual(save.propertyMarket.transactions[0], transactionBefore);

  const restored = hydrateCoreV9(structuredClone(save));
  assert.deepEqual(restored.propertyMarket.listTransactions()[0], transactionBefore);
  assert.deepEqual(restored.cadastre.snapshot(), core.cadastre.snapshot());
  assert.deepEqual(restored.buildings.listV2(), core.buildings.listV2());
  assert.deepEqual(restored.zoning.listParcelAssignments(), core.zoning.listParcelAssignments());
  assert.deepEqual(restored.propertyMarket.snapshot(), core.propertyMarket.snapshot());
  assert.deepEqual(restored.lots.list(), core.lots.list());

  restored.step(10);
  for (const assignment of restored.zoning.listParcelAssignments()) {
    assert.ok(restored.cadastre.getParcel(assignment.parcelId));
  }
  for (const building of restored.buildings.listV2()) {
    assert.ok(building.parcelIds.every((parcelId) => restored.cadastre.getParcel(parcelId)));
  }
  for (const holding of restored.propertyMarket.listHoldings()) {
    assert.ok(restored.cadastre.getParcel(holding.parcelId));
  }
});

test('Save V9 continuation preserves canonical building lifecycle state after hydration', () => {
  const core = urbanFabricCore();
  const building = core.buildings.listV2()[0];
  assert.ok(building);
  const lifecycle = {
    ...building.lifecycle,
    ageTicks: 4_500,
    condition: 42,
    structuralCondition: 55,
    systemsCondition: 44,
    exteriorCondition: 33,
    maintenanceBacklog: 1_234,
    deferredMaintenanceTicks: 77,
    effectiveAge: 18,
    vacancyDurationTicks: 12,
    distressScore: 61,
    lastMajorRenovationTick: 321,
  };
  core.buildings.restoreV2([{ ...building, lifecycle }]);

  const restored = hydrateCoreV9(structuredClone(serializeCoreV9(core)));
  assert.deepEqual(restored.buildings.listV2()[0]?.lifecycle, lifecycle);

  restored.step(1);
  assert.deepEqual(restored.buildings.listV2()[0]?.lifecycle, lifecycle);
});

test('Save V9 hydration rebuilds legacy lots from persisted cadastral topology', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 92, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{ x: 2, y: 3 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 2, y: 2 }], 'residential').painted, 1);
  assert.deepEqual(core.lots.list().map((lot) => lot.id), ['lot:2,2']);

  const save = serializeCoreV9(core);
  const graph = new CadastralGraph(save.urbanFabric);
  const parcel = graph.listParcels()[0];
  assert.ok(parcel);
  const frontageEdgeId = parcel.frontageEdgeIds[0];
  assert.ok(frontageEdgeId);
  const frontage = graph.getEdge(frontageEdgeId);
  assert.ok(frontage);
  const from = graph.getNode(frontage.fromNodeId)?.point;
  const to = graph.getNode(frontage.toNodeId)?.point;
  assert.ok(from);
  assert.ok(to);

  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const inward = {
    x: (parcel.centroid.x - midpoint.x) * 0.5,
    y: (parcel.centroid.y - midpoint.y) * 0.5,
  };
  const mutation = new CadastralMutationSystem(graph).dedicateRightOfWay(parcel.id, [
    from,
    to,
    { x: to.x + inward.x, y: to.y + inward.y },
    { x: from.x + inward.x, y: from.y + inward.y },
  ]);
  assert.equal(mutation.committed, true, mutation.rejectionReasons.join('; '));
  const residual = graph.getParcel(mutation.resultingParcelIds[0]!);
  assert.ok(residual);
  assert.equal(residual.frontageEdgeIds.length, 0);

  const restored = hydrateCoreV9({ ...structuredClone(save), urbanFabric: graph.snapshot() });
  assert.deepEqual(restored.cadastre.snapshot(), graph.snapshot());
  assert.deepEqual(restored.lots.list(), []);
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