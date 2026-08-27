import type { ZoneType } from '../../simulation/core/types.ts';
import type { RoadSystem } from '../roads/RoadSystem.ts';
import type { ZoningSystem } from '../../simulation/zoning/ZoningSystem.ts';
import { LEGACY_CELL_SIZE_METERS } from '../cadastre/Geometry.ts';
import type { CadastralGraph } from '../cadastre/CadastralGraph.ts';
import type { Parcel } from '../cadastre/CadastralTypes.ts';

export type Lot = Readonly<{
  id: string;
  x: number;
  y: number;
  zone: ZoneType;
  frontageRoadKey: string;
}>;

const CARDINAL = [[0,-1],[1,0],[0,1],[-1,0]] as const;
const GRID_EPSILON = 1e-6;

type LegacyLotCandidate = Readonly<{
  sourceParcelId: string;
  x: number;
  y: number;
  zone: ZoneType;
  frontageRoadKey: string;
  frontagePriority: number;
}>;

export class LotSystem {
  private lots: Lot[] = [];

  /** @deprecated Runtime development should consume cadastral parcels. */
  rebuild(roads: RoadSystem, zoning: ZoningSystem): void {
    const next: Lot[] = [];
    for (const cell of zoning.list()) {
      let frontage: string | undefined;
      for (const [dx, dy] of CARDINAL) {
        const road = roads.get(cell.x + dx, cell.y + dy);
        if (road) {
          frontage = `${road.x},${road.y}`;
          break;
        }
      }
      if (frontage) next.push({ id: `lot:${cell.x},${cell.y}`, x: cell.x, y: cell.y, zone: cell.zone, frontageRoadKey: frontage });
    }
    this.lots = next.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  rebuildFromCadastre(
    graph: CadastralGraph,
    legacyZoneResolver: (parcel: Parcel) => ZoneType | undefined,
  ): void {
    const candidates: LegacyLotCandidate[] = [];
    for (const parcel of graph.listParcels()) {
      const zone = legacyZoneResolver(parcel);
      if (!zone) continue;
      for (const edgeId of parcel.frontageEdgeIds) {
        const edge = graph.getEdge(edgeId);
        if (!edge?.roadRef) continue;
        const from = graph.getNode(edge.fromNodeId)?.point;
        const to = graph.getNode(edge.toNodeId)?.point;
        if (!from || !to) continue;
        const projection = projectLegacyFrontage(from.x, from.y, to.x, to.y, edge.roadRef);
        if (!projection) continue;
        candidates.push({
          sourceParcelId: parcel.id,
          x: projection.x,
          y: projection.y,
          zone,
          frontageRoadKey: edge.roadRef,
          frontagePriority: projection.frontagePriority,
        });
      }
    }

    candidates.sort((left, right) =>
      left.y - right.y
      || left.x - right.x
      || left.frontagePriority - right.frontagePriority
      || left.sourceParcelId.localeCompare(right.sourceParcelId)
      || left.frontageRoadKey.localeCompare(right.frontageRoadKey));

    const next: Lot[] = [];
    const seenCells = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.x},${candidate.y}`;
      if (seenCells.has(key)) continue;
      seenCells.add(key);
      next.push({
        id: `lot:${candidate.x},${candidate.y}`,
        x: candidate.x,
        y: candidate.y,
        zone: candidate.zone,
        frontageRoadKey: candidate.frontageRoadKey,
      });
    }
    this.lots = next;
  }

  list(): Lot[] {
    return this.lots.map((lot) => ({ ...lot }));
  }
}

function projectLegacyFrontage(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  roadRef: string,
): Readonly<{ x: number; y: number; frontagePriority: number }> | undefined {
  const road = parseRoadRef(roadRef);
  if (!road) return undefined;
  const size = LEGACY_CELL_SIZE_METERS;

  if (Math.abs(fromY - toY) <= GRID_EPSILON) {
    if (Math.abs(Math.abs(toX - fromX) - size) > GRID_EPSILON) return undefined;
    const boundaryY = alignedGridLine(fromY);
    if (boundaryY === undefined) return undefined;
    const cellX = Math.floor(((fromX + toX) / 2) / size);
    if (road.x !== cellX) return undefined;
    if (road.y === boundaryY - 1) return { x: cellX, y: boundaryY, frontagePriority: 0 };
    if (road.y === boundaryY) return { x: cellX, y: boundaryY - 1, frontagePriority: 2 };
    return undefined;
  }

  if (Math.abs(fromX - toX) <= GRID_EPSILON) {
    if (Math.abs(Math.abs(toY - fromY) - size) > GRID_EPSILON) return undefined;
    const boundaryX = alignedGridLine(fromX);
    if (boundaryX === undefined) return undefined;
    const cellY = Math.floor(((fromY + toY) / 2) / size);
    if (road.y !== cellY) return undefined;
    if (road.x === boundaryX) return { x: boundaryX - 1, y: cellY, frontagePriority: 1 };
    if (road.x === boundaryX - 1) return { x: boundaryX, y: cellY, frontagePriority: 3 };
  }
  return undefined;
}

function alignedGridLine(worldCoordinate: number): number | undefined {
  const scaled = worldCoordinate / LEGACY_CELL_SIZE_METERS;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) <= GRID_EPSILON ? rounded : undefined;
}

function parseRoadRef(roadRef: string): Readonly<{ x: number; y: number }> | undefined {
  const match = /^(-?\d+),(-?\d+)$/.exec(roadRef);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]) };
}