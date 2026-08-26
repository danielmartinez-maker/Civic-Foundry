import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';

function flatTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('simulation owns cadastral parcels while legacy lot view preserves cell identity', () => {
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 150_000, seed: 7 });
  core.buildRoad(Array.from({ length: 8 }, (_, index) => ({ x: index + 2, y: 4 })), 'local');
  core.paintZone([
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 5, y: 3 },
  ], 'residential');
  core.step(1);

  const cadastre = (core as SimulationCore & { readonly cadastre?: CadastralGraph }).cadastre;
  assert.ok(cadastre, 'SimulationCore must expose the canonical cadastral graph');

  const frontageParcels = cadastre.listParcels().filter((parcel) => parcel.frontageEdgeIds.length > 0);
  assert.equal(frontageParcels.length, 2, 'three compatible legacy cells should be represented by two canonical parcels');
  assert.deepEqual(
    core.lots.list().map((lot) => lot.id),
    ['lot:3,3', 'lot:4,3', 'lot:5,3'],
    'legacy lot facade must preserve V7/V8 cell IDs while deriving from cadastral frontage',
  );
});