import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadCell } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { LegacyTransportationGraphAdapter } from '../src/simulation/transportation/LegacyTransportationGraphAdapter.ts';
import { TransportNetworkStore } from '../src/simulation/transportation/TransportNetworkStore.ts';
import { buildLaneGroups } from '../src/simulation/transportation/LaneGroupBuilder.ts';
import { buildRoutingTopology } from '../src/simulation/transportation/RoutingTopology.ts';
import { MovementAwarePathfindingSystem } from '../src/simulation/transportation/MovementAwarePathfindingSystem.ts';
import {
  VEHICLE_PERMISSION,
  type TransportNetworkAuthority,
} from '../src/simulation/transportation/TransportNetworkTypes.ts';

function flatTerrain(width: number, height: number): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function reversedAuthority(authority: TransportNetworkAuthority): TransportNetworkAuthority {
  return {
    junctions: [...authority.junctions].reverse(),
    segments: [...authority.segments].reverse().map((segment) => ({
      ...segment,
      carriagewayIds: [...segment.carriagewayIds].reverse(),
      ...(segment.sourceLegacyCells ? { sourceLegacyCells: [...segment.sourceLegacyCells].reverse() } : {}),
    })),
    carriageways: [...authority.carriageways].reverse().map((carriageway) => ({
      ...carriageway,
      laneIds: [...carriageway.laneIds].reverse(),
    })),
    lanes: [...authority.lanes].reverse(),
    movements: [...authority.movements].reverse().map((movement) => ({
      ...movement,
      fromLaneIds: [...movement.fromLaneIds].reverse(),
      toLaneIds: [...movement.toLaneIds].reverse(),
    })),
  };
}

test('canonical authority snapshots and route results are byte-identical under shuffled input order', () => {
  const roads = new RoadSystem(flatTerrain(10, 10));
  roads.restore([
    { x: 4, y: 3, type: 'collector' },
    { x: 3, y: 4, type: 'local' },
    { x: 4, y: 4, type: 'arterial' },
    { x: 5, y: 4, type: 'collector' },
    { x: 4, y: 5, type: 'local' },
  ], 8);

  const authority = new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(roads).authority;
  const storeA = new TransportNetworkStore();
  const storeB = new TransportNetworkStore();
  assert.deepEqual(storeA.replaceAuthority(authority), { ok: true, changed: true });
  assert.deepEqual(storeB.replaceAuthority(reversedAuthority(authority)), { ok: true, changed: true });

  const snapshotA = storeA.snapshot();
  const snapshotB = storeB.snapshot();
  assert.equal(JSON.stringify(snapshotA), JSON.stringify(snapshotB));

  const topologyA = buildRoutingTopology(snapshotA, buildLaneGroups(snapshotA));
  const topologyB = buildRoutingTopology(snapshotB, buildLaneGroups(snapshotB));
  assert.equal(JSON.stringify(topologyA.states), JSON.stringify(topologyB.states));
  assert.equal(JSON.stringify(topologyA.arcs), JSON.stringify(topologyB.arcs));

  const routeA = new MovementAwarePathfindingSystem().findRoute(
    topologyA,
    'j:legacy:4,3',
    'j:legacy:5,4',
    { permissions: VEHICLE_PERMISSION.privateCar, costEpoch: snapshotA.costEpoch },
  );
  const routeB = new MovementAwarePathfindingSystem().findRoute(
    topologyB,
    'j:legacy:4,3',
    'j:legacy:5,4',
    { permissions: VEHICLE_PERMISSION.privateCar, costEpoch: snapshotB.costEpoch },
  );
  assert.ok(routeA);
  assert.equal(JSON.stringify(routeA), JSON.stringify(routeB));
});

test('10,000-road-cell legacy and compatibility projections stay bounded and reuse unchanged revisions', () => {
  const size = 100;
  const roadCells: RoadCell[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) roadCells.push({ x, y, type: 'local' });
  }

  const roads = new RoadSystem(flatTerrain(size, size));
  roads.restore(roadCells, 31);
  const adapter = new LegacyRoadNetworkAdapter();
  const started = performance.now();
  const first = adapter.projectIfNeeded(roads);
  const elapsedMs = performance.now() - started;

  assert.equal(first.physical.junctions.length, 10_000);
  assert.equal(first.physical.segments.length, 19_800);
  assert.equal(first.physical.carriageways.length, 39_600);
  assert.equal(first.physical.lanes.length, 39_600);
  assert.equal(adapter.diagnostics.roadCellsVisited, 10_000);
  assert.equal(adapter.diagnostics.adjacencyChecks, 40_000);
  assert.equal(adapter.diagnostics.builds, 1);

  const builds = adapter.diagnostics.builds;
  const second = adapter.projectIfNeeded(roads);
  assert.strictEqual(second, first);
  assert.equal(adapter.diagnostics.builds, builds);
  assert.equal(adapter.diagnostics.roadCellsVisited, 10_000);
  assert.equal(adapter.diagnostics.adjacencyChecks, 40_000);

  const directGraph = new TransportationGraph();
  const directStarted = performance.now();
  assert.equal(directGraph.rebuildIfNeeded(roads), true);
  const directElapsedMs = performance.now() - directStarted;

  const compatibilitySource = new LegacyRoadNetworkAdapter();
  const compatibilityStarted = performance.now();
  const authorityProjection = compatibilitySource.projectAuthorityIfNeeded(roads);
  const compatibilityProjection = new LegacyTransportationGraphAdapter().project(authorityProjection);
  const compatibilityElapsedMs = performance.now() - compatibilityStarted;

  assert.equal(authorityProjection.authority.movements.length, 117_608);
  assert.equal(compatibilityProjection.nodes.length, directGraph.nodes.length);
  assert.equal(compatibilityProjection.edges.length, directGraph.edges.length);
  assert.equal(compatibilityProjection.nodes.length, 10_000);
  assert.equal(compatibilityProjection.edges.length, 39_600);
  assert.equal(compatibilityProjection.sourceRoadRevision, 31);
  assert.equal(compatibilitySource.diagnostics.builds, 1);
  assert.equal(compatibilitySource.diagnostics.roadCellsVisited, 10_000);
  assert.equal(compatibilitySource.diagnostics.adjacencyChecks, 40_000);

  for (const index of [0, Math.floor(directGraph.nodes.length / 2), directGraph.nodes.length - 1]) {
    assert.deepEqual(compatibilityProjection.nodes[index], directGraph.nodes[index]);
  }
  for (const index of [0, Math.floor(directGraph.edges.length / 2), directGraph.edges.length - 1]) {
    assert.deepEqual(compatibilityProjection.edges[index], directGraph.edges[index]);
  }

  const authorityAgain = compatibilitySource.projectAuthorityIfNeeded(roads);
  assert.strictEqual(authorityAgain, authorityProjection);
  assert.equal(compatibilitySource.diagnostics.builds, 1);
  assert.equal(compatibilitySource.diagnostics.roadCellsVisited, 10_000);
  assert.equal(compatibilitySource.diagnostics.adjacencyChecks, 40_000);

  console.log('# TRANSPORT3R_NETWORK_SCALE', JSON.stringify({
    roadCells: 10_000,
    segments: first.physical.segments.length,
    carriageways: first.physical.carriageways.length,
    movements: authorityProjection.authority.movements.length,
    adjacencyChecks: adapter.diagnostics.adjacencyChecks,
    physicalProjectionMs: Number(elapsedMs.toFixed(2)),
    directV7GraphMs: Number(directElapsedMs.toFixed(2)),
    compatibilityPathMs: Number(compatibilityElapsedMs.toFixed(2)),
    compatibilityToDirectRatio: directElapsedMs > 0
      ? Number((compatibilityElapsedMs / directElapsedMs).toFixed(2))
      : null,
  }));
});
