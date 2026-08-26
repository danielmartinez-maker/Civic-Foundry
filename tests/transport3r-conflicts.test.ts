import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { LegacyRoadNetworkAdapter } from '../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { buildLaneGroups } from '../src/simulation/transportation/LaneGroupBuilder.ts';
import { buildPedestrianCrossings } from '../src/simulation/transportation/PedestrianCrossingBuilder.ts';
import {
  buildConflictMatrices,
  type JunctionConflictMatrix,
} from '../src/simulation/transportation/ConflictMatrixBuilder.ts';
import type {
  Carriageway,
  LaneGroup,
  TransportNetworkAuthority,
  TurnMovement,
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

function movement(
  authority: TransportNetworkAuthority,
  fromNeighbor: string,
  toNeighbor: string,
): TurnMovement {
  const center = 'j:legacy:4,4';
  const from = authority.carriageways.find(
    (candidate) => candidate.fromJunctionId === fromNeighbor && candidate.toJunctionId === center,
  );
  const to = authority.carriageways.find(
    (candidate) => candidate.fromJunctionId === center && candidate.toJunctionId === toNeighbor,
  );
  assert.ok(from && to);
  const found = authority.movements.find(
    (candidate) => candidate.fromCarriagewayId === from.id && candidate.toCarriagewayId === to.id,
  );
  assert.ok(found);
  return found;
}

function centerMatrix(matrices: readonly JunctionConflictMatrix[]): JunctionConflictMatrix {
  const matrix = matrices.find((candidate) => candidate.junctionId === 'j:legacy:4,4');
  assert.ok(matrix);
  return matrix;
}

function serializeMatrix(matrix: JunctionConflictMatrix): string {
  const pairs: string[] = [];
  for (let i = 0; i < matrix.participants.length; i += 1) {
    for (let j = i + 1; j < matrix.participants.length; j += 1) {
      const a = matrix.participants[i];
      const b = matrix.participants[j];
      if (matrix.conflicts(a, b)) pairs.push(`${a}|${b}`);
    }
  }
  return JSON.stringify({ junctionId: matrix.junctionId, participants: matrix.participants, pairs });
}

test('four-leg surface junction derives one stable pedestrian crossing per leg with lane-based length', () => {
  const { authority, laneGroups } = plusNetwork();
  const crossings = buildPedestrianCrossings(authority, laneGroups)
    .filter((crossing) => crossing.junctionId === 'j:legacy:4,4');

  assert.equal(crossings.length, 4);
  assert.deepEqual(
    crossings.map((crossing) => crossing.id),
    [
      'pc:j:legacy:4,4:east',
      'pc:j:legacy:4,4:north',
      'pc:j:legacy:4,4:south',
      'pc:j:legacy:4,4:west',
    ],
  );
  for (const crossing of crossings) {
    assert.equal(crossing.crossedCarriagewayIds.length, 2);
    assert.equal(crossing.crossingLengthMeters, 7.2);
  }
});

test('ordinary pedestrian crossings are not fabricated across controlled-access mainline legs', () => {
  const { authority, laneGroups } = plusNetwork();
  const center = 'j:legacy:4,4';
  const north = 'j:legacy:4,3';
  const carriageways: Carriageway[] = authority.carriageways.map((carriageway) => (
    (carriageway.fromJunctionId === north && carriageway.toJunctionId === center)
      || (carriageway.fromJunctionId === center && carriageway.toJunctionId === north)
      ? { ...carriageway, operatingClass: 'highway' as const }
      : carriageway
  ));
  const controlled: TransportNetworkAuthority = { ...authority, carriageways };
  const crossings = buildPedestrianCrossings(controlled, laneGroups)
    .filter((crossing) => crossing.junctionId === center);

  assert.equal(crossings.length, 3);
  assert.equal(crossings.some((crossing) => crossing.id.endsWith(':north')), false);
});

test('cardinal conflict matrix distinguishes compatible and conflicting vehicle movements', () => {
  const { authority, laneGroups } = plusNetwork();
  const crossings = buildPedestrianCrossings(authority, laneGroups);
  const matrix = centerMatrix(buildConflictMatrices(authority, crossings));

  const north = 'j:legacy:4,3';
  const south = 'j:legacy:4,5';
  const west = 'j:legacy:3,4';
  const east = 'j:legacy:5,4';

  const northThrough = movement(authority, north, south);
  const southThrough = movement(authority, south, north);
  const westThrough = movement(authority, west, east);
  const northLeft = movement(authority, north, east);
  const northRight = movement(authority, north, west);
  const southRight = movement(authority, south, east);

  assert.equal(matrix.conflicts(northThrough.id, southThrough.id), false, 'opposing through movements are compatible');
  assert.equal(matrix.conflicts(northLeft.id, southThrough.id), true, 'left conflicts with opposing through');
  assert.equal(matrix.conflicts(northThrough.id, westThrough.id), true, 'perpendicular through movements conflict');
  assert.equal(matrix.conflicts(northRight.id, southRight.id), false, 'rights to distinct departures are compatible');
  assert.equal(matrix.conflicts(northLeft.id, westThrough.id), true, 'movements sharing a constrained departure conflict');
});

test('pedestrian crossings participate symmetrically and participants never self-conflict', () => {
  const { authority, laneGroups } = plusNetwork();
  const crossings = buildPedestrianCrossings(authority, laneGroups);
  const matrix = centerMatrix(buildConflictMatrices(authority, crossings));
  const northCrossing = crossings.find((crossing) => crossing.id === 'pc:j:legacy:4,4:north');
  assert.ok(northCrossing);
  const northThrough = movement(authority, 'j:legacy:4,3', 'j:legacy:4,5');

  assert.equal(matrix.conflicts(northCrossing.id, northThrough.id), true);
  assert.equal(matrix.conflicts(northThrough.id, northCrossing.id), true);
  for (const participant of matrix.participants) {
    assert.equal(matrix.conflicts(participant, participant), false);
  }
});

test('crossings and conflict matrices are canonical under shuffled authority arrays', () => {
  const { authority, laneGroups } = plusNetwork();
  const shuffled: TransportNetworkAuthority = {
    junctions: [...authority.junctions].reverse(),
    segments: [...authority.segments].reverse(),
    carriageways: [...authority.carriageways].reverse(),
    lanes: [...authority.lanes].reverse(),
    movements: [...authority.movements].reverse(),
  };

  const canonicalCrossings = buildPedestrianCrossings(authority, laneGroups);
  const shuffledCrossings = buildPedestrianCrossings(shuffled, [...laneGroups].reverse());
  assert.deepEqual(shuffledCrossings, canonicalCrossings);

  const canonicalMatrix = centerMatrix(buildConflictMatrices(authority, canonicalCrossings));
  const shuffledMatrix = centerMatrix(buildConflictMatrices(shuffled, shuffledCrossings));
  assert.equal(serializeMatrix(shuffledMatrix), serializeMatrix(canonicalMatrix));
});
