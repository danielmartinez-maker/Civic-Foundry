import type { ZoneType } from '../core/types.ts';
import type { BuildingSystem } from '../buildings/BuildingSystem.ts';
import { PropertyMarketSystem, type PropertyMarketSnapshot } from '../development/PropertyMarketSystem.ts';
import type { ZoningSystem } from '../zoning/ZoningSystem.ts';
import { CadastralGraph } from '../../world/cadastre/CadastralGraph.ts';
import { CadastralMutationSystem } from '../../world/cadastre/CadastralMutationSystem.ts';
import { polygonArea, polygonIntersection, type WorldPoint } from '../../world/cadastre/Geometry.ts';
import type { Parcel } from '../../world/cadastre/CadastralTypes.ts';
import { LotSystem } from '../../world/lots/LotSystem.ts';

const GEOMETRY_AREA_TOLERANCE_M2 = 0.01;

export type CadastralRuntimeMutationDependencies = Readonly<{
  cadastre: CadastralGraph;
  buildings: BuildingSystem;
  zoning: ZoningSystem;
  propertyMarket: PropertyMarketSystem;
  lots: LotSystem;
  legacyZoneResolver: (parcel: Parcel) => ZoneType | undefined;
}>;

export type CadastralRuntimeMutationResult = Readonly<{
  committed: boolean;
  resultingParcelIds: readonly string[];
  retiredParcelIds: readonly string[];
  rejectionReasons: readonly string[];
  parcelReferenceRewrites: Readonly<Record<string, string>>;
}>;

type BuildingSnapshot = ReturnType<BuildingSystem['listV2']>[number];
type ParcelAssignment = ReturnType<ZoningSystem['listParcelAssignments']>[number];

type StagedBuildings = Readonly<{
  buildings: readonly BuildingSnapshot[];
  rejectionReason?: string;
}>;

export class CadastralRuntimeMutationService {
  private readonly deps: CadastralRuntimeMutationDependencies;

  constructor(deps: CadastralRuntimeMutationDependencies) {
    this.deps = deps;
  }

  splitParcel(parcelId: string, cutLine: readonly WorldPoint[]): CadastralRuntimeMutationResult {
    const originalCadastre = this.deps.cadastre.snapshot();
    const originalBuildings = this.deps.buildings.listV2();
    const originalZoning = this.deps.zoning.listParcelAssignments();
    const originalProperty = this.deps.propertyMarket.snapshot();

    const sourceParcel = this.deps.cadastre.getParcel(parcelId);
    if (!sourceParcel) return rejected('parcel-not-found');

    const stagedGraph = new CadastralGraph(originalCadastre);
    const lowLevel = new CadastralMutationSystem(stagedGraph).splitParcel(parcelId, cutLine);
    if (!lowLevel.committed) return fromLowLevel(lowLevel);

    const resultingParcelIds = [...lowLevel.resultingParcelIds].sort((left, right) => left.localeCompare(right));
    const stagedBuildings = stageBuildingsForSplit(originalBuildings, parcelId, resultingParcelIds, stagedGraph);
    if (stagedBuildings.rejectionReason) {
      return rejected(stagedBuildings.rejectionReason, lowLevel.resultingParcelIds, lowLevel.retiredParcelIds);
    }

    const stagedZoning = stageZoningForSplit(originalZoning, parcelId, resultingParcelIds);
    const stagedProperty = stagePropertyForSplit(
      originalProperty,
      parcelId,
      sourceParcel.areaM2,
      resultingParcelIds,
      stagedGraph,
    );
    const stagedHistoricalPredicate = historicalParcelPredicate(stagedGraph);

    // Validate derived compatibility and property-history projections before touching live state.
    const stagedLots = new LotSystem();
    stagedLots.rebuildFromCadastre(stagedGraph, this.deps.legacyZoneResolver);
    new PropertyMarketSystem().restore(stagedProperty, {
      isHistoricalParcelId: stagedHistoricalPredicate,
    });

    try {
      this.deps.cadastre.replaceSnapshot(stagedGraph.snapshot());
      this.deps.zoning.restoreParcelAssignments(stagedZoning);
      this.deps.buildings.restoreV2(stagedBuildings.buildings);
      this.deps.propertyMarket.restore(stagedProperty, {
        isHistoricalParcelId: stagedHistoricalPredicate,
      });
      this.deps.lots.rebuildFromCadastre(this.deps.cadastre, this.deps.legacyZoneResolver);
    } catch (error) {
      this.rollback(originalCadastre, originalZoning, originalBuildings, originalProperty, error);
      return rejected('runtime-commit-rollback', lowLevel.resultingParcelIds, lowLevel.retiredParcelIds);
    }

    return committed(lowLevel);
  }

  private rollback(
    originalCadastre: ReturnType<CadastralGraph['snapshot']>,
    originalZoning: readonly ParcelAssignment[],
    originalBuildings: readonly BuildingSnapshot[],
    originalProperty: PropertyMarketSnapshot,
    originalError: unknown,
  ): void {
    try {
      const originalGraph = new CadastralGraph(originalCadastre);
      this.deps.cadastre.replaceSnapshot(originalCadastre);
      this.deps.zoning.restoreParcelAssignments(originalZoning);
      this.deps.buildings.restoreV2(originalBuildings);
      this.deps.propertyMarket.restore(originalProperty, {
        isHistoricalParcelId: historicalParcelPredicate(originalGraph),
      });
      this.deps.lots.rebuildFromCadastre(this.deps.cadastre, this.deps.legacyZoneResolver);
    } catch (rollbackError) {
      const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`runtime cadastral rollback failed after ${originalMessage}: ${rollbackMessage}`, {
        cause: rollbackError,
      });
    }
  }
}

function stageBuildingsForSplit(
  buildings: readonly BuildingSnapshot[],
  sourceParcelId: string,
  childParcelIds: readonly string[],
  stagedGraph: CadastralGraph,
): StagedBuildings {
  const staged: BuildingSnapshot[] = [];

  for (const building of [...buildings].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!building.parcelIds.includes(sourceParcelId)) {
      staged.push(building);
      continue;
    }

    const footprintArea = polygonArea(building.footprint);
    const overlaps = childParcelIds.map((childParcelId) => {
      const overlapAreaM2 = polygonIntersection(building.footprint, stagedGraph.parcelPolygon(childParcelId))
        .reduce((sum, ring) => sum + polygonArea(ring), 0);
      return Object.freeze({ childParcelId, overlapAreaM2 });
    });
    const containingChildren = overlaps.filter(
      ({ overlapAreaM2 }) => Math.abs(footprintArea - overlapAreaM2) <= GEOMETRY_AREA_TOLERANCE_M2,
    );

    if (containingChildren.length !== 1) {
      const materialOverlaps = overlaps.filter(({ overlapAreaM2 }) => overlapAreaM2 > GEOMETRY_AREA_TOLERANCE_M2);
      return Object.freeze({
        buildings: Object.freeze(staged),
        rejectionReason: materialOverlaps.length > 1 ? 'building-crosses-split' : 'building-outside-resulting-parcel',
      });
    }

    const replacementId = containingChildren[0]!.childParcelId;
    const parcelIds = building.parcelIds
      .map((candidate) => (candidate === sourceParcelId ? replacementId : candidate))
      .sort((left, right) => left.localeCompare(right));
    staged.push(Object.freeze({ ...building, parcelIds: Object.freeze(parcelIds) }));
  }

  return Object.freeze({ buildings: Object.freeze(staged) });
}

function stageZoningForSplit(
  assignments: readonly ParcelAssignment[],
  sourceParcelId: string,
  childParcelIds: readonly string[],
): readonly ParcelAssignment[] {
  const source = assignments.find((assignment) => assignment.parcelId === sourceParcelId);
  const staged = assignments.filter((assignment) => assignment.parcelId !== sourceParcelId);
  if (source) {
    for (const childParcelId of childParcelIds) {
      staged.push(
        Object.freeze({
          parcelId: childParcelId,
          districtId: source.districtId,
          overlayIds: Object.freeze([...source.overlayIds]),
        }),
      );
    }
  }
  return Object.freeze(staged.sort((left, right) => left.parcelId.localeCompare(right.parcelId)));
}

function stagePropertyForSplit(
  snapshot: PropertyMarketSnapshot,
  sourceParcelId: string,
  sourceAreaM2: number,
  childParcelIds: readonly string[],
  stagedGraph: CadastralGraph,
): PropertyMarketSnapshot {
  const sourceHolding = snapshot.holdings.find((holding) => holding.parcelId === sourceParcelId);
  if (!sourceHolding) return snapshot;

  const childAreas = childParcelIds.map((childParcelId) => stagedGraph.getParcel(childParcelId)!.areaM2);
  const allocatedValues = allocateCurrencyByArea(sourceHolding.reservationValue, sourceAreaM2, childAreas);
  const holdings = snapshot.holdings.filter((holding) => holding.parcelId !== sourceParcelId);
  for (let index = 0; index < childParcelIds.length; index += 1) {
    holdings.push(
      Object.freeze({
        parcelId: childParcelIds[index]!,
        ownerId: sourceHolding.ownerId,
        reservationValue: allocatedValues[index]!,
      }),
    );
  }
  holdings.sort((left, right) => left.parcelId.localeCompare(right.parcelId));

  return Object.freeze({
    holdings: Object.freeze(holdings),
    transactions: snapshot.transactions,
    nextTransactionId: snapshot.nextTransactionId,
  });
}

function allocateCurrencyByArea(
  value: number,
  sourceAreaM2: number,
  childAreasM2: readonly number[],
): readonly number[] {
  const totalCents = Math.round(value * 100);
  let remainingCents = totalCents;
  const allocations: number[] = [];

  for (let index = 0; index < childAreasM2.length; index += 1) {
    const isLast = index === childAreasM2.length - 1;
    const cents = isLast ? remainingCents : Math.round((totalCents * childAreasM2[index]!) / sourceAreaM2);
    allocations.push(cents / 100);
    remainingCents -= cents;
  }

  return Object.freeze(allocations);
}

function historicalParcelPredicate(graph: CadastralGraph): (parcelId: string) => boolean {
  const retiredParcelIds = new Set<string>();
  for (const event of graph.listLineage()) {
    for (const sourceParcelId of event.sourceParcelIds) retiredParcelIds.add(sourceParcelId);
  }
  return (parcelId: string) => retiredParcelIds.has(parcelId);
}

function committed(
  result: ReturnType<CadastralMutationSystem['splitParcel']>,
): CadastralRuntimeMutationResult {
  return Object.freeze({
    committed: true,
    resultingParcelIds: Object.freeze([...result.resultingParcelIds]),
    retiredParcelIds: Object.freeze([...result.retiredParcelIds]),
    rejectionReasons: Object.freeze([]),
    parcelReferenceRewrites: Object.freeze({ ...result.parcelReferenceRewrites }),
  });
}

function fromLowLevel(
  result: ReturnType<CadastralMutationSystem['splitParcel']>,
): CadastralRuntimeMutationResult {
  return Object.freeze({
    committed: result.committed,
    resultingParcelIds: Object.freeze([...result.resultingParcelIds]),
    retiredParcelIds: Object.freeze([...result.retiredParcelIds]),
    rejectionReasons: Object.freeze([...result.rejectionReasons]),
    parcelReferenceRewrites: Object.freeze({ ...result.parcelReferenceRewrites }),
  });
}

function rejected(
  reason: string,
  resultingParcelIds: readonly string[] = [],
  retiredParcelIds: readonly string[] = [],
): CadastralRuntimeMutationResult {
  return Object.freeze({
    committed: false,
    resultingParcelIds: Object.freeze([...resultingParcelIds]),
    retiredParcelIds: Object.freeze([...retiredParcelIds]),
    rejectionReasons: Object.freeze([reason]),
    parcelReferenceRewrites: Object.freeze({}),
  });
}
