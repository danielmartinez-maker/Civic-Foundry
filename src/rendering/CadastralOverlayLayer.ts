import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PolygonRing, WorldPoint } from '../world/cadastre/Geometry.ts';

export type CadastralOverlaySegment = Readonly<{
  edgeId: string;
  from: WorldPoint;
  to: WorldPoint;
}>;

export type CadastralOverlayParcel = Readonly<{
  parcelId: string;
  blockId: string;
  boundary: PolygonRing;
  frontage: readonly CadastralOverlaySegment[];
}>;

export type CadastralOverlaySnapshot = Readonly<{
  parcels: readonly CadastralOverlayParcel[];
}>;

export function mapCadastralOverlay(core: SimulationCore): CadastralOverlaySnapshot {
  const parcels = core.cadastre.listParcels().map((parcel) => ({
    parcelId: parcel.id,
    blockId: parcel.blockId,
    boundary: core.cadastre.parcelPolygon(parcel.id),
    frontage: [...parcel.frontageEdgeIds].sort().flatMap((edgeId): CadastralOverlaySegment[] => {
      const edge = core.cadastre.getEdge(edgeId);
      if (!edge) return [];
      const from = core.cadastre.getNode(edge.fromNodeId)?.point;
      const to = core.cadastre.getNode(edge.toNodeId)?.point;
      return from && to ? [{ edgeId, from, to }] : [];
    }),
  }));

  return { parcels };
}
