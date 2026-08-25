import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { ZoningSystem } from '../src/simulation/zoning/ZoningSystem.ts';
import { ParcelGenerationSystem } from '../src/world/cadastre/ParcelGenerationSystem.ts';
import { CadastralGraph } from '../src/world/cadastre/CadastralGraph.ts';
import { LotSystem } from '../src/world/lots/LotSystem.ts';

function flatTerrain(width = 8, height = 6): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('parcel generator converts road-fronting zoned land into cadastral parcels', () => {
  const terrain = flatTerrain();
  const roads = new RoadSystem(terrain);
  roads.restore([
    { x: 0, y: 2, type: 'local' },
    { x: 1, y: 2, type: 'local' },
    { x: 2, y: 2, type: 'local' },
    { x: 3, y: 2, type: 'local' },
  ], 1);
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 1, y: 1 }, { x: 2, y: 1 }], 'residential');

  const snapshot = new ParcelGenerationSystem().rebuild(terrain, roads, zoning);
  assert.equal(snapshot.blocks.length, 1);
  assert.equal(snapshot.parcels.length, 1, 'adjacent compatible frontage cells should form one parcel');
  assert.equal(snapshot.parcels[0]!.areaM2, 800);
  assert.ok(snapshot.parcels[0]!.frontageEdgeIds.length > 0);
  assert.doesNotThrow(() => new CadastralGraph(snapshot));
});

test('parcel generation shares topology across adjacent parcel boundaries', () => {
  const terrain = flatTerrain();
  const roads = new RoadSystem(terrain);
  roads.restore([
    { x: 1, y: 2, type: 'local' },
    { x: 2, y: 2, type: 'local' },
  ], 1);
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 1, y: 1 }], 'residential');
  zoning.paint([{ x: 2, y: 1 }], 'commercial');

  const graph = new CadastralGraph(new ParcelGenerationSystem().rebuild(terrain, roads, zoning));
  assert.equal(graph.listParcels().length, 2);
  const [left, right] = graph.listParcels();
  assert.deepEqual(graph.adjacentParcelIds(left!.id), [right!.id]);
  assert.deepEqual(graph.adjacentParcelIds(right!.id), [left!.id]);
});

test('LotSystem compatibility lots are derived from parcel state', () => {
  const terrain = flatTerrain();
  const roads = new RoadSystem(terrain);
  roads.restore([{ x: 1, y: 2, type: 'local' }], 1);
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 1, y: 1 }], 'residential');

  const graph = new CadastralGraph(new ParcelGenerationSystem().rebuild(terrain, roads, zoning));
  const lots = new LotSystem();
  lots.rebuildFromCadastre(graph, () => 'residential');

  assert.equal(lots.list().length, 1);
  assert.equal(lots.list()[0]!.id, graph.listParcels()[0]!.id);
  assert.equal(lots.list()[0]!.frontageRoadKey, '1,2');
});

test('unfrontaged parcels remain cadastral but do not leak into legacy lots', () => {
  const terrain = flatTerrain();
  const roads = new RoadSystem(terrain);
  const zoning = new ZoningSystem(terrain, roads);
  zoning.paint([{ x: 5, y: 1 }], 'industrial');

  const graph = new CadastralGraph(new ParcelGenerationSystem().rebuild(terrain, roads, zoning));
  assert.equal(graph.listParcels().length, 1);
  assert.equal(graph.listParcels()[0]!.frontageEdgeIds.length, 0);

  const lots = new LotSystem();
  lots.rebuildFromCadastre(graph, () => 'industrial');
  assert.deepEqual(lots.list(), []);
});
