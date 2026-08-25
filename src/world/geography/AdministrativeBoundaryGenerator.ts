import type { SeededRandom } from '../../simulation/core/SeededRandom.ts';
import type { Point2, Polygon2 } from '../geometry/GeometryTypes.ts';
import { GEOMETRY_EPSILON, pointsNearlyEqual } from '../geometry/GeometryTolerance.ts';
import { normalizePolygon, polygonArea, polygonBounds, polygonCentroid } from '../geometry/PolygonMath.ts';
import type { GeographyEntity, GeographyKind } from './GeographyTypes.ts';

function padded(value: number): string { return value.toString().padStart(3, '0'); }
function signedDistance(point: Point2, nx: number, ny: number, c: number): number { return nx * point.x + ny * point.y - c; }
function clean(points: Point2[]): Point2[] {
  const output: Point2[] = [];
  for (const point of points) if (output.length === 0 || !pointsNearlyEqual(output[output.length - 1]!, point)) output.push(point);
  if (output.length > 1 && pointsNearlyEqual(output[0]!, output[output.length - 1]!)) output.pop();
  return output;
}
function clipHalfPlane(polygon: Polygon2, nx: number, ny: number, c: number, keepPositive: boolean): Point2[] {
  const output: Point2[] = [];
  const inside = (d: number) => keepPositive ? d >= -GEOMETRY_EPSILON : d <= GEOMETRY_EPSILON;
  for (let index = 0; index < polygon.points.length; index++) {
    const a = polygon.points[index]!; const b = polygon.points[(index + 1) % polygon.points.length]!;
    const da = signedDistance(a, nx, ny, c); const db = signedDistance(b, nx, ny, c);
    const aIn = inside(da); const bIn = inside(db);
    if (aIn) output.push({ ...a });
    if (aIn !== bIn) {
      const denominator = da - db;
      const t = Math.abs(denominator) <= GEOMETRY_EPSILON ? 0.5 : da / denominator;
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return clean(output);
}
function trySplit(polygon: Polygon2, angle: number, offset: number): readonly [Polygon2, Polygon2] | null {
  const centroid = polygonCentroid(polygon);
  const nx = Math.cos(angle); const ny = Math.sin(angle);
  const c = nx * centroid.x + ny * centroid.y + offset;
  const first = clipHalfPlane(polygon, nx, ny, c, false);
  const second = clipHalfPlane(polygon, nx, ny, c, true);
  if (first.length < 3 || second.length < 3) return null;
  try {
    const a = normalizePolygon(first); const b = normalizePolygon(second);
    const minArea = polygonArea(polygon) * 0.08;
    return polygonArea(a) >= minArea && polygonArea(b) >= minArea ? [a, b] : null;
  } catch { return null; }
}
function splitPolygon(polygon: Polygon2, rng: SeededRandom): readonly [Polygon2, Polygon2] {
  const bounds = polygonBounds(polygon);
  const width = bounds.maxX - bounds.minX; const height = bounds.maxY - bounds.minY;
  const baseAngle = width >= height ? 0 : Math.PI / 2;
  const scale = Math.max(width, height);
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = baseAngle + (rng.next() - 0.5) * 0.9;
    const offset = (rng.next() - 0.5) * scale * 0.16;
    const split = trySplit(polygon, angle, offset);
    if (split) return split;
  }
  const fallback = trySplit(polygon, baseAngle, 0);
  if (!fallback) throw new Error('failed deterministic administrative split');
  return fallback;
}
function partition(polygon: Polygon2, count: number, rng: SeededRandom): Polygon2[] {
  const parts: Polygon2[] = [polygon];
  while (parts.length < count) {
    let index = 0;
    for (let i = 1; i < parts.length; i++) if (polygonArea(parts[i]!) > polygonArea(parts[index]!)) index = i;
    const source = parts.splice(index, 1)[0]!;
    const [a, b] = splitPolygon(source, rng);
    parts.push(a, b);
  }
  return parts.sort((a, b) => {
    const ca = polygonCentroid(a); const cb = polygonCentroid(b);
    return ca.x - cb.x || ca.y - cb.y;
  });
}
function entity(kind: GeographyKind, parentId: string | null, ordinal: number, boundary: Polygon2, parentSort: string): GeographyEntity {
  const ord = padded(ordinal);
  const id = kind === 'region' ? 'region:0' : `${kind}:${parentId}:${ord}`;
  return Object.freeze({ id, kind, parentId, boundary, sortKey: `${parentSort}.${ord}` });
}

export function generateAdministrativeHierarchy(root: Polygon2, rng: SeededRandom): readonly GeographyEntity[] {
  const entities: GeographyEntity[] = [];
  const region = entity('region', null, 0, root, '');
  entities.push(region);
  const municipality = entity('municipality', region.id, 0, root, region.sortKey);
  entities.push(municipality);
  const districts = partition(root, 2 + rng.nextInt(3), rng);
  districts.forEach((districtBoundary, districtIndex) => {
    const district = entity('district', municipality.id, districtIndex, districtBoundary, municipality.sortKey);
    entities.push(district);
    const neighborhoods = partition(districtBoundary, 2 + rng.nextInt(3), rng);
    neighborhoods.forEach((neighborhoodBoundary, neighborhoodIndex) => {
      const neighborhood = entity('neighborhood', district.id, neighborhoodIndex, neighborhoodBoundary, district.sortKey);
      entities.push(neighborhood);
      const blocks = partition(neighborhoodBoundary, 2 + rng.nextInt(5), rng);
      blocks.forEach((blockBoundary, blockIndex) => entities.push(entity('block', neighborhood.id, blockIndex, blockBoundary, neighborhood.sortKey)));
    });
  });
  return Object.freeze(entities.slice());
}
