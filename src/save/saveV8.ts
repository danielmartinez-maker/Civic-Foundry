import { withSimulationCoreHydrationOverride, type SimulationCore } from '../simulation/core/SimulationCore.ts';
import { WorldFoundation } from '../world/foundation/WorldFoundation.ts';
import type { WorldFoundationSnapshot } from '../world/foundation/WorldFoundationTypes.ts';
import type { TerrainCell } from '../world/terrain/TerrainGrid.ts';
import { hydrateCoreV7, serializeCoreV7, type SaveV7 } from './saveV7.ts';

export type SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 8;
  gameVersion: '0.8.0-world-foundation';
  world: WorldFoundationSnapshot;
}>;

export function serializeCoreV8(core: SimulationCore, baseV7: SaveV7 = serializeCoreV7(core)): SaveV8 {
  return { ...baseV7, saveVersion: 8, gameVersion: '0.8.0-world-foundation', world: core.world.snapshotAuthoritative() };
}

export function hydrateCoreV8(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 8) {
    const fromSaveVersion = isRecord(input) && Number.isInteger(input.saveVersion) && Number(input.saveVersion) >= 0 ? Number(input.saveVersion) : 1;
    const core = withSimulationCoreHydrationOverride({ terrainMode: 'legacy-flat' }, () => hydrateCoreV7(input));
    core.recordWorldMigrationDiagnostic(fromSaveVersion);
    return core;
  }
  if (input.gameVersion !== '0.8.0-world-foundation') throw new Error('invalid V8 game version');
  if (!isRecord(input.world)) throw new Error('world must be an object');

  const save = input as unknown as SaveV8;
  const world = WorldFoundation.restore(save.world);
  validateCompatibilityTerrain(save.terrain, world.legacyTerrain().snapshot(), world.terrain.width, world.terrain.height);
  const { world: _world, ...withoutWorld } = save;
  const v7: SaveV7 = { ...withoutWorld, saveVersion: 7, gameVersion: '0.7.0-metropolitan' };
  return withSimulationCoreHydrationOverride({ world }, () => hydrateCoreV7(v7));
}

function validateCompatibilityTerrain(saved: Readonly<{ width: number; height: number; cells: readonly TerrainCell[] }>, expectedCells: readonly TerrainCell[], expectedWidth: number, expectedHeight: number): void {
  if (saved.width !== expectedWidth || saved.height !== expectedHeight) throw new Error('world compatibility terrain dimensions do not match save terrain');
  if (!Array.isArray(saved.cells) || saved.cells.length !== expectedCells.length) throw new Error('world compatibility terrain cell count does not match save terrain');
  for (let index = 0; index < expectedCells.length; index++) {
    const a = saved.cells[index]; const b = expectedCells[index];
    if (!a || !b || a.elevation !== b.elevation || a.water !== b.water || a.buildable !== b.buildable || a.biome !== b.biome) throw new Error(`world compatibility terrain differs at cell ${index}`);
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
