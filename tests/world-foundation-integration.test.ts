import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { RandomStreamRegistry } from '../src/simulation/kernel/RandomStreamRegistry.ts';
import { hydrateCore, serializeCore, serializeCoreV7 } from '../src/save/save.ts';
import { WorldFoundation } from '../src/world/foundation/WorldFoundation.ts';
import { resolveWorldGenerationConfig } from '../src/world/generation/WorldGenerationConfig.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

test('direct terrain construction stays exact and emits no world generation or migration diagnostic', () => {
  const terrain = flatTerrain();
  const before = terrain.snapshot();
  const core = new SimulationCore({ terrain, seed: 17 });
  assert.equal(core.world.mode, 'legacy-explicit');
  assert.deepEqual(core.terrain.snapshot(), before);
  assert.equal(core.world.preparationMultiplierAt(2, 2), 1);
  assert.equal(core.terrain.isBuildable(2, 2), true);
  assert.deepEqual(core.kernel.events.list().filter((event) => event.type.startsWith('World')), []);
});

test('generated SimulationCore owns generated-1r world and emits one WorldGenerated diagnostic', () => {
  const core = new SimulationCore({ width: 16, height: 10, seed: 42 });
  assert.equal(core.world.mode, 'generated-1r');
  const sample = core.world.terrainSampleAt(3, 3);
  assert.ok(Number.isFinite(sample.elevationMeters));
  assert.ok(sample.watershedId.length > 0);
  assert.deepEqual(core.kernel.snapshots.capture('world'), core.world.diagnosticSnapshot());
  assert.deepEqual(core.kernel.events.list().map((event) => event.type), ['WorldGenerated']);
});

test('one design storm emits exact start/resolved ordering and returns deterministic result', () => {
  const core = new SimulationCore({ width: 16, height: 10, seed: 51 });
  core.kernel.events.clearDiagnosticHistory();
  const event = { id: 'storm:80', rainfallMm: 80, durationHours: 2 } as const;
  const first = core.runDesignStorm(event);
  const entries = core.kernel.events.list();
  assert.deepEqual(entries.map((entry) => entry.type), ['FloodEventStarted', 'FloodEventResolved']);
  assert.equal((entries[1]!.payload as { eventId: string }).eventId, 'storm:80');
  core.kernel.events.clearDiagnosticHistory();
  const second = core.runDesignStorm(event);
  assert.deepEqual(second, first);
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

test('V7 current hydration records exactly one migration diagnostic while V8 load records none', () => {
  const source = new SimulationCore({ terrain: flatTerrain(), seed: 81 });
  const migrated = hydrateCore(structuredClone(serializeCoreV7(source)));
  const migrationEvents = migrated.kernel.events.list().filter((event) => event.type === 'WorldMigratedTo1R');
  assert.equal(migrationEvents.length, 1);
  assert.deepEqual(migrationEvents[0]!.payload, { fromSaveVersion: 7, mode: 'legacy-flat' });

  const v8Loaded = hydrateCore(structuredClone(serializeCore(new SimulationCore({ width: 12, height: 8, seed: 82 }))));
  assert.equal(v8Loaded.kernel.events.list().some((event) => event.type === 'WorldMigratedTo1R' || event.type === 'WorldGenerated'), false);
});
