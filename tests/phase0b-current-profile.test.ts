import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { commitEntityProjectionPartitions, type EntityProjectionPartition } from '../src/entities/EntityProjection.ts';
import type { LegacyV7EntityProjector } from '../src/entities/LegacyV7EntityProjector.ts';

function flat(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5, water: false, buildable: true, biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildCity(seed = 120): SimulationCore {
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

function time(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function timeStep(core: SimulationCore, ticks = 5000): number {
  return time(() => core.step(ticks));
}

function revisionMap(parts: readonly EntityProjectionPartition[]): Map<string, string> {
  return new Map(parts.map((part) => [part.id, part.revisionKey] as const));
}

test('profile current Phase 0B partitioned sync hot path without changing production behavior', () => {
  const noSync = buildCity() as CoreInternals;
  noSync.syncEntityProjection = () => {};
  const noSyncMs = timeStep(noSync);

  const projectorOnly = buildCity() as CoreInternals;
  projectorOnly.syncEntityProjection = () => {
    projectorOnly.entityProjector.projectPartitions(projectorOnly);
  };
  const projectorOnlyMs = timeStep(projectorOnly);

  const full = buildCity();
  const registryRevisionBefore = full.entityRegistry.commitRevision;
  const graphRevisionBefore = full.entityReferences.commitRevision;
  const fullMs = timeStep(full);
  const entityCommits = full.entityRegistry.commitRevision - registryRevisionBefore;
  const graphCommits = full.entityReferences.commitRevision - graphRevisionBefore;

  const stable = buildCity() as CoreInternals;
  const stableParts = stable.entityProjector.projectPartitions(stable);
  const stableProjector5000Ms = time(() => {
    for (let i = 0; i < 5000; i++) stable.entityProjector.projectPartitions(stable);
  });
  const stableCommit5000Ms = time(() => {
    for (let i = 0; i < 5000; i++) {
      commitEntityProjectionPartitions(stable.entityRegistry, stable.entityReferences, stableParts);
    }
  });

  const counted = buildCity() as CoreInternals;
  const projector = counted.entityProjector as LegacyV7EntityProjector & {
    projectPartitions: (source: CoreInternals) => readonly EntityProjectionPartition[];
  };
  const originalProjectPartitions = projector.projectPartitions.bind(projector);
  let previous = revisionMap(originalProjectPartitions(counted));
  const changedByPartition = new Map<string, number>();
  let changedTicks = 0;
  projector.projectPartitions = (source: CoreInternals) => {
    const parts = originalProjectPartitions(source);
    let anyChanged = false;
    for (const part of parts) {
      if (previous.get(part.id) !== part.revisionKey) {
        changedByPartition.set(part.id, (changedByPartition.get(part.id) ?? 0) + 1);
        anyChanged = true;
      }
    }
    if (anyChanged) changedTicks++;
    previous = revisionMap(parts);
    return parts;
  };
  counted.step(5000);

  const changedPartitionCounts = Object.fromEntries([...changedByPartition.entries()].sort(([a], [b]) => a.localeCompare(b)));
  console.log('PHASE0B_CURRENT_PROFILE', JSON.stringify({
    noSyncMs: Number(noSyncMs.toFixed(2)),
    projectorOnlyMs: Number(projectorOnlyMs.toFixed(2)),
    fullMs: Number(fullMs.toFixed(2)),
    projectorAddedMs: Number((projectorOnlyMs - noSyncMs).toFixed(2)),
    commitAndIntegrityAddedMs: Number((fullMs - projectorOnlyMs).toFixed(2)),
    stableProjector5000Ms: Number(stableProjector5000Ms.toFixed(2)),
    stableCommit5000Ms: Number(stableCommit5000Ms.toFixed(2)),
    entityCommits,
    graphCommits,
    changedTicks,
    changedPartitionCounts,
  }));

  assert.equal(noSync.clock.tick, 5000);
  assert.equal(projectorOnly.clock.tick, 5000);
  assert.equal(full.clock.tick, 5000);
  assert.equal(counted.clock.tick, 5000);
  assert.equal(entityCommits, graphCommits);
});
