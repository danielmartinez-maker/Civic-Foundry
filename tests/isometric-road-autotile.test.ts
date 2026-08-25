import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROAD_EAST,
  ROAD_NORTH,
  ROAD_SOUTH,
  ROAD_WEST,
  roadConnectivityMask,
  rotateRoadMask,
} from '../src/rendering/assets/RoadAutotile.ts';

const roads = new Set(['2,2', '2,1', '3,2', '2,3']);
const lookup = (x: number, y: number) => roads.has(`${x},${y}`) ? 'local' as const : undefined;

test('derives topology mask', () => {
  assert.equal(roadConnectivityMask(2, 2, lookup), ROAD_NORTH | ROAD_EAST | ROAD_SOUTH);
});

test('camera rotation rotates mask bits', () => {
  assert.equal(rotateRoadMask(ROAD_NORTH, 1), ROAD_EAST);
  assert.equal(rotateRoadMask(ROAD_NORTH | ROAD_EAST, 2), ROAD_SOUTH | ROAD_WEST);
});

test('all masks survive four quarter-turns', () => {
  for (let mask = 0; mask < 16; mask += 1) {
    let rotated = mask;
    for (let i = 0; i < 4; i += 1) rotated = rotateRoadMask(rotated, 1);
    assert.equal(rotated, mask);
  }
});
