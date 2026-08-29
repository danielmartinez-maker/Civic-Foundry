import type { ZoneType } from '../core/types.ts';
import { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import type { CadastralSnapshot, Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { WorldPoint } from '../../world/cadastre/Geometry.ts';
import type { LotSystem } from '../../world/lots/LotSystem.ts';

export type LegacyCadastreRebuildResult = Readonly<{
  committed: boolean;
  changed: boolean;
  rejectionReason?: string;
}>;

export type LegacyCadastreRebuildDependencies = Readonly<{
  cadastre: CadastralGraph;
  lots: LotSystem;
  legacyZoneResolver: (parcel: Parcel) => ZoneType | undefined;
}>;

export class LegacyCadastreRebuildService {
  private readonly deps: LegacyCadastreRebuildDependencies;
  private legacyProjectionFingerprint: string | null = null;

  constructor(deps: LegacyCadastreRebuildDependencies) {
    this.deps = deps;
  }

  rebuild(
    candidate: CadastralSnapshot,
    _tick: number,
    commitChangedProjection: () => void,
  ): LegacyCadastreRebuildResult {
    const fingerprint = projectionFingerprint(candidate);
    if (this.legacyProjectionFingerprint === fingerprint) {
      // The legal parcel projection did not change. Canonical legal-land
      // mutations may legitimately diverge from that legacy projection, so
      // preserve the live cadastre and only restore the derived compatibility
      // lots that inherited legacy edit paths may have rebuilt.
      this.deps.lots.rebuildFromCadastre(this.deps.cadastre, this.deps.legacyZoneResolver);
      return Object.freeze({ committed: true, changed: false });
    }

    commitChangedProjection();
    this.legacyProjectionFingerprint = fingerprint;
    return Object.freeze({ committed: true, changed: true });
  }
}

function projectionFingerprint(snapshot: CadastralSnapshot): string {
  const graph = new CadastralGraph(snapshot);
  const parcels = graph.listParcels().map((parcel) => ({
    polygon: polygonFingerprint(graph.parcelPolygon(parcel.id)),
    zoningDistrictId: parcel.zoningDistrictId,
    frontage: parcel.frontageEdgeIds.map((edgeId) => edgeFingerprint(graph, edgeId)).sort(),
    access: parcel.accessEdgeIds.map((edgeId) => edgeFingerprint(graph, edgeId)).sort(),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(parcels);
}

function edgeFingerprint(graph: CadastralGraph, edgeId: string): string {
  const edge = graph.getEdge(edgeId);
  if (!edge) throw new Error(`candidate parcel references missing edge ${edgeId}`);
  const from = graph.getNode(edge.fromNodeId)?.point;
  const to = graph.getNode(edge.toNodeId)?.point;
  if (!from || !to) throw new Error(`candidate edge references missing node ${edge.id}`);
  const endpoints = [pointFingerprint(from), pointFingerprint(to)].sort();
  return `${endpoints[0]}>${endpoints[1]}|${edge.kind}|${edge.roadRef ?? ''}`;
}

function polygonFingerprint(points: readonly WorldPoint[]): string {
  if (points.length === 0) return '';
  const encoded = points.map(pointFingerprint);
  const candidates: string[] = [];
  for (const sequence of [encoded, [...encoded].reverse()]) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      candidates.push([...sequence.slice(offset), ...sequence.slice(0, offset)].join(';'));
    }
  }
  candidates.sort();
  return candidates[0] ?? '';
}

function pointFingerprint(point: WorldPoint): string {
  return `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
