import type { BoundingBox2, Point2, Polygon2, Segment2 } from './GeometryTypes.ts';
import { GEOMETRY_EPSILON, pointsNearlyEqual } from './GeometryTolerance.ts';
import { pointOnSegment, segmentsIntersect } from './SegmentMath.ts';

function requireFinitePoint(point: Point2): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('polygon coordinates must be finite');
}

export function polygonSignedArea(polygon: Polygon2): number {
  let twiceArea = 0;
  for (let index = 0; index < polygon.points.length; index++) {
    const a = polygon.points[index]!;
    const b = polygon.points[(index + 1) % polygon.points.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea / 2;
}

export function normalizePolygon(input: readonly Point2[]): Polygon2 {
  const points = input.map((point) => ({ x: point.x, y: point.y }));
  for (const point of points) requireFinitePoint(point);
  if (points.length > 1 && pointsNearlyEqual(points[0]!, points[points.length - 1]!)) points.pop();
  if (points.length < 3) throw new Error('polygon requires at least three unique vertices');
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (pointsNearlyEqual(points[i]!, points[j]!)) throw new Error('polygon contains duplicate vertex');
    }
  }
  for (let i = 0; i < points.length; i++) {
    const edgeA: Segment2 = { a: points[i]!, b: points[(i + 1) % points.length]! };
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const edgeB: Segment2 = { a: points[j]!, b: points[(j + 1) % points.length]! };
      if (segmentsIntersect(edgeA, edgeB)) throw new Error('polygon self-intersection');
    }
  }
  const provisional: Polygon2 = { points };
  const signed = polygonSignedArea(provisional);
  if (Math.abs(signed) <= GEOMETRY_EPSILON) throw new Error('polygon has zero area');
  const normalized = signed > 0 ? points : points.slice().reverse();
  return Object.freeze({ points: Object.freeze(normalized.map((point) => Object.freeze({ ...point }))) });
}

export function polygonArea(polygon: Polygon2): number {
  return Math.abs(polygonSignedArea(polygon));
}

export function polygonPerimeter(polygon: Polygon2): number {
  let total = 0;
  for (let index = 0; index < polygon.points.length; index++) {
    const a = polygon.points[index]!;
    const b = polygon.points[(index + 1) % polygon.points.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function polygonCentroid(polygon: Polygon2): Point2 {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < polygon.points.length; index++) {
    const a = polygon.points[index]!;
    const b = polygon.points[(index + 1) % polygon.points.length]!;
    const factor = a.x * b.y - b.x * a.y;
    crossSum += factor;
    xSum += (a.x + b.x) * factor;
    ySum += (a.y + b.y) * factor;
  }
  if (Math.abs(crossSum) <= GEOMETRY_EPSILON) throw new Error('polygon has zero area');
  return { x: xSum / (3 * crossSum), y: ySum / (3 * crossSum) };
}

export function polygonBounds(polygon: Polygon2): BoundingBox2 {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of polygon.points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(point: Point2, polygon: Polygon2, includeBoundary = true): boolean {
  let inside = false;
  for (let i = 0, j = polygon.points.length - 1; i < polygon.points.length; j = i++) {
    const a = polygon.points[j]!;
    const b = polygon.points[i]!;
    if (pointOnSegment(point, { a, b })) return includeBoundary;
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInBounds(point: Point2, bounds: BoundingBox2): boolean {
  return point.x >= bounds.minX - GEOMETRY_EPSILON && point.x <= bounds.maxX + GEOMETRY_EPSILON
    && point.y >= bounds.minY - GEOMETRY_EPSILON && point.y <= bounds.maxY + GEOMETRY_EPSILON;
}

export function polygonIntersectsBounds(polygon: Polygon2, bounds: BoundingBox2): boolean {
  const pb = polygonBounds(polygon);
  if (pb.maxX < bounds.minX - GEOMETRY_EPSILON || pb.minX > bounds.maxX + GEOMETRY_EPSILON
    || pb.maxY < bounds.minY - GEOMETRY_EPSILON || pb.minY > bounds.maxY + GEOMETRY_EPSILON) return false;
  if (polygon.points.some((point) => pointInBounds(point, bounds))) return true;
  const corners: Point2[] = [
    { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  const boundEdges: Segment2[] = corners.map((point, index) => ({ a: point, b: corners[(index + 1) % corners.length]! }));
  for (let index = 0; index < polygon.points.length; index++) {
    const edge = { a: polygon.points[index]!, b: polygon.points[(index + 1) % polygon.points.length]! };
    if (boundEdges.some((boundEdge) => segmentsIntersect(edge, boundEdge))) return true;
  }
  return false;
}

function collinearOverlapLength(first: Segment2, second: Segment2): number {
  const dx = first.b.x - first.a.x;
  const dy = first.b.y - first.a.y;
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON) return 0;
  const crossA = dx * (second.a.y - first.a.y) - dy * (second.a.x - first.a.x);
  const crossB = dx * (second.b.y - first.a.y) - dy * (second.b.x - first.a.x);
  if (Math.abs(crossA) > GEOMETRY_EPSILON || Math.abs(crossB) > GEOMETRY_EPSILON) return 0;
  const ux = dx / length;
  const uy = dy / length;
  const project = (point: Point2) => (point.x - first.a.x) * ux + (point.y - first.a.y) * uy;
  const a = project(second.a);
  const b = project(second.b);
  const low = Math.max(0, Math.min(a, b));
  const high = Math.min(length, Math.max(a, b));
  return Math.max(0, high - low);
}

export function frontageOverlapLength(polygon: Polygon2, frontage: Segment2): number {
  let total = 0;
  for (let index = 0; index < polygon.points.length; index++) {
    total += collinearOverlapLength({ a: polygon.points[index]!, b: polygon.points[(index + 1) % polygon.points.length]! }, frontage);
  }
  return total;
}
