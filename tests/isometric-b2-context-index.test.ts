import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { PublicRealmPresentationCache } from '../src/rendering/public-realm/PublicRealmPresentationCache.ts';
import { buildPublicRealmContextIndex } from '../src/rendering/public-realm/PublicRealmContextIndex.ts';
import { publicRealmRevisionFingerprint } from '../src/rendering/public-realm/PublicRealmRevisionFingerprint.ts';

function flatTerrain(width = 14, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: .5, water: false, buildable: true, biome: 'grass',
  }));
  return new TerrainGrid(width, height, cells);
}

test('context index uses authoritative adjacent road class for service facilities', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 82, startingFunds: 500_000 });
  assert.equal(core.buildRoad([{x:2,y:5},{x:3,y:5},{x:4,y:5},{x:5,y:5}], 'collector').ok, true);
  core.paintZone([{x:3,y:4}], 'residential');
  assert.equal(core.placeServiceFacility('fire_station', 5, 4).ok, true);
  const contexts = buildPublicRealmContextIndex(core);
  const facility = contexts.find((item) => item.kind === 'facility' && item.facilityType === 'fire_station');
  assert.ok(facility);
  assert.equal(facility.roadType, 'collector');
  assert.deepEqual(facility.siteAnchor, { x: 5, y: 4 });
  assert.deepEqual(facility.frontageAnchor, { x: 5, y: 5 });
});

test('fingerprint changes only when relevant presentation authority changes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 83, startingFunds: 500_000 });
  const before = publicRealmRevisionFingerprint(core);
  assert.equal(core.buildRoad([{x:2,y:5},{x:3,y:5}], 'local').ok, true);
  const afterRoad = publicRealmRevisionFingerprint(core);
  assert.notEqual(afterRoad, before);
  assert.equal(core.placeServiceFacility('clinic', 2, 4).ok, true);
  const afterFacility = publicRealmRevisionFingerprint(core);
  assert.notEqual(afterFacility, afterRoad);
  core.setServiceFunding('healthcare', 120);
  assert.equal(publicRealmRevisionFingerprint(core), afterFacility);
});

test('presentation cache rebuilds contexts only when the fingerprint changes', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 84, startingFunds: 500_000 });
  let builds = 0;
  const cache = new PublicRealmPresentationCache((value) => {
    builds += 1;
    return buildPublicRealmContextIndex(value);
  });
  const first = cache.resolve(core);
  const second = cache.resolve(core);
  assert.equal(first, second);
  assert.equal(builds, 1);
  assert.equal(core.buildRoad([{x:2,y:5}], 'local').ok, true);
  const third = cache.resolve(core);
  assert.notEqual(third, first);
  assert.equal(builds, 2);
});
