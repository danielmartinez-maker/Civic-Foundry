import type { ZoneType } from '../core/types.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_DEFINITION_BY_ID,
  BUILDING_VARIANTS,
  type BuildingDefinition,
  type BuildingIntensity,
} from '../../data/buildings.ts';
import { getBuildingTypology } from '../../data/buildingTypologies.ts';
import type { Lot } from '../../world/lots/LotSystem.ts';
import {
  LEGACY_CELL_SIZE_METERS,
  polygonArea,
  polygonIntersection,
} from '../../world/cadastre/Geometry.ts';
import type { DevelopmentAward } from '../development/DevelopmentTypes.ts';
import type { BuildingV2 } from './BuildingTypes.ts';

export type BuildingStatus = 'construction' | 'occupied';
export type Building = {
  id: string;
  lotId: string;
  x: number;
  y: number;
  zone: ZoneType;
  definitionId: string;
  status: BuildingStatus;
  constructionStartedTick: number;
  completionTick: number;
  developerId?: string;
  projectCost?: number;
  requiredEquity?: number;
  awardScore?: number;
};

export type NativeLegacyBuildingProjectionCell = Readonly<{
  parcelId: string;
  x: number;
  y: number;
  faithful: boolean;
}>;

const INTENSITY_RANK: Readonly<Record<BuildingIntensity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});
const SPATIAL_OVERLAP_EPSILON_M2 = 1e-6;

export function definitionForBuilding(
  building: Pick<Building, 'definitionId' | 'zone'>,
): BuildingDefinition {
  return (
    BUILDING_DEFINITION_BY_ID[building.definitionId] ??
    BUILDING_DEFINITIONS[building.zone]
  );
}

export class BuildingSystem {
  private readonly buildings = new Map<string, Building>();
  private readonly buildingsV2 = new Map<string, BuildingV2>();

  startDevelopment(tick: number, lot: Lot, award: DevelopmentAward): Building {
    if (!Number.isInteger(tick) || tick < 0)
      throw new Error('tick must be a non-negative integer');
    if (this.buildings.has(lot.id))
      throw new Error(`lot already developed: ${lot.id}`);
    const definition = this.validateAwardForLot(tick, lot, award);

    const building = this.buildingFromAward(tick, lot, award, definition);
    this.buildings.set(lot.id, building);
    return { ...building };
  }

  replaceDevelopment(
    tick: number,
    lot: Lot,
    award: DevelopmentAward,
  ): { removed: Building; replacement: Building } {
    if (!Number.isInteger(tick) || tick < 0)
      throw new Error('tick must be a non-negative integer');
    const existing = this.buildings.get(lot.id);
    if (!existing)
      throw new Error(
        `redevelopment requires an existing occupied building: ${lot.id}`,
      );
    if (existing.status !== 'occupied')
      throw new Error(`redevelopment requires an occupied building: ${lot.id}`);
    if (lot.zone !== 'residential' || existing.zone !== 'residential') {
      throw new Error('redevelopment execution is residential only');
    }
    if (existing.id !== `building:${lot.id}`) {
      throw new Error(`existing building id does not match lot: ${existing.id}`);
    }

    const definition = this.validateAwardForLot(tick, lot, award);
    if (definition.zone !== 'residential')
      throw new Error('redevelopment execution is residential only');
    const existingDefinition = definitionForBuilding(existing);
    if (
      INTENSITY_RANK[definition.intensity] <=
      INTENSITY_RANK[existingDefinition.intensity]
    ) {
      throw new Error(
        'redevelopment replacement must have higher intensity than the existing building',
      );
    }

    const replacement = this.buildingFromAward(tick, lot, award, definition);
    const removed = { ...existing };
    this.buildings.set(lot.id, replacement);
    return { removed, replacement: { ...replacement } };
  }

  tick(tick: number): void {
    for (const building of this.buildings.values()) {
      if (
        building.status === 'construction' &&
        tick >= building.completionTick
      )
        building.status = 'occupied';
    }
  }

  getById(id: string): Building | undefined {
    for (const building of this.buildings.values())
      if (building.id === id) return { ...building };
    return undefined;
  }

  getAt(x: number, y: number): Building | undefined {
    for (const building of this.buildings.values())
      if (building.x === x && building.y === y) return { ...building };
    return undefined;
  }

  removeAt(x: number, y: number): Building | undefined {
    for (const [lotId, building] of this.buildings.entries()) {
      if (building.x === x && building.y === y) {
        this.buildings.delete(lotId);
        return { ...building };
      }
    }
    return undefined;
  }

  list(): Building[] {
    return [...this.buildings.values()]
      .map((building) => ({ ...building }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  occupied(): Building[] {
    return this.list().filter((building) => building.status === 'occupied');
  }

  residentialCapacity(): number {
    return this.occupied().reduce(
      (sum, building) => sum + definitionForBuilding(building).residentCapacity,
      0,
    );
  }

  jobCapacity(): number {
    return this.occupied().reduce(
      (sum, building) => sum + definitionForBuilding(building).jobCapacity,
      0,
    );
  }

  restore(buildings: readonly Building[]): void {
    this.buildings.clear();
    for (const building of buildings)
      this.buildings.set(building.lotId, { ...building });
  }

  restoreV2(buildings: readonly BuildingV2[]): void {
    const next = new Map<string, BuildingV2>();
    for (const building of buildings) {
      if (next.has(building.id))
        throw new Error(`duplicate canonical building id: ${building.id}`);
      next.set(building.id, cloneBuildingV2(building));
    }
    this.buildingsV2.clear();
    for (const [id, building] of next) this.buildingsV2.set(id, building);
  }

  /**
   * Rebuild the inherited one-cell building API from native canonical BuildingV2.
   * The returned legacy objects are disposable compatibility records: canonical
   * identity, lifecycle and existence remain owned by BuildingV2.
   */
  restoreLegacyProjectionFromV2(
    buildings: readonly BuildingV2[],
    lots: readonly Lot[],
    projectionCells: readonly NativeLegacyBuildingProjectionCell[],
  ): void {
    const lotsByCell = new Map(
      lots.map((lot) => [`${lot.x},${lot.y}`, lot] as const),
    );
    const cellsByParcel = new Map<
      string,
      NativeLegacyBuildingProjectionCell[]
    >();
    for (const cell of projectionCells) {
      const cells = cellsByParcel.get(cell.parcelId) ?? [];
      cells.push(cell);
      cellsByParcel.set(cell.parcelId, cells);
    }
    for (const cells of cellsByParcel.values()) {
      cells.sort(
        (left, right) =>
          Number(right.faithful) - Number(left.faithful) ||
          left.y - right.y ||
          left.x - right.x,
      );
    }

    const projected: Building[] = [];
    const consumedLots = new Set<string>();
    for (const building of [...buildings].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const candidateCells = building.parcelIds.flatMap(
        (parcelId) => cellsByParcel.get(parcelId) ?? [],
      );
      const lot = candidateCells
        .map((cell) => lotsByCell.get(`${cell.x},${cell.y}`))
        .find((candidate) => candidate && !consumedLots.has(candidate.id));
      if (!lot) continue;

      consumedLots.add(lot.id);
      const definitionId = compatibilityDefinitionId(building, lot);
      const underConstruction =
        building.status === 'proposed' ||
        building.status === 'entitlement' ||
        building.status === 'demolition' ||
        building.status === 'construction';
      const constructionStartedTick = Math.max(
        0,
        Math.trunc(
          building.project?.startedTick ?? building.entitlement.approvalTick,
        ),
      );
      const completionTick = underConstruction
        ? Math.max(
            constructionStartedTick + 1,
            building.project?.completionTick ?? Number.MAX_SAFE_INTEGER,
          )
        : Math.max(
            constructionStartedTick,
            building.project?.completionTick ?? constructionStartedTick,
          );

      projected.push({
        id: `building:${lot.id}`,
        lotId: lot.id,
        x: lot.x,
        y: lot.y,
        zone: lot.zone,
        definitionId,
        status: underConstruction ? 'construction' : 'occupied',
        constructionStartedTick,
        completionTick,
        ...(building.developerId ? { developerId: building.developerId } : {}),
        projectCost: building.projectCost,
      });
    }
    this.restore(projected);
  }

  listV2(): BuildingV2[] {
    return [...this.buildingsV2.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneBuildingV2);
  }

  getV2ById(id: string): BuildingV2 | undefined {
    const building = this.buildingsV2.get(id);
    return building ? cloneBuildingV2(building) : undefined;
  }

  getV2At(x: number, y: number): BuildingV2 | undefined {
    const minX = x * LEGACY_CELL_SIZE_METERS;
    const minY = y * LEGACY_CELL_SIZE_METERS;
    const maxX = minX + LEGACY_CELL_SIZE_METERS;
    const maxY = minY + LEGACY_CELL_SIZE_METERS;
    const cell = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    for (const building of [...this.buildingsV2.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const overlap = polygonIntersection(building.footprint, cell);
      if (
        overlap.some(
          (ring) => polygonArea(ring) > SPATIAL_OVERLAP_EPSILON_M2,
        )
      )
        return cloneBuildingV2(building);
    }
    return undefined;
  }

  private validateAwardForLot(
    tick: number,
    lot: Lot,
    award: DevelopmentAward,
  ): BuildingDefinition {
    if (award.lotId !== lot.id)
      throw new Error(`award lot does not match parcel: ${award.lotId}`);
    if (award.zone !== lot.zone)
      throw new Error(`award zone does not match parcel zone: ${award.zone}`);
    const definition = BUILDING_DEFINITION_BY_ID[award.definitionId];
    if (!definition)
      throw new Error(
        `unknown awarded building definition: ${award.definitionId}`,
      );
    if (definition.zone !== lot.zone)
      throw new Error(
        `building definition zone does not match parcel zone: ${definition.zone}`,
      );
    const expectedBuildingId = `building:${lot.id}`;
    if (award.buildingId !== expectedBuildingId)
      throw new Error(`award building id does not match lot: ${award.buildingId}`);
    const expectedCompletionTick = tick + definition.constructionTicks;
    if (award.completionTick !== expectedCompletionTick)
      throw new Error(
        'award completion tick does not match building definition',
      );
    return definition;
  }

  private buildingFromAward(
    tick: number,
    lot: Lot,
    award: DevelopmentAward,
    definition: BuildingDefinition,
  ): Building {
    return {
      id: award.buildingId,
      lotId: lot.id,
      x: lot.x,
      y: lot.y,
      zone: lot.zone,
      definitionId: definition.id,
      status: 'construction',
      constructionStartedTick: tick,
      completionTick: award.completionTick,
      developerId: award.developerId,
      projectCost: award.totalDevelopmentCost,
      requiredEquity: award.requiredEquity,
      awardScore: award.rankScore,
    };
  }
}

function compatibilityDefinitionId(building: BuildingV2, lot: Lot): string {
  const typology = getBuildingTypology(building.typologyId);
  if (typology.legacyDefinitionId) {
    const definition = BUILDING_DEFINITION_BY_ID[typology.legacyDefinitionId];
    if (definition?.zone === lot.zone) return definition.id;
  }

  const targetRank = building.stories >= 8 ? 2 : building.stories >= 3 ? 1 : 0;
  const candidates = [...BUILDING_VARIANTS[lot.zone]].sort(
    (left, right) =>
      Math.abs(INTENSITY_RANK[left.intensity] - targetRank) -
        Math.abs(INTENSITY_RANK[right.intensity] - targetRank) ||
      left.id.localeCompare(right.id),
  );
  const fallback = candidates[0];
  if (!fallback)
    throw new Error(`no legacy building projection for zone: ${lot.zone}`);
  return fallback.id;
}

function cloneBuildingV2(building: BuildingV2): BuildingV2 {
  return {
    ...building,
    parcelIds: [...building.parcelIds],
    footprint: building.footprint.map((point) => ({ ...point })),
    floors: building.floors.map((floor) => ({
      ...floor,
      uses: floor.uses.map((use) => ({ ...use })),
    })),
    entitlement: {
      ...building.entitlement,
      approvedUses: [...building.entitlement.approvedUses],
    },
    lifecycle: { ...building.lifecycle },
    ...(building.project ? { project: { ...building.project } } : {}),
  };
}
