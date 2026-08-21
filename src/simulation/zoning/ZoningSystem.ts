import type { CellCoord, ZoneType } from '../core/types.ts';
import { cellKey } from '../core/types.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';

export type ZonedCell = Readonly<CellCoord & { zone: ZoneType }>;

export class ZoningSystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly zones = new Map<string, ZonedCell>();

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
}
