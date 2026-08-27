import test from 'node:test';
import assert from 'node:assert/strict';
import { PropertyMarketSystem } from '../src/simulation/development/PropertyMarketSystem.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { CadastralRuntimeMutationService } from '../src/simulation/land/CadastralRuntimeMutationService.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { WorldPoint } from '../src/world/cadastre/Geometry.ts';

function flatTerrain(width: number, height: number): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildSplitFixture(): Readonly<{
  core: SimulationCore;
  service: CadastralRuntimeMutationService;
  sourceParcelId: string;
}> {
  const core = new SimulationCore({ terrain: flatTerrain(8, 6), startingFunds: 300_000, seed: 37 });
  assert.equal(
    core.buildRoad(
      [
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
      'local',
    ).ok,
    true,
  );
  core.paintZone(
    [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
    'residential',
  );
  core.buildings.restore([
    {
      id: 'building:lot:1,1',
      lotId: 'lot:1,1',
      x: 1,
      y: 1,
      zone: 'residential',
      definitionId: 'residential_cottage',
      status: 'occupied',
      constructionStartedTick: 0,
      completionTick: 0,
    },
  ]);
  core.rebuildCadastreFromLegacyState();

  const building = core.buildings.listV2()[0];
  assert.ok(building, 'fixture must materialize one canonical building');
  assert.equal(building.parcelIds.length, 1);
  const sourceParcelId = building.parcelIds[0]!;
  core.zoning.assignParcel(sourceParcelId, 'R2');
  assert.ok(core.zoning.getParcelAssignment(sourceParcelId), 'fixture parcel must have canonical zoning');

  core.propertyMarket.restore({
    holdings: [
      {
        parcelId: sourceParcelId,
        ownerId: 'owner:test',
        reservationValue: 300_000,
      },
    ],
    transactions: [],
    nextTransactionId: 1,
  });

  return Object.freeze({
    core,
    sourceParcelId,
    service: new CadastralRuntimeMutationService({
      cadastre: core.cadastre,
      buildings: core.buildings,
      zoning: core.zoning,
      propertyMarket: core.propertyMarket,
      lots: core.lots,
      legacyZoneResolver: () => 'residential',
    }),
  });
}

function verticalCutAt(core: SimulationCore, parcelId: string, x: number): readonly WorldPoint[] {
  const polygon = core.cadastre.parcelPolygon(parcelId);
  const ys = polygon.map((point) => point.y);
  return Object.freeze([
    Object.freeze({ x, y: Math.min(...ys) }),
    Object.freeze({ x, y: Math.max(...ys) }),
  ]);
}

function snapshots(core: SimulationCore): Readonly<{
  cadastre: ReturnType<SimulationCore['cadastre']['snapshot']>;
  buildings: ReturnType<SimulationCore['buildings']['listV2']>;
  zoning: ReturnType<SimulationCore['zoning']['listParcelAssignments']>;
  propertyMarket: ReturnType<SimulationCore['propertyMarket']['snapshot']>;
  lots: ReturnType<SimulationCore['lots']['list']>;
}> {
  return Object.freeze({
    cadastre: core.cadastre.snapshot(),
    buildings: core.buildings.listV2(),
    zoning: core.zoning.listParcelAssignments(),
    propertyMarket: core.propertyMarket.snapshot(),
    lots: core.lots.list(),
  });
}

test('property history may reference a retired parcel when cadastral lineage recognizes it', () => {
  const market = new PropertyMarketSystem();
  const snapshot = {
    holdings: [
      {
        parcelId: 'parcel:child',
        ownerId: 'owner:b',
        reservationValue: 120_000,
      },
    ],
    transactions: [
      {
        id: 'property:tx:1',
        tick: 3,
        parcelIds: ['parcel:parent'],
        buyerId: 'owner:b',
        sellerId: 'owner:a',
        purpose: 'sale' as const,
        price: 120_000,
        landValue: 80_000,
        improvementValue: 40_000,
      },
    ],
    nextTransactionId: 2,
  } as const;

  assert.throws(() => market.restore(snapshot), /missing holding/);
  market.restore(snapshot, {
    isHistoricalParcelId: (id) => id === 'parcel:parent',
  });
  assert.deepEqual(market.snapshot(), snapshot);
});

test('runtime split preserves canonical building identity while rewriting live parcel references atomically', () => {
  const { core, service, sourceParcelId } = buildSplitFixture();
  const beforeBuilding = core.buildings.listV2()[0]!;
  const parcelPolygon = core.cadastre.parcelPolygon(sourceParcelId);
  const buildingMaxX = Math.max(...beforeBuilding.footprint.map((point) => point.x));
  const parcelMaxX = Math.max(...parcelPolygon.map((point) => point.x));
  assert.ok(parcelMaxX - buildingMaxX > 0.2, 'fixture must leave a safe split corridor beside the building');
  const safeX = buildingMaxX + (parcelMaxX - buildingMaxX) / 2;

  const result = service.splitParcel(sourceParcelId, verticalCutAt(core, sourceParcelId, safeX));

  assert.equal(result.committed, true);
  assert.deepEqual(result.retiredParcelIds, [sourceParcelId]);
  assert.equal(result.resultingParcelIds.length, 2);
  assert.equal(core.cadastre.getParcel(sourceParcelId), undefined);

  const afterBuilding = core.buildings.getV2ById(beforeBuilding.id);
  assert.ok(afterBuilding);
  assert.equal(afterBuilding.id, beforeBuilding.id);
  assert.deepEqual(afterBuilding.lifecycle, beforeBuilding.lifecycle);
  assert.equal(afterBuilding.parcelIds.length, 1);
  assert.ok(afterBuilding.parcelIds.every((id) => core.cadastre.getParcel(id)));

  const childAssignments = core.zoning
    .listParcelAssignments()
    .filter((assignment) => result.resultingParcelIds.includes(assignment.parcelId));
  assert.equal(childAssignments.length, 2);
  assert.ok(childAssignments.every((assignment) => assignment.districtId === 'R2'));

  const property = core.propertyMarket.snapshot();
  assert.deepEqual(
    property.holdings.map((holding) => holding.parcelId),
    [...result.resultingParcelIds].sort(),
  );
  assert.ok(property.holdings.every((holding) => holding.ownerId === 'owner:test'));
  assert.equal(
    property.holdings.reduce((sum, holding) => sum + holding.reservationValue, 0),
    300_000,
  );
  assert.deepEqual(property.transactions, []);
});

test('runtime split crossing a canonical building rejects without mutating any dependent domain', () => {
  const { core, service, sourceParcelId } = buildSplitFixture();
  const building = core.buildings.listV2()[0]!;
  const buildingXs = building.footprint.map((point) => point.x);
  const crossingX = (Math.min(...buildingXs) + Math.max(...buildingXs)) / 2;
  const before = snapshots(core);

  const result = service.splitParcel(sourceParcelId, verticalCutAt(core, sourceParcelId, crossingX));

  assert.equal(result.committed, false);
  assert.ok(result.rejectionReasons.includes('building-crosses-split'));
  assert.deepEqual(snapshots(core), before);
});