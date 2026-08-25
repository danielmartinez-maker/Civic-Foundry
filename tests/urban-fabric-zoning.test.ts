import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { ZoningSystem } from '../src/simulation/zoning/ZoningSystem.ts';
import {
  ZONING_DISTRICTS,
  districtForLegacyZone,
  getZoningDistrict,
} from '../src/simulation/zoning/ZoningDistrictCatalog.ts';

function terrainFixture(): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: 16 }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(4, 4, cells);
}

test('base catalog contains deterministic dimensional districts', () => {
  assert.equal(ZONING_DISTRICTS.MU8.maxFAR, 8);
  assert.equal(ZONING_DISTRICTS.MU8.maxHeightMeters, 90);
  assert.ok(ZONING_DISTRICTS.MU8.permittedUses.includes('residential'));
  assert.ok(ZONING_DISTRICTS.MU8.permittedUses.includes('retail'));
  assert.equal(districtForLegacyZone('residential').id, 'R2');
  assert.equal(districtForLegacyZone('commercial').id, 'C6');
  assert.equal(districtForLegacyZone('industrial').id, 'IND');
});

test('district catalog exposes exact initial dimensional controls', () => {
  assert.deepEqual(
    Object.keys(ZONING_DISTRICTS),
    ['R2', 'R5', 'MU4', 'MU8', 'C6', 'IND'],
  );
  assert.deepEqual(
    {
      far: ZONING_DISTRICTS.R2.maxFAR,
      height: ZONING_DISTRICTS.R2.maxHeightMeters,
      stories: ZONING_DISTRICTS.R2.maxStories,
      coverage: ZONING_DISTRICTS.R2.maxCoverageRatio,
      front: ZONING_DISTRICTS.R2.frontSetbackMeters,
      rear: ZONING_DISTRICTS.R2.rearSetbackMeters,
      side: ZONING_DISTRICTS.R2.sideSetbackMeters,
      area: ZONING_DISTRICTS.R2.minParcelAreaM2,
      frontage: ZONING_DISTRICTS.R2.minFrontageMeters,
    },
    { far: 1.5, height: 12, stories: 2, coverage: 0.55, front: 4, rear: 5, side: 2, area: 250, frontage: 8 },
  );
  assert.equal(getZoningDistrict('missing'), undefined);
});

test('parcel zoning assignment is independent of legacy cell paint', () => {
  const terrain = terrainFixture();
  const roads = new RoadSystem(terrain);
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 1, y: 1 }], 'residential');
  zoning.assignParcel('parcel:1', 'MU4');

  assert.equal(zoning.get(1, 1), 'residential');
  assert.equal(zoning.getParcelDistrictId('parcel:1'), 'MU4');
  assert.deepEqual(zoning.listParcelAssignments(), [{ parcelId: 'parcel:1', districtId: 'MU4', overlayIds: [] }]);
});

test('parcel zoning assignment validates districts and normalizes overlays', () => {
  const terrain = terrainFixture();
  const zoning = new ZoningSystem(terrain, new RoadSystem(terrain));
  assert.throws(() => zoning.assignParcel('parcel:1', 'NOPE'), /unknown zoning district/);
  zoning.assignParcel('parcel:1', 'R5', ['historic:b', 'historic:a', 'historic:b']);
  assert.deepEqual(zoning.getParcelAssignment('parcel:1'), {
    parcelId: 'parcel:1',
    districtId: 'R5',
    overlayIds: ['historic:a', 'historic:b'],
  });
});
