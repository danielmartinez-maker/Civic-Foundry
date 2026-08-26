import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PolygonRing, WorldPoint } from '../world/cadastre/Geometry.ts';

export type UrbanFabricOverlayMode = 'none' | 'cadastre' | 'zoning-envelope' | 'redevelopment';

export type CadastralOverlaySegment = Readonly<{
  edgeId: string;
  from: WorldPoint;
  to: WorldPoint;
}>;

export type CadastralOverlayBlock = Readonly<{
  blockId: string;
  boundary: PolygonRing;
}>;

export type CadastralOverlayParcel = Readonly<{
  parcelId: string;
  blockId: string;
  boundary: PolygonRing;
  frontage: readonly CadastralOverlaySegment[];
  access: readonly CadastralOverlaySegment[];
}>;

export type CadastralOverlaySnapshot = Readonly<{
  blocks: readonly CadastralOverlayBlock[];
  parcels: readonly CadastralOverlayParcel[];
}>;

export function mapCadastralOverlay(core: SimulationCore): CadastralOverlaySnapshot {
  const blocks = core.cadastre.listBlocks()
    .map((block) => ({ blockId: block.id, boundary: block.boundary }))
    .sort((a, b) => a.blockId.localeCompare(b.blockId));

  const parcels = core.cadastre.listParcels()
    .map((parcel) => ({
      parcelId: parcel.id,
      blockId: parcel.blockId,
      boundary: core.cadastre.parcelPolygon(parcel.id),
      frontage: mapEdges(core, parcel.frontageEdgeIds),
      access: mapEdges(core, parcel.accessEdgeIds),
    }))
    .sort((a, b) => a.parcelId.localeCompare(b.parcelId));

  return { blocks, parcels };
}

function mapEdges(core: SimulationCore, edgeIds: readonly string[]): readonly CadastralOverlaySegment[] {
  return [...edgeIds].sort().flatMap((edgeId): CadastralOverlaySegment[] => {
    const edge = core.cadastre.getEdge(edgeId);
    if (!edge) return [];
    const from = core.cadastre.getNode(edge.fromNodeId)?.point;
    const to = core.cadastre.getNode(edge.toNodeId)?.point;
    return from && to ? [{ edgeId, from, to }] : [];
  });
}