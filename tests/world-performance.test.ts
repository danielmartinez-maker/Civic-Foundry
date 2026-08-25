import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { RandomStreamRegistry } from '../src/simulation/kernel/RandomStreamRegistry.ts';
import { WorldFoundation } from '../src/world/foundation/WorldFoundation.ts';
import {
  WORLD_FORM_PRESETS,
  resolveWorldGenerationConfig,
  type WorldFormPreset,
} from '../src/world/generation/WorldGenerationConfig.ts';
import type { GeographyKind } from '../src/world/geography/GeographyTypes.ts';

const WIDTH = 96;
const HEIGHT = 64;
const QUERY_COUNT = 10_000;
const DIRECT_SAMPLE_COUNT = 500;
const QUERY_KINDS = Object.freeze(['block', 'neighborhood', 'district'] as const satisfies readonly GeographyKind[]);

function generatedWorld(seed: number, preset: WorldFormPreset): WorldFoundation {
  const config = resolveWorldGenerationConfig({ width: WIDTH, height: HEIGHT, preset });
  return WorldFoundation.generate({ seed, config, randomRegistry: new RandomStreamRegistry(seed) });
}

function queryPoints(): readonly Readonly<{ x: number; y: number }>[] {
  return Object.freeze(Array.from({ length: QUERY_COUNT }, (_, index) => Object.freeze({
    x: ((index * 37) % WIDTH) + 0.5,
    y: ((index * 53) % HEIGHT) + 0.5,
  })));
}

test('1R spatial index resolves 10,000 hierarchy queries within the acceptance budget and matches direct hierarchy lookups', () => {
  const world = generatedWorld(14_041, 'rolling_uplands');
  const points = queryPoints();

  const startedAt = performance.now();
  for (const point of points) {
    for (const kind of QUERY_KINDS) {
      const indexed = world.spatialIndex.entitiesAt(point, kind);
      assert.equal(indexed.length, 1, `expected one ${kind} at ${point.x},${point.y}`);
    }
  }
  const indexedElapsedMs = performance.now() - startedAt;
  assert.ok(indexedElapsedMs < 2500, `10,000 indexed hierarchy queries took ${indexedElapsedMs.toFixed(2)}ms`);

  for (const point of points.slice(0, DIRECT_SAMPLE_COUNT)) {
    for (const kind of QUERY_KINDS) {
      const indexedIds = world.spatialIndex.entitiesAt(point, kind).map((entity) => entity.id);
      const direct = world.geography.entityAt(point, kind);
      assert.deepEqual(indexedIds, direct ? [direct.id] : [], `indexed/direct mismatch for ${kind} at ${point.x},${point.y}`);
    }
  }

  console.log('WORLD_SPATIAL_INDEX_PERF', { queryCount: QUERY_COUNT, kinds: QUERY_KINDS.length, indexedElapsedMs });
});

test('all six 1R world presets generate finite valid 96x64 worlds', () => {
  const diagnostics: Record<string, Readonly<{ elapsedMs: number; watersheds: number; channels: number }>> = {};

  for (const [index, preset] of WORLD_FORM_PRESETS.entries()) {
    const seed = 20_000 + index;
    const startedAt = performance.now();
    const world = generatedWorld(seed, preset);
    const elapsedMs = performance.now() - startedAt;
    const diagnostic = world.diagnosticSnapshot();

    assert.equal(world.terrain.width, WIDTH);
    assert.equal(world.terrain.height, HEIGHT);
    assert.equal(world.mode, 'generated-1r');
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
    assert.ok(diagnostic.watersheds > 0);
    assert.ok(diagnostic.channels >= 0);
    assert.equal(world.geography.list('region').length, 1);
    assert.ok(world.geography.list('municipality').length > 0);
    assert.ok(world.geography.list('district').length > 0);
    assert.ok(world.geography.list('neighborhood').length > 0);
    assert.ok(world.geography.list('block').length > 0);

    const sample = world.terrainSampleAt((index * 17) % WIDTH, (index * 23) % HEIGHT);
    assert.ok(Number.isFinite(sample.elevationMeters));
    assert.ok(Number.isFinite(sample.slope));
    assert.ok(Number.isFinite(sample.landPreparationMultiplier));

    diagnostics[preset] = Object.freeze({
      elapsedMs,
      watersheds: diagnostic.watersheds,
      channels: diagnostic.channels,
    });
  }

  console.log('WORLD_PRESET_GENERATION_DIAGNOSTICS', diagnostics);
});

test('5,000 ordinary simulation ticks leave the generated authoritative world unchanged', () => {
  const core = new SimulationCore({ width: 24, height: 16, seed: 51_000, worldConfig: { preset: 'basin' } });
  const before = core.world.snapshotAuthoritative();

  core.step(5000);

  assert.deepEqual(core.world.snapshotAuthoritative(), before);
});
