import type { CellCoord } from '../../simulation/core/types.ts';
import { cellKey } from '../../simulation/core/types.ts';
import type { TerrainGrid } from '../terrain/TerrainGrid.ts';
import type { TreasurySystem } from '../../simulation/treasury/TreasurySystem.ts';
import { ROAD_DEFINITIONS, type RoadType } from '../../data/roads.ts';

export type RoadCell = Readonly<CellCoord & { type: RoadType }>;
export type RoadPlacementResult = Readonly<{ ok: boolean; cost: number; reason?: string }>;

export class RoadSystem {
  private readonly terrain: TerrainGrid;
  private readonly cells = new Map<string, RoadCell>();
  revision = 0;

  constructor(terrain: TerrainGrid) {
    this.terrain = terrain;
  }

  has(x: number, y: number): boolean {
    return this.cells.has(cellKey(x, y));
  }

  get(x: number, y: number): RoadCell | undefined {
    return this.cells.get(cellKey(x, y));
  }

  placePath(coords: readonly CellCoord[], type: RoadType, treasury: TreasurySystem): RoadPlacementResult {
    if (coords.length === 0) return { ok: false, cost: 0, reason: 'empty path' };
    const seen = new Set<string>();
    for (const coord of coords) {
      const key = cellKey(coord.x, coord.y);
      if (seen.has(key)) return { ok: false, cost: 0, reason: 'duplicate cell in path' };
      seen.add(key);
      if (!this.terrain.isBuildable(coord.x, coord.y)) return { ok: false, cost: 0, reason: 'unbuildable terrain' };
      if (this.cells.has(key)) return { ok: false, cost: 0, reason: 'road already exists' };
    }
    const definition = ROAD_DEFINITIONS[type];
    const cost = definition.constructionCostPerCell * coords.length;
    if (!treasury.tryDebit(cost, `Build ${type} road`)) return { ok: false, cost, reason: 'insufficient funds' };
    for (const coord of coords) this.cells.set(cellKey(coord.x, coord.y), { x: coord.x, y: coord.y, type });
    this.revision++;
    return { ok: true, cost };
  }

  remove(x: number, y: number): RoadCell | undefined {
    const key = cellKey(x, y);
    const existing = this.cells.get(key);
    if (!existing) return undefined;
    this.cells.delete(key);
    this.revision++;
    return existing;
  }

  list(): RoadCell[] {
    return [...this.cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  }
}
