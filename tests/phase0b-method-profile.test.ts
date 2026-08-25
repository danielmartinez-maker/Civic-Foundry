import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { EntityKind } from '../src/entities/EntityTypes.ts';
import type { ProjectedEntity } from '../src/entities/EntityTypes.ts';
import type { EntityReference } from '../src/entities/EntityReferenceGraph.ts';
import type { KnownEntityView, PreparedEntityPartitionProjection } from '../src/entities/EntityRegistry.ts';
import type { PreparedReferencePartition } from '../src/entities/EntityReferenceGraph.ts';

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

type MutableInvariantRunner = { runDue: (...args: unknown[]) => void };
type CoreInternals = SimulationCore & { syncEntityProjection: () => void };

type Timing = { ms: number; calls: number };
function timer(): Timing { return { ms: 0, calls: 0 }; }
function round(value: number): number { return Number(value.toFixed(2)); }

test('profile exact Phase 0B sync method costs with invariants disabled', () => {
  const core = buildCity() as CoreInternals;
  (core.kernel.invariants as unknown as MutableInvariantRunner).runDue = () => {};

  const sync = timer();
  const projector = timer();
  const registryPrepare = timer();
  const registryCommit = timer();
  const graphPrepare = timer();
  const graphCommit = timer();

  const projectorObject = (core as unknown as { entityProjector: { projectPartitions: (source: SimulationCore) => unknown } }).entityProjector;
  const originalProjectPartitions = projectorObject.projectPartitions.bind(projectorObject);
  projectorObject.projectPartitions = (source: SimulationCore) => {
    const start = performance.now();
    try { return originalProjectPartitions(source); }
    finally { projector.ms += performance.now() - start; projector.calls++; }
  };

  const registry = core.entityRegistry as unknown as {
    preparePartitionProjection: (kinds: readonly EntityKind[], entities: readonly ProjectedEntity[]) => PreparedEntityPartitionProjection;
    commitPreparedPartitions: (prepared: readonly PreparedEntityPartitionProjection[]) => void;
  };
  const originalRegistryPrepare = registry.preparePartitionProjection.bind(registry);
  registry.preparePartitionProjection = (kinds, entities) => {
    const start = performance.now();
    try { return originalRegistryPrepare(kinds, entities); }
    finally { registryPrepare.ms += performance.now() - start; registryPrepare.calls++; }
  };
  const originalRegistryCommit = registry.commitPreparedPartitions.bind(registry);
  registry.commitPreparedPartitions = (prepared) => {
    const start = performance.now();
    try { return originalRegistryCommit(prepared); }
    finally { registryCommit.ms += performance.now() - start; registryCommit.calls++; }
  };

  const graph = core.entityReferences as unknown as {
    preparePartition: (kinds: readonly EntityKind[], references: readonly EntityReference[], view: KnownEntityView) => PreparedReferencePartition;
    commitPreparedPartitions: (prepared: readonly PreparedReferencePartition[]) => void;
  };
  const originalGraphPrepare = graph.preparePartition.bind(graph);
  graph.preparePartition = (kinds, references, view) => {
    const start = performance.now();
    try { return originalGraphPrepare(kinds, references, view); }
    finally { graphPrepare.ms += performance.now() - start; graphPrepare.calls++; }
  };
  const originalGraphCommit = graph.commitPreparedPartitions.bind(graph);
  graph.commitPreparedPartitions = (prepared) => {
    const start = performance.now();
    try { return originalGraphCommit(prepared); }
    finally { graphCommit.ms += performance.now() - start; graphCommit.calls++; }
  };

  const originalSync = core.syncEntityProjection.bind(core);
  core.syncEntityProjection = () => {
    const start = performance.now();
    try { originalSync(); }
    finally { sync.ms += performance.now() - start; sync.calls++; }
  };

  const totalStart = performance.now();
  core.step(5000);
  const totalMs = performance.now() - totalStart;
  const accountedMs = projector.ms + registryPrepare.ms + registryCommit.ms + graphPrepare.ms + graphCommit.ms;

  console.log('PHASE0B_METHOD_PROFILE', JSON.stringify({
    totalMs: round(totalMs),
    syncMs: round(sync.ms), syncCalls: sync.calls,
    projectorMs: round(projector.ms), projectorCalls: projector.calls,
    registryPrepareMs: round(registryPrepare.ms), registryPrepareCalls: registryPrepare.calls,
    graphPrepareMs: round(graphPrepare.ms), graphPrepareCalls: graphPrepare.calls,
    registryCommitMs: round(registryCommit.ms), registryCommitCalls: registryCommit.calls,
    graphCommitMs: round(graphCommit.ms), graphCommitCalls: graphCommit.calls,
    coordinatorResidualMs: round(sync.ms - accountedMs),
  }));

  assert.equal(core.clock.tick, 5000);
  assert.equal(sync.calls, 5000);
  assert.ok(sync.ms >= 0);
});
