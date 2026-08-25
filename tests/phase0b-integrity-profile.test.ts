import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

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

type CoreInternals = SimulationCore & { syncEntityProjection: () => void };
type MutableInvariantRunner = { runDue: (...args: unknown[]) => void };

function elapsed(core: SimulationCore): number {
  const start = performance.now();
  core.step(5000);
  return performance.now() - start;
}

function run(mode: 'no-sync' | 'sync-no-invariants' | 'normal'): number {
  const core = buildCity() as CoreInternals;
  if (mode === 'no-sync') core.syncEntityProjection = () => {};
  if (mode === 'sync-no-invariants') {
    (core.kernel.invariants as unknown as MutableInvariantRunner).runDue = () => {};
  }
  const ms = elapsed(core);
  assert.equal(core.clock.tick, 5000);
  return ms;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

test('profile changed-partition commit cost separately from invariant cost', () => {
  const values: Record<'no-sync' | 'sync-no-invariants' | 'normal', number[]> = {
    'no-sync': [],
    'sync-no-invariants': [],
    normal: [],
  };
  const orders = [
    ['no-sync', 'sync-no-invariants', 'normal'],
    ['sync-no-invariants', 'normal', 'no-sync'],
    ['normal', 'no-sync', 'sync-no-invariants'],
  ] as const;

  for (const order of orders) {
    for (const mode of order) values[mode].push(run(mode));
  }

  const noSyncMedian = median(values['no-sync']);
  const syncNoInvariantsMedian = median(values['sync-no-invariants']);
  const normalMedian = median(values.normal);
  console.log('PHASE0B_INTEGRITY_PROFILE', JSON.stringify({
    noSync: values['no-sync'].map((x) => Number(x.toFixed(2))),
    syncNoInvariants: values['sync-no-invariants'].map((x) => Number(x.toFixed(2))),
    normal: values.normal.map((x) => Number(x.toFixed(2))),
    noSyncMedian: Number(noSyncMedian.toFixed(2)),
    syncNoInvariantsMedian: Number(syncNoInvariantsMedian.toFixed(2)),
    normalMedian: Number(normalMedian.toFixed(2)),
    syncCommitAddedMs: Number((syncNoInvariantsMedian - noSyncMedian).toFixed(2)),
    invariantAddedMs: Number((normalMedian - syncNoInvariantsMedian).toFixed(2)),
  }));
});
