import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { LegacyV7EntityProjector } from '../src/entities/LegacyV7EntityProjector.ts';

function flat(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5, water: false, buildable: true, biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildCity(seed: number): SimulationCore {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 2_000_000, seed });
  core.buildRoad(Array.from({ length: 40 }, (_, x) => ({ x, y: 12 })), 'collector');
  for (let x = 4; x <= 14; x++) core.paintZone([{ x, y: 11 }], 'residential');
  for (let x = 20; x <= 27; x++) core.paintZone([{ x, y: 11 }], 'commercial');
  for (let x = 28; x <= 36; x++) core.paintZone([{ x, y: 11 }], 'industrial');
  for (const [x, y] of [[6, 13], [10, 13], [14, 13]] as const) core.placeUtility('power', x, y);
  for (const [x, y] of [[18, 13], [22, 13], [26, 13]] as const) core.placeUtility('water', x, y);
  for (const [x, y] of [[30, 13], [33, 13], [36, 13]] as const) core.placeUtility('landfill', x, y);
  return core;
}

type CoreInternals = SimulationCore & {
  syncEntityProjection: () => void;
  entityProjector: LegacyV7EntityProjector;
};

function timed(core: SimulationCore, ticks = 5000): number {
  const start = performance.now();
  core.step(ticks);
  return performance.now() - start;
}

test('profile Phase 0B projector, registry and full-sync layer costs', () => {
  const noop = buildCity(120) as CoreInternals;
  noop.syncEntityProjection = () => {};
  const noSyncMs = timed(noop);

  const projectorOnly = buildCity(120) as CoreInternals;
  projectorOnly.syncEntityProjection = () => {
    projectorOnly.entityProjector.project(projectorOnly);
  };
  const projectorMs = timed(projectorOnly);

  const registryOnly = buildCity(120) as CoreInternals;
  registryOnly.syncEntityProjection = () => {
    const projection = registryOnly.entityProjector.project(registryOnly);
    registryOnly.entityRegistry.commitPrepared(
      registryOnly.entityRegistry.prepareProjection(projection.entities),
    );
  };
  const registryMs = timed(registryOnly);

  const full = buildCity(120);
  const fullMs = timed(full);

  console.log('PHASE0B_LAYER_PROFILE', JSON.stringify({
    noSyncMs: Number(noSyncMs.toFixed(2)),
    projectorMs: Number(projectorMs.toFixed(2)),
    registryMs: Number(registryMs.toFixed(2)),
    fullMs: Number(fullMs.toFixed(2)),
    projectorAddedMs: Number((projectorMs - noSyncMs).toFixed(2)),
    registryAddedMs: Number((registryMs - projectorMs).toFixed(2)),
    graphAndValidationAddedMs: Number((fullMs - registryMs).toFixed(2)),
  }));
  assert.equal(noop.clock.tick, 5000);
  assert.equal(projectorOnly.clock.tick, 5000);
  assert.equal(registryOnly.clock.tick, 5000);
  assert.equal(full.clock.tick, 5000);
});
