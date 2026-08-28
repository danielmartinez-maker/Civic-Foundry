import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { serializeCore } from '../src/save/save.ts';
import { serializeCoreV9 } from '../src/save/saveV9.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('default save advances to V10 and owns canonical intersection-control state', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 101, startingFunds: 500_000 });
  const current = serializeCore(core) as unknown as Record<string, unknown>;

  assert.equal(current.saveVersion, 10);
  assert.equal(current.gameVersion, '0.10.0-intersection-control');
  assert.deepEqual(current.intersectionControl, core.intersectionControl.snapshot());

  const legacyV9 = serializeCoreV9(core) as unknown as Record<string, unknown>;
  assert.equal(legacyV9.saveVersion, 9);
  assert.equal(legacyV9.gameVersion, '0.9.0-urban-fabric');
  assert.equal('intersectionControl' in legacyV9, false);
});
