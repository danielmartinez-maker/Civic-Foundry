import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';
import { TaxSystem } from '../src/simulation/tax/TaxSystem.ts';
import { UtilitySystem } from '../src/simulation/utilities/UtilitySystem.ts';
import { GarbageSystem } from '../src/simulation/garbage/GarbageSystem.ts';
import { WasteCollectionSystem } from '../src/simulation/services/WasteCollectionSystem.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import type { Lot } from '../src/world/lots/LotSystem.ts';
import type { DevelopmentAward } from '../src/simulation/development/DevelopmentTypes.ts';

const lot: Lot = { id: 'lot:2,2', x: 2, y: 2, zone: 'residential', frontageRoadKey: '2,3' };

function award(overrides: Partial<DevelopmentAward> = {}): DevelopmentAward {
  return {
    id: 'bid:100:lot:2,2:residential_rowhouse:local_builder',
    awardId: 'development:100:lot:2,2:residential_rowhouse:local_builder',
    buildingId: 'building:lot:2,2',
    lotId: lot.id,
    definitionId: 'residential_rowhouse',
    zone: 'residential',
    developerId: 'local_builder',
    expectedReturn: 0.2,
    expectedReturnMargin: 0.1,
    requiredEquity: 30_000,
    financingCost: 2_000,
    totalDevelopmentCost: 82_000,
    preferenceBonus: 0.05,
    capitalEfficiencyBonus: 0.01,
    residualValueBonus: 0.01,
    riskPenalty: 0,
    rankScore: 0.17,
    residualLandValue: 40_000,
    awardTick: 100,
    completionTick: 170,
    releaseTick: 270,
    ...overrides,
  };
}

function flatTerrain(width = 8, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5, water: false, buildable: true, biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildDevelopmentCore(withUtilities = true): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(20, 12), startingFunds: 300_000, seed: 41 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'local').ok, true);
  core.paintZone([{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }], 'residential');
  core.paintZone([{ x: 7, y: 5 }, { x: 8, y: 5 }], 'commercial');
  core.paintZone([{ x: 10, y: 5 }, { x: 11, y: 5 }], 'industrial');
  if (withUtilities) {
    assert.equal(core.placeUtility('power', 4, 7).ok, true);
    assert.equal(core.placeUtility('water', 8, 7).ok, true);
  }
  return core;
}

test('BuildingSystem starts only an awarded project and preserves developer finance metadata', () => {
  const buildings = new BuildingSystem();
  const started = buildings.startDevelopment(100, lot, award());
  assert.equal(started.id, 'building:lot:2,2');
  assert.equal(started.developerId, 'local_builder');
  assert.equal(started.definitionId, 'residential_rowhouse');
  assert.equal(started.projectCost, 82_000);
  assert.equal(started.requiredEquity, 30_000);
  assert.equal(started.awardScore, 0.17);
  assert.equal(started.status, 'construction');
  assert.equal(started.completionTick, 170);
  assert.throws(() => buildings.startDevelopment(101, lot, award()), /already developed|occupied/i);
});

test('BuildingSystem rejects an award for the wrong parcel zone or building definition', () => {
  const buildings = new BuildingSystem();
  assert.throws(
    () => buildings.startDevelopment(100, lot, award({ zone: 'commercial' })),
    /zone/i,
  );
  assert.throws(
    () => buildings.startDevelopment(100, lot, award({ lotId: 'lot:wrong' })),
    /lot/i,
  );
});

test('variant definition drives occupied capacity utilities taxes and garbage', () => {
  const terrain = flatTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  assert.equal(roads.placePath([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], 'local', treasury).ok, true);
  const utilities = new UtilitySystem(terrain, roads);
  const garbage = new GarbageSystem();
  const taxes = new TaxSystem();
  const buildings = new BuildingSystem();
  buildings.startDevelopment(100, lot, award());
  buildings.tick(170);

  assert.equal(buildings.residentialCapacity(), 28);
  assert.equal(buildings.jobCapacity(), 0);
  const occupied = buildings.occupied();
  assert.equal(utilities.evaluate(occupied).power.demand, 16);
  assert.equal(utilities.evaluate(occupied).water.demand, 14);
  assert.equal(taxes.calculateRevenue(occupied).residential, 25);
  assert.equal(garbage.evaluate(occupied, roads, []).generated, 5);
});

test('routed waste collection also uses the awarded project variant', () => {
  const buildings = new BuildingSystem();
  buildings.startDevelopment(100, lot, award());
  buildings.tick(170);
  const waste = new WasteCollectionSystem();
  assert.equal(waste.generate(buildings.occupied(), 200), 5);
  assert.equal(waste.getBuildingWaste('building:lot:2,2')?.wasteGenerationRate, 5);
});

test('legacy fixture definition IDs retain zone-default compatibility', () => {
  const buildings = new BuildingSystem();
  buildings.restore([{
    id: 'legacy:r', lotId: 'lot:legacy', x: 2, y: 2, zone: 'residential', definitionId: 'residential_fixture',
    status: 'occupied', constructionStartedTick: 0, completionTick: 0,
  }]);
  assert.equal(buildings.residentialCapacity(), 10);
});

test('SimulationCore exposes deterministic derived land and housing market metrics', () => {
  const first = buildDevelopmentCore(true);
  const second = buildDevelopmentCore(true);
  first.step(100);
  second.step(100);

  assert.ok(first.landHousingMarketSnapshot.housingPressure >= 0);
  assert.ok(first.landHousingMarketSnapshot.housingRentIndex > 0);
  assert.ok(first.landHousingMarketSnapshot.housingVacancyRate >= 0.03);
  assert.ok(first.landHousingMarketSnapshot.housingVacancyRate <= 0.35);
  assert.deepEqual(first.landHousingMarketSnapshot, second.landHousingMarketSnapshot);
});

test('SimulationCore routes feasible parcels through deterministic developer awards', () => {
  const first = buildDevelopmentCore(true);
  const second = buildDevelopmentCore(true);
  first.step(600);
  second.step(600);

  assert.ok(first.buildings.list().length > 0);
  assert.ok(first.buildings.list().some((building) => building.developerId));
  assert.deepEqual(first.buildings.list(), second.buildings.list());
  assert.deepEqual(first.developerMarket.snapshotState(), second.developerMarket.snapshotState());
});

test('city development is blocked when infrastructure eligibility fails', () => {
  const core = buildDevelopmentCore(false);
  core.step(300);
  assert.equal(core.buildings.list().length, 0);
  assert.equal(core.developerMarket.lastAwards().length, 0);
});

test('city development is blocked when every developer hurdle is above expected returns', () => {
  const core = buildDevelopmentCore(true);
  const state = core.developerMarket.snapshotState();
  core.developerMarket.restoreState({
    developers: state.developers.map((developer) => ({ ...developer, hurdleRate: 5 })),
    commitments: state.commitments,
  });
  core.step(300);
  assert.equal(core.buildings.list().length, 0);
  assert.equal(core.developerMarket.lastAwards().length, 0);
});
