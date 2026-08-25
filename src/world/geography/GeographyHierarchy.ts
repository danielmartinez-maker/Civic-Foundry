import type { Point2, Polygon2 } from '../geometry/GeometryTypes.ts';
import { GEOMETRY_EPSILON } from '../geometry/GeometryTolerance.ts';
import { pointInPolygon, polygonCentroid } from '../geometry/PolygonMath.ts';
import type { GeographyEntity, GeographyId, GeographyKind, GeographySnapshot } from './GeographyTypes.ts';

const PARENT_KIND: Readonly<Partial<Record<GeographyKind, GeographyKind>>> = Object.freeze({
  municipality: 'region',
  district: 'municipality',
  neighborhood: 'district',
  block: 'neighborhood',
});
const DEPTH: Readonly<Record<GeographyKind, number>> = Object.freeze({ region: 0, municipality: 1, district: 2, neighborhood: 3, block: 4 });

function ordinalCompare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function clonePolygon(polygon: Polygon2): Polygon2 {
  return Object.freeze({ points: Object.freeze(polygon.points.map((point) => Object.freeze({ ...point }))) });
}
function cloneEntity(entity: GeographyEntity): GeographyEntity {
  const base = { id: entity.id, kind: entity.kind, parentId: entity.parentId, boundary: clonePolygon(entity.boundary), sortKey: entity.sortKey };
  return Object.freeze(entity.name === undefined ? base : { ...base, name: entity.name });
}
function properCross(a: Point2, b: Point2, c: Point2): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function edgesProperlyCross(a0: Point2, a1: Point2, b0: Point2, b1: Point2): boolean {
  const c1 = properCross(a0, a1, b0); const c2 = properCross(a0, a1, b1);
  const c3 = properCross(b0, b1, a0); const c4 = properCross(b0, b1, a1);
  return ((c1 > GEOMETRY_EPSILON && c2 < -GEOMETRY_EPSILON) || (c1 < -GEOMETRY_EPSILON && c2 > GEOMETRY_EPSILON))
    && ((c3 > GEOMETRY_EPSILON && c4 < -GEOMETRY_EPSILON) || (c3 < -GEOMETRY_EPSILON && c4 > GEOMETRY_EPSILON));
}
function materiallyOverlap(a: Polygon2, b: Polygon2): boolean {
  if (a.points.some((point) => pointInPolygon(point, b, false)) || b.points.some((point) => pointInPolygon(point, a, false))) return true;
  const centroidA = polygonCentroid(a); const centroidB = polygonCentroid(b);
  if (pointInPolygon(centroidA, b, false) || pointInPolygon(centroidB, a, false)) return true;
  for (let i = 0; i < a.points.length; i++) {
    const a0 = a.points[i]!; const a1 = a.points[(i + 1) % a.points.length]!;
    const midpoint = { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 };
    if (pointInPolygon(midpoint, b, false)) return true;
    for (let j = 0; j < b.points.length; j++) {
      const b0 = b.points[j]!; const b1 = b.points[(j + 1) % b.points.length]!;
      if (edgesProperlyCross(a0, a1, b0, b1)) return true;
    }
  }
  for (let i = 0; i < b.points.length; i++) {
    const b0 = b.points[i]!; const b1 = b.points[(i + 1) % b.points.length]!;
    if (pointInPolygon({ x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 }, a, false)) return true;
  }
  return false;
}
function childInsideParent(child: Polygon2, parent: Polygon2): boolean {
  return child.points.every((point) => pointInPolygon(point, parent, true)) && pointInPolygon(polygonCentroid(child), parent, true);
}

export class GeographyHierarchy {
  private readonly byId = new Map<GeographyId, GeographyEntity>();
  private readonly ordered: readonly GeographyEntity[];

  constructor(entities: readonly GeographyEntity[]) {
    for (const source of entities) {
      if (source.id.trim().length === 0) throw new Error('geography id must not be empty');
      if (this.byId.has(source.id)) throw new Error(`duplicate geography id: ${source.id}`);
      const entity = cloneEntity(source);
      this.byId.set(entity.id, entity);
    }
    const roots = [...this.byId.values()].filter((entity) => entity.kind === 'region' && entity.parentId === null);
    if (roots.length !== 1) throw new Error('geography requires exactly one region root');
    for (const entity of this.byId.values()) {
      if (entity.kind === 'region') {
        if (entity.parentId !== null) throw new Error('region parent kind is invalid');
        continue;
      }
      if (entity.parentId === null) throw new Error(`orphan geography: ${entity.id}`);
      const parent = this.byId.get(entity.parentId);
      if (!parent) throw new Error(`orphan geography: ${entity.id}`);
      if (parent.kind !== PARENT_KIND[entity.kind]) throw new Error(`invalid parent kind for ${entity.id}`);
      if (!childInsideParent(entity.boundary, parent.boundary)) throw new Error(`geography outside parent: ${entity.id}`);
    }
    for (const entity of this.byId.values()) {
      const seen = new Set<string>();
      let current: GeographyEntity | undefined = entity;
      while (current?.parentId !== null) {
        if (seen.has(current.id)) throw new Error(`geography cycle: ${entity.id}`);
        seen.add(current.id);
        current = this.byId.get(current.parentId);
        if (!current) break;
      }
    }
    const children = new Map<string, GeographyEntity[]>();
    for (const entity of this.byId.values()) {
      if (entity.parentId === null) continue;
      const list = children.get(entity.parentId) ?? [];
      list.push(entity); children.set(entity.parentId, list);
    }
    for (const siblings of children.values()) {
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          if (materiallyOverlap(siblings[i]!.boundary, siblings[j]!.boundary)) throw new Error(`sibling overlap: ${siblings[i]!.id} / ${siblings[j]!.id}`);
        }
      }
    }
    this.ordered = Object.freeze([...this.byId.values()].sort((a, b) => ordinalCompare(a.sortKey, b.sortKey) || ordinalCompare(a.id, b.id)));
  }

  get(id: GeographyId): GeographyEntity | undefined { return this.byId.get(id); }
  list(kind?: GeographyKind): readonly GeographyEntity[] { return Object.freeze(this.ordered.filter((entity) => kind === undefined || entity.kind === kind)); }
  childrenOf(id: GeographyId): readonly GeographyEntity[] { return Object.freeze(this.ordered.filter((entity) => entity.parentId === id)); }
  parentOf(id: GeographyId): GeographyEntity | undefined {
    const parentId = this.byId.get(id)?.parentId;
    return parentId === null || parentId === undefined ? undefined : this.byId.get(parentId);
  }
  entityAt(point: Point2, kind?: GeographyKind): GeographyEntity | undefined {
    const matches = this.ordered.filter((entity) => (kind === undefined || entity.kind === kind) && pointInPolygon(point, entity.boundary, true));
    matches.sort((a, b) => DEPTH[b.kind] - DEPTH[a.kind] || ordinalCompare(a.id, b.id));
    return matches[0];
  }
  snapshot(): GeographySnapshot { return Object.freeze({ entities: Object.freeze(this.ordered.map(cloneEntity)) }); }
  static restore(snapshot: GeographySnapshot): GeographyHierarchy { return new GeographyHierarchy(snapshot.entities); }
}
