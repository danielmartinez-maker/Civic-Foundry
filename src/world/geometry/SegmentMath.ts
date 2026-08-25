import type { Point2, Polyline2, Segment2 } from './GeometryTypes.ts';
import { GEOMETRY_EPSILON } from './GeometryTolerance.ts';

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function pointOnSegment(point: Point2, segment: Segment2): boolean {
  if (Math.abs(cross(segment.a, segment.b, point)) > GEOMETRY_EPSILON) return false;
  return point.x >= Math.min(segment.a.x, segment.b.x) - GEOMETRY_EPSILON
    && point.x <= Math.max(segment.a.x, segment.b.x) + GEOMETRY_EPSILON
    && point.y >= Math.min(segment.a.y, segment.b.y) - GEOMETRY_EPSILON
    && point.y <= Math.max(segment.a.y, segment.b.y) + GEOMETRY_EPSILON;
}

export function segmentsIntersect(first: Segment2, second: Segment2): boolean {
  const c1 = cross(first.a, first.b, second.a);
  const c2 = cross(first.a, first.b, second.b);
  const c3 = cross(second.a, second.b, first.a);
  const c4 = cross(second.a, second.b, first.b);
  if (((c1 > GEOMETRY_EPSILON && c2 < -GEOMETRY_EPSILON) || (c1 < -GEOMETRY_EPSILON && c2 > GEOMETRY_EPSILON))
    && ((c3 > GEOMETRY_EPSILON && c4 < -GEOMETRY_EPSILON) || (c3 < -GEOMETRY_EPSILON && c4 > GEOMETRY_EPSILON))) return true;
  return (Math.abs(c1) <= GEOMETRY_EPSILON && pointOnSegment(second.a, first))
    || (Math.abs(c2) <= GEOMETRY_EPSILON && pointOnSegment(second.b, first))
    || (Math.abs(c3) <= GEOMETRY_EPSILON && pointOnSegment(first.a, second))
    || (Math.abs(c4) <= GEOMETRY_EPSILON && pointOnSegment(first.b, second));
}

export function nearestPointOnSegment(point: Point2, segment: Segment2): Point2 {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON) return { ...segment.a };
  const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared));
  return { x: segment.a.x + t * dx, y: segment.a.y + t * dy };
}

export function polylineLength(polyline: Polyline2): number {
  let total = 0;
  for (let index = 1; index < polyline.points.length; index++) {
    const a = polyline.points[index - 1]!;
    const b = polyline.points[index]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
