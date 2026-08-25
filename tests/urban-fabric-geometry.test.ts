import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_CELL_SIZE_METERS,
  normalizePoint,
  offsetPolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonDifference,
  polygonIntersection,
  polygonUnion,
} from '../src/world/cadastre/Geometry.ts';

const square = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
] as const;

test('geometry normalizes to centimeter precision', () => {
  assert.deepEqual(normalizePoint({ x: 1.2349, y: 8.7651 }), { x: 1.23, y: 8.77 });
  assert.equal(LEGACY_CELL_SIZE_METERS, 20);
});

test('square geometry has stable area centroid and inset', () => {
  assert.equal(polygonArea(square), 400);
  assert.deepEqual(polygonCentroid(square), { x: 10, y: 10 });
  const inset = offsetPolygon(square, -2);
  assert.equal(inset.length, 1);
  assert.equal(Math.round(polygonArea(inset[0]!) * 100) / 100, 256);
});

test('boolean operations conserve expected rectangular area', () => {
  const clip = [
    { x: 10, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 20 },
    { x: 10, y: 20 },
  ] as const;
  const unionResult = polygonUnion(square, clip);
  const intersection = polygonIntersection(square, clip);
  const difference = polygonDifference(square, clip);
  assert.equal(unionResult.reduce((sum, ring) => sum + polygonArea(ring), 0), 600);
  assert.equal(intersection.reduce((sum, ring) => sum + polygonArea(ring), 0), 200);
  assert.equal(difference.reduce((sum, ring) => sum + polygonArea(ring), 0), 200);
});

test('boolean output is canonical across equivalent vertex orderings', () => {
  const shifted = [
    { x: 20, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ] as const;
  assert.deepEqual(polygonUnion(square), polygonUnion(shifted));
});

test('point inclusion treats parcel boundaries as inside', () => {
  assert.equal(pointInPolygon({ x: 10, y: 10 }, square), true);
  assert.equal(pointInPolygon({ x: 0, y: 8 }, square), true);
  assert.equal(pointInPolygon({ x: 21, y: 10 }, square), false);
});
