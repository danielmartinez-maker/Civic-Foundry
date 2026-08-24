import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';
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

function occupiedCottage(): ReturnType<BuildingSystem['list']>[number] {
  return {
    id: 'building:lot:2,2',
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone: 'residential',
    definitionId: 'residential_cottage',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  };
}

test('BuildingSystem replaces an occupied residential building with a higher-intensity awarded project', () => {
  const buildings = new BuildingSystem();
  buildings.restore([occupiedCottage()]);

  const result = buildings.replaceDevelopment(100, lot, award());

  assert.equal(result.removed.definitionId, 'residential_cottage');
  assert.equal(result.replacement.id, result.removed.id);
  assert.equal(result.replacement.definitionId, 'residential_rowhouse');
  assert.equal(result.replacement.status, 'construction');
  assert.equal(result.replacement.completionTick, 170);
  assert.equal(result.replacement.developerId, 'local_builder');
  assert.equal(buildings.occupied().length, 0);
  assert.deepEqual(buildings.getById(result.replacement.id), result.replacement);
});

test('BuildingSystem redevelopment rejects vacant, constructing, non-residential, and non-intensifying parcels', () => {
  const vacant = new BuildingSystem();
  assert.throws(() => vacant.replaceDevelopment(100, lot, award()), /existing|occupied|developed/i);

  const constructing = new BuildingSystem();
  constructing.restore([{ ...occupiedCottage(), status: 'construction', completionTick: 120 }]);
  assert.throws(() => constructing.replaceDevelopment(100, lot, award()), /occupied/i);

  const nonResidentialLot: Lot = { ...lot, zone: 'commercial' };
  const nonResidential = new BuildingSystem();
  nonResidential.restore([{ ...occupiedCottage(), zone: 'commercial', definitionId: 'commercial_shop' }]);
  assert.throws(
    () => nonResidential.replaceDevelopment(100, nonResidentialLot, award({ zone: 'commercial', definitionId: 'commercial_block' })),
    /residential/i,
  );

  const sameIntensity = new BuildingSystem();
  sameIntensity.restore([occupiedCottage()]);
  assert.throws(
    () => sameIntensity.replaceDevelopment(100, lot, award({ definitionId: 'residential_cottage', completionTick: 150 })),
    /higher|intensity/i,
  );
});

test('BuildingSystem redevelopment rejects award identity and parcel mismatches', () => {
  const buildings = new BuildingSystem();
  buildings.restore([occupiedCottage()]);
  assert.throws(() => buildings.replaceDevelopment(100, lot, award({ lotId: 'lot:wrong' })), /lot/i);
  assert.throws(() => buildings.replaceDevelopment(100, lot, award({ buildingId: 'building:wrong' })), /building/i);
  assert.throws(() => buildings.replaceDevelopment(100, lot, award({ zone: 'commercial' })), /zone/i);
});
