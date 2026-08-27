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

function splitSafely(fixture: ReturnType<typeof buildSplitFixture>): readonly string[] {
  const { core, service, sourceParcelId } = fixture;
  const building = core.buildings.listV2()[0]!;
  const parcelPolygon = core.cadastre.parcelPolygon(sourceParcelId);
  const buildingMaxX = Math.max(...building.footprint.map((point) => point.x));
  const parcelMaxX = Math.max(...parcelPolygon.map((point) => point.x));
  assert.ok(parcelMaxX - buildingMaxX > 0.2, 'fixture must leave a safe split corridor beside the building');
  const safeX = buildingMaxX + (parcelMaxX - buildingMaxX) / 2;
  const split = service.splitParcel(sourceParcelId, verticalCutAt(core, sourceParcelId, safeX));
  assert.equal(split.committed, true, `fixture split failed: ${split.rejectionReasons.join(',')}`);
  assert.equal(split.resultingParcelIds.length, 2);
  return Object.freeze([...split.resultingParcelIds].sort((left, right) => left.localeCompare(right)));
}

function verticalStrip(core: SimulationCore, parcelId: string, minX: number, maxX: number): readonly WorldPoint[] {
  const polygon = core.cadastre.parcelPolygon(parcelId);
  const ys = polygon.map((point) => point.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return Object.freeze([
    Object.freeze({ x: minX, y: minY }),
    Object.freeze({ x: maxX, y: minY }),
    Object.freeze({ x: maxX, y: maxY }),
    Object.freeze({ x: minX, y: maxY }),
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

test('runtime assembly rewrites canonical building zoning property and compatibility state atomically', () => {
  const fixture = buildSplitFixture();
  const childParcelIds = splitSafely(fixture);
  const { core, service } = fixture;
  const beforeBuilding = core.buildings.listV2()[0]!;

  const result = service.assembleParcels(childParcelIds);

  assert.equal(result.committed, true);
  assert.deepEqual(result.retiredParcelIds, childParcelIds);
  assert.equal(result.resultingParcelIds.length, 1);
  const assembledId = result.resultingParcelIds[0]!;
  assert.ok(core.cadastre.getParcel(assembledId));
  assert.ok(childParcelIds.every((id) => core.cadastre.getParcel(id) === undefined));

  const afterBuilding = core.buildings.getV2ById(beforeBuilding.id);
  assert.ok(afterBuilding);
  assert.equal(afterBuilding.id, beforeBuilding.id);
  assert.deepEqual(afterBuilding.lifecycle, beforeBuilding.lifecycle);
  assert.deepEqual(afterBuilding.parcelIds, [assembledId]);

  assert.deepEqual(core.zoning.getParcelAssignment(assembledId), {
    parcelId: assembledId,
    districtId: 'R2',
    overlayIds: [],
  });
  assert.equal(core.propertyMarket.ownerOf(assembledId), 'owner:test');
  const holding = core.propertyMarket.snapshot().holdings.find((candidate) => candidate.parcelId === assembledId);
  assert.ok(holding);
  assert.equal(holding.reservationValue, 300_000);
  assert.ok(core.lots.list().length > 0);
});

test('runtime assembly rejects conflicting property owners without mutating any dependent domain', () => {
  const fixture = buildSplitFixture();
  const childParcelIds = splitSafely(fixture);
  const { core, service } = fixture;
  const property = core.propertyMarket.snapshot();
  core.propertyMarket.restore({
    ...property,
    holdings: property.holdings.map((holding, index) => ({
      ...holding,
      ownerId: index === 0 ? 'owner:a' : 'owner:b',
    })),
  });
  const before = snapshots(core);

  const result = service.assembleParcels(childParcelIds);

  assert.equal(result.committed, false);
  assert.ok(result.rejectionReasons.includes('conflicting-property-owners'));
  assert.deepEqual(snapshots(core), before);
});

test('runtime assembly rejects conflicting explicit zoning assignments without mutating any dependent domain', () => {
  const fixture = buildSplitFixture();
  const childParcelIds = splitSafely(fixture);
  const { core, service } = fixture;
  core.zoning.assignParcel(childParcelIds[1]!, 'R5');
  const before = snapshots(core);

  const result = service.assembleParcels(childParcelIds);

  assert.equal(result.committed, false);
  assert.ok(result.rejectionReasons.includes('conflicting-zoning-assignments'));
  assert.deepEqual(snapshots(core), before);
});

test('runtime right-of-way dedication transfers live references to the residual parcel and scales land value', () => {
  const { core, service, sourceParcelId } = buildSplitFixture();
  const source = core.cadastre.getParcel(sourceParcelId)!;
  const building = core.buildings.listV2()[0]!;
  const parcelXs = core.cadastre.parcelPolygon(sourceParcelId).map((point) => point.x);
  const parcelMaxX = Math.max(...parcelXs);
  const buildingMaxX = Math.max(...building.footprint.map((point) => point.x));
  assert.ok(parcelMaxX - buildingMaxX > 0.2, 'fixture must leave a dedication corridor beside the building');
  const corridorMinX = buildingMaxX + (parcelMaxX - buildingMaxX) / 2;

  const result = service.dedicateRightOfWay(
    sourceParcelId,
    verticalStrip(core, sourceParcelId, corridorMinX, parcelMaxX),
  );

  assert.equal(result.committed, true);
  assert.deepEqual(result.retiredParcelIds, [sourceParcelId]);
  assert.equal(result.resultingParcelIds.length, 1);
  const residualId = result.resultingParcelIds[0]!;
  const residual = core.cadastre.getParcel(residualId);
  assert.ok(residual);
  assert.equal(core.cadastre.getParcel(sourceParcelId), undefined);

  const afterBuilding = core.buildings.getV2ById(building.id);
  assert.ok(afterBuilding);
  assert.equal(afterBuilding.id, building.id);
  assert.deepEqual(afterBuilding.lifecycle, building.lifecycle);
  assert.deepEqual(afterBuilding.parcelIds, [residualId]);
  assert.deepEqual(core.zoning.getParcelAssignment(residualId), {
    parcelId: residualId,
    districtId: 'R2',
    overlayIds: [],
  });

  const holding = core.propertyMarket.snapshot().holdings.find((candidate) => candidate.parcelId === residualId);
  assert.ok(holding);
  const expectedValue = Math.round(300_000 * (residual.areaM2 / source.areaM2) * 100) / 100;
  assert.equal(holding.ownerId, 'owner:test');
  assert.equal(holding.reservationValue, expectedValue);
  assert.ok(core.lots.list().length > 0);
});

test('runtime right-of-way dedication crossing the active building rejects without dependent mutation', () => {
  const { core, service, sourceParcelId } = buildSplitFixture();
  const building = core.buildings.listV2()[0]!;
  const parcelXs = core.cadastre.parcelPolygon(sourceParcelId).map((point) => point.x);
  const parcelMinX = Math.min(...parcelXs);
  const buildingXs = building.footprint.map((point) => point.x);
  const crossingX = (Math.min(...buildingXs) + Math.max(...buildingXs)) / 2;
  const before = snapshots(core);

  const result = service.dedicateRightOfWay(
    sourceParcelId,
    verticalStrip(core, sourceParcelId, parcelMinX, crossingX),
  );

  assert.equal(result.committed, false);
  assert.ok(result.rejectionReasons.includes('building-outside-resulting-parcel'));
  assert.deepEqual(snapshots(core), before);
});

test('runtime easement create and remove mutate only cadastral legal state', () => {
  const { core, service, sourceParcelId } = buildSplitFixture();
  const building = core.buildings.listV2()[0]!;
  const polygon = core.cadastre.parcelPolygon(sourceParcelId);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const parcelMaxX = Math.max(...xs);
  const buildingMaxX = Math.max(...building.footprint.map((point) => point.x));
  const easementX = buildingMaxX + (parcelMaxX - buildingMaxX) / 2;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const geometry = Object.freeze([
    Object.freeze({ x: easementX, y: minY + (maxY - minY) * 0.25 }),
    Object.freeze({ x: easementX, y: minY + (maxY - minY) * 0.75 }),
  ]);
  const before = snapshots(core);

  const created = service.createEasement([sourceParcelId], 'utility', geometry);

  assert.equal(created.committed, true);
  const easements = core.cadastre.listEasements();
  assert.equal(easements.length, 1);
  assert.deepEqual(core.buildings.listV2(), before.buildings);
  assert.deepEqual(core.zoning.listParcelAssignments(), before.zoning);
  assert.deepEqual(core.propertyMarket.snapshot(), before.propertyMarket);
  assert.deepEqual(core.lots.list(), before.lots);

  const removed = service.removeEasement(easements[0]!.id);

  assert.equal(removed.committed, true);
  assert.deepEqual(core.cadastre.snapshot(), before.cadastre);
  assert.deepEqual(core.buildings.listV2(), before.buildings);
  assert.deepEqual(core.zoning.listParcelAssignments(), before.zoning);
  assert.deepEqual(core.propertyMarket.snapshot(), before.propertyMarket);
  assert.deepEqual(core.lots.list(), before.lots);
});