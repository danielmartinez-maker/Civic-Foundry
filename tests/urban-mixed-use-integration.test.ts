import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_DEFINITION_BY_ID } from '../src/data/buildings.ts';
import { getUrbanPrototype } from '../src/data/urbanPrototypes.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { FirmSystem } from '../src/simulation/economy/FirmSystem.ts';
import { urbanBusinessSiteFromView } from '../src/simulation/urban/UrbanBuildingView.ts';
import { TerrainGrid } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 6, height = 6): TerrainGrid {
  return new TerrainGrid(width, height, Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  })));
}

function installCommercialMixedBlock(core: SimulationCore): string {
  assert.equal(core.buildRoad([{ x: 1, y: 1 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 1, y: 2 }], 'commercial').painted, 1);
  const buildingId = 'building:lot:1,2';
  core.buildings.restore([{
    id: buildingId,
    lotId: 'lot:1,2',
    x: 1,
    y: 2,
    zone: 'commercial',
    definitionId: 'commercial_mixed_block',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 95,
  }]);
  const prototype = getUrbanPrototype('commercial_mixed_block');
  core.urbanFabric.install({
    buildingId,
    useComponents: prototype.components,
    qualityTier: 'standard',
    conditionScore: 80,
    lifecycleState: 'stabilized',
    conditionEstablishedTick: 0,
    lastConditionTick: 0,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 10 },
  });
  return buildingId;
}

test('mixed-use structural definitions are first-class and preserve dominant-use intensity', () => {
  assert.equal(BUILDING_DEFINITION_BY_ID.residential_mainstreet_mixed?.zone, 'residential');
  assert.equal(BUILDING_DEFINITION_BY_ID.residential_mainstreet_mixed?.intensity, 'medium');
  assert.equal(BUILDING_DEFINITION_BY_ID.residential_urban_mixed?.intensity, 'high');
  assert.equal(BUILDING_DEFINITION_BY_ID.commercial_mixed_block?.zone, 'commercial');
  assert.equal(BUILDING_DEFINITION_BY_ID.commercial_mixed_block?.intensity, 'medium');
  assert.equal(BUILDING_DEFINITION_BY_ID.commercial_mixed_tower?.intensity, 'high');
});

test('mixed-use housing, jobs, and tax bases are consumed once by use component', () => {
  const core = new SimulationCore({ width: 6, height: 6, seed: 103, startingFunds: 500_000, terrain: flatTerrain() });
  const buildingId = installCommercialMixedBlock(core);
  const view = core.urbanBuildingView(buildingId);
  assert.ok(view);
  assert.equal(view.residentialCapacity, 14);
  assert.equal(view.commercialJobCapacity, 18);
  assert.equal(view.jobCapacity, 18);
  assert.equal(view.taxBase, 600);

  core.taxes.setRate('residential', 0.10);
  core.taxes.setRate('commercial', 0.20);
  core.taxes.setRate('industrial', 0.25);
  const revenue = core.taxes.calculateUrbanRevenue([view]);
  assert.equal(revenue.residential, 18);
  assert.equal(revenue.commercial, 84);
  assert.equal(revenue.industrial, 0);
  assert.equal(revenue.total, 102);

  core.restoreHousingState();
  assert.equal(core.housingTenureSnapshot.byBuilding[buildingId]?.totalCapacity, 14);
});

test('firm eligibility and job capacity come from semantic business sites', () => {
  const core = new SimulationCore({ width: 6, height: 6, seed: 104, startingFunds: 500_000, terrain: flatTerrain() });
  const buildingId = installCommercialMixedBlock(core);
  const view = core.urbanBuildingView(buildingId);
  assert.ok(view);
  const site = urbanBusinessSiteFromView(view);
  assert.equal(site.commercialJobCapacity, 18);
  assert.equal(site.industrialJobCapacity, 0);
  assert.equal(site.totalJobCapacity, 18);

  const firms = new FirmSystem(7);
  firms.syncEligibleSites([site], 100);
  const firm = firms.getByBuildingId(buildingId);
  assert.ok(firm);
  assert.equal(firm.zone, 'commercial');
  assert.ok(firm.jobCapacity > 0);
  assert.ok(firm.jobCapacity <= 18);
});
