import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';

function flatTerrain(width = 12, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function laneCapacityFor(projected: ReturnType<LegacyRoadNetworkAdapter['projectIfNeeded']>, carriagewayId: string): number {
  return projected.physical.lanes
    .filter((lane) => lane.carriagewayId === carriagewayId)
    .reduce((sum, lane) => sum + lane.baseCapacityPerMinute, 0);
}

test('legacy projection creates stable junction, segment, carriageway, and lane identities', () => {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 2, y: 5, type: 'local' },
    { x: 3, y: 5, type: 'local' },
    { x: 4, y: 5, type: 'local' },
  ], 7);

  const projected = new LegacyRoadNetworkAdapter().projectIfNeeded(roads);
  assert.deepEqual(projected.physical.junctions.map((item) => item.id), ['j:legacy:2,5', 'j:legacy:3,5', 'j:legacy:4,5']);
  assert.deepEqual(projected.physical.segments.map((item) => item.id), [
    's:legacy:2,5>3,5',
    's:legacy:3,5>4,5',
  ]);
  assert.equal(projected.physical.carriageways.length, 4);
  assert.equal(projected.physical.lanes.length, 4);
  assert.equal(projected.sourceRoadRevision, 7);
});

test('legacy directional lane capacity exactly conserves existing aggregate capacity', () => {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 2, y: 5, type: 'local' },
    { x: 3, y: 5, type: 'collector' },
  ], 3);

  const projected = new LegacyRoadNetworkAdapter().projectIfNeeded(roads);
  const forward = projected.physical.carriageways.find((item) => item.fromJunctionId === 'j:legacy:2,5' && item.toJunctionId === 'j:legacy:3,5');
  const reverse = projected.physical.carriageways.find((item) => item.fromJunctionId === 'j:legacy:3,5' && item.toJunctionId === 'j:legacy:2,5');
  assert.ok(forward);
  assert.ok(reverse);
  assert.equal(forward.operatingClass, 'local');
  assert.equal(reverse.operatingClass, 'collector');
  assert.equal(forward.laneIds.length, 1);
  assert.equal(reverse.laneIds.length, 2);
  assert.equal(laneCapacityFor(projected, forward.id), 60);
  assert.equal(laneCapacityFor(projected, reverse.id), 120);
  assert.equal(projected.physical.segments[0]?.roadClass, 'collector');
});

test('legacy projection preserves source-cell speed asymmetry', () => {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 5, y: 5, type: 'collector' },
    { x: 6, y: 5, type: 'arterial' },
  ], 1);
  const projected = new LegacyRoadNetworkAdapter().projectIfNeeded(roads);
  const forward = projected.physical.carriageways.find((item) => item.fromJunctionId === 'j:legacy:5,5');
  const reverse = projected.physical.carriageways.find((item) => item.fromJunctionId === 'j:legacy:6,5');
  assert.ok(forward);
  assert.ok(reverse);
  const forwardLanes = projected.physical.lanes.filter((lane) => lane.carriagewayId === forward.id);
  const reverseLanes = projected.physical.lanes.filter((lane) => lane.carriagewayId === reverse.id);
  assert.equal(forward.operatingClass, 'collector');
  assert.equal(reverse.operatingClass, 'arterial');
  assert.equal(forwardLanes[0]?.freeFlowSpeedKph, 90);
  assert.equal(reverseLanes[0]?.freeFlowSpeedKph, 144);
});

test('unchanged road revisions reuse the same projection and road removal invalidates it', () => {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 1, y: 1, type: 'local' },
    { x: 2, y: 1, type: 'local' },
    { x: 3, y: 1, type: 'local' },
  ], 10);
  const adapter = new LegacyRoadNetworkAdapter();
  const first = adapter.projectIfNeeded(roads);
  const afterFirst = adapter.diagnostics;
  const second = adapter.projectIfNeeded(roads);
  assert.strictEqual(second, first);
  assert.deepEqual(adapter.diagnostics, afterFirst);

  roads.remove(2, 1);
  const rebuilt = adapter.projectIfNeeded(roads);
  assert.notStrictEqual(rebuilt, first);
  assert.equal(rebuilt.physical.segments.length, 0);
  assert.equal(adapter.diagnostics.builds, afterFirst.builds + 1);
});
