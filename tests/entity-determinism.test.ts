import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { commitEntityProjection, type EntityProjectionData } from '../src/entities/EntityProjection.ts';
import { LegacyV7EntityProjector } from '../src/entities/LegacyV7EntityProjector.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flatTerrain(width = 8, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function projectionFixture(): EntityProjectionData {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 902 });
  const building = {
    id: 'building:lot:fixture',
    lotId: 'lot:fixture',
    x: 2,
    y: 2,
    zone: 'residential' as const,
    definitionId: 'residential_cottage',
    status: 'occupied' as const,
    constructionStartedTick: 0,
    completionTick: 0,
  };
  core.buildings.restore([building]);
  core.incidents.createIncident('fire', building, 0.4, 0, core.serviceDispatch);
  core.incidents.createIncident('police', building, 0.3, 0, core.serviceDispatch);
  return new LegacyV7EntityProjector().project(core);
}

function commit(projection: EntityProjectionData): Readonly<{
  registry: ReturnType<EntityRegistry['snapshot']>;
  graph: ReturnType<EntityReferenceGraph['snapshot']>;
  unresolved: ReturnType<typeof commitEntityProjection>['unresolved'];
}> {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const result = commitEntityProjection(registry, graph, projection);
  return Object.freeze({
    registry: registry.snapshot(),
    graph: graph.snapshot(),
    unresolved: result.unresolved,
  });
}

test('projected identity state is invariant to entity reference and unresolved input ordering', () => {
  const projection = projectionFixture();
  assert.ok(projection.entities.length >= 3);
  assert.ok(projection.references.length >= 2);
  const expected = commit(projection);

  for (let seed = 1; seed <= 32; seed++) {
    const shuffled = Object.freeze({
      entities: deterministicShuffle(projection.entities, seed),
      references: deterministicShuffle(projection.references, seed ^ 0x9e3779b9),
      unresolved: deterministicShuffle(projection.unresolved, seed ^ 0x85ebca6b),
    });
    assert.deepEqual(commit(shuffled), expected, `projection ordering changed committed state for seed ${seed}`);
  }
});

test('rebuilding an unchanged projection preserves active generations and graph identity', () => {
  const projection = projectionFixture();
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();

  const first = commitEntityProjection(registry, graph, projection);
  const firstRegistry = registry.snapshot();
  const firstGraph = graph.snapshot();
  const firstHandles = registry.listActive();

  const second = commitEntityProjection(registry, graph, projection);
  assert.deepEqual(registry.snapshot(), firstRegistry);
  assert.deepEqual(graph.snapshot(), firstGraph);
  assert.deepEqual(registry.listActive(), firstHandles);
  assert.deepEqual(second.unresolved, first.unresolved);
});
