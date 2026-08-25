import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { EntityKind, ProjectedEntity } from '../src/entities/EntityTypes.ts';
import type { EntityReference, PreparedReferencePartition } from '../src/entities/EntityReferenceGraph.ts';
import type { KnownEntityView, PreparedEntityPartitionProjection } from '../src/entities/EntityRegistry.ts';

function flat(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
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
type Timing = { ms: number; calls: number; refs: number; removals: number };
function timer(): Timing { return { ms: 0, calls: 0, refs: 0, removals: 0 }; }
function round(value: number): number { return Number(value.toFixed(2)); }

test('profile current Phase 0B sync methods with invariants disabled', () => {
  const core = buildCity() as CoreInternals;
  (core.kernel.invariants as unknown as MutableInvariantRunner).runDue = () => {};
  const sync = timer(), projector = timer(), registryPrepare = timer(), registryCommit = timer();
  const graphFullPrepare = timer(), graphDeltaPrepare = timer(), graphCommit = timer();
  const projectorObject = (core as unknown as { entityProjector: { projectPartitions: (source: SimulationCore) => unknown } }).entityProjector;
  const originalProjectPartitions = projectorObject.projectPartitions.bind(projectorObject);
  projectorObject.projectPartitions = (source: SimulationCore) => { const s = performance.now(); try { return originalProjectPartitions(source); } finally { projector.ms += performance.now() - s; projector.calls++; } };
  const registry = core.entityRegistry as unknown as {
    preparePartitionProjection: (kinds: readonly EntityKind[], entities: readonly ProjectedEntity[]) => PreparedEntityPartitionProjection;
    commitPreparedPartitions: (prepared: readonly PreparedEntityPartitionProjection[]) => void;
  };
  const rp = registry.preparePartitionProjection.bind(registry);
  registry.preparePartitionProjection = (k,e) => { const s=performance.now(); try{return rp(k,e);}finally{registryPrepare.ms+=performance.now()-s;registryPrepare.calls++;} };
  const rc = registry.commitPreparedPartitions.bind(registry);
  registry.commitPreparedPartitions = (p) => { const s=performance.now(); try{return rc(p);}finally{registryCommit.ms+=performance.now()-s;registryCommit.calls++;} };
  const graph = core.entityReferences as unknown as {
    preparePartition:(k:readonly EntityKind[],r:readonly EntityReference[],v:KnownEntityView)=>PreparedReferencePartition;
    prepareSourceDelta:(k:readonly EntityKind[],r:readonly EntityReference[],x:readonly string[],v:KnownEntityView)=>PreparedReferencePartition;
    commitPreparedPartitions:(p:readonly PreparedReferencePartition[])=>void;
  };
  const gp=graph.preparePartition.bind(graph);
  graph.preparePartition=(k,r,v)=>{const s=performance.now();try{return gp(k,r,v);}finally{graphFullPrepare.ms+=performance.now()-s;graphFullPrepare.calls++;graphFullPrepare.refs+=r.length;}};
  const gd=graph.prepareSourceDelta.bind(graph);
  graph.prepareSourceDelta=(k,r,x,v)=>{const s=performance.now();try{return gd(k,r,x,v);}finally{graphDeltaPrepare.ms+=performance.now()-s;graphDeltaPrepare.calls++;graphDeltaPrepare.refs+=r.length;graphDeltaPrepare.removals+=x.length;}};
  const gc=graph.commitPreparedPartitions.bind(graph);
  graph.commitPreparedPartitions=(p)=>{const s=performance.now();try{return gc(p);}finally{graphCommit.ms+=performance.now()-s;graphCommit.calls++;}};
  const os=core.syncEntityProjection.bind(core);
  core.syncEntityProjection=()=>{const s=performance.now();try{os();}finally{sync.ms+=performance.now()-s;sync.calls++;}};
  const start=performance.now(); core.step(5000); const totalMs=performance.now()-start;
  const accounted=projector.ms+registryPrepare.ms+registryCommit.ms+graphFullPrepare.ms+graphDeltaPrepare.ms+graphCommit.ms;
  console.log('PHASE0B_CURRENT_METHOD_PROFILE',JSON.stringify({totalMs:round(totalMs),syncMs:round(sync.ms),syncCalls:sync.calls,projectorMs:round(projector.ms),projectorCalls:projector.calls,registryPrepareMs:round(registryPrepare.ms),registryPrepareCalls:registryPrepare.calls,graphFullPrepareMs:round(graphFullPrepare.ms),graphFullPrepareCalls:graphFullPrepare.calls,graphDeltaPrepareMs:round(graphDeltaPrepare.ms),graphDeltaPrepareCalls:graphDeltaPrepare.calls,graphDeltaPrepareRefs:graphDeltaPrepare.refs,registryCommitMs:round(registryCommit.ms),graphCommitMs:round(graphCommit.ms),coordinatorResidualMs:round(sync.ms-accounted)}));
  assert.equal(core.clock.tick,5000);
});
