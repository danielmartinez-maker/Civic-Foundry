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

test('simulation development enumerates cadastral parcels and keeps lot view derived', () => {
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

  const parcels = cadastre.listParcels();
  assert.ok(parcels.length > 0);
  assert.deepEqual(
    core.lots.list().map((lot) => lot.id).sort(),
    parcels
      .filter((parcel) => parcel.frontageEdgeIds.length > 0)
      .map((parcel) => parcel.id)
      .sort(),
  );
});
