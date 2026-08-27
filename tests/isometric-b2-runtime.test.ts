import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { NEW_BUILDING_LIFECYCLE, type BuildingV2 } from '../src/simulation/buildings/BuildingTypes.ts';
import { LEGACY_CELL_SIZE_METERS } from '../src/world/cadastre/Geometry.ts';
import { PublicRealmPresentationCache } from '../src/rendering/public-realm/PublicRealmPresentationCache.ts';

function flatTerrain(width = 18, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: .5, water: false, buildable: true, biome: 'grass',
  }));
  return new TerrainGrid(width, height, cells);
}

function canonicalBuilding(parcelId: string, x: number, y: number): BuildingV2 {
  const size = LEGACY_CELL_SIZE_METERS;
  return {
    id: 'canonical:b2-main', parcelIds: [parcelId], typologyId: 'main_street_mixed_use',
    footprint: [{x:x*size,y:y*size},{x:(x+1)*size,y:y*size},{x:(x+1)*size,y:(y+1)*size},{x:x*size,y:(y+1)*size}],
    grossFloorAreaM2: 1400, usableFloorAreaM2: 1120, heightMeters: 18, stories: 5,
    realizedFAR: 2.1, coverageRatio: .65,
    floors: [{ level: 1, elevationMeters: 0, grossAreaM2: 280, uses: [{use:'retail',floorAreaM2:140},{use:'residential',floorAreaM2:140}] }],
    status: 'occupied', yearBuilt: 0, projectCost: 100000,
    entitlement: { approvalTick: 0, zoningDistrictId: 'commercial', approvedFAR: 4, approvedHeightMeters: 60, approvedUses: ['retail','residential'] },
    lifecycle: NEW_BUILDING_LIFECYCLE,
  };
}

test('B2 presentation resolution reads authority without mutating it', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 106, startingFunds: 1_000_000 });
  assert.equal(core.buildRoad(Array.from({length:10},(_,i)=>({x:i+2,y:6})), 'collector').ok, true);
  core.paintZone([{x:4,y:5}], 'commercial');
  const parcel = core.cadastre.listParcels().find((item) => item.centroid.x / LEGACY_CELL_SIZE_METERS > 3 && item.centroid.x / LEGACY_CELL_SIZE_METERS < 5);
  assert.ok(parcel);
  core.buildings.restoreV2([canonicalBuilding(parcel.id, 4, 5)]);
  assert.equal(core.placeServiceFacility('fire_station', 8, 5).ok, true);

  const before = JSON.stringify({
    roads: core.roads.list(), cadastre: core.cadastre.snapshot(), buildings: core.buildings.listV2(),
    services: core.services.listFacilities(), treasury: core.treasury.balance,
    traffic: core.trafficSnapshot, utilities: core.utilitySnapshot,
  });
  const snapshot = new PublicRealmPresentationCache().resolve(core);
  const after = JSON.stringify({
    roads: core.roads.list(), cadastre: core.cadastre.snapshot(), buildings: core.buildings.listV2(),
    services: core.services.listFacilities(), treasury: core.treasury.balance,
    traffic: core.trafficSnapshot, utilities: core.utilitySnapshot,
  });
  assert.equal(after, before);
  assert.ok(snapshot.descriptors.some((descriptor) => descriptor.profile === 'main-street'));
  assert.ok(snapshot.descriptors.some((descriptor) => descriptor.profile === 'civic-public-space' && descriptor.context.kind === 'facility'));
});

test('B2 presentation modules contain no parking authority or simulation RNG hooks', () => {
  const paths = [
    '../src/rendering/public-realm/PublicRealmVisualResolver.ts',
    '../src/rendering/public-realm/PublicRealmRevisionFingerprint.ts',
    '../src/rendering/public-realm/PublicRealmContextIndex.ts',
    '../src/rendering/public-realm/PublicRealmPresentationCache.ts',
    '../src/rendering/public-realm/PublicRealmAssetResolver.ts',
    '../src/rendering/passes/PublicRealmRenderPass.ts',
  ];
  const source = paths.map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  for (const forbidden of ['parkingCapacity','parkingPrice','cruisingPenalty','Math.random','.getV2At(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('WorldRenderer resolves one B2 frame and joins B2 vertical commands to shared scene commands', () => {
  const source = readFileSync(new URL('../src/rendering/WorldRenderer.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('this.publicRealm.resolveFrame(core, this.camera)'));
  assert.ok(source.includes('this.publicRealm.drawSurfaces('));
  assert.ok(source.includes('this.publicRealm.collectVertical('));
  assert.ok(source.includes('...this.objects.collect(core, this.camera)'));
});
