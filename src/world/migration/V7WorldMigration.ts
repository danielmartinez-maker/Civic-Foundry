import { WorldFoundation } from '../foundation/WorldFoundation.ts';
import { TerrainGrid } from '../terrain/TerrainGrid.ts';

export function migrateV7TerrainToWorld(terrain: TerrainGrid, seed: number): WorldFoundation {
  return WorldFoundation.fromLegacyTerrain(terrain, seed, 'legacy-flat');
}
