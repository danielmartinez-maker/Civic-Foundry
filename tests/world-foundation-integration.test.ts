import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { RandomStreamRegistry } from '../src/simulation/kernel/RandomStreamRegistry.ts';
import { WorldFoundation } from '../src/world/foundation/WorldFoundation.ts';
import { resolveWorldGenerationConfig } from '../src/world/generation/WorldGenerationConfig.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

test('direct terrain construction stays exact and receives neutral legacy-explicit world semantics', () => {
  const terrain = flatTerrain();
  const before = terrain.snapshot();
  const core = new SimulationCore({ terrain, seed: 17 });
  assert.equal(core.world.mode, 'legacy-explicit');
  assert.deepEqual(core.terrain.snapshot(), before);
  assert.equal(core.world.preparationMultiplierAt(2, 2), 1);
  assert.equal(core.terrain.width, 8);
  assert.equal(core.terrain.height, 6);
  assert.equal(core.terrain.isBuildable(2, 2), true);
});

test('generated SimulationCore owns a generated-1r world behind the legacy terrain facade', () => {
  const core = new SimulationCore({ width: 16, height: 10, seed: 42 });
  assert.equal(core.world.mode, 'generated-1r');
  assert.equal(core.terrain.width, 16);
  assert.equal(core.terrain.height, 10);
  const sample = core.world.terrainSampleAt(3, 3);
  assert.ok(Number.isFinite(sample.elevationMeters));
  assert.ok(sample.watershedId.length > 0);
  assert.deepEqual(core.kernel.snapshots.capture('world'), core.world.diagnosticSnapshot());
});

test('legacy ticking does not mutate authoritative static world state', () => {
  const core = new SimulationCore({ width: 14, height: 9, seed: 91 });
  const before = core.world.snapshotAuthoritative();
  core.step(100);
  assert.deepEqual(core.world.snapshotAuthoritative(), before);
});

test('WorldFoundation snapshot restore preserves composition and flood state isolation', () => {
  const seed = 73;
  const config = resolveWorldGenerationConfig({ width: 12, height: 8, preset: 'river_valley' });
  const world = WorldFoundation.generate({ seed, config, randomRegistry: new RandomStreamRegistry(seed) });
  const before = world.snapshotAuthoritative();
  const result = world.runDesignStorm({ id: 'storm:1', rainfallMm: 40, durationHours: 1 });
  assert.ok(result.depthMeters.every((depth) => Number.isFinite(depth) && depth >= 0));
  assert.deepEqual(world.terrain.snapshotAuthoritative(), before.terrain);
  assert.deepEqual(world.hydrology.snapshotAuthoritative(), before.hydrology);
  const restored = WorldFoundation.restore(world.snapshotAuthoritative());
  assert.deepEqual(restored.snapshotAuthoritative(), world.snapshotAuthoritative());
});
