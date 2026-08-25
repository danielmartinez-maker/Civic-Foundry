import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { buildLaneGroups } from '../src/simulation/transportation/LaneGroupBuilder.ts';
import {
  buildRoutingTopology,
  routingStateKey,
} from '../src/simulation/transportation/RoutingTopology.ts';
import {
  VEHICLE_PERMISSION,
  type TransportNetworkAuthority,
  type TransportNetworkSnapshot,
} from '../src/simulation/transportation/TransportNetworkTypes.ts';

function flatTerrain(width = 10, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function plusAuthority(): TransportNetworkAuthority {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 4, y: 3, type: 'local' },
    { x: 3, y: 4, type: 'local' },
    { x: 4, y: 4, type: 'local' },
    { x: 5, y: 4, type: 'local' },
    { x: 4, y: 5, type: 'local' },
  ], 1);
  return new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(roads).authority;
}

function snapshot(authority = plusAuthority(), topologyRevision = 7): TransportNetworkSnapshot {
  return { ...authority, topologyRevision, costEpoch: 0 };
}

function carriageway(authority: TransportNetworkAuthority, from: string, to: string): string {
  const match = authority.carriageways.find((item) => item.fromJunctionId === from && item.toJunctionId === to);
  assert.ok(match, `missing carriageway ${from} -> ${to}`);
  return match.id;
}

test('origin states expose deterministic outgoing carriageway traversal arcs', () => {
  const state = snapshot();
  const topology = buildRoutingTopology(state, buildLaneGroups(state));
  const center = { junctionId: 'j:legacy:4,4' } as const;
  const arcs = topology.outgoingArcs(center);

  assert.equal(topology.revision, 7);
  assert.equal(routingStateKey(center), 'j:legacy:4,4|-');
  assert.equal(arcs.length, 4);
  assert.deepEqual(arcs.map((arc) => arc.id), [...arcs.map((arc) => arc.id)].sort());
  assert.equal(arcs.every((arc) => arc.movementId === undefined && arc.movementPenaltyTicks === 0), true);
  assert.equal(arcs.every((arc) => arc.toState.incomingCarriagewayId === arc.carriagewayId), true);
});

test('entered states expose only explicit non-u-turn movement-backed arcs', () => {
  const authority = plusAuthority();
  const state = snapshot(authority);
  const topology = buildRoutingTopology(state, buildLaneGroups(state));
  const incoming = carriageway(authority, 'j:legacy:4,3', 'j:legacy:4,4');
  const reverse = carriageway(authority, 'j:legacy:4,4', 'j:legacy:4,3');
  const arcs = topology.outgoingArcs({ junctionId: 'j:legacy:4,4', incomingCarriagewayId: incoming });

  assert.equal(arcs.length, 3);
  assert.equal(arcs.every((arc) => arc.movementId !== undefined), true);
  assert.equal(arcs.some((arc) => arc.carriagewayId === reverse), false);
});

test('removing an authoritative movement removes connectivity despite physical adjacency', () => {
  const base = plusAuthority();
  const incoming = carriageway(base, 'j:legacy:4,3', 'j:legacy:4,4');
  const east = carriageway(base, 'j:legacy:4,4', 'j:legacy:5,4');
  const left = base.movements.find((movement) =>
    movement.fromCarriagewayId === incoming && movement.toCarriagewayId === east);
  assert.ok(left);

  const authority: TransportNetworkAuthority = {
    ...base,
    movements: base.movements.filter((movement) => movement.id !== left.id),
  };
  const state = snapshot(authority);
  const topology = buildRoutingTopology(state, buildLaneGroups(state));
  const arcs = topology.outgoingArcs({ junctionId: 'j:legacy:4,4', incomingCarriagewayId: incoming });

  assert.equal(arcs.some((arc) => arc.carriagewayId === east), false);
  assert.equal(arcs.length, 2);
});

test('movement permissions narrow routing arcs without fabricating broader access', () => {
  const base = plusAuthority();
  const incoming = carriageway(base, 'j:legacy:4,3', 'j:legacy:4,4');
  const east = carriageway(base, 'j:legacy:4,4', 'j:legacy:5,4');
  const target = base.movements.find((movement) =>
    movement.fromCarriagewayId === incoming && movement.toCarriagewayId === east);
  assert.ok(target);

  const authority: TransportNetworkAuthority = {
    ...base,
    movements: base.movements.map((movement) => movement.id === target.id
      ? { ...movement, permissions: VEHICLE_PERMISSION.bus }
      : movement),
  };
  const state = snapshot(authority);
  const topology = buildRoutingTopology(state, buildLaneGroups(state));
  const arc = topology.outgoingArcs({ junctionId: 'j:legacy:4,4', incomingCarriagewayId: incoming })
    .find((candidate) => candidate.carriagewayId === east);

  assert.ok(arc);
  assert.equal(arc.permissions, VEHICLE_PERMISSION.bus);
});

test('legacy traversal ticks reproduce current one-cell free-flow timing', () => {
  const state = snapshot();
  const topology = buildRoutingTopology(state, buildLaneGroups(state));
  const arc = topology.outgoingArcs({ junctionId: 'j:legacy:4,4' })[0];
  assert.ok(arc);
  assert.ok(Math.abs(arc.traversalTicks - (10 / 1.5)) < 1e-9);
});

test('routing topology indexes segment and lane authority once instead of rescanning per arc', () => {
  const base = snapshot();
  const groups = buildLaneGroups(base);
  const segments = [...base.segments];
  const lanes = [...base.lanes];
  let segmentFindCalls = 0;
  let laneMapCalls = 0;
  const nativeSegmentFind = segments.find.bind(segments);
  const nativeLaneMap = lanes.map.bind(lanes);

  segments.find = ((...args: Parameters<typeof segments.find>) => {
    segmentFindCalls += 1;
    return nativeSegmentFind(...args);
  }) as typeof segments.find;
  lanes.map = ((...args: Parameters<typeof lanes.map>) => {
    laneMapCalls += 1;
    return nativeLaneMap(...args);
  }) as typeof lanes.map;

  const instrumented: TransportNetworkSnapshot = { ...base, segments, lanes };
  const topology = buildRoutingTopology(instrumented, groups);
  assert.ok(topology.arcs.length > 1);
  assert.equal(segmentFindCalls, 0, 'segment lookup must use one prebuilt index, not Array.find per arc');
  assert.equal(laneMapCalls, 1, 'lane authority must be indexed once, not remapped for every movement');
});
