import type { CellCoord, ZoneType } from '../core/types.ts';
import { cellKey } from '../core/types.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import { getZoningDistrict } from './ZoningDistrictCatalog.ts';
import type { ParcelZoningAssignment } from './ZoningTypes.ts';

export type ZonedCell = Readonly<CellCoord & { zone: ZoneType }>;

export class ZoningSystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly zones = new Map<string, ZonedCell>();
  private readonly parcelAssignments = new Map<string, ParcelZoningAssignment>();

  constructor(terrain: TerrainGrid, roads: RoadSystem) {
    this.terrain = terrain;
    this.roads = roads;
  }

  paint(coords: readonly CellCoord[], zone: ZoneType): { painted: number } {
    let painted = 0;
    for (const coord of coords) {
      if (!this.terrain.isBuildable(coord.x, coord.y) || this.roads.has(coord.x, coord.y)) continue;
      this.zones.set(cellKey(coord.x, coord.y), { x: coord.x, y: coord.y, zone });
      painted++;
    }
    return { painted };
  }

  clear(x: number, y: number): void {
    this.zones.delete(cellKey(x, y));
  }

  get(x: number, y: number): ZoneType | undefined {
    return this.zones.get(cellKey(x, y))?.zone;
  }

  list(): ZonedCell[] {
    return [...this.zones.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  restore(cells: readonly ZonedCell[]): void {
    this.zones.clear();
    for (const cell of cells) {
      if (!this.terrain.isBuildable(cell.x, cell.y) || this.roads.has(cell.x, cell.y)) throw new Error('invalid restored zoning cell');
      this.zones.set(cellKey(cell.x, cell.y), { ...cell });
    }
  }

  assignParcel(parcelId: string, districtId: string, overlayIds: readonly string[] = []): void {
    if (parcelId.trim().length === 0) throw new Error('parcelId must be non-empty');
    if (!getZoningDistrict(districtId)) throw new Error(`unknown zoning district: ${districtId}`);
    this.parcelAssignments.set(parcelId, Object.freeze({
      parcelId,
      districtId,
      overlayIds: Object.freeze([...new Set(overlayIds)].sort()),
    }));
  }

  clearParcelAssignment(parcelId: string): void {
    this.parcelAssignments.delete(parcelId);
  }

  getParcelDistrictId(parcelId: string): string | undefined {
    return this.parcelAssignments.get(parcelId)?.districtId;
  }

  getParcelAssignment(parcelId: string): ParcelZoningAssignment | undefined {
    const assignment = this.parcelAssignments.get(parcelId);
    return assignment ? cloneAssignment(assignment) : undefined;
  }

  listParcelAssignments(): readonly ParcelZoningAssignment[] {
    return Object.freeze([...this.parcelAssignments.values()]
      .map(cloneAssignment)
      .sort((left, right) => left.parcelId.localeCompare(right.parcelId)));
  }

  restoreParcelAssignments(assignments: readonly ParcelZoningAssignment[]): void {
    const next = new Map<string, ParcelZoningAssignment>();
    for (const assignment of assignments) {
      if (assignment.parcelId.trim().length === 0) throw new Error('invalid parcel zoning assignment');
      if (!getZoningDistrict(assignment.districtId)) throw new Error(`unknown zoning district: ${assignment.districtId}`);
      if (next.has(assignment.parcelId)) throw new Error(`duplicate parcel zoning assignment: ${assignment.parcelId}`);
      next.set(assignment.parcelId, Object.freeze({
        parcelId: assignment.parcelId,
        districtId: assignment.districtId,
        overlayIds: Object.freeze([...new Set(assignment.overlayIds)].sort()),
      }));
    }
    this.parcelAssignments.clear();
    for (const [parcelId, assignment] of next) this.parcelAssignments.set(parcelId, assignment);
  }
}

function cloneAssignment(assignment: ParcelZoningAssignment): ParcelZoningAssignment {
  return Object.freeze({
    parcelId: assignment.parcelId,
    districtId: assignment.districtId,
    overlayIds: Object.freeze([...assignment.overlayIds]),
  });
}
