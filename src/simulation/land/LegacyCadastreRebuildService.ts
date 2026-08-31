import type { ZoneType } from '../core/types.ts';
import type { BuildingSystem } from '../buildings/BuildingSystem.ts';
import type { PropertyMarketSystem } from '../development/PropertyMarketSystem.ts';
import type { ZoningSystem } from '../zoning/ZoningSystem.ts';
import { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import type { CadastralSnapshot, Parcel } from '../../world/cadastre/CadastralTypes.ts';
import type { WorldPoint } from '../../world/cadastre/Geometry.ts';
import { LotSystem } from '../../world/lots/LotSystem.ts';

export type LegacyCadastreRebuildResult = Readonly<{
  committed: boolean;
  changed: boolean;
  rejectionReason?: 'protected-parcel-topology-change';
}>;

export type LegacyCadastreRebuildDependencies = Readonly<{
  cadastre: CadastralGraph;
  lots: LotSystem;
  zoning: ZoningSystem;
  buildings: BuildingSystem;
  propertyMarket: PropertyMarketSystem;
  legacyZoneResolver: (parcel: Parcel) => ZoneType | undefined;
}>;

export class LegacyCadastreRebuildService {
  private readonly deps: LegacyCadastreRebuildDependencies;

  constructor(deps: LegacyCadastreRebuildDependencies) {
    this.deps = deps;
  }

  rebuild(candidate: CadastralSnapshot, tick: number): LegacyCadastreRebuildResult {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('legacy cadastre rebuild tick must be a non-negative integer');
    const previous = this.deps.cadastre.snapshot();
    if (previous.parcels.length === 0) {
      this.commit(candidate);
      return Object.freeze({ committed: true, changed: candidate.parcels.length > 0 });
    }

    const previousGraph = new CadastralGraph(previous);
    const candidateGraph = new CadastralGraph(candidate);
    const previousByFingerprint = groupParcelsByFingerprint(previousGraph);
    const candidateByFingerprint = groupParcelsByFingerprint(candidateGraph);
    const candidateIdRewrite = new Map<string, string>();
    const geometryStableOldIds = new Set<string>();

    for (const fingerprint of [...candidateByFingerprint.keys()].sort()) {
      const oldIds = [...(previousByFingerprint.get(fingerprint) ?? [])].sort();
      const candidateIds = [...(candidateByFingerprint.get(fingerprint) ?? [])].sort();
      const matches = Math.min(oldIds.length, candidateIds.length);
      for (let index = 0; index < matches; index += 1) {
        const oldId = oldIds[index]!;
        candidateIdRewrite.set(candidateIds[index]!, oldId);
        geometryStableOldIds.add(oldId);
      }
    }

    const protectedIds = this.protectedParcelIds(previous);
    if ([...protectedIds].some((parcelId) => !geometryStableOldIds.has(parcelId))) {
      return Object.freeze({ committed: false, changed: false, rejectionReason: 'protected-parcel-topology-change' });
    }

    const oldIds = new Set(previous.parcels.map((parcel) => parcel.id));
    const usedIds = new Set<string>(candidateIdRewrite.values());
    let generatedIndex = 1;
    for (const parcel of [...candidate.parcels].sort((left, right) => left.id.localeCompare(right.id))) {
      if (candidateIdRewrite.has(parcel.id)) continue;
      let nextId = parcel.id;
      if (oldIds.has(nextId) || usedIds.has(nextId)) {
        do {
          nextId = `legacy-parcel:${tick}:${generatedIndex++}:${parcel.id}`;
        } while (oldIds.has(nextId) || usedIds.has(nextId));
      }
      candidateIdRewrite.set(parcel.id, nextId);
      usedIds.add(nextId);
    }

    const oldParcelById = new Map(previous.parcels.map((parcel) => [parcel.id, parcel] as const));
    const reconciledParcels = candidate.parcels.map((parcel) => {
      const id = candidateIdRewrite.get(parcel.id)!;
      const old = oldParcelById.get(id);
      return Object.freeze({
        ...parcel,
        id,
        historicalParentIds: Object.freeze(old ? [...old.historicalParentIds] : [...parcel.historicalParentIds]),
        ...(old?.ownerId ? { ownerId: old.ownerId } : {}),
      });
    });
    const reconciledEdges = candidate.edges.map((edge) => Object.freeze({
      ...edge,
      ...(edge.leftParcelId ? { leftParcelId: candidateIdRewrite.get(edge.leftParcelId) ?? edge.leftParcelId } : {}),
      ...(edge.rightParcelId ? { rightParcelId: candidateIdRewrite.get(edge.rightParcelId) ?? edge.rightParcelId } : {}),
    }));
    const reconciledBlocks = candidate.blocks.map((block) => Object.freeze({
      ...block,
      boundary: Object.freeze(block.boundary.map((point) => Object.freeze({ ...point }))),
      parcelIds: Object.freeze(block.parcelIds.map((parcelId) => candidateIdRewrite.get(parcelId) ?? parcelId).sort()),
      roadEdgeIds: Object.freeze([...block.roadEdgeIds]),
    }));

    const retiredParcelIds = previous.parcels
      .map((parcel) => parcel.id)
      .filter((parcelId) => !geometryStableOldIds.has(parcelId))
      .sort();
    const resultingParcelIds = candidate.parcels
      .filter((parcel) => !geometryStableOldIds.has(candidateIdRewrite.get(parcel.id)!))
      .map((parcel) => candidateIdRewrite.get(parcel.id)!)
      .sort();
    const lineage = [...previous.lineage];
    if (retiredParcelIds.length > 0 || resultingParcelIds.length > 0) {
      const existingIds = new Set(lineage.map((event) => event.id));
      let suffix = lineage.length + 1;
      let id = `legacy-boundary-adjustment:${suffix}`;
      while (existingIds.has(id)) id = `legacy-boundary-adjustment:${++suffix}`;
      lineage.push(Object.freeze({
        id,
        tick,
        kind: 'boundary-adjustment' as const,
        sourceParcelIds: Object.freeze(retiredParcelIds),
        resultingParcelIds: Object.freeze(resultingParcelIds),
      }));
    }

    const reconciled: CadastralSnapshot = Object.freeze({
      nodes: Object.freeze(candidate.nodes.map((node) => Object.freeze({ id: node.id, point: Object.freeze({ ...node.point }) }))),
      edges: Object.freeze(reconciledEdges),
      blocks: Object.freeze(reconciledBlocks),
      parcels: Object.freeze(reconciledParcels),
      easements: Object.freeze(previous.easements.map((easement) => Object.freeze({
        ...easement,
        parcelIds: Object.freeze([...easement.parcelIds]),
        geometry: Object.freeze(easement.geometry.map((point) => Object.freeze({ ...point }))),
      }))),
      lineage: Object.freeze(lineage),
    });

    new CadastralGraph(reconciled);
    const stagedLots = new LotSystem();
    stagedLots.rebuildFromCadastre(new CadastralGraph(reconciled), this.deps.legacyZoneResolver);
    this.commit(reconciled);
    return Object.freeze({
      committed: true,
      changed: retiredParcelIds.length > 0 || resultingParcelIds.length > 0 || !sameProjection(previousGraph, candidateGraph),
    });
  }

  private protectedParcelIds(previous: CadastralSnapshot): ReadonlySet<string> {
    const result = new Set<string>();
    for (const assignment of this.deps.zoning.listParcelAssignments()) result.add(assignment.parcelId);
    for (const holding of this.deps.propertyMarket.snapshot().holdings) result.add(holding.parcelId);
    for (const building of this.deps.buildings.listV2()) for (const parcelId of building.parcelIds) result.add(parcelId);
    for (const easement of previous.easements) for (const parcelId of easement.parcelIds) result.add(parcelId);
    return result;
  }

  private commit(snapshot: CadastralSnapshot): void {
    this.deps.cadastre.replaceSnapshot(snapshot);
    this.deps.lots.rebuildFromCadastre(this.deps.cadastre, this.deps.legacyZoneResolver);
  }
}

function groupParcelsByFingerprint(graph: CadastralGraph): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const parcel of graph.listParcels()) {
    const fingerprint = polygonFingerprint(graph.parcelPolygon(parcel.id));
    const ids = result.get(fingerprint) ?? [];
    ids.push(parcel.id);
    result.set(fingerprint, ids);
  }
  return result;
}

function sameProjection(left: CadastralGraph, right: CadastralGraph): boolean {
  const leftFingerprints = left.listParcels().map((parcel) => polygonFingerprint(left.parcelPolygon(parcel.id))).sort();
  const rightFingerprints = right.listParcels().map((parcel) => polygonFingerprint(right.parcelPolygon(parcel.id))).sort();
  return JSON.stringify(leftFingerprints) === JSON.stringify(rightFingerprints);
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
