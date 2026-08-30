import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LegacySimulationCore } from '../src/simulation/core/LegacySimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('LegacySimulationCore module exports a matching LegacySimulationCore symbol', () => {
  const core = new LegacySimulationCore({ terrain: flatTerrain(), seed: 77 });
  assert.equal(core.seed, 77);
});

test('current runtime presentation uses canonical milestone and waste terminology', async () => {
  const gameAppSource = await readFile(new URL('../src/app/GameApp.ts', import.meta.url), 'utf8');
  const inspectorSource = await readFile(new URL('../src/ui/Inspector.ts', import.meta.url), 'utf8');

  assert.match(gameAppSource, /URBAN FABRIC 2\.0 · DESKTOP GPU RUNTIME/);
  assert.doesNotMatch(gameAppSource, /PHASE VI · FIRMS, PRODUCTION & FREIGHT/);
  assert.match(gameAppSource, /<option value="garbage">Waste<\/option>/);
  assert.doesNotMatch(gameAppSource, /<option value="garbage">Garbage<\/option>/);
  assert.match(gameAppSource, /const SERVICE_DEPARTMENT_LABELS: Readonly<Record<ServiceDepartment, string>>/);
  assert.match(gameAppSource, /garbage: 'Waste'/);
  assert.match(gameAppSource, /\$\{SERVICE_DEPARTMENT_LABELS\[department\]\}/);

  assert.match(inspectorSource, /Waste backlog:/);
  assert.match(inspectorSource, /Waste access:/);
  assert.doesNotMatch(inspectorSource, /Garbage backlog:|Garbage access:/);
});
