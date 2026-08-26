import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';
import { indexCanonicalBuildingsByLegacyCell, legacyCellKey } from '../src/rendering/assets/CanonicalBuildingVisualIndex.ts';

function canonicalBuilding(id: string, footprint: BuildingV2['footprint']): BuildingV2 {
  return {
    id,
    parcelIds: [`parcel:${id}`],
    typologyId: 'typology:residential_cottage',
    footprint,
    grossFloorAreaM2: 600,
    usableFloorAreaM2: 500,
    heightMeters: 7,
    stories: 2,
    realizedFAR: 0.75,
    coverageRatio: 0.4,
    floors: [],
    status: 'occupied',
    yearBuilt: 0,
    projectCost: 100,
    entitlement: {
      approvalTick: 0,
      zoningDistrictId: 'residential',
      approvedFAR: 1,
      approvedHeightMeters: 12,
      approvedUses: ['residential'],
    },
    lifecycle: NEW_BUILDING_LIFECYCLE,
  };
}

test('canonical visual index maps every legacy cell with positive footprint intersection', () => {
  const building = canonicalBuilding('building:wide', [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ]);

  const index = indexCanonicalBuildingsByLegacyCell([building]);

  assert.equal(index.get(legacyCellKey(0, 0))?.id, building.id);
  assert.equal(index.get(legacyCellKey(1, 0))?.id, building.id);
  assert.equal(index.has(legacyCellKey(2, 0)), false, 'touching the footprint boundary must not count as occupied area');
  assert.equal(index.has(legacyCellKey(0, 1)), false, 'touching the footprint boundary must not count as occupied area');
});

test('canonical visual index keeps deterministic lowest-id precedence for overlaps', () => {
  const footprint: BuildingV2['footprint'] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];
  const later = canonicalBuilding('building:z', footprint);
  const earlier = canonicalBuilding('building:a', footprint);

  const index = indexCanonicalBuildingsByLegacyCell([later, earlier]);

  assert.equal(index.get(legacyCellKey(0, 0))?.id, earlier.id);
});

test('canonical visual index is independent of input order', () => {
  const left = canonicalBuilding('building:left', [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ]);
  const right = canonicalBuilding('building:right', [
    { x: 20, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 20, y: 20 },
  ]);

  const forward = indexCanonicalBuildingsByLegacyCell([left, right]);
  const reverse = indexCanonicalBuildingsByLegacyCell([right, left]);

  assert.equal(forward.get(legacyCellKey(0, 0))?.id, reverse.get(legacyCellKey(0, 0))?.id);
  assert.equal(forward.get(legacyCellKey(1, 0))?.id, reverse.get(legacyCellKey(1, 0))?.id);
}
);
