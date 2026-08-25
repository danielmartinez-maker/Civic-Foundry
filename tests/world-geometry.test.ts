import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolygon, polygonArea, polygonCentroid, polygonPerimeter, polygonBounds, pointInPolygon, polygonIntersectsBounds, frontageOverlapLength } from '../src/world/geometry/PolygonMath.ts';
import { segmentsIntersect, nearestPointOnSegment, polylineLength, pointOnSegment } from '../src/world/geometry/SegmentMath.ts';

const rectangle = normalizePolygon([
  { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 },
]);

test('polygon math normalizes winding and returns exact rectangle measures', () => {
  assert.equal(polygonArea(rectangle), 12);
  assert.equal(polygonPerimeter(rectangle), 14);
  assert.deepEqual(polygonCentroid(rectangle), { x: 2, y: 1.5 });
  assert.deepEqual(polygonBounds(rectangle), { minX: 0, minY: 0, maxX: 4, maxY: 3 });
  assert.equal(pointInPolygon({ x: 4, y: 1 }, rectangle), true);
  assert.equal(pointInPolygon({ x: 5, y: 1 }, rectangle), false);
});

test('clockwise input is normalized to canonical counter-clockwise winding', () => {
  const polygon = normalizePolygon([{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }]);
  assert.deepEqual(polygon.points, [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }]);
});

test('duplicate terminal vertex is removed but internal duplicate and zero area are rejected', () => {
  const polygon = normalizePolygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: 0 }]);
  assert.equal(polygon.points.length, 3);
  assert.throws(() => normalizePolygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }]), /duplicate/);
  assert.throws(() => normalizePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), /zero area/);
});

test('self-intersecting and non-finite polygons are rejected', () => {
  assert.throws(() => normalizePolygon([
    { x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 },
  ]), /self-intersection/);
  assert.throws(() => normalizePolygon([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 0, y: 1 }]), /finite/);
});

test('segment math handles crossings, endpoints, point membership, projection, and polyline length', () => {
  assert.equal(segmentsIntersect({ a: { x: 0, y: 0 }, b: { x: 2, y: 2 } }, { a: { x: 0, y: 2 }, b: { x: 2, y: 0 } }), true);
  assert.equal(segmentsIntersect({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, { a: { x: 2, y: 0 }, b: { x: 3, y: 1 } }), true);
  assert.equal(pointOnSegment({ x: 1, y: 0 }, { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }), true);
  assert.deepEqual(nearestPointOnSegment({ x: 3, y: 1 }, { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }), { x: 2, y: 0 });
  assert.equal(polylineLength({ points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 4 }] }), 8);
});

test('bounds intersection and frontage overlap are deterministic', () => {
  assert.equal(polygonIntersectsBounds(rectangle, { minX: 3.5, minY: 2.5, maxX: 5, maxY: 4 }), true);
  assert.equal(polygonIntersectsBounds(rectangle, { minX: 5, minY: 5, maxX: 6, maxY: 6 }), false);
  assert.equal(frontageOverlapLength(rectangle, { points: [{ x: 1, y: 0 }, { x: 3, y: 0 }] }), 2);
  assert.equal(frontageOverlapLength(rectangle, { points: [{ x: -1, y: 0 }, { x: 1, y: 0 }] }), 1);
  assert.equal(frontageOverlapLength(rectangle, { points: [{ x: 1, y: 1 }, { x: 3, y: 1 }] }), 0);
  assert.equal(frontageOverlapLength(rectangle, { points: [{ x: -1, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 0 }] }), 4);
});
