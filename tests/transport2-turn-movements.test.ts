import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import {
  buildTurnMovements,
  movementEffectivePermissions,
} from '../src/simulation/transportation/TurnMovementBuilder.ts';
import {
  VEHICLE_PERMISSION,
  type TransportNetworkAuthority,
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

function carriageway(authority: TransportNetworkAuthority, from: string, to: string): string {
  const match = authority.carriageways.find((item) => item.fromJunctionId === from && item.toJunctionId === to);
  assert.ok(match, `missing carriageway ${from} -> ${to}`);
  return match.id;
}

test('four-way legacy junction exposes twelve deterministic legal non-u-turn movements', () => {
  const authority = plusAuthority();
  const center = authority.movements.filter((movement) => movement.junctionId === 'j:legacy:4,4');
  assert.equal(center.length, 12);
  assert.equal(center.every((movement) => movement.allowed), true);
  assert.equal(center.some((movement) => movement.turnKind === 'u-turn'), false);
  assert.deepEqual(center.map((movement) => movement.id), [...center.map((movement) => movement.id)].sort());
});

test('turn classification respects the grid coordinate convention', () => {
  const authority = plusAuthority();
  const northToCenter = carriageway(authority, 'j:legacy:4,3', 'j:legacy:4,4');
  const eastOut = carriageway(authority, 'j:legacy:4,4', 'j:legacy:5,4');
  const southOut = carriageway(authority, 'j:legacy:4,4', 'j:legacy:4,5');
  const westOut = carriageway(authority, 'j:legacy:4,4', 'j:legacy:3,4');

  const find = (toCarriagewayId: string) => authority.movements.find((movement) =>
    movement.junctionId === 'j:legacy:4,4' &&
    movement.fromCarriagewayId === northToCenter &&
    movement.toCarriagewayId === toCarriagewayId);

  assert.equal(find(eastOut)?.turnKind, 'left');
  assert.equal(find(southOut)?.turnKind, 'through');
  assert.equal(find(westOut)?.turnKind, 'right');
});

test('default movement builder never fabricates reverse u-turn connectivity', () => {
  const authority = plusAuthority();
  const northToCenter = carriageway(authority, 'j:legacy:4,3', 'j:legacy:4,4');
  const northOut = carriageway(authority, 'j:legacy:4,4', 'j:legacy:4,3');
  assert.equal(authority.movements.some((movement) =>
    movement.fromCarriagewayId === northToCenter && movement.toCarriagewayId === northOut), false);
});

test('movement permissions are bounded by eligible incoming and outgoing lane permissions', () => {
  const base = plusAuthority();
  const movement = base.movements.find((item) => item.junctionId === 'j:legacy:4,4');
  assert.ok(movement);
  const incomingLaneId = movement.fromLaneIds[0]!;
  const outgoingLaneId = movement.toLaneIds[0]!;
  const restricted: TransportNetworkAuthority = {
    ...base,
    lanes: base.lanes.map((lane) => {
      if (lane.id === incomingLaneId) return { ...lane, permissions: VEHICLE_PERMISSION.bus | VEHICLE_PERMISSION.emergency };
      if (lane.id === outgoingLaneId) return { ...lane, permissions: VEHICLE_PERMISSION.bus };
      return lane;
    }),
    movements: base.movements.map((item) => item.id === movement.id
      ? { ...item, permissions: VEHICLE_PERMISSION.bus | VEHICLE_PERMISSION.privateCar }
      : item),
  };
  assert.equal(movementEffectivePermissions(restricted, restricted.movements.find((item) => item.id === movement.id)!), VEHICLE_PERMISSION.bus);
});

test('movement generation is deterministic and independent of physical array order', () => {
  const authority = plusAuthority();
  const physical = {
    junctions: [...authority.junctions].reverse(),
    segments: [...authority.segments].reverse(),
    carriageways: [...authority.carriageways].reverse(),
    lanes: [...authority.lanes].reverse(),
  };
  assert.equal(JSON.stringify(buildTurnMovements(physical)), JSON.stringify(authority.movements));
});
