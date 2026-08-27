import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';

function buildingFixture(id: string, parcelId: string, x0: number, y0: number): BuildingV2 {
  return {
    id,
    parcelIds: [parcelId],
    typologyId: 'typology:detached-home',
    footprint: [
      { x: x0, y: y0 },
      { x: x0 + 12, y: y0 },
      { x: x0 + 12, y: y0 + 12 },
      { x: x0, y: y0 + 12 },
    ],
    grossFloorAreaM2: 144,
    usableFloorAreaM2: 120,
    heightMeters: 6.4,
    stories: 2,
    realizedFAR: 0.36,
    coverageRatio: 0.36,
    floors: [],
    status: 'occupied',
    yearBuilt: 0,
    projectCost: 300_000,
    entitlement: {
      approvalTick: 0,
      zoningDistrictId: 'R2',
      approvedFAR: 1.2,
      approvedHeightMeters: 12,
      approvedUses: ['residential'],
    },
    lifecycle: NEW_BUILDING_LIFECYCLE,
  };
}

test('BuildingSystem stores canonical BuildingV2 state independently of legacy buildings', () => {
  const system = new BuildingSystem();
  const first = buildingFixture('building:v2:b', 'parcel:3,3', 64, 64);
  const second = buildingFixture('building:v2:a', 'parcel:5,3', 104, 64);

  system.restoreV2([first, second]);

  assert.deepEqual(system.list(), [], 'V2 state must not leak into the V7/V8 legacy building collection');
  assert.deepEqual(system.listV2().map((building) => building.id), ['building:v2:a', 'building:v2:b']);
  assert.deepEqual(system.getV2ById(first.id), first);
});

test('BuildingSystem resolves canonical buildings through legacy cell spatial lookup without changing IDs', () => {
  const system = new BuildingSystem();
  const building = buildingFixture('building:v2:parcel-3-3', 'parcel:3,3', 64, 64);
  system.restoreV2([building]);

  assert.equal(system.getV2At(3, 3)?.id, building.id);
  assert.equal(system.getV2At(2, 3), undefined);
  assert.equal(system.getV2At(4, 3), undefined);
  assert.equal(system.listV2()[0]?.parcelIds[0], 'parcel:3,3');
});

test('BuildingSystem rejects duplicate canonical building IDs during V2 restore', () => {
  const system = new BuildingSystem();
  const building = buildingFixture('building:v2:duplicate', 'parcel:3,3', 64, 64);
  assert.throws(() => system.restoreV2([building, building]), /duplicate.*building/i);
});
