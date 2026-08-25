import {
  EndType,
  FillRule,
  JoinType,
  difference,
  inflatePaths,
  intersect,
  union,
} from 'clipper2-ts';

export const LEGACY_CELL_SIZE_METERS = 20;
const GEOMETRY_SCALE = 100;

export type WorldPoint = Readonly<{ x: number; y: number }>;
export type PolygonRing = readonly WorldPoint[];
export type MultiPolygon = readonly PolygonRing[];

type ClipperPoint = Readonly<{ x: number; y: number }>;
type ClipperPath = readonly ClipperPoint[];
type ClipperPaths = readonly ClipperPath[];

export function normalizePoint(point: WorldPoint): WorldPoint {
  assertFinitePoint(point);
  return Object.freeze({
    x: Math.round(point.x * GEOMETRY_SCALE) / GEOMETRY_SCALE,
    y: Math.round(point.y * GEOMETRY_SCALE) / GEOMETRY_SCALE,
  });
}

export function normalizeRing(ring: PolygonRing): PolygonRing {
  if (ring.length < 3) throw new Error('polygon ring must contain at least three points');
  const normalized: WorldPoint[] = [];
  for (const point of ring) {
    const next = normalizePoint(point);
    const previous = normalized.at(-1);
    if (!previous || previous.x !== next.x || previous.y !== next.y) normalized.push(next);
  }
  if (normalized.length > 1) {
    const first = normalized[0]!;
    const last = normalized.at(-1)!;
    if (first.x === last.x && first.y === last.y) normalized.pop();
  }
  if (normalized.length < 3) throw new Error('polygon ring collapses below three unique points');
  return Object.freeze(normalized);
}

export function polygonArea(ring: PolygonRing): number {
  const normalized = normalizeRing(ring);
  let twiceArea = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function polygonCentroid(ring: PolygonRing): WorldPoint {
  const normalized = normalizeRing(ring);
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < Number.EPSILON) throw new Error('cannot compute centroid of zero-area polygon');
  return normalizePoint({
    x: x / (3 * twiceArea),
    y: y / (3 * twiceArea),
  });
}

export function pointInPolygon(point: WorldPoint, ring: PolygonRing): boolean {
  const target = normalizePoint(point);
  const normalized = normalizeRing(ring);
  let inside = false;
  for (let i = 0, j = normalized.length - 1; i < normalized.length; j = i, i += 1) {
    const a = normalized[j]!;
    const b = normalized[i]!;
    if (pointOnSegment(target, a, b)) return true;
    const intersects = ((b.y > target.y) !== (a.y > target.y))
      && target.x < ((a.x - b.x) * (target.y - b.y)) / (a.y - b.y) + b.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonUnion(
  subject: PolygonRing | MultiPolygon,
  clip?: PolygonRing | MultiPolygon,
): MultiPolygon {
  const subjectPaths = toClipperPaths(subject);
  if (subjectPaths.length === 0) return Object.freeze([]);
  const clipPaths = clip ? toClipperPaths(clip) : [];
  return fromClipperPaths(union(subjectPaths, clipPaths, FillRule.NonZero));
}

export function polygonIntersection(
  subject: PolygonRing | MultiPolygon,
  clip: PolygonRing | MultiPolygon,
): MultiPolygon {
  return fromClipperPaths(intersect(toClipperPaths(subject), toClipperPaths(clip), FillRule.NonZero));
}

export function polygonDifference(
  subject: PolygonRing | MultiPolygon,
  clip: PolygonRing | MultiPolygon,
): MultiPolygon {
  return fromClipperPaths(difference(toClipperPaths(subject), toClipperPaths(clip), FillRule.NonZero));
}

export function offsetPolygon(subject: PolygonRing | MultiPolygon, deltaMeters: number): MultiPolygon {
  if (!Number.isFinite(deltaMeters)) throw new Error('deltaMeters must be finite');
  return fromClipperPaths(
    inflatePaths(
      toClipperPaths(subject),
      Math.round(deltaMeters * GEOMETRY_SCALE),
      JoinType.Miter,
      EndType.Polygon,
    ),
  );
}

function assertFinitePoint(point: WorldPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('geometry coordinates must be finite');
  }
}

function toClipperPaths(value: PolygonRing | MultiPolygon): ClipperPaths {
  const rings = isMultiPolygon(value) ? value : [value];
  return rings.map((ring) => normalizeRing(ring).map((point) => ({
    x: Math.round(point.x * GEOMETRY_SCALE),
    y: Math.round(point.y * GEOMETRY_SCALE),
  })));
}

function fromClipperPaths(paths: readonly (readonly { x: number; y: number }[])[]): MultiPolygon {
  const rings = paths
    .map((path) => normalizeRing(path.map((point) => ({
      x: point.x / GEOMETRY_SCALE,
      y: point.y / GEOMETRY_SCALE,
    }))))
    .filter((ring) => polygonArea(ring) > 0);

  rings.sort((left, right) => {
    const areaDelta = polygonArea(right) - polygonArea(left);
    if (Math.abs(areaDelta) > 1e-9) return areaDelta;
    return compareRings(left, right);
  });
  return Object.freeze(rings);
}

function isMultiPolygon(value: PolygonRing | MultiPolygon): value is MultiPolygon {
  const first = value[0];
  return Array.isArray(first);
}

function compareRings(left: PolygonRing, right: PolygonRing): number {
  const leftStart = canonicalStart(left);
  const rightStart = canonicalStart(right);
  if (leftStart.x !== rightStart.x) return leftStart.x - rightStart.x;
  if (leftStart.y !== rightStart.y) return leftStart.y - rightStart.y;
  if (left.length !== right.length) return left.length - right.length;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
  }
  return 0;
}

function canonicalStart(ring: PolygonRing): WorldPoint {
  return ring.reduce((best, point) => (
    point.x < best.x || (point.x === best.x && point.y < best.y) ? point : best
  ), ring[0]!);
}

function pointOnSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= squaredLength;
}
