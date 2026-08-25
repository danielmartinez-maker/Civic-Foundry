import { normalizeRing, polygonArea, polygonIntersection, type PolygonRing } from './Geometry.ts';
import type { CadastralGraph } from './CadastralGraph.ts';
import type {
  CadastralSnapshot,
  CadastralValidationError,
  CadastralValidationResult,
  Parcel,
  ParcelEdge,
  ParcelNode,
} from './CadastralTypes.ts';

const AREA_TOLERANCE_M2 = 0.01;

export function validateCadastralGraph(graph: CadastralGraph): CadastralValidationResult {
  return validateCadastralSnapshot(graph.snapshot());
}

export function validateCadastralSnapshot(snapshot: CadastralSnapshot): CadastralValidationResult {
  const errors: CadastralValidationError[] = [];
  checkDuplicateIds(snapshot, errors);

  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const edges = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  const blocks = new Map(snapshot.blocks.map((block) => [block.id, block]));
  const parcels = new Map(snapshot.parcels.map((parcel) => [parcel.id, parcel]));

  const referencedNodeIds = new Set<string>();
  const edgeByNodePair = new Map<string, string>();

  for (const edge of snapshot.edges) {
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    if (!from) push(errors, 'missing-node', `edge ${edge.id} references missing node ${edge.fromNodeId}`, edge.id);
    if (!to) push(errors, 'missing-node', `edge ${edge.id} references missing node ${edge.toNodeId}`, edge.id);
    if (from) referencedNodeIds.add(from.id);
    if (to) referencedNodeIds.add(to.id);
    if (from && to && samePoint(from.point, to.point)) {
      push(errors, 'zero-length-edge', `edge ${edge.id} has identical endpoints`, edge.id);
    }
    if (edge.leftParcelId && !parcels.has(edge.leftParcelId)) {
      push(errors, 'missing-parcel', `edge ${edge.id} references missing left parcel ${edge.leftParcelId}`, edge.id);
    }
    if (edge.rightParcelId && !parcels.has(edge.rightParcelId)) {
      push(errors, 'missing-parcel', `edge ${edge.id} references missing right parcel ${edge.rightParcelId}`, edge.id);
    }
    if (edge.leftParcelId && edge.rightParcelId && edge.leftParcelId === edge.rightParcelId) {
      push(errors, 'parcel-boundary-invalid', `edge ${edge.id} has the same parcel on both sides`, edge.id);
    }
    if (edge.kind === 'street-frontage' && !edge.roadRef) {
      push(errors, 'road-reference-missing', `street-frontage edge ${edge.id} has no roadRef`, edge.id);
    }

    const pairKey = canonicalNodePair(edge.fromNodeId, edge.toNodeId);
    const previous = edgeByNodePair.get(pairKey);
    if (previous && previous !== edge.id) {
      push(errors, 'duplicate-shared-boundary', `edges ${previous} and ${edge.id} duplicate the same node pair`, edge.id);
    } else {
      edgeByNodePair.set(pairKey, edge.id);
    }
  }

  for (const node of snapshot.nodes) {
    if (!referencedNodeIds.has(node.id)) push(errors, 'orphan-node', `node ${node.id} is not referenced by any edge`, node.id);
  }

  const parcelPolygons = new Map<string, PolygonRing>();
  for (const parcel of snapshot.parcels) {
    const block = blocks.get(parcel.blockId);
    if (!block) {
      push(errors, 'missing-block', `parcel ${parcel.id} references missing block ${parcel.blockId}`, parcel.id);
    } else if (!block.parcelIds.includes(parcel.id)) {
      push(errors, 'parcel-block-mismatch', `block ${block.id} does not list parcel ${parcel.id}`, parcel.id);
    }

    for (const edgeId of parcel.boundaryEdgeIds) {
      const edge = edges.get(edgeId);
      if (!edge) {
        push(errors, 'missing-edge', `parcel ${parcel.id} references missing boundary edge ${edgeId}`, parcel.id);
        continue;
      }
      if (edge.leftParcelId !== parcel.id && edge.rightParcelId !== parcel.id) {
        push(errors, 'parcel-boundary-invalid', `edge ${edgeId} does not reference parcel ${parcel.id}`, parcel.id);
      }
    }

    for (const edgeId of parcel.frontageEdgeIds) {
      const edge = edges.get(edgeId);
      if (!edge || !parcel.boundaryEdgeIds.includes(edgeId) || edge.kind !== 'street-frontage') {
        push(errors, 'frontage-invalid', `parcel ${parcel.id} has invalid frontage edge ${edgeId}`, parcel.id);
      }
    }

    for (const edgeId of parcel.accessEdgeIds) {
      if (!edges.has(edgeId)) push(errors, 'access-invalid', `parcel ${parcel.id} has invalid access edge ${edgeId}`, parcel.id);
    }

    try {
      const polygon = polygonFromSnapshot(parcel, edges, nodes);
      parcelPolygons.set(parcel.id, polygon);
      if (hasSelfIntersection(polygon)) {
        push(errors, 'parcel-self-intersection', `parcel ${parcel.id} boundary self-intersects`, parcel.id);
      }
      const calculatedArea = polygonArea(polygon);
      if (Math.abs(calculatedArea - parcel.areaM2) > AREA_TOLERANCE_M2) {
        push(
          errors,
          'parcel-area-mismatch',
          `parcel ${parcel.id} stores ${parcel.areaM2} m2 but topology encloses ${calculatedArea} m2`,
          parcel.id,
        );
      }
    } catch (error) {
      push(
        errors,
        'parcel-boundary-invalid',
        error instanceof Error ? error.message : `parcel ${parcel.id} has invalid boundary geometry`,
        parcel.id,
      );
    }
  }

  for (const block of snapshot.blocks) {
    for (const parcelId of block.parcelIds) {
      const parcel = parcels.get(parcelId);
      if (!parcel) push(errors, 'missing-parcel', `block ${block.id} references missing parcel ${parcelId}`, block.id);
      else if (parcel.blockId !== block.id) {
        push(errors, 'parcel-block-mismatch', `parcel ${parcel.id} points to block ${parcel.blockId}, not ${block.id}`, block.id);
      }
    }
    for (const edgeId of block.roadEdgeIds) {
      if (!edges.has(edgeId)) push(errors, 'missing-edge', `block ${block.id} references missing road edge ${edgeId}`, block.id);
    }
  }

  const parcelEntries = [...parcelPolygons.entries()];
  for (let leftIndex = 0; leftIndex < parcelEntries.length; leftIndex += 1) {
    const [leftId, leftPolygon] = parcelEntries[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < parcelEntries.length; rightIndex += 1) {
      const [rightId, rightPolygon] = parcelEntries[rightIndex]!;
      const overlapArea = polygonIntersection(leftPolygon, rightPolygon)
        .reduce((sum, ring) => sum + polygonArea(ring), 0);
      if (overlapArea > AREA_TOLERANCE_M2) {
        push(errors, 'parcel-overlap', `parcels ${leftId} and ${rightId} overlap by ${overlapArea} m2`, `${leftId}|${rightId}`);
      }
    }
  }

  for (const easement of snapshot.easements) {
    for (const parcelId of easement.parcelIds) {
      if (!parcels.has(parcelId)) {
        push(errors, 'easement-reference-invalid', `easement ${easement.id} references missing parcel ${parcelId}`, easement.id);
      }
    }
  }

  if (lineageHasCycle(snapshot)) push(errors, 'lineage-cycle', 'parcel lineage contains a cycle');

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function checkDuplicateIds(snapshot: CadastralSnapshot, errors: CadastralValidationError[]): void {
  const groups: readonly [string, readonly { id: string }[]][] = [
    ['node', snapshot.nodes],
    ['edge', snapshot.edges],
    ['block', snapshot.blocks],
    ['parcel', snapshot.parcels],
    ['easement', snapshot.easements],
    ['lineage', snapshot.lineage],
  ];
  for (const [kind, entities] of groups) {
    const seen = new Set<string>();
    for (const entity of entities) {
      if (seen.has(entity.id)) push(errors, 'duplicate-id', `duplicate ${kind} id ${entity.id}`, entity.id);
      seen.add(entity.id);
    }
  }
}

function polygonFromSnapshot(
  parcel: Parcel,
  edges: ReadonlyMap<string, ParcelEdge>,
  nodes: ReadonlyMap<string, ParcelNode>,
): PolygonRing {
  if (parcel.boundaryEdgeIds.length < 3) throw new Error(`parcel ${parcel.id} has fewer than three boundary edges`);
  const boundaryEdges = parcel.boundaryEdgeIds.map((edgeId) => {
    const edge = edges.get(edgeId);
    if (!edge) throw new Error(`parcel ${parcel.id} references missing edge ${edgeId}`);
    return edge;
  });
  const forward = walkBoundary(boundaryEdges, nodes, false);
  if (forward) return normalizeRing(forward);
  const reverse = walkBoundary(boundaryEdges, nodes, true);
  if (reverse) return normalizeRing(reverse);
  throw new Error(`parcel ${parcel.id} boundary edges do not form a closed chain`);
}

function walkBoundary(
  edges: readonly ParcelEdge[],
  nodes: ReadonlyMap<string, ParcelNode>,
  reverseFirst: boolean,
): readonly { x: number; y: number }[] | null {
  const first = edges[0]!;
  const startNodeId = reverseFirst ? first.toNodeId : first.fromNodeId;
  let currentNodeId = reverseFirst ? first.fromNodeId : first.toNodeId;
  const start = nodes.get(startNodeId);
  if (!start) return null;
  const points = [start.point];
  for (let index = 1; index < edges.length; index += 1) {
    const node = nodes.get(currentNodeId);
    if (!node) return null;
    points.push(node.point);
    const edge = edges[index]!;
    if (edge.fromNodeId === currentNodeId) currentNodeId = edge.toNodeId;
    else if (edge.toNodeId === currentNodeId) currentNodeId = edge.fromNodeId;
    else return null;
  }
  return currentNodeId === startNodeId ? points : null;
}

function hasSelfIntersection(ring: PolygonRing): boolean {
  for (let leftIndex = 0; leftIndex < ring.length; leftIndex += 1) {
    const leftA = ring[leftIndex]!;
    const leftB = ring[(leftIndex + 1) % ring.length]!;
    for (let rightIndex = leftIndex + 1; rightIndex < ring.length; rightIndex += 1) {
      if (rightIndex === leftIndex) continue;
      if (rightIndex === (leftIndex + 1) % ring.length) continue;
      if (leftIndex === 0 && rightIndex === ring.length - 1) continue;
      const rightA = ring[rightIndex]!;
      const rightB = ring[(rightIndex + 1) % ring.length]!;
      if (segmentsIntersect(leftA, leftB, rightA, rightB)) return true;
    }
  }
  return false;
}

function segmentsIntersect(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  c: Readonly<{ x: number; y: number }>,
  d: Readonly<{ x: number; y: number }>,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && onSegment(c, a, b)) return true;
  if (abD === 0 && onSegment(d, a, b)) return true;
  if (cdA === 0 && onSegment(a, c, d)) return true;
  if (cdB === 0 && onSegment(b, c, d)) return true;
  return abC !== abD && cdA !== cdB;
}

function orientation(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  c: Readonly<{ x: number; y: number }>,
): -1 | 0 | 1 {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) <= 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(
  point: Readonly<{ x: number; y: number }>,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): boolean {
  return point.x >= Math.min(start.x, end.x) - 1e-9
    && point.x <= Math.max(start.x, end.x) + 1e-9
    && point.y >= Math.min(start.y, end.y) - 1e-9
    && point.y <= Math.max(start.y, end.y) + 1e-9;
}

function lineageHasCycle(snapshot: CadastralSnapshot): boolean {
  const graph = new Map<string, Set<string>>();
  for (const event of snapshot.lineage) {
    for (const source of event.sourceParcelIds) {
      const targets = graph.get(source) ?? new Set<string>();
      for (const result of event.resultingParcelIds) targets.add(result);
      graph.set(source, targets);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some((id) => visit(id));
}

function samePoint(left: Readonly<{ x: number; y: number }>, right: Readonly<{ x: number; y: number }>): boolean {
  return left.x === right.x && left.y === right.y;
}

function canonicalNodePair(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function push(
  errors: CadastralValidationError[],
  code: CadastralValidationError['code'],
  message: string,
  entityId?: string,
): void {
  errors.push(Object.freeze(entityId === undefined ? { code, message } : { code, message, entityId }));
}
