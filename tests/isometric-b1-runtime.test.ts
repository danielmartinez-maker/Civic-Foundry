import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';

async function loadRuntimeManifest() {
  return import('../src/rendering/assets/RuntimeAssetManifest.ts');
}

async function loadResolver() {
  return import('../src/rendering/assets/BuildingVisualResolver.ts');
}

function canonicalBuilding(overrides: Partial<BuildingV2> = {}): BuildingV2 {
  return {
    id: 'building:runtime-test',
    parcelIds: ['parcel:runtime-test'],
    typologyId: 'typology:residential_cottage',
    footprint: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
    grossFloorAreaM2: 700,
    usableFloorAreaM2: 600,
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
    lifecycle: { ...NEW_BUILDING_LIFECYCLE, exteriorCondition: 75 },
    ...overrides,
  };
}

test('runtime asset manifest composes Pass A and B1', async () => {
  const { RUNTIME_ASSET_MANIFEST } = await loadRuntimeManifest();
  assert.equal(RUNTIME_ASSET_MANIFEST.entries.length, 299);
  assert.equal(RUNTIME_ASSET_MANIFEST.atlases.length, 9);
  assert.ok(RUNTIME_ASSET_MANIFEST.atlases.some((atlas) => atlas.atlasId === 'urban_depth_buildings'));
});

test('canonical building resolves a condition-aware runtime sprite without mutation', async () => {
  const { RUNTIME_ASSET_MANIFEST } = await loadRuntimeManifest();
  const { selectBuildingVisualEntry } = await loadResolver();
  assert.equal(typeof selectBuildingVisualEntry, 'function');
  const building = canonicalBuilding({
    lifecycle: { ...NEW_BUILDING_LIFECYCLE, exteriorCondition: 50 },
  });
  const before = JSON.stringify(building);
  const entry = selectBuildingVisualEntry(building, 2, RUNTIME_ASSET_MANIFEST.entries);
  assert.ok(entry);
  assert.equal(entry.condition, 'aging');
  assert.ok(entry.variantKey.endsWith('__aging'));
  assert.equal(JSON.stringify(building), before);
});

test('mixed-use canonical building resolves from the authored B1 family', async () => {
  const { RUNTIME_ASSET_MANIFEST } = await loadRuntimeManifest();
  const { selectBuildingVisualEntry } = await loadResolver();
  const building = canonicalBuilding({
    id: 'building:mixed-runtime',
    typologyId: 'main_street_mixed_use',
    lifecycle: { ...NEW_BUILDING_LIFECYCLE, exteriorCondition: 78 },
  });
  const entry = selectBuildingVisualEntry(building, 3, RUNTIME_ASSET_MANIFEST.entries);
  assert.ok(entry);
  assert.equal(entry.condition, 'maintained');
  assert.equal(entry.subcategory, 'mixed-use');
  assert.ok(entry.tags?.includes('typology:main_street_mixed_use'));
});
