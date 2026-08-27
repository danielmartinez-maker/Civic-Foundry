import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { PublicRealmPresentationCache } from '../src/rendering/public-realm/PublicRealmPresentationCache.ts';
import { buildPublicRealmContextIndex } from '../src/rendering/public-realm/PublicRealmContextIndex.ts';

function flatTerrain(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: .5, water: false, buildable: true, biome: 'grass',
  }));
  return new TerrainGrid(width, height, cells);
}

test('unchanged frames reuse one public-realm context build', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 91, startingFunds: 500_000 });
  let builds = 0;
  const cache = new PublicRealmPresentationCache((value) => {
    builds += 1;
    return buildPublicRealmContextIndex(value);
  });
  for (let i = 0; i < 100; i += 1) cache.resolve(core);
  assert.equal(builds, 1);
  assert.equal(core.buildRoad([{x:8,y:5}], 'local').ok, true);
  cache.resolve(core);
  assert.equal(builds, 2);
});

test('context index never uses per-cell canonical BuildingV2 scans', () => {
  const source = readFileSync(new URL('../src/rendering/public-realm/PublicRealmContextIndex.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('.getV2At('), false);
});

test('render pass never performs whole-city authoritative scans', () => {
  const source = readFileSync(new URL('../src/rendering/passes/PublicRealmRenderPass.ts', import.meta.url), 'utf8');
  for (const forbidden of ['core.cadastre.list', 'core.buildings.listV2(', 'core.services.listFacilities(', '.getV2At(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const resolver = readFileSync(new URL('../src/rendering/public-realm/PublicRealmAssetResolver.ts', import.meta.url), 'utf8');
  assert.equal(resolver.includes('.filter((entry) => entry.category'), false, 'resolver must use the pre-indexed catalog');
});
