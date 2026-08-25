import type { ZoneType } from '../../simulation/core/types.ts';
import type { ZoningSystem, ZonedCell } from '../../simulation/zoning/ZoningSystem.ts';
import type { RoadSystem } from '../roads/RoadSystem.ts';
import type { TerrainGrid } from '../terrain/TerrainGrid.ts';
import {
  LEGACY_CELL_SIZE_METERS,
  polygonArea,
  polygonCentroid,
  polygonUnion,
  type MultiPolygon,
  type PolygonRing,
  type WorldPoint,
} from './Geometry.ts';
import type {
  CadastralSnapshot,
  Parcel,
  ParcelEdge,
  ParcelEdgeKind,
  ParcelNode,
  UrbanBlock,
} from './CadastralTypes.ts';

const CARDINAL = [
  { dx: 0, dy: -1, side: 'north' },
  { dx: 1, dy: 0, side: 'east' },
  { dx: 0, dy: 1, side: 'south' },
  { dx: -1, dy: 0, side: 'west' },
] as const;

type Cell = Readonly<{ x: number; y: number; zone: ZoneType }>;
type MutableEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  leftParcelId?: string;
  rightParcelId?: string;
  kind: ParcelEdgeKind;
  roadRef?: string;
};

type ParcelDraft = Readonly<{
  id: string;
  blockId: string;
  zone: ZoneType;
  cells: readonly Cell[];
  ring: PolygonRing;
}>;

export class ParcelGenerationSystem {
  rebuild(terrain: TerrainGrid, roads: RoadSystem, zoning: ZoningSystem): CadastralSnapshot {
    const cells = zoning.list()
      .filter((cell) => terrain.isBuildable(cell.x, cell.y) && !roads.has(cell.x, cell.y))
      .map((cell) => ({ ...cell }))
      .sort(compareCells);
    if (cells.length === 0) return emptySnapshot();

    const components = connectedComponents(cells);
    const parcelDrafts: ParcelDraft[] = [];
    const blockDrafts: Array<{ id: string; boundary: PolygonRing; parcelIds: string[] }> = [];

    for (const component of components) {
      const anchor = component[0]!;
      const blockId = `block:${anchor.x},${anchor.y}`;
      const blockBoundary = unionCells(component);
      const groups = groupParcelCells(component, roads);
      const parcelIds: string[] = [];
      for (const group of groups) {
        const parcelAnchor = group[0]!;
        const parcelId = `parcel:${parcelAnchor.x},${parcelAnchor.y}`;
        parcelIds.push(parcelId);
        parcelDrafts.push({
          id: parcelId,
          blockId,
          zone: parcelAnchor.zone,
          cells: Object.freeze(group),
          ring: subdivideGridEdges(unionCells(group)),
        });
      }
      blockDrafts.push({ id: blockId, boundary: blockBoundary, parcelIds });
    }

    const nodes = new Map<string, ParcelNode>();
    const edgesByKey = new Map<string, MutableEdge>();
    const parcelResults: Parcel[] = [];

    for (const draft of parcelDrafts.sort((a, b) => a.id.localeCompare(b.id))) {
      const boundaryEdgeIds: string[] = [];
      const frontageEdgeIds: string[] = [];
      for (let index = 0; index < draft.ring.length; index += 1) {
        const start = draft.ring[index]!;
        const end = draft.ring[(index + 1) % draft.ring.length]!;
        const fromNode = ensureNode(nodes, start);
        const toNode = ensureNode(nodes, end);
        const key = canonicalEdgeKey(fromNode.id, toNode.id);
        const roadRef = roadRefForSegment(start, end, roads);
        let edge = edgesByKey.get(key);
        if (!edge) {
          edge = {
            id: `edge:${key}`,
            fromNodeId: fromNode.id,
            toNodeId: toNode.id,
            leftParcelId: draft.id,
            kind: roadRef ? 'street-frontage' : 'property-boundary',
          };
          if (roadRef) edge.roadRef = roadRef;
          edgesByKey.set(key, edge);
        } else {
          if (edge.leftParcelId === draft.id || edge.rightParcelId === draft.id) {
            throw new Error(`parcel ${draft.id} repeats boundary edge ${edge.id}`);
          }
          if (edge.rightParcelId) throw new Error(`edge ${edge.id} cannot border more than two parcels`);
          edge.rightParcelId = draft.id;
          edge.kind = 'property-boundary';
          delete edge.roadRef;
        }
        boundaryEdgeIds.push(edge.id);
        if (roadRef && !edge.rightParcelId) frontageEdgeIds.push(edge.id);
      }

      parcelResults.push(Object.freeze({
        id: draft.id,
        blockId: draft.blockId,
        boundaryEdgeIds: Object.freeze(boundaryEdgeIds),
        areaM2: polygonArea(draft.ring),
        centroid: polygonCentroid(draft.ring),
        frontageEdgeIds: Object.freeze(frontageEdgeIds),
        accessEdgeIds: Object.freeze([...frontageEdgeIds]),
        zoningDistrictId: draft.zone,
        historicalParentIds: Object.freeze([]),
      }));
    }

    const edges = [...edgesByKey.values()].map(freezeEdge).sort((a, b) => a.id.localeCompare(b.id));
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    const parcelsById = new Map(parcelResults.map((parcel) => [parcel.id, parcel]));
    const blocks: UrbanBlock[] = blockDrafts.map((block) => {
      const roadEdgeIds = new Set<string>();
      for (const parcelId of block.parcelIds) {
        const parcel = parcelsById.get(parcelId);
        if (!parcel) continue;
        for (const edgeId of parcel.frontageEdgeIds) {
          if (edgeById.get(edgeId)?.kind === 'street-frontage') roadEdgeIds.add(edgeId);
        }
      }
      return Object.freeze({
        id: block.id,
        boundary: block.boundary,
        parcelIds: Object.freeze([...block.parcelIds].sort()),
        roadEdgeIds: Object.freeze([...roadEdgeIds].sort()),
      });
    }).sort((a, b) => a.id.localeCompare(b.id));

    return Object.freeze({
      nodes: Object.freeze([...nodes.values()].sort((a, b) => a.id.localeCompare(b.id))),
      edges: Object.freeze(edges),
      blocks: Object.freeze(blocks),
      parcels: Object.freeze(parcelResults.sort((a, b) => a.id.localeCompare(b.id))),
      easements: Object.freeze([]),
      lineage: Object.freeze([]),
    });
  }
}

function connectedComponents(cells: readonly Cell[]): readonly (readonly Cell[])[] {
  const byKey = new Map(cells.map((cell) => [cellKey(cell.x, cell.y), cell]));
  const unseen = new Set(byKey.keys());
  const components: Cell[][] = [];
  for (const start of cells) {
    const startKey = cellKey(start.x, start.y);
    if (!unseen.delete(startKey)) continue;
    const queue: Cell[] = [start];
    const component: Cell[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const direction of CARDINAL) {
        const key = cellKey(current.x + direction.dx, current.y + direction.dy);
        const neighbor = byKey.get(key);
        if (neighbor && unseen.delete(key)) queue.push(neighbor);
      }
    }
    component.sort(compareCells);
    components.push(component);
  }
  return Object.freeze(components.sort((left, right) => compareCells(left[0]!, right[0]!)));
}

function groupParcelCells(component: readonly Cell[], roads: RoadSystem): readonly (readonly Cell[])[] {
  const byKey = new Map(component.map((cell) => [cellKey(cell.x, cell.y), cell]));
  const assigned = new Set<string>();
  const groups: Cell[][] = [];
  for (const cell of component) {
    const key = cellKey(cell.x, cell.y);
    if (assigned.has(key)) continue;
    assigned.add(key);
    const group = [cell];
    const frontage = frontageSides(cell, roads);
    for (const direction of CARDINAL) {
      const neighborKey = cellKey(cell.x + direction.dx, cell.y + direction.dy);
      const neighbor = byKey.get(neighborKey);
      if (!neighbor || assigned.has(neighborKey) || neighbor.zone !== cell.zone) continue;
      if (!compatibleFrontage(frontage, frontageSides(neighbor, roads))) continue;
      assigned.add(neighborKey);
      group.push(neighbor);
      break;
    }
    group.sort(compareCells);
    groups.push(group);
  }
  return Object.freeze(groups);
}

function compatibleFrontage(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size === 0 && right.size === 0) return true;
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function frontageSides(cell: Cell, roads: RoadSystem): ReadonlySet<string> {
  const sides = new Set<string>();
  for (const direction of CARDINAL) {
    if (roads.has(cell.x + direction.dx, cell.y + direction.dy)) sides.add(direction.side);
  }
  return sides;
}

function unionCells(cells: readonly Cell[]): PolygonRing {
  let result: MultiPolygon = Object.freeze([cellPolygon(cells[0]!.x, cells[0]!.y)]);
  for (let index = 1; index < cells.length; index += 1) {
    result = polygonUnion(result, cellPolygon(cells[index]!.x, cells[index]!.y));
  }
  if (result.length !== 1) throw new Error('connected grid cells must produce exactly one polygon');
  return result[0]!;
}

function cellPolygon(x: number, y: number): PolygonRing {
  const size = LEGACY_CELL_SIZE_METERS;
  return Object.freeze([
    Object.freeze({ x: x * size, y: y * size }),
    Object.freeze({ x: (x + 1) * size, y: y * size }),
    Object.freeze({ x: (x + 1) * size, y: (y + 1) * size }),
    Object.freeze({ x: x * size, y: (y + 1) * size }),
  ]);
}

function subdivideGridEdges(ring: PolygonRing): PolygonRing {
  const result: WorldPoint[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]!;
    const end = ring[(index + 1) % ring.length]!;
    result.push(start);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx !== 0 && dy !== 0) throw new Error('legacy parcel boundary must remain axis aligned');
    const length = Math.abs(dx || dy);
    const steps = Math.round(length / LEGACY_CELL_SIZE_METERS);
    if (Math.abs(length - steps * LEGACY_CELL_SIZE_METERS) > 1e-9) {
      throw new Error('legacy parcel boundary must align to cell grid');
    }
    for (let step = 1; step < steps; step += 1) {
      result.push(Object.freeze({
        x: start.x + (dx / steps) * step,
        y: start.y + (dy / steps) * step,
      }));
    }
  }
  return Object.freeze(result);
}

function ensureNode(nodes: Map<string, ParcelNode>, point: WorldPoint): ParcelNode {
  const id = nodeId(point);
  const existing = nodes.get(id);
  if (existing) return existing;
  const node = Object.freeze({ id, point: Object.freeze({ x: point.x, y: point.y }) });
  nodes.set(id, node);
  return node;
}

function nodeId(point: WorldPoint): string {
  return `node:${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
}

function canonicalEdgeKey(leftNodeId: string, rightNodeId: string): string {
  return leftNodeId < rightNodeId ? `${leftNodeId}|${rightNodeId}` : `${rightNodeId}|${leftNodeId}`;
}

function roadRefForSegment(start: WorldPoint, end: WorldPoint, roads: RoadSystem): string | undefined {
  const size = LEGACY_CELL_SIZE_METERS;
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  const candidates: Array<readonly [number, number]> = [];
  if (start.y === end.y) {
    const x = Math.floor(midpointX / size);
    const gridY = Math.round(start.y / size);
    candidates.push([x, gridY - 1], [x, gridY]);
  } else if (start.x === end.x) {
    const y = Math.floor(midpointY / size);
    const gridX = Math.round(start.x / size);
    candidates.push([gridX - 1, y], [gridX, y]);
  }
  return candidates
    .filter(([x, y]) => roads.has(x, y))
    .map(([x, y]) => `${x},${y}`)
    .sort()[0];
}

function freezeEdge(edge: MutableEdge): ParcelEdge {
  const base = {
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    kind: edge.kind,
  };
  return Object.freeze({
    ...base,
    ...(edge.leftParcelId ? { leftParcelId: edge.leftParcelId } : {}),
    ...(edge.rightParcelId ? { rightParcelId: edge.rightParcelId } : {}),
    ...(edge.roadRef ? { roadRef: edge.roadRef } : {}),
  });
}

function compareCells(left: Cell | ZonedCell, right: Cell | ZonedCell): number {
  return left.y - right.y || left.x - right.x || left.zone.localeCompare(right.zone);
}

function cellKey(x: number, y: number): string { return `${x},${y}`; }

function emptySnapshot(): CadastralSnapshot {
  return Object.freeze({
    nodes: Object.freeze([]),
    edges: Object.freeze([]),
    blocks: Object.freeze([]),
    parcels: Object.freeze([]),
    easements: Object.freeze([]),
    lineage: Object.freeze([]),
  });
}
