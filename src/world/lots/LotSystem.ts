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

  rebuildFromCadastre(graph: CadastralGraph, legacyZoneResolver: (parcel: Parcel) => ZoneType): void {
    const next: Lot[] = [];
    for (const parcel of graph.listParcels()) {
      const frontageRoadKey = firstRoadRef(graph, parcel);
      if (!frontageRoadKey) continue;
      next.push({
        id: parcel.id,
        x: Math.floor(parcel.centroid.x / LEGACY_CELL_SIZE_METERS),
        y: Math.floor(parcel.centroid.y / LEGACY_CELL_SIZE_METERS),
        zone: legacyZoneResolver(parcel),
        frontageRoadKey,
      });
    }
    this.lots = next.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  }

  list(): Lot[] {
    return this.lots.map((lot) => ({ ...lot }));
  }
}

function firstRoadRef(graph: CadastralGraph, parcel: Parcel): string | undefined {
  return parcel.frontageEdgeIds
    .map((edgeId) => graph.getEdge(edgeId)?.roadRef)
    .filter((roadRef): roadRef is string => roadRef !== undefined)
    .sort()[0];
}
