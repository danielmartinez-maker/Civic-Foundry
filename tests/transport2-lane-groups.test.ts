import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { buildLaneGroups } from '../src/simulation/transportation/LaneGroupBuilder.ts';
import type { Lane, TransportNetworkAuthority } from '../src/simulation/transportation/TransportNetworkTypes.ts';

function flatTerrain(width = 10, height = 10): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function straightAuthority(type: 'local' | 'collector' | 'arterial'): TransportNetworkAuthority {
  const roads = new RoadSystem(flatTerrain());
  roads.restore([
    { x: 2, y: 4, type },
    { x: 3, y: 4, type },
    { x: 4, y: 4, type },
  ], 1);
  return new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(roads).authority;
}

function inboundCarriageway(authority: TransportNetworkAuthority) {
  const item = authority.carriageways.find((carriageway) =>
    carriageway.fromJunctionId === 'j:legacy:2,4' && carriageway.toJunctionId === 'j:legacy:3,4');
  assert.ok(item);
  return item;
}

test('legacy lane groups conserve aggregate local collector and arterial capacity', () => {
  const cases = [
    ['local', 60],
    ['collector', 120],
    ['arterial', 240],
  ] as const;
  for (const [roadType, expectedCapacity] of cases) {
    const authority = straightAuthority(roadType);
    const carriageway = inboundCarriageway(authority);
    const groups = buildLaneGroups(authority).filter((group) => group.carriagewayId === carriageway.id);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]?.laneIds, carriageway.laneIds);
    assert.equal(groups[0]?.capacityPerMinute, expectedCapacity);
  }
});

test('closed parking and shoulder lanes never contribute normal travel capacity', () => {
  const base = straightAuthority('arterial');
  const carriageway = inboundCarriageway(base);
  const laneIds = carriageway.laneIds;
  const extraParking: Lane = {
    ...base.lanes.find((lane) => lane.id === laneIds[0])!,
    id: `${carriageway.id}:parking`, ordinal: 3, kind: 'parking', baseCapacityPerMinute: 999,
  };
  const extraShoulder: Lane = {
    ...base.lanes.find((lane) => lane.id === laneIds[0])!,
    id: `${carriageway.id}:shoulder`, ordinal: 4, kind: 'shoulder', baseCapacityPerMinute: 999,
  };
  const authority: TransportNetworkAuthority = {
    ...base,
    carriageways: base.carriageways.map((item) => item.id === carriageway.id
      ? { ...item, laneIds: [...item.laneIds, extraParking.id, extraShoulder.id] }
      : item),
    lanes: [
      ...base.lanes.map((lane) => lane.id === laneIds[2] ? { ...lane, operatingState: 'closed' as const } : lane),
      extraParking,
      extraShoulder,
    ],
  };
  const groups = buildLaneGroups(authority).filter((group) => group.carriagewayId === carriageway.id);
  assert.equal(groups.reduce((sum, group) => sum + group.capacityPerMinute, 0), 160);
  assert.equal(groups.flatMap((group) => group.laneIds).includes(laneIds[2]!), false);
  assert.equal(groups.flatMap((group) => group.laneIds).includes(extraParking.id), false);
  assert.equal(groups.flatMap((group) => group.laneIds).includes(extraShoulder.id), false);
});

test('different downstream movement sets keep adjacent lanes in separate groups', () => {
  const base = straightAuthority('collector');
  const carriageway = inboundCarriageway(base);
  assert.equal(carriageway.laneIds.length, 2);
  const movement = base.movements.find((item) => item.fromCarriagewayId === carriageway.id);
  assert.ok(movement);
  const authority: TransportNetworkAuthority = {
    ...base,
    movements: base.movements.map((item) => item.id === movement.id
      ? { ...item, fromLaneIds: [carriageway.laneIds[0]!] }
      : item),
  };
  const groups = buildLaneGroups(authority).filter((group) => group.carriagewayId === carriageway.id);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.laneIds), [[carriageway.laneIds[0]!], [carriageway.laneIds[1]!]]);
  assert.notDeepEqual(groups[0]?.movementIds, groups[1]?.movementIds);
});

test('lane group IDs and output order are deterministic under shuffled authority arrays', () => {
  const authority = straightAuthority('arterial');
  const shuffled: TransportNetworkAuthority = {
    junctions: [...authority.junctions].reverse(),
    segments: [...authority.segments].reverse(),
    carriageways: [...authority.carriageways].reverse(),
    lanes: [...authority.lanes].reverse(),
    movements: [...authority.movements].reverse(),
  };
  assert.equal(JSON.stringify(buildLaneGroups(authority)), JSON.stringify(buildLaneGroups(shuffled)));
});
