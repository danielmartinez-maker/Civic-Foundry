import {
  normalizePoint,
  normalizeRing,
  polygonArea,
  polygonCentroid,
  polygonUnion,
  type PolygonRing,
  type WorldPoint,
} from './Geometry.ts';
import type { CadastralGraph } from './CadastralGraph.ts';
import { createParcelLineageEvent, lineageParents } from './ParcelLineage.ts';
import { validateCadastralSnapshot } from './CadastralValidator.ts';
import type {
  CadastralMutationResult,
  CadastralSnapshot,
  Parcel,
  ParcelEdge,
  ParcelEdgeKind,
  ParcelNode,
  UrbanBlock,
} from './CadastralTypes.ts';

const GEOMETRY_EPSILON = 1e-7;
const AREA_TOLERANCE_M2 = 0.01;
const MIN_SPLIT_AREA_M2 = 1;
const MIN_CUT_LENGTH_M = 0.1;

export type CadastralMutationGuard = Readonly<{
  canSplitParcel?: (parcelId: string, cutLine: readonly WorldPoint[]) => boolean;
}>;

type ParcelGeometrySpec = Readonly<{
  parcel: Omit<Parcel, 'boundaryEdgeIds' | 'frontageEdgeIds' | 'accessEdgeIds' | 'areaM2' | 'centroid'>;
  polygon: PolygonRing;
}>;

type SegmentUse = Readonly<{
  parcelId: string;
  from: WorldPoint;
  to: WorldPoint;
}>;

export class CadastralMutationSystem {
  private readonly graph: CadastralGraph;
  private readonly guard: CadastralMutationGuard;

  constructor(
    graph: CadastralGraph,
    guard: CadastralMutationGuard = Object.freeze({}),
  ) {
    this.graph = graph;
    this.guard = guard;
  }

  splitParcel(parcelId: string, cutLine: readonly WorldPoint[]): CadastralMutationResult {
    const before = this.graph.snapshot();
    try {
      const source = this.graph.getParcel(parcelId);
      if (!source) return rejected(`unknown-parcel:${parcelId}`);
      if (cutLine.length !== 2) return rejected('split-requires-two-point-cut');
      if (before.easements.some((easement) => easement.parcelIds.includes(parcelId))) {
        return rejected('parcel-has-easement');
      }

      const start = normalizePoint(cutLine[0]!);
      const end = normalizePoint(cutLine[1]!);
      if (distance(start, end) < MIN_CUT_LENGTH_M) return rejected('cut-too-short');

      const sourcePolygon = this.graph.parcelPolygon(parcelId);
      if (!pointOnBoundary(start, sourcePolygon) || !pointOnBoundary(end, sourcePolygon)) {
        return rejected('cut-endpoints-must-lie-on-boundary');
      }
      if (this.guard.canSplitParcel && !this.guard.canSplitParcel(parcelId, Object.freeze([start, end]))) {
        return rejected('split-guard-rejected');
      }

      const pieces = splitRingByChord(sourcePolygon, start, end);
      if (!pieces) return rejected('cut-does-not-produce-two-valid-parcels');
      const sourceArea = polygonArea(sourcePolygon);
      const splitArea = pieces.reduce((sum, ring) => sum + polygonArea(ring), 0);
      if (Math.abs(sourceArea - splitArea) > AREA_TOLERANCE_M2) return rejected('split-area-not-conserved');

      const sequence = mutationSequence(before);
      const childIds = Object.freeze([
        `parcel:${source.id}:split:${sequence}:0`,
        `parcel:${source.id}:split:${sequence}:1`,
      ]);
      if (new Set(childIds).size !== childIds.length || childIds.some((id) => before.parcels.some((parcel) => parcel.id === id))) {
        return rejected('generated-parcel-id-collision');
      }

      const parents = lineageParents([source.id], source.historicalParentIds);
      const specs = currentGeometrySpecs(this.graph, before, new Set([source.id]));
      for (let index = 0; index < pieces.length; index += 1) {
        const id = childIds[index]!;
        specs.push(Object.freeze({
          parcel: Object.freeze({
            id,
            blockId: source.blockId,
            zoningDistrictId: source.zoningDistrictId,
            ...(source.ownerId === undefined ? {} : { ownerId: source.ownerId }),
            historicalParentIds: parents,
          }),
          polygon: pieces[index]!,
        }));
      }

      const lineageEvent = createParcelLineageEvent(before, 'split', [source.id], childIds);
      const candidate = rebuildSnapshot(before, specs, Object.freeze([...before.lineage, lineageEvent]));
      const validation = validateCadastralSnapshot(candidate);
      if (!validation.valid) return rejected(...validation.errors.map((error) => `${error.code}:${error.message}`));

      this.graph.replaceSnapshot(candidate);
      return committed(childIds, [source.id], {});
    } catch (error) {
      return rejected(error instanceof Error ? error.message : 'split-failed');
    }
  }

  assembleParcels(parcelIds: readonly string[]): CadastralMutationResult {
    const before = this.graph.snapshot();
    try {
      const sourceIds = canonicalIds(parcelIds);
      if (sourceIds.length < 2) return rejected('assembly-requires-at-least-two-parcels');
      const sources = sourceIds.map((id) => this.graph.getParcel(id));
      if (sources.some((parcel) => !parcel)) return rejected('assembly-references-unknown-parcel');
      const parcels = sources as readonly Parcel[];

      const blockId = parcels[0]!.blockId;
      if (parcels.some((parcel) => parcel.blockId !== blockId)) return rejected('assembly-requires-one-block');
      const districtId = parcels[0]!.zoningDistrictId;
      if (parcels.some((parcel) => parcel.zoningDistrictId !== districtId)) return rejected('assembly-requires-one-zoning-district');
      const ownerId = parcels[0]!.ownerId;
      if (parcels.some((parcel) => parcel.ownerId !== ownerId)) return rejected('assembly-requires-common-owner');
      if (before.easements.some((easement) => easement.parcelIds.some((id) => sourceIds.includes(id)))) {
        return rejected('parcel-has-easement');
      }
      if (!selectionIsConnected(this.graph, sourceIds)) return rejected('assembly-parcels-not-adjacent');

      const union = polygonUnion(sourceIds.map((id) => this.graph.parcelPolygon(id)));
      if (union.length !== 1) return rejected('assembly-does-not-form-one-contiguous-polygon');
      const assembledPolygon = union[0]!;
      const sourceArea = parcels.reduce((sum, parcel) => sum + parcel.areaM2, 0);
      if (Math.abs(polygonArea(assembledPolygon) - sourceArea) > AREA_TOLERANCE_M2) {
        return rejected('assembly-area-not-conserved');
      }

      const sequence = mutationSequence(before);
      const assembledId = `parcel:assembly:${sequence}:${sourceIds.join('+')}`;
      if (before.parcels.some((parcel) => parcel.id === assembledId)) return rejected('generated-parcel-id-collision');
      const inheritedParents = parcels.flatMap((parcel) => parcel.historicalParentIds);
      const parents = lineageParents(sourceIds, inheritedParents);

      const specs = currentGeometrySpecs(this.graph, before, new Set(sourceIds));
      specs.push(Object.freeze({
        parcel: Object.freeze({
          id: assembledId,
          blockId,
          zoningDistrictId: districtId,
          ...(ownerId === undefined ? {} : { ownerId }),
          historicalParentIds: parents,
        }),
        polygon: assembledPolygon,
      }));

      const lineageEvent = createParcelLineageEvent(before, 'assembly', sourceIds, [assembledId]);
      const candidate = rebuildSnapshot(before, specs, Object.freeze([...before.lineage, lineageEvent]));
      const validation = validateCadastralSnapshot(candidate);
      if (!validation.valid) return rejected(...validation.errors.map((error) => `${error.code}:${error.message}`));

      this.graph.replaceSnapshot(candidate);
      const rewrites = Object.fromEntries(sourceIds.map((id) => [id, assembledId]));
      return committed([assembledId], sourceIds, rewrites);
    } catch (error) {
      return rejected(error instanceof Error ? error.message : 'assembly-failed');
    }
  }
}

function currentGeometrySpecs(
  graph: CadastralGraph,
  snapshot: CadastralSnapshot,
  excludedIds: ReadonlySet<string>,
): ParcelGeometrySpec[] {
  return snapshot.parcels
    .filter((parcel) => !excludedIds.has(parcel.id))
    .map((parcel) => Object.freeze({
      parcel: Object.freeze({
        id: parcel.id,
        blockId: parcel.blockId,
        zoningDistrictId: parcel.zoningDistrictId,
        ...(parcel.ownerId === undefined ? {} : { ownerId: parcel.ownerId }),
        historicalParentIds: Object.freeze([...parcel.historicalParentIds]),
      }),
      polygon: graph.parcelPolygon(parcel.id),
    }));
}

function rebuildSnapshot(
  before: CadastralSnapshot,
  rawSpecs: readonly ParcelGeometrySpec[],
  lineage: CadastralSnapshot['lineage'],
): CadastralSnapshot {
  const oldNodesByPoint = new Map(before.nodes.map((node) => [pointKey(node.point), node]));
  const oldEdges = before.edges;
  const allVertices = rawSpecs.flatMap((spec) => normalizeRing(spec.polygon));
  const specs = rawSpecs
    .map((spec) => Object.freeze({ ...spec, polygon: segmentizeRing(spec.polygon, allVertices) }))
    .sort((left, right) => left.parcel.id.localeCompare(right.parcel.id));

  const nodeByPoint = new Map<string, ParcelNode>();
  const usedNodeIds = new Set<string>();
  const ensureNode = (point: WorldPoint): ParcelNode => {
    const key = pointKey(point);
    const existing = nodeByPoint.get(key);
    if (existing) return existing;
    const previous = oldNodesByPoint.get(key);
    const id = previous && !usedNodeIds.has(previous.id)
      ? previous.id
      : uniqueId(`node:${key}`, usedNodeIds);
    usedNodeIds.add(id);
    const node = Object.freeze({ id, point: normalizePoint(point) });
    nodeByPoint.set(key, node);
    return node;
  };

  const usesBySegment = new Map<string, SegmentUse[]>();
  const segmentKeysByParcel = new Map<string, string[]>();
  for (const spec of specs) {
    const ring = normalizeRing(spec.polygon);
    const keys: string[] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const from = ring[index]!;
      const to = ring[(index + 1) % ring.length]!;
      ensureNode(from);
      ensureNode(to);
      const key = segmentKey(from, to);
      keys.push(key);
      const uses = usesBySegment.get(key) ?? [];
      uses.push(Object.freeze({ parcelId: spec.parcel.id, from, to }));
      usesBySegment.set(key, uses);
    }
    segmentKeysByParcel.set(spec.parcel.id, keys);
  }

  const oldExactEdgeBySegment = new Map<string, ParcelEdge>();
  const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
  for (const edge of oldEdges) {
    const from = oldNodes.get(edge.fromNodeId)?.point;
    const to = oldNodes.get(edge.toNodeId)?.point;
    if (from && to) oldExactEdgeBySegment.set(segmentKey(from, to), edge);
  }

  const usedEdgeIds = new Set<string>();
  const edgeBySegment = new Map<string, ParcelEdge>();
  for (const key of [...usesBySegment.keys()].sort()) {
    const uses = usesBySegment.get(key)!;
    if (uses.length > 2) throw new Error(`non-manifold parcel boundary:${key}`);
    const first = uses[0]!;
    const fromNode = ensureNode(first.from);
    const toNode = ensureNode(first.to);
    const previous = oldExactEdgeBySegment.get(key);
    const id = previous && !usedEdgeIds.has(previous.id)
      ? previous.id
      : uniqueId(`edge:${key}`, usedEdgeIds);
    usedEdgeIds.add(id);

    const shared = uses.length === 2;
    const inherited = shared ? undefined : findContainingOldEdge(first.from, first.to, oldEdges, oldNodes);
    const kind: ParcelEdgeKind = shared ? 'property-boundary' : (inherited?.kind ?? 'property-boundary');
    const edge = Object.freeze({
      id,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      leftParcelId: first.parcelId,
      ...(uses[1] ? { rightParcelId: uses[1].parcelId } : {}),
      kind,
      ...(kind === 'street-frontage' && inherited?.roadRef ? { roadRef: inherited.roadRef } : {}),
    });
    edgeBySegment.set(key, edge);
  }

  const parcels: Parcel[] = specs.map((spec) => {
    const keys = segmentKeysByParcel.get(spec.parcel.id)!;
    const boundaryEdgeIds = keys.map((key) => edgeBySegment.get(key)!.id);
    const frontageEdgeIds = keys
      .map((key) => edgeBySegment.get(key)!)
      .filter((edge) => edge.kind === 'street-frontage')
      .map((edge) => edge.id);
    return Object.freeze({
      ...spec.parcel,
      boundaryEdgeIds: Object.freeze(boundaryEdgeIds),
      areaM2: polygonArea(spec.polygon),
      centroid: polygonCentroid(spec.polygon),
      frontageEdgeIds: Object.freeze(frontageEdgeIds),
      accessEdgeIds: Object.freeze([...frontageEdgeIds]),
    });
  });

  const blocks: UrbanBlock[] = before.blocks.map((block) => {
    const parcelIds = parcels.filter((parcel) => parcel.blockId === block.id).map((parcel) => parcel.id).sort();
    const roadEdgeIds = [...new Set(parcels
      .filter((parcel) => parcel.blockId === block.id)
      .flatMap((parcel) => parcel.frontageEdgeIds))].sort();
    return Object.freeze({
      ...block,
      boundary: Object.freeze(block.boundary.map((point) => normalizePoint(point))),
      parcelIds: Object.freeze(parcelIds),
      roadEdgeIds: Object.freeze(roadEdgeIds),
    });
  });

  return Object.freeze({
    nodes: Object.freeze([...nodeByPoint.values()].sort((left, right) => left.id.localeCompare(right.id))),
    edges: Object.freeze([...edgeBySegment.values()].sort((left, right) => left.id.localeCompare(right.id))),
    blocks: Object.freeze(blocks),
    parcels: Object.freeze(parcels),
    easements: Object.freeze(before.easements.map((easement) => Object.freeze({
      ...easement,
      parcelIds: Object.freeze([...easement.parcelIds]),
      geometry: Object.freeze(easement.geometry.map((point) => normalizePoint(point))),
    }))),
    lineage,
  });
}

function splitRingByChord(ring: PolygonRing, start: WorldPoint, end: WorldPoint): readonly [PolygonRing, PolygonRing] | null {
  const positive = clipToHalfPlane(ring, start, end, 1);
  const negative = clipToHalfPlane(ring, start, end, -1);
  if (!positive || !negative) return null;
  if (polygonArea(positive) < MIN_SPLIT_AREA_M2 || polygonArea(negative) < MIN_SPLIT_AREA_M2) return null;
  return Object.freeze([positive, negative]);
}

function clipToHalfPlane(
  ring: PolygonRing,
  lineStart: WorldPoint,
  lineEnd: WorldPoint,
  sign: 1 | -1,
): PolygonRing | null {
  const source = normalizeRing(ring);
  const output: WorldPoint[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const from = source[index]!;
    const to = source[(index + 1) % source.length]!;
    const fromSide = lineSide(lineStart, lineEnd, from) * sign;
    const toSide = lineSide(lineStart, lineEnd, to) * sign;
    const fromInside = fromSide >= -GEOMETRY_EPSILON;
    const toInside = toSide >= -GEOMETRY_EPSILON;

    if (fromInside && toInside) {
      output.push(to);
    } else if (fromInside && !toInside) {
      output.push(lineIntersection(from, to, lineStart, lineEnd));
    } else if (!fromInside && toInside) {
      output.push(lineIntersection(from, to, lineStart, lineEnd));
      output.push(to);
    }
  }
  if (output.length < 3) return null;
  try {
    return normalizeRing(output);
  } catch {
    return null;
  }
}

function segmentizeRing(ring: PolygonRing, vertices: readonly WorldPoint[]): PolygonRing {
  const source = normalizeRing(ring);
  const expanded: WorldPoint[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const from = source[index]!;
    const to = source[(index + 1) % source.length]!;
    expanded.push(from);
    const interior = vertices
      .map(normalizePoint)
      .filter((point) => !samePoint(point, from) && !samePoint(point, to) && pointOnSegment(point, from, to))
      .sort((left, right) => segmentParameter(left, from, to) - segmentParameter(right, from, to));
    for (const point of interior) {
      const previous = expanded.at(-1);
      if (!previous || !samePoint(previous, point)) expanded.push(point);
    }
  }
  return normalizeRing(expanded);
}

function findContainingOldEdge(
  from: WorldPoint,
  to: WorldPoint,
  oldEdges: readonly ParcelEdge[],
  oldNodes: ReadonlyMap<string, ParcelNode>,
): ParcelEdge | undefined {
  return oldEdges.find((edge) => {
    const oldFrom = oldNodes.get(edge.fromNodeId)?.point;
    const oldTo = oldNodes.get(edge.toNodeId)?.point;
    return oldFrom && oldTo && pointOnSegment(from, oldFrom, oldTo) && pointOnSegment(to, oldFrom, oldTo);
  });
}

function selectionIsConnected(graph: CadastralGraph, ids: readonly string[]): boolean {
  const selected = new Set(ids);
  const visited = new Set<string>();
  const queue = [ids[0]!];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const adjacent of graph.adjacentParcelIds(current)) {
      if (selected.has(adjacent) && !visited.has(adjacent)) queue.push(adjacent);
    }
  }
  return visited.size === selected.size;
}

function pointOnBoundary(point: WorldPoint, ring: PolygonRing): boolean {
  const normalized = normalizeRing(ring);
  for (let index = 0; index < normalized.length; index += 1) {
    if (pointOnSegment(point, normalized[index]!, normalized[(index + 1) % normalized.length]!)) return true;
  }
  return false;
}

function pointOnSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > GEOMETRY_EPSILON) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < -GEOMETRY_EPSILON) return false;
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= lengthSquared + GEOMETRY_EPSILON;
}

function lineSide(start: WorldPoint, end: WorldPoint, point: WorldPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function lineIntersection(
  segmentStart: WorldPoint,
  segmentEnd: WorldPoint,
  lineStart: WorldPoint,
  lineEnd: WorldPoint,
): WorldPoint {
  const startSide = lineSide(lineStart, lineEnd, segmentStart);
  const endSide = lineSide(lineStart, lineEnd, segmentEnd);
  const denominator = startSide - endSide;
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return normalizePoint(segmentStart);
  const t = startSide / denominator;
  return normalizePoint({
    x: segmentStart.x + (segmentEnd.x - segmentStart.x) * t,
    y: segmentStart.y + (segmentEnd.y - segmentStart.y) * t,
  });
}

function segmentParameter(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator <= GEOMETRY_EPSILON) return 0;
  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator;
}

function distance(left: WorldPoint, right: WorldPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function mutationSequence(snapshot: CadastralSnapshot): number {
  return snapshot.lineage.reduce((maximum, event) => Math.max(maximum, event.tick), 0) + 1;
}

function canonicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function pointKey(point: WorldPoint): string {
  const normalized = normalizePoint(point);
  return `${normalized.x},${normalized.y}`;
}

function segmentKey(from: WorldPoint, to: WorldPoint): string {
  const left = pointKey(from);
  const right = pointKey(to);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function samePoint(left: WorldPoint, right: WorldPoint): boolean {
  return Math.abs(left.x - right.x) <= GEOMETRY_EPSILON && Math.abs(left.y - right.y) <= GEOMETRY_EPSILON;
}

function uniqueId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let suffix = 1;
  while (used.has(`${base}:${suffix}`)) suffix += 1;
  return `${base}:${suffix}`;
}

function committed(
  resultingParcelIds: readonly string[],
  retiredParcelIds: readonly string[],
  parcelReferenceRewrites: Readonly<Record<string, string>>,
): CadastralMutationResult {
  return Object.freeze({
    committed: true,
    resultingParcelIds: Object.freeze([...resultingParcelIds]),
    retiredParcelIds: Object.freeze([...retiredParcelIds].sort()),
    parcelReferenceRewrites: Object.freeze({ ...parcelReferenceRewrites }),
    rejectionReasons: Object.freeze([]),
  });
}

function rejected(...reasons: readonly string[]): CadastralMutationResult {
  return Object.freeze({
    committed: false,
    resultingParcelIds: Object.freeze([]),
    retiredParcelIds: Object.freeze([]),
    parcelReferenceRewrites: Object.freeze({}),
    rejectionReasons: Object.freeze([...reasons]),
  });
}
