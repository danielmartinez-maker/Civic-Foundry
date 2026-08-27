import { normalizeRing, type PolygonRing, type WorldPoint } from './Geometry.ts';
import type {
  CadastralSnapshot,
  Easement,
  Parcel,
  ParcelEdge,
  ParcelNode,
  ParcelLineageEvent,
  UrbanBlock,
} from './CadastralTypes.ts';
import { validateCadastralSnapshot } from './CadastralValidator.ts';

const EMPTY_SNAPSHOT: CadastralSnapshot = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  blocks: Object.freeze([]),
  parcels: Object.freeze([]),
  easements: Object.freeze([]),
  lineage: Object.freeze([]),
});

export class CadastralGraph {
  private nodes = new Map<string, ParcelNode>();
  private edges = new Map<string, ParcelEdge>();
  private blocks = new Map<string, UrbanBlock>();
  private parcels = new Map<string, Parcel>();
  private easements = new Map<string, Easement>();
  private lineage: readonly ParcelLineageEvent[] = Object.freeze([]);

  constructor(snapshot: CadastralSnapshot = EMPTY_SNAPSHOT) {
    const validation = validateCadastralSnapshot(snapshot);
    if (!validation.valid) throw new Error(formatValidationErrors(validation.errors));
    this.loadUnchecked(snapshot);
  }

  getParcel(id: string): Parcel | undefined { return this.parcels.get(id); }
  getBlock(id: string): UrbanBlock | undefined { return this.blocks.get(id); }
  getEdge(id: string): ParcelEdge | undefined { return this.edges.get(id); }
  getNode(id: string): ParcelNode | undefined { return this.nodes.get(id); }
  getEasement(id: string): Easement | undefined { return this.easements.get(id); }

  parcelPolygon(id: string): PolygonRing {
    const parcel = this.parcels.get(id);
    if (!parcel) throw new Error(`unknown parcel: ${id}`);
    return traceBoundary(parcel, this.edges, this.nodes);
  }

  adjacentParcelIds(id: string): readonly string[] {
    if (!this.parcels.has(id)) return Object.freeze([]);
    const adjacent = new Set<string>();
    for (const edge of this.edges.values()) {
      if (edge.leftParcelId === id && edge.rightParcelId) adjacent.add(edge.rightParcelId);
      if (edge.rightParcelId === id && edge.leftParcelId) adjacent.add(edge.leftParcelId);
    }
    return Object.freeze([...adjacent].sort());
  }

  listParcels(): readonly Parcel[] { return Object.freeze([...this.parcels.values()]); }
  listBlocks(): readonly UrbanBlock[] { return Object.freeze([...this.blocks.values()]); }
  listEdges(): readonly ParcelEdge[] { return Object.freeze([...this.edges.values()]); }
  listNodes(): readonly ParcelNode[] { return Object.freeze([...this.nodes.values()]); }
  listEasements(): readonly Easement[] { return Object.freeze([...this.easements.values()]); }
  listLineage(): readonly ParcelLineageEvent[] { return this.lineage; }

  snapshot(): CadastralSnapshot {
    return Object.freeze({
      nodes: Object.freeze([...this.nodes.values()]),
      edges: Object.freeze([...this.edges.values()]),
      blocks: Object.freeze([...this.blocks.values()]),
      parcels: Object.freeze([...this.parcels.values()]),
      easements: Object.freeze([...this.easements.values()]),
      lineage: this.lineage,
    });
  }

  replaceSnapshot(snapshot: CadastralSnapshot): void {
    const validation = validateCadastralSnapshot(snapshot);
    if (!validation.valid) throw new Error(formatValidationErrors(validation.errors));
    this.loadUnchecked(snapshot);
  }

  private loadUnchecked(snapshot: CadastralSnapshot): void {
    const cloned = cloneSnapshot(snapshot);
    this.nodes = new Map(cloned.nodes.map((node) => [node.id, node]));
    this.edges = new Map(cloned.edges.map((edge) => [edge.id, edge]));
    this.blocks = new Map(cloned.blocks.map((block) => [block.id, block]));
    this.parcels = new Map(cloned.parcels.map((parcel) => [parcel.id, parcel]));
    this.easements = new Map(cloned.easements.map((easement) => [easement.id, easement]));
    this.lineage = cloned.lineage;
  }
}

function cloneSnapshot(snapshot: CadastralSnapshot): CadastralSnapshot {
  return Object.freeze({
    nodes: Object.freeze(snapshot.nodes.map((node) => Object.freeze({
      id: node.id,
      point: Object.freeze({ x: node.point.x, y: node.point.y }),
    }))),
    edges: Object.freeze(snapshot.edges.map((edge) => Object.freeze({ ...edge }))),
    blocks: Object.freeze(snapshot.blocks.map((block) => Object.freeze({
      id: block.id,
      boundary: Object.freeze(block.boundary.map((point) => Object.freeze({ x: point.x, y: point.y }))),
      parcelIds: Object.freeze([...block.parcelIds]),
      roadEdgeIds: Object.freeze([...block.roadEdgeIds]),
    }))),
    parcels: Object.freeze(snapshot.parcels.map((parcel) => Object.freeze({
      ...parcel,
      centroid: Object.freeze({ x: parcel.centroid.x, y: parcel.centroid.y }),
      boundaryEdgeIds: Object.freeze([...parcel.boundaryEdgeIds]),
      frontageEdgeIds: Object.freeze([...parcel.frontageEdgeIds]),
      accessEdgeIds: Object.freeze([...parcel.accessEdgeIds]),
      historicalParentIds: Object.freeze([...parcel.historicalParentIds]),
    }))),
    easements: Object.freeze(snapshot.easements.map((easement) => Object.freeze({
      ...easement,
      parcelIds: Object.freeze([...easement.parcelIds]),
      geometry: Object.freeze(easement.geometry.map((point) => Object.freeze({ x: point.x, y: point.y }))),
    }))),
    lineage: Object.freeze(snapshot.lineage.map((event) => Object.freeze({
      ...event,
      sourceParcelIds: Object.freeze([...event.sourceParcelIds]),
      resultingParcelIds: Object.freeze([...event.resultingParcelIds]),
    }))),
  });
}

function traceBoundary(
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
): readonly WorldPoint[] | null {
  const first = edges[0]!;
  const startNodeId = reverseFirst ? first.toNodeId : first.fromNodeId;
  let currentNodeId = reverseFirst ? first.fromNodeId : first.toNodeId;
  const start = nodes.get(startNodeId);
  if (!start) return null;
  const points: WorldPoint[] = [start.point];

  for (let index = 1; index < edges.length; index += 1) {
    const currentNode = nodes.get(currentNodeId);
    if (!currentNode) return null;
    points.push(currentNode.point);
    const edge = edges[index]!;
    if (edge.fromNodeId === currentNodeId) currentNodeId = edge.toNodeId;
    else if (edge.toNodeId === currentNodeId) currentNodeId = edge.fromNodeId;
    else return null;
  }
  if (currentNodeId !== startNodeId) return null;
  return points;
}

function formatValidationErrors(errors: readonly { code: string; message: string }[]): string {
  return `invalid cadastral snapshot: ${errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`;
}
