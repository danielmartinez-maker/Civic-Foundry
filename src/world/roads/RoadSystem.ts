import type { CellCoord } from '../../simulation/core/types.ts';
import { cellKey } from '../../simulation/core/types.ts';
import type { TerrainGrid } from '../terrain/TerrainGrid.ts';
import type { TreasurySystem } from '../../simulation/treasury/TreasurySystem.ts';
import { ROAD_DEFINITIONS, type RoadType } from '../../data/roads.ts';

export type RoadCell = Readonly<CellCoord & { type: RoadType }>;
export type RoadPlacementResult = Readonly<{ ok: boolean; cost: number; reason?: string }>;

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class RoadSystem {
  private readonly terrain: TerrainGrid;
  private readonly cells = new Map<string, RoadCell>();
  private costMultiplierAt: (x: number, y: number) => number;
  revision = 0;

  constructor(terrain: TerrainGrid, costMultiplierAt: (x: number, y: number) => number = () => 1) {
    this.terrain = terrain;
    this.costMultiplierAt = costMultiplierAt;
  }

  setCostMultiplierProvider(provider: (x: number, y: number) => number): void {
    this.costMultiplierAt = provider;
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
    const newCoords: CellCoord[] = [];
    for (const coord of coords) {
      const key = cellKey(coord.x, coord.y);
      if (seen.has(key)) return { ok: false, cost: 0, reason: 'duplicate cell in path' };
      seen.add(key);
      if (!this.terrain.isBuildable(coord.x, coord.y)) return { ok: false, cost: 0, reason: 'unbuildable terrain' };
      if (!this.cells.has(key)) newCoords.push(coord);
    }
    if (newCoords.length === 0) return { ok: false, cost: 0, reason: 'road already exists' };
    const definition = ROAD_DEFINITIONS[type];
    let rawCost = 0;
    for (const coord of newCoords) {
      const multiplier = this.costMultiplierAt(coord.x, coord.y);
      if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error(`invalid road terrain cost multiplier at ${coord.x},${coord.y}`);
      rawCost += definition.constructionCostPerCell * multiplier;
    }
    const cost = roundCurrency(rawCost);
    if (!treasury.tryDebit(cost, `Build ${type} road`)) return { ok: false, cost, reason: 'insufficient funds' };
    for (const coord of newCoords) this.cells.set(cellKey(coord.x, coord.y), { x: coord.x, y: coord.y, type });
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

  restore(cells: readonly RoadCell[], revision: number): void {
    this.cells.clear();
    for (const cell of cells) {
      if (!this.terrain.isBuildable(cell.x, cell.y)) throw new Error('invalid restored road cell');
      this.cells.set(cellKey(cell.x, cell.y), { ...cell });
    }
    this.revision = Math.max(0, Math.floor(revision));
  }
}
