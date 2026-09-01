import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { buildLaneGroups } from '../src/simulation/transportation/LaneGroupBuilder.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { LegacyRouteMovementResolver } from '../src/simulation/transportation/LegacyRouteMovementResolver.ts';
import type { LaneGroup, TransportNetworkAuthority, TurnKind } from '../src/simulation/transportation/TransportNetworkTypes.ts';

function flatTerrain(width = 10, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function plusNetwork(): Readonly<{ authority: TransportNetworkAuthority; laneGroups: readonly LaneGroup[] }> {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 4, y: 3, type: 'local' },
    { x: 3, y: 4, type: 'local' },
    { x: 4, y: 4, type: 'local' },
    { x: 5, y: 4, type: 'local' },
    { x: 4, y: 5, type: 'local' },
  ], 1);
  const authority = new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(roads).authority;
  return { authority, laneGroups: buildLaneGroups(authority) };
}

function assertResolvedTurn(
  authority: TransportNetworkAuthority,
  laneGroups: readonly LaneGroup[],
  currentEdgeId: string,
  nextEdgeId: string,
  expectedTurn: TurnKind,
): void {
  const resolved = new LegacyRouteMovementResolver(authority, laneGroups).resolve(currentEdgeId, nextEdgeId);
  assert.ok(resolved);
  const movement = authority.movements.find((candidate) => candidate.id === resolved.movementId);
  assert.ok(movement);
  assert.equal(movement.turnKind, expectedTurn);
  assert.equal(resolved.junctionId, 'j:legacy:4,4');
  assert.equal(resolved.fromCarriagewayId, movement.fromCarriagewayId);
  assert.equal(resolved.toCarriagewayId, movement.toCarriagewayId);

  const expectedGroups = laneGroups
    .filter((group) => group.carriagewayId === movement.fromCarriagewayId && group.movementIds.includes(movement.id))
    .map((group) => group.id)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(resolved.laneGroupIds, expectedGroups);
  assert.equal(resolved.laneGroupIds.length > 0, true);
}

test('legacy edge pairs resolve straight right and left turns to explicit 3R movements', () => {
  const { authority, laneGroups } = plusNetwork();
  const incoming = 'e:n:4,3>n:4,4';

  assertResolvedTurn(authority, laneGroups, incoming, 'e:n:4,4>n:4,5', 'through');
  assertResolvedTurn(authority, laneGroups, incoming, 'e:n:4,4>n:3,4', 'right');
  assertResolvedTurn(authority, laneGroups, incoming, 'e:n:4,4>n:5,4', 'left');
});

test('resolver rejects malformed non-contiguous absent and default-prohibited u-turn edge pairs', () => {
  const { authority, laneGroups } = plusNetwork();
  const resolver = new LegacyRouteMovementResolver(authority, laneGroups);

  assert.equal(resolver.resolve('bad-edge', 'e:n:4,4>n:4,5'), undefined);
  assert.equal(resolver.resolve('e:n:4,3>n:4,4', 'e:n:5,4>n:5,5'), undefined);
  assert.equal(resolver.resolve('e:n:4,3>n:4,4', 'e:n:4,4>n:4,6'), undefined);
  assert.equal(resolver.resolve('e:n:4,3>n:4,4', 'e:n:4,4>n:4,3'), undefined);
});

test('resolver result is deterministic under shuffled authority and lane-group arrays', () => {
  const { authority, laneGroups } = plusNetwork();
  const shuffled: TransportNetworkAuthority = {
    junctions: [...authority.junctions].reverse(),
    segments: [...authority.segments].reverse(),
    carriageways: [...authority.carriageways].reverse(),
    lanes: [...authority.lanes].reverse(),
    movements: [...authority.movements].reverse(),
  };
  const current = 'e:n:4,3>n:4,4';
  const next = 'e:n:4,4>n:5,4';

  const canonical = new LegacyRouteMovementResolver(authority, laneGroups).resolve(current, next);
  const reordered = new LegacyRouteMovementResolver(shuffled, [...laneGroups].reverse()).resolve(current, next);
  assert.deepEqual(reordered, canonical);
});
