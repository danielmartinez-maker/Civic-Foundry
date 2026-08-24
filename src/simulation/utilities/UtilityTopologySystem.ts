import { UTILITY_CORRIDOR_COST } from '../../data/utilities.ts';
import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import type { CellCoord } from '../core/types.ts';
import type {
  UtilityCorridorCell,
  UtilityCorridorType,
  UtilityMutationResult,
  UtilityTier,
  UtilityTopologyState,
} from './UtilityInfrastructureTypes.ts';

const CORRIDOR_TYPES: readonly UtilityCorridorType[] = [
  'power_distribution',
  'power_transmission',
  'water_main',
  'water_trunk',
];

const cellKey = (type: UtilityCorridorType, x: number, y: number): string => `${type}|${x},${y}`;
const coordKey = (coord: CellCoord): string => `${coord.x},${coord.y}`;
const isDistribution = (type: UtilityCorridorType): boolean => type === 'power_distribution' || type === 'water_main';

function costFor(type: UtilityCorridorType, tier: UtilityTier): number {
  return UTILITY_CORRIDOR_COST[type][tier];
}

function nextTier(tier: UtilityTier): UtilityTier | undefined {
  if (tier === 1) return 2;
  if (tier === 2) return 3;
  return undefined;
}

function isTier(value: number): value is UtilityTier {
  return value === 1 || value === 2 || value === 3;
}

function isCorridorType(value: string): value is UtilityCorridorType {
  return (CORRIDOR_TYPES as readonly string[]).includes(value);
}

function sortedCells(cells: Iterable<UtilityCorridorCell>): UtilityCorridorCell[] {
  return [...cells]
    .map((cell) => ({ ...cell }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}

export class UtilityTopologySystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly cells = new Map<string, UtilityCorridorCell>();
  revision = 0;
  private nextCorridorId = 1;

  constructor(terrain: TerrainGrid, roads: RoadSystem) {
    this.terrain = terrain;
    this.roads = roads;
  }

  list(): UtilityCorridorCell[] {
    return sortedCells(this.cells.values());
  }

  get(type: UtilityCorridorType, x: number, y: number): UtilityCorridorCell | undefined {
    const cell = this.cells.get(cellKey(type, x, y));
    return cell ? { ...cell } : undefined;
  }

  seedCell(type: UtilityCorridorType, tier: UtilityTier, x: number, y: number): UtilityCorridorCell {
    const existing = this.cells.get(cellKey(type, x, y));
    if (existing) return { ...existing };
    const reason = this.validateCell(type, tier, { x, y });
    if (reason) throw new Error(reason);
    const cell: UtilityCorridorCell = Object.freeze({
      id: `utility-corridor:${this.nextCorridorId++}`,
      type,
      tier,
      x,
      y,
      saturatedCycles: 0,
      trippedUntilTick: 0,
    });
    this.cells.set(cellKey(type, x, y), cell);
    this.revision++;
    return { ...cell };
  }

  placePath(
    type: UtilityCorridorType,
    tier: UtilityTier,
    coords: readonly CellCoord[],
    treasury: TreasurySystem,
  ): UtilityMutationResult {
    if (!isCorridorType(type)) return { ok: false, cost: 0, reason: 'invalid corridor type' };
    if (!isTier(tier)) return { ok: false, cost: 0, reason: 'invalid corridor tier' };
    if (coords.length === 0) return { ok: false, cost: 0, reason: 'empty path' };

    const seen = new Set<string>();
    for (let index = 0; index < coords.length; index++) {
      const coord = coords[index];
      if (!coord || !Number.isInteger(coord.x) || !Number.isInteger(coord.y)) {
        return { ok: false, cost: costFor(type, tier) * coords.length, reason: 'invalid coordinate' };
      }
      const key = coordKey(coord);
      if (seen.has(key)) return { ok: false, cost: costFor(type, tier) * coords.length, reason: 'duplicate cell in path' };
      seen.add(key);
      if (this.cells.has(cellKey(type, coord.x, coord.y))) {
        return { ok: false, cost: costFor(type, tier) * coords.length, reason: 'corridor already exists' };
      }
      const reason = this.validateCell(type, tier, coord);
      if (reason) return { ok: false, cost: costFor(type, tier) * coords.length, reason };
      if (index > 0) {
        const prior = coords[index - 1];
        if (!prior || Math.abs(prior.x - coord.x) + Math.abs(prior.y - coord.y) !== 1) {
          return { ok: false, cost: costFor(type, tier) * coords.length, reason: 'path must be cardinally contiguous' };
        }
      }
    }

    const cost = costFor(type, tier) * coords.length;
    if (!treasury.tryDebit(cost, `Build ${type}`)) return { ok: false, cost, reason: 'insufficient funds' };

    const ordered = [...coords].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const coord of ordered) {
      const cell: UtilityCorridorCell = Object.freeze({
        id: `utility-corridor:${this.nextCorridorId++}`,
        type,
        tier,
        x: coord.x,
        y: coord.y,
        saturatedCycles: 0,
        trippedUntilTick: 0,
      });
      this.cells.set(cellKey(type, coord.x, coord.y), cell);
    }
    this.revision++;
    return { ok: true, cost };
  }

  upgradePath(type: UtilityCorridorType, coords: readonly CellCoord[], treasury: TreasurySystem): UtilityMutationResult {
    if (!isCorridorType(type)) return { ok: false, cost: 0, reason: 'invalid corridor type' };
    if (coords.length === 0) return { ok: false, cost: 0, reason: 'empty path' };

    const seen = new Set<string>();
    const upgrades: Array<{ key: string; cell: UtilityCorridorCell; tier: UtilityTier; delta: number }> = [];
    for (const coord of coords) {
      const key = coordKey(coord);
      if (seen.has(key)) return { ok: false, cost: 0, reason: 'duplicate cell in path' };
      seen.add(key);
      const storageKey = cellKey(type, coord.x, coord.y);
      const cell = this.cells.get(storageKey);
      if (!cell) return { ok: false, cost: 0, reason: 'corridor missing' };
      const tier = nextTier(cell.tier);
      if (!tier) return { ok: false, cost: 0, reason: 'maximum tier reached' };
      upgrades.push({ key: storageKey, cell, tier, delta: costFor(type, tier) - costFor(type, cell.tier) });
    }

    const cost = upgrades.reduce((sum, item) => sum + item.delta, 0);
    if (!treasury.tryDebit(cost, `Upgrade ${type}`)) return { ok: false, cost, reason: 'insufficient funds' };
    for (const item of upgrades) this.cells.set(item.key, Object.freeze({ ...item.cell, tier: item.tier }));
    this.revision++;
    return { ok: true, cost };
  }

  removeAt(type: UtilityCorridorType, x: number, y: number): UtilityCorridorCell | undefined {
    const key = cellKey(type, x, y);
    const existing = this.cells.get(key);
    if (!existing) return undefined;
    this.cells.delete(key);
    this.revision++;
    return { ...existing };
  }

  updateProtectionStates(
    updates: readonly Readonly<{ id: string; saturatedCycles: number; trippedUntilTick: number }>[],
  ): boolean {
    if (updates.length === 0) return false;
    const byId = new Map([...this.cells.entries()].map(([key, cell]) => [cell.id, { key, cell }] as const));
    const seen = new Set<string>();
    const staged: Array<{ key: string; cell: UtilityCorridorCell }> = [];
    let changed = false;
    for (const update of [...updates].sort((a, b) => a.id.localeCompare(b.id))) {
      if (seen.has(update.id)) throw new Error('duplicate utility protection update');
      seen.add(update.id);
      const current = byId.get(update.id);
      if (!current) throw new Error(`unknown utility corridor id: ${update.id}`);
      if (!Number.isInteger(update.saturatedCycles) || update.saturatedCycles < 0) throw new Error('invalid utility saturation counter');
      if (!Number.isInteger(update.trippedUntilTick) || update.trippedUntilTick < 0) throw new Error('invalid utility trip expiry');
      const next = Object.freeze({ ...current.cell, saturatedCycles: update.saturatedCycles, trippedUntilTick: update.trippedUntilTick });
      staged.push({ key: current.key, cell: next });
      if (next.saturatedCycles !== current.cell.saturatedCycles || next.trippedUntilTick !== current.cell.trippedUntilTick) changed = true;
    }
    if (!changed) return false;
    for (const item of staged) this.cells.set(item.key, item.cell);
    this.revision++;
    return true;
  }

  snapshotState(): UtilityTopologyState {
    return Object.freeze({
      cells: Object.freeze(this.list().map((cell) => Object.freeze({ ...cell }))),
      revision: this.revision,
      nextCorridorId: this.nextCorridorId,
    });
  }

  restoreState(state: UtilityTopologyState): void {
    if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('invalid utility topology revision');
    if (!Number.isInteger(state.nextCorridorId) || state.nextCorridorId < 1) throw new Error('invalid utility topology next id');

    const idSet = new Set<string>();
    const restored = new Map<string, UtilityCorridorCell>();
    for (const raw of state.cells) {
      if (!raw.id || idSet.has(raw.id)) throw new Error('duplicate utility corridor id');
      idSet.add(raw.id);
      if (!isCorridorType(raw.type)) throw new Error('invalid utility corridor type');
      if (!isTier(raw.tier)) throw new Error('invalid utility corridor tier');
      if (!Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !this.terrain.inBounds(raw.x, raw.y)) throw new Error('invalid utility corridor coordinate');
      if (isDistribution(raw.type)) {
        if (!this.roads.has(raw.x, raw.y)) throw new Error('utility distribution corridor missing road right-of-way');
      } else if (!this.terrain.isBuildable(raw.x, raw.y)) {
        throw new Error('utility backbone corridor on unbuildable terrain');
      }
      if (!Number.isInteger(raw.saturatedCycles) || raw.saturatedCycles < 0) throw new Error('invalid utility saturation counter');
      if (!Number.isInteger(raw.trippedUntilTick) || raw.trippedUntilTick < 0) throw new Error('invalid utility trip expiry');
      const key = cellKey(raw.type, raw.x, raw.y);
      if (restored.has(key)) throw new Error('duplicate utility corridor layer coordinate');
      restored.set(key, Object.freeze({ ...raw }));
    }

    this.cells.clear();
    for (const [key, cell] of restored) this.cells.set(key, cell);
    this.revision = state.revision;
    this.nextCorridorId = state.nextCorridorId;
  }

  private validateCell(type: UtilityCorridorType, tier: UtilityTier, coord: CellCoord): string | undefined {
    if (!isCorridorType(type)) return 'invalid corridor type';
    if (!isTier(tier)) return 'invalid corridor tier';
    if (!Number.isInteger(coord.x) || !Number.isInteger(coord.y) || !this.terrain.inBounds(coord.x, coord.y)) return 'invalid coordinate';
    if (isDistribution(type)) return this.roads.has(coord.x, coord.y) ? undefined : 'road right-of-way required';
    return this.terrain.isBuildable(coord.x, coord.y) ? undefined : 'buildable terrain required';
  }
}
