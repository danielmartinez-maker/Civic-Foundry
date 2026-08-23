import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';
import { TaxSystem } from '../src/simulation/tax/TaxSystem.ts';
import { UtilitySystem } from '../src/simulation/utilities/UtilitySystem.ts';
import { GarbageSystem } from '../src/simulation/garbage/GarbageSystem.ts';
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

test('legacy fixture definition IDs retain zone-default compatibility', () => {
  const buildings = new BuildingSystem();
  buildings.restore([{
    id: 'legacy:r', lotId: 'lot:legacy', x: 2, y: 2, zone: 'residential', definitionId: 'residential_fixture',
    status: 'occupied', constructionStartedTick: 0, completionTick: 0,
  }]);
  assert.equal(buildings.residentialCapacity(), 10);
});
