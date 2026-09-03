import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Point2, Polygon2, Segment2 } from "../src/world/geometry/GeometryTypes.ts";
import {
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
  polygonSignedArea,
  normalizePolygon,
} from "../src/world/geometry/PolygonMath.ts";
import { segmentsIntersect } from "../src/world/geometry/SegmentMath.ts";

type FixturePoint = readonly [number, number];

type PolygonFixture = Readonly<{
  id: string;
  verticesCm: readonly FixturePoint[];
  expected: Readonly<{
    signedDoubleAreaCm2: number;
    canonicalVerticesCm: readonly FixturePoint[];
    centroidCm: FixturePoint;
    boundsCm: readonly [number, number, number, number];
    hash64: string;
  }>;
  pointCases: readonly Readonly<{
    pointCm: FixturePoint;
    insideOrBoundary: boolean;
  }>[];
}>;

type GeometryFixture = Readonly<{
  version: number;
  centroidToleranceCm: number;
  polygons: readonly PolygonFixture[];
  segmentCases: readonly Readonly<{
    id: string;
    lhsCm: readonly [FixturePoint, FixturePoint];
    rhsCm: readonly [FixturePoint, FixturePoint];
    intersects: boolean;
  }>[];
}>;

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cpp-migration/geometry-v1.json", import.meta.url),
    "utf8",
  ),
) as GeometryFixture;

function point([x, y]: FixturePoint): Point2 {
  return { x, y };
}

function polygon(vertices: readonly FixturePoint[]): Polygon2 {
  return { points: vertices.map(point) };
}

function segment([a, b]: readonly [FixturePoint, FixturePoint]): Segment2 {
  return { a: point(a), b: point(b) };
}

function canonicalVertices(vertices: readonly FixturePoint[]): FixturePoint[] {
  const normalized = normalizePolygon(vertices.map(point));
  let minimumIndex = 0;
  for (let index = 1; index < normalized.points.length; index += 1) {
    const candidate = normalized.points[index]!;
    const minimum = normalized.points[minimumIndex]!;
    if (
      candidate.x < minimum.x ||
      (candidate.x === minimum.x && candidate.y < minimum.y)
    ) {
      minimumIndex = index;
    }
  }
  return Array.from({ length: normalized.points.length }, (_, offset) => {
    const value = normalized.points[
      (minimumIndex + offset) % normalized.points.length
    ]!;
    return [value.x, value.y] as const;
  });
}

function geometryHash64(vertices: readonly FixturePoint[]): string {
  const offset = 1469598103934665603n;
  const prime = 1099511628211n;
  let hash = offset;
  for (const [x, y] of canonicalVertices(vertices)) {
    for (const coordinate of [x, y]) {
      const value = BigInt.asUintN(64, BigInt(coordinate));
      for (let byteIndex = 0n; byteIndex < 8n; byteIndex += 1n) {
        hash ^= (value >> (byteIndex * 8n)) & 0xffn;
        hash = BigInt.asUintN(64, hash * prime);
      }
    }
  }
  return hash.toString(10);
}

test("Task 1 shared geometry fixture matches accepted TypeScript semantics", () => {
  assert.equal(fixture.version, 1);
  assert.ok(fixture.polygons.length >= 3);

  for (const polygonCase of fixture.polygons) {
    const input = polygon(polygonCase.verticesCm);
    const centroid = polygonCentroid(input);
    const bounds = polygonBounds(input);

    assert.equal(
      polygonSignedArea(input) * 2,
      polygonCase.expected.signedDoubleAreaCm2,
      `${polygonCase.id}: signed area`,
    );
    assert.deepEqual(
      canonicalVertices(polygonCase.verticesCm),
      polygonCase.expected.canonicalVerticesCm,
      `${polygonCase.id}: canonical winding/rotation`,
    );
    assert.ok(
      Math.abs(centroid.x - polygonCase.expected.centroidCm[0]) <=
        fixture.centroidToleranceCm,
      `${polygonCase.id}: centroid x`,
    );
    assert.ok(
      Math.abs(centroid.y - polygonCase.expected.centroidCm[1]) <=
        fixture.centroidToleranceCm,
      `${polygonCase.id}: centroid y`,
    );
    assert.deepEqual(
      [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
      polygonCase.expected.boundsCm,
      `${polygonCase.id}: bounds`,
    );
    assert.equal(
      geometryHash64(polygonCase.verticesCm),
      polygonCase.expected.hash64,
      `${polygonCase.id}: deterministic hash`,
    );

    for (const pointCase of polygonCase.pointCases) {
      assert.equal(
        pointInPolygon(point(pointCase.pointCm), input),
        pointCase.insideOrBoundary,
        `${polygonCase.id}: point ${pointCase.pointCm.join(",")}`,
      );
    }
  }
});

test("Task 1 shared geometry fixture matches TypeScript segment intersection semantics", () => {
  for (const segmentCase of fixture.segmentCases) {
    assert.equal(
      segmentsIntersect(segment(segmentCase.lhsCm), segment(segmentCase.rhsCm)),
      segmentCase.intersects,
      segmentCase.id,
    );
  }
});
