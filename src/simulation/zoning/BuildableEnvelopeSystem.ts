import {
  polygonArea,
  polygonIntersection,
  type MultiPolygon,
  type PolygonRing,
  type WorldPoint,
} from '../../world/cadastre/Geometry.ts';
import type { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import type { Parcel, ParcelEdge } from '../../world/cadastre/CadastralTypes.ts';
import type {
  ParcelDevelopmentEnvelope,
  UseType,
  ZoningConstraint,
  ZoningDistrict,
  ZoningOverlay,
} from './ZoningTypes.ts';

const FLOOR_TO_FLOOR_METERS = 3.2;
const EPSILON = 1e-9;

type EdgeRole = 'front' | 'rear' | 'side';
type EffectiveRules = Readonly<{
  maxFAR: number;
  maxHeightMeters: number;
  maxCoverageRatio: number;
  frontSetbackMeters: number;
  rearSetbackMeters: number;
  sideSetbackMeters: number;
  permittedUses: readonly UseType[];
}>;

export class BuildableEnvelopeSystem {
  evaluate(
    parcelId: string,
    graph: CadastralGraph,
    district: ZoningDistrict,
    overlays: readonly ZoningOverlay[] = [],
  ): ParcelDevelopmentEnvelope {
    const parcel = graph.getParcel(parcelId);
    if (!parcel) throw new Error(`unknown parcel: ${parcelId}`);
    const parcelPolygon = graph.parcelPolygon(parcelId);
    const applicableOverlays = overlays
      .filter((overlay) => overlay.parcelIds.includes(parcelId))
      .sort((left, right) => left.id.localeCompare(right.id));
    const rules = applyOverlays(district, applicableOverlays);
    const frontageMeters = parcel.frontageEdgeIds.reduce(
      (sum, edgeId) => sum + edgeLength(graph, edgeId),
      0,
    );
    const limitingConstraints: ZoningConstraint[] = [];

    if (parcel.areaM2 < district.minParcelAreaM2) {
      limitingConstraints.push(constraint('minimum-area', district.minParcelAreaM2, parcel.areaM2, district.id));
    }
    if (frontageMeters + EPSILON < district.minFrontageMeters) {
      limitingConstraints.push(constraint('minimum-frontage', district.minFrontageMeters, frontageMeters, district.id));
    }
    for (const overlay of applicableOverlays) {
      limitingConstraints.push(constraint('overlay', overlay.id, overlay.kind, overlay.id));
    }

    const dimensionallyEligible = parcel.areaM2 + EPSILON >= district.minParcelAreaM2
      && frontageMeters + EPSILON >= district.minFrontageMeters;
    const buildablePieces = dimensionallyEligible
      ? insetByEdgeSetbacks(parcel, parcelPolygon, graph, rules)
      : Object.freeze([]) as MultiPolygon;
    const buildableFootprint = largestRing(buildablePieces);
    const geometryFloorplate = buildableFootprint.length >= 3 ? polygonArea(buildableFootprint) : 0;
    const zoningFloorArea = parcel.areaM2 * rules.maxFAR;
    const coverageFloorplate = parcel.areaM2 * rules.maxCoverageRatio;
    const maxFootprintAreaM2 = Math.min(coverageFloorplate, geometryFloorplate);
    const heightStories = Math.max(1, Math.floor(rules.maxHeightMeters / FLOOR_TO_FLOOR_METERS));
    const storyLimit = Math.min(heightStories, district.maxStories ?? heightStories);
    const heightFloorArea = maxFootprintAreaM2 * storyLimit;
    const maxGrossFloorAreaM2 = Math.min(zoningFloorArea, heightFloorArea);
    const effectiveFAR = parcel.areaM2 > 0 ? maxGrossFloorAreaM2 / parcel.areaM2 : 0;

    if (rules.frontSetbackMeters > 0) limitingConstraints.push(constraint('front-setback', rules.frontSetbackMeters, rules.frontSetbackMeters, district.id));
    if (rules.rearSetbackMeters > 0) limitingConstraints.push(constraint('rear-setback', rules.rearSetbackMeters, rules.rearSetbackMeters, district.id));
    if (rules.sideSetbackMeters > 0) limitingConstraints.push(constraint('side-setback', rules.sideSetbackMeters, rules.sideSetbackMeters, district.id));
    if (parcel.areaM2 > 0 && coverageFloorplate <= geometryFloorplate + EPSILON) {
      limitingConstraints.push(constraint('coverage', rules.maxCoverageRatio, maxFootprintAreaM2 / parcel.areaM2, district.id));
    }
    if (zoningFloorArea <= heightFloorArea + EPSILON) {
      limitingConstraints.push(constraint('far', rules.maxFAR, effectiveFAR, district.id));
    } else {
      limitingConstraints.push(constraint('height', rules.maxHeightMeters, rules.maxHeightMeters, district.id));
    }

    return Object.freeze({
      parcelId,
      districtId: district.id,
      buildableFootprint,
      parcelAreaM2: parcel.areaM2,
      frontageMeters,
      maxFootprintAreaM2,
      maxGrossFloorAreaM2,
      maxHeightMeters: rules.maxHeightMeters,
      maxStories: storyLimit,
      allowedFAR: rules.maxFAR,
      effectiveFAR,
      effectiveCoverageRatio: parcel.areaM2 > 0 ? maxFootprintAreaM2 / parcel.areaM2 : 0,
      permittedUses: rules.permittedUses,
      limitingConstraints: Object.freeze(limitingConstraints),
    });
  }
}

function applyOverlays(district: ZoningDistrict, overlays: readonly ZoningOverlay[]): EffectiveRules {
  let maxFAR = district.maxFAR;
  let maxHeightMeters = district.maxHeightMeters;
  let maxCoverageRatio = district.maxCoverageRatio;
  let frontSetbackMeters = district.frontSetbackMeters;
  let rearSetbackMeters = district.rearSetbackMeters;
  let sideSetbackMeters = district.sideSetbackMeters;
  const uses = new Set<UseType>(district.permittedUses);

  for (const overlay of overlays) {
    if (overlay.maxFARMultiplier !== undefined) {
      if (!Number.isFinite(overlay.maxFARMultiplier) || overlay.maxFARMultiplier < 0) {
        throw new Error(`invalid FAR multiplier in overlay ${overlay.id}`);
      }
      maxFAR *= overlay.maxFARMultiplier;
    }
    if (overlay.maxHeightMeters !== undefined) maxHeightMeters = Math.min(maxHeightMeters, overlay.maxHeightMeters);
    if (overlay.maxCoverageRatio !== undefined) maxCoverageRatio = Math.min(maxCoverageRatio, overlay.maxCoverageRatio);
    frontSetbackMeters += overlay.additionalFrontSetbackMeters ?? 0;
    rearSetbackMeters += overlay.additionalRearSetbackMeters ?? 0;
    sideSetbackMeters += overlay.additionalSideSetbackMeters ?? 0;
    for (const use of overlay.permittedUseAdditions ?? []) uses.add(use);
    for (const use of overlay.prohibitedUses ?? []) uses.delete(use);
  }

  return Object.freeze({
    maxFAR,
    maxHeightMeters,
    maxCoverageRatio,
    frontSetbackMeters,
    rearSetbackMeters,
    sideSetbackMeters,
    permittedUses: Object.freeze([...uses].sort()),
  });
}

function insetByEdgeSetbacks(
  parcel: Parcel,
  ring: PolygonRing,
  graph: CadastralGraph,
  rules: EffectiveRules,
): MultiPolygon {
  if (ring.length < 3) return Object.freeze([]);
  const roleByEdge = classifyEdges(parcel, graph);
  const ccw = signedDoubleArea(ring) > 0;
  let current: MultiPolygon = Object.freeze([ring]);
  const extent = polygonExtent(ring) + Math.max(
    rules.frontSetbackMeters,
    rules.rearSetbackMeters,
    rules.sideSetbackMeters,
  ) + 1000;

  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]!;
    const end = ring[(index + 1) % ring.length]!;
    const edge = findEdgeForSegment(parcel, graph, start, end);
    const role = edge ? roleByEdge.get(edge.id) ?? 'side' : 'side';
    const setback = role === 'front'
      ? rules.frontSetbackMeters
      : role === 'rear'
        ? rules.rearSetbackMeters
        : rules.sideSetbackMeters;
    if (setback <= 0) continue;
    current = polygonIntersection(current, inwardHalfPlane(start, end, setback, ccw, extent));
    if (current.length === 0) break;
  }
  return current;
}

function classifyEdges(parcel: Parcel, graph: CadastralGraph): ReadonlyMap<string, EdgeRole> {
  const roles = new Map<string, EdgeRole>();
  const frontage = new Set(parcel.frontageEdgeIds);
  for (const edgeId of parcel.boundaryEdgeIds) if (frontage.has(edgeId)) roles.set(edgeId, 'front');
  const nonFrontage = parcel.boundaryEdgeIds.filter((edgeId) => !frontage.has(edgeId));
  if (frontage.size === 0 || nonFrontage.length === 0) {
    for (const edgeId of nonFrontage) roles.set(edgeId, 'side');
    return roles;
  }

  const frontageMidpoints = [...frontage]
    .map((edgeId) => edgeMidpoint(graph, edgeId))
    .filter((point): point is WorldPoint => point !== undefined);
  let rearId: string | undefined;
  let rearScore = -Infinity;
  for (const edgeId of nonFrontage) {
    const midpoint = edgeMidpoint(graph, edgeId);
    if (!midpoint || frontageMidpoints.length === 0) continue;
    const score = Math.min(...frontageMidpoints.map((front) => Math.hypot(midpoint.x - front.x, midpoint.y - front.y)));
    if (score > rearScore + EPSILON || (Math.abs(score - rearScore) <= EPSILON && (rearId === undefined || edgeId < rearId))) {
      rearId = edgeId;
      rearScore = score;
    }
  }
  for (const edgeId of nonFrontage) roles.set(edgeId, edgeId === rearId ? 'rear' : 'side');
  return roles;
}

function inwardHalfPlane(
  start: WorldPoint,
  end: WorldPoint,
  setback: number,
  ccw: boolean,
  extent: number,
): PolygonRing {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) throw new Error('cannot offset zero-length parcel edge');
  const tangent = { x: dx / length, y: dy / length };
  const leftNormal = { x: -tangent.y, y: tangent.x };
  const normal = ccw ? leftNormal : { x: -leftNormal.x, y: -leftNormal.y };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const base = { x: midpoint.x + normal.x * setback, y: midpoint.y + normal.y * setback };
  const a = { x: base.x - tangent.x * extent, y: base.y - tangent.y * extent };
  const b = { x: base.x + tangent.x * extent, y: base.y + tangent.y * extent };
  const c = { x: b.x + normal.x * extent * 2, y: b.y + normal.y * extent * 2 };
  const d = { x: a.x + normal.x * extent * 2, y: a.y + normal.y * extent * 2 };
  return Object.freeze([a, b, c, d]);
}

function findEdgeForSegment(
  parcel: Parcel,
  graph: CadastralGraph,
  start: WorldPoint,
  end: WorldPoint,
): ParcelEdge | undefined {
  for (const edgeId of parcel.boundaryEdgeIds) {
    const edge = graph.getEdge(edgeId);
    if (!edge) continue;
    const from = graph.getNode(edge.fromNodeId)?.point;
    const to = graph.getNode(edge.toNodeId)?.point;
    if (!from || !to) continue;
    if ((samePoint(from, start) && samePoint(to, end)) || (samePoint(from, end) && samePoint(to, start))) return edge;
  }
  return undefined;
}

function edgeLength(graph: CadastralGraph, edgeId: string): number {
  const edge = graph.getEdge(edgeId);
  if (!edge) return 0;
  const start = graph.getNode(edge.fromNodeId)?.point;
  const end = graph.getNode(edge.toNodeId)?.point;
  return start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
}

function edgeMidpoint(graph: CadastralGraph, edgeId: string): WorldPoint | undefined {
  const edge = graph.getEdge(edgeId);
  if (!edge) return undefined;
  const start = graph.getNode(edge.fromNodeId)?.point;
  const end = graph.getNode(edge.toNodeId)?.point;
  if (!start || !end) return undefined;
  return Object.freeze({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
}

function largestRing(polygons: MultiPolygon): PolygonRing {
  if (polygons.length === 0) return Object.freeze([]);
  return polygons.reduce((best, ring) => polygonArea(ring) > polygonArea(best) ? ring : best, polygons[0]!);
}

function polygonExtent(ring: PolygonRing): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(maxX - minX, maxY - minY, 1);
}

function signedDoubleArea(ring: PolygonRing): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return total;
}

function samePoint(left: WorldPoint, right: WorldPoint): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}

function constraint(
  code: ZoningConstraint['code'],
  limit: number | string,
  actual: number | string,
  sourceId: string,
): ZoningConstraint {
  return Object.freeze({ code, limit, actual, sourceId });
}
