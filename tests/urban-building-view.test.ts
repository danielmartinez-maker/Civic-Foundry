import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { definitionForBuilding, type Building } from '../src/simulation/buildings/BuildingSystem.ts';

test('legacy urban baseline reproduces every V7 building definition nominal metric', () => {
  const core = new SimulationCore({ width: 12, height: 4, seed: 91 });
  const definitions = Object.values(BUILDING_VARIANTS).flat();
  const buildings: Building[] = definitions.map((definition, index) => ({
    id: `building:legacy:${index}`,
    lotId: `lot:legacy:${index}`,
    x: index,
    y: 1,
    zone: definition.zone,
    definitionId: definition.id,
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 10,
  }));
  core.buildings.restore(buildings);

  core.initializeUrbanFabricFromLegacy(240);

  assert.deepEqual(core.urbanBuildingViews().map((view) => view.buildingId), buildings.map((building) => building.id).sort());
  for (const building of core.buildings.list()) {
    const definition = definitionForBuilding(building);
    const view = core.urbanBuildingView(building.id);
    assert.ok(view);
    assert.equal(view.residentialCapacity, definition.residentCapacity, definition.id);
    assert.equal(view.jobCapacity, definition.jobCapacity, definition.id);
    assert.equal(view.taxBase, definition.taxBase, definition.id);
    assert.equal(view.powerDemand, definition.powerDemand, definition.id);
    assert.equal(view.waterDemand, definition.waterDemand, definition.id);
    assert.equal(view.garbageGeneration, definition.garbageGeneration, definition.id);
    assert.equal(view.qualityTier, 'standard');
    assert.equal(view.conditionScore, 80);
    assert.equal(view.conditionCapacityMultiplier, 1);
    assert.deepEqual(view.parking, { profile: 'legacy-none', spaces: 0 });
  }
});

test('legacy migration establishes explicit timestamps and lifecycle without fabricating history', () => {
  const core = new SimulationCore({ width: 4, height: 4, seed: 92 });
  core.buildings.restore([
    {
      id: 'building:occupied', lotId: 'lot:occupied', x: 1, y: 1, zone: 'residential', definitionId: 'residential_cottage',
      status: 'occupied', constructionStartedTick: 5, completionTick: 55,
    },
    {
      id: 'building:construction', lotId: 'lot:construction', x: 2, y: 1, zone: 'commercial', definitionId: 'commercial_shop',
      status: 'construction', constructionStartedTick: 200, completionTick: 265,
    },
  ]);

  core.initializeUrbanFabricFromLegacy(240);
  const occupied = core.urbanFabric.get('building:occupied');
  const construction = core.urbanFabric.get('building:construction');
  assert.equal(occupied?.lifecycleState, 'stabilized');
  assert.equal(construction?.lifecycleState, 'construction');
  assert.equal(occupied?.conditionEstablishedTick, 240);
  assert.equal(occupied?.lastConditionTick, 240);
  assert.equal(occupied?.renovationCount, 0);
  assert.deepEqual(occupied?.useComponents, [
    { use: 'residential', areaShareBps: 10_000, residentCapacity: 10, jobCapacity: 0, taxBase: 120 },
  ]);
});
