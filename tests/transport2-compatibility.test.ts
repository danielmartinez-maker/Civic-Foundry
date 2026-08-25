import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadCell } from '../src/world/roads/RoadSystem.ts';
import { TransportationGraph } from '../src/simulation/traffic/TransportationGraph.ts';
import { PathfindingSystem } from '../src/simulation/traffic/PathfindingSystem.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { LegacyTransportationGraphAdapter } from '../src/simulation/transportation/LegacyTransportationGraphAdapter.ts';

function flatTerrain(width = 12, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function roads(cells: readonly RoadCell[], revision = 11): RoadSystem {
  const system = new RoadSystem(flatTerrain());
  system.restore(cells, revision);
  return system;
}

function parity(
  roadSystem: RoadSystem,
  startNodeId: string,
  endNodeId: string,
): Readonly<{ direct: TransportationGraph; projected: TransportationGraph }> {
  const direct = new TransportationGraph();
  assert.equal(direct.rebuildIfNeeded(roadSystem), true);

  const legacyProjection = new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(roadSystem);
  const projection = new LegacyTransportationGraphAdapter().project(legacyProjection);
  const projected = new TransportationGraph();
  assert.equal(projected.loadProjection(projection), true);
  assert.equal(projected.loadProjection(projection), false, 'identical compatibility projection must be a no-op');

  assert.deepEqual(projected.nodes, direct.nodes);
  assert.deepEqual(projected.edges, direct.edges);
  assert.equal(projected.sourceRoadRevision, direct.sourceRoadRevision);

  const directRoute = new PathfindingSystem().findRoute(direct, startNodeId, endNodeId);
  const projectedRoute = new PathfindingSystem().findRoute(projected, startNodeId, endNodeId);
  assert.deepEqual(projectedRoute, directRoute);
  return { direct, projected };
}

test('local-road 3R compatibility projection is field-for-field identical to V7 graph', () => {
  parity(roads([
    { x: 1, y: 1, type: 'local' },
    { x: 2, y: 1, type: 'local' },
    { x: 3, y: 1, type: 'local' },
    { x: 4, y: 1, type: 'local' },
  ]), 'n:1,1', 'n:4,1');
});

test('isolated legacy road cell remains a valid V7-compatible isolated node', () => {
  const { direct, projected } = parity(roads([
    { x: 8, y: 8, type: 'arterial' },
  ], 14), 'n:8,8', 'n:8,8');
  assert.deepEqual(direct.nodes, [{ id: 'n:8,8', x: 8, y: 8, roadType: 'arterial' }]);
  assert.deepEqual(projected.nodes, direct.nodes);
  assert.deepEqual(projected.edges, []);
});

test('mixed local collector arterial projection preserves source-cell directional edge semantics', () => {
  const { direct } = parity(roads([
    { x: 2, y: 2, type: 'local' },
    { x: 3, y: 2, type: 'collector' },
    { x: 4, y: 2, type: 'arterial' },
    { x: 5, y: 2, type: 'local' },
  ], 12), 'n:2,2', 'n:5,2');

  const forward = direct.getEdge('e:n:2,2>n:3,2');
  const reverse = direct.getEdge('e:n:3,2>n:2,2');
  assert.ok(forward && reverse);
  assert.equal(forward.roadType, 'local');
  assert.equal(forward.capacityPerMinute, 60);
  assert.equal(reverse.roadType, 'collector');
  assert.equal(reverse.capacityPerMinute, 120);
});

test('four-way intersection projection preserves every V7 node edge and route choice', () => {
  parity(roads([
    { x: 5, y: 4, type: 'collector' },
    { x: 4, y: 5, type: 'local' },
    { x: 5, y: 5, type: 'arterial' },
    { x: 6, y: 5, type: 'collector' },
    { x: 5, y: 6, type: 'local' },
  ], 13), 'n:5,4', 'n:6,5');
});

test('road removal rebuilds both graphs to the same surviving topology and revision source', () => {
  const roadSystem = roads([
    { x: 1, y: 7, type: 'arterial' },
    { x: 2, y: 7, type: 'arterial' },
    { x: 3, y: 7, type: 'collector' },
    { x: 4, y: 7, type: 'local' },
  ], 20);

  parity(roadSystem, 'n:1,7', 'n:4,7');
  assert.ok(roadSystem.remove(4, 7));
  const { direct, projected } = parity(roadSystem, 'n:1,7', 'n:3,7');
  assert.equal(direct.getNode('n:4,7'), undefined);
  assert.equal(projected.getNode('n:4,7'), undefined);
  assert.equal(direct.sourceRoadRevision, 21);
  assert.equal(projected.sourceRoadRevision, 21);
});