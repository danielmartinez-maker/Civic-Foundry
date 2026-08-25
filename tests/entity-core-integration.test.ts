import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import { LegacyV7EntityProjector } from '../src/entities/LegacyV7EntityProjector.ts';
import { commitEntityProjection } from '../src/entities/EntityProjection.ts';
import { serializeCoreV7, hydrateCoreV7 } from '../src/save/saveV7.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('SimulationCore owns initialized derived entity infrastructure', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 301 });
  assert.ok(core.entityRegistry instanceof EntityRegistry);
  assert.ok(core.entityReferences instanceof EntityReferenceGraph);
  assert.equal(core.entityDiagnostics.activeEntities, 0);
  assert.equal(core.entityDiagnostics.references, 0);
});

test('entity registry synchronization runs after legacy V7 gameplay each tick', () => {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 100_000, seed: 302 });
  assert.equal(core.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'local').ok, true);
  core.paintZone([{ x: 3, y: 3 }], 'residential');
  assert.equal(core.entityRegistry.listActive('lot').length, 0, 'direct V7 mutation should not secretly make registry authoritative');
  core.step(1);
  assert.equal(core.entityRegistry.listActive('lot').length, 1);
  assert.equal(core.entityRegistry.require('lot', 'lot:3,3').generation, 1);
  assert.deepEqual(
    core.kernel.scheduler.dueSystems(1).map((system) => system.id),
    ['legacy-v7-city', 'entity-registry-sync'],
  );
});

test('runtime entity synchronization consumes partitions rather than the legacy full-projector path', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 307 });
  type ProjectorProbe = {
    project: (source: SimulationCore) => unknown;
    projectPartitions: (source: SimulationCore) => readonly unknown[];
  };
  const projector = (core as unknown as { entityProjector: ProjectorProbe }).entityProjector;
  const originalProjectPartitions = projector.projectPartitions.bind(projector);
  let partitionCalls = 0;
  projector.project = () => { throw new Error('legacy full projector path used'); };
  projector.projectPartitions = (source) => {
    partitionCalls += 1;
    return originalProjectPartitions(source);
  };

  assert.doesNotThrow(() => core.rebuildEntityProjection());
  assert.equal(partitionCalls, 1);
});

test('unchanged entity sync keeps its kernel slot without recommitting derived identity state', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 306 });
  const registryRevision = core.entityRegistry.commitRevision;
  const graphRevision = core.entityReferences.commitRevision;

  core.step(1);

  assert.equal(core.entityRegistry.commitRevision, registryRevision);
  assert.equal(core.entityReferences.commitRevision, graphRevision);
  assert.deepEqual(
    core.kernel.scheduler.dueSystems(1).map((system) => system.id),
    ['legacy-v7-city', 'entity-registry-sync'],
  );
});

test('entity referential integrity invariant is registered and passes valid projected state', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 303 });
  assert.ok(core.kernel.invariants.list().some((invariant) => invariant.id === 'entity-referential-integrity'));
  assert.doesNotThrow(() => core.step(1));
});

test('hydrate rebuilds identical derived entity state without persisting it', () => {
  const original = new SimulationCore({ terrain: flat(), startingFunds: 100_000, seed: 304 });
  assert.equal(original.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'local').ok, true);
  original.paintZone([{ x: 3, y: 3 }], 'residential');
  original.step(1);
  const beforeRegistry = original.entityRegistry.snapshot();
  const beforeGraph = original.entityReferences.snapshot();
  const save = serializeCoreV7(original);
  const hydrated = hydrateCoreV7(structuredClone(save));
  assert.deepEqual(hydrated.entityRegistry.snapshot(), beforeRegistry);
  assert.deepEqual(hydrated.entityReferences.snapshot(), beforeGraph);
  assert.deepEqual(hydrated.entityDiagnostics, original.entityDiagnostics);
});

test('hydrate consumes no tick or gameplay RNG draw and first incremental sync matches the full projection oracle', () => {
  const original = new SimulationCore({ terrain: flat(), startingFunds: 100_000, seed: 308 });
  assert.equal(original.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'local').ok, true);
  original.paintZone([{ x: 3, y: 3 }], 'commercial');
  original.step(3);
  const save = serializeCoreV7(original);
  const expectedTick = original.clock.tick;
  const expectedRandomState = original.random.getState();

  const hydrated = hydrateCoreV7(structuredClone(save));
  assert.equal(hydrated.clock.tick, expectedTick);
  assert.equal(hydrated.random.getState(), expectedRandomState);

  hydrated.step(1);
  const oracleRegistry = new EntityRegistry();
  const oracleGraph = new EntityReferenceGraph();
  commitEntityProjection(
    oracleRegistry,
    oracleGraph,
    new LegacyV7EntityProjector().project(hydrated),
  );
  assert.deepEqual(hydrated.entityRegistry.snapshot(), oracleRegistry.snapshot());
  assert.deepEqual(hydrated.entityReferences.snapshot(), oracleGraph.snapshot());
});

test('Save V7 excludes all Phase 0B derived identity infrastructure', () => {
  const core = new SimulationCore({ terrain: flat(), seed: 305 });
  const save = serializeCoreV7(core) as unknown as Record<string, unknown>;
  for (const key of ['entityRegistry', 'entityReferences', 'entityDiagnostics', 'entityHistory', 'unresolvedEntityReferences']) {
    assert.equal(Object.hasOwn(save, key), false, `Save V7 unexpectedly contains ${key}`);
  }
});