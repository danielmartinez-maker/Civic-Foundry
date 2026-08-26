import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import {
  commitEntityProjectionPartitions,
  type EntityProjectionPartition,
} from '../src/entities/EntityProjection.ts';
import type {
  EntityKind,
  ProjectedEntity,
  ProjectedReferenceIntent,
  UnresolvedEntityReference,
} from '../src/entities/EntityTypes.ts';

type IterationCounter = { iterations: number };
type CountedArray<T> = Readonly<{ items: T[]; counter: IterationCounter }>;

function countedArray<T>(...items: T[]): CountedArray<T> {
  const counter: IterationCounter = { iterations: 0 };
  const target = [...items];
  const proxy = new Proxy(target, {
    get(array, property, receiver) {
      if (property === Symbol.iterator) {
        return function* () {
          counter.iterations++;
          yield* array;
        };
      }
      return Reflect.get(array, property, receiver);
    },
  });
  return { items: proxy, counter };
}

function reset(value: IterationCounter): void { value.iterations = 0; }

function countedPartition(
  id: string,
  ownedKinds: readonly EntityKind[],
  revisionKey: string,
  entities: CountedArray<ProjectedEntity>,
  references = countedArray<ProjectedReferenceIntent>(),
  unresolved = countedArray<UnresolvedEntityReference>(),
): EntityProjectionPartition {
  return {
    id,
    ownedKinds,
    revisionKey,
    projection: { entities: entities.items, references: references.items, unresolved: unresolved.items },
  };
}

const building1: ProjectedEntity = {
  kind: 'building',
  legacyId: 'building:1',
  incarnationToken: 'build:1',
};

const traffic1: ProjectedEntity = {
  kind: 'traffic-vehicle',
  legacyId: 'vehicle:1',
  incarnationToken: 'trip:1|10',
};

const traffic2: ProjectedEntity = {
  kind: 'traffic-vehicle',
  legacyId: 'vehicle:2',
  incarnationToken: 'trip:2|11',
};

test('identical committed partition objects return without rescanning projection contents', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const entities = countedArray<ProjectedEntity>(building1);
  const references = countedArray<ProjectedReferenceIntent>();
  const unresolved = countedArray<UnresolvedEntityReference>();
  const buildings = countedPartition('buildings', ['building'], 'b1', entities, references, unresolved);

  commitEntityProjectionPartitions(registry, graph, [buildings]);
  reset(entities.counter);
  reset(references.counter);
  reset(unresolved.counter);

  const beforeRegistryRevision = registry.commitRevision;
  const beforeGraphRevision = graph.commitRevision;
  commitEntityProjectionPartitions(registry, graph, [buildings]);

  assert.equal(entities.counter.iterations, 0, 'steady-state cache hit must not rescan projected entities');
  assert.equal(references.counter.iterations, 0, 'steady-state cache hit must not rescan projected references');
  assert.equal(unresolved.counter.iterations, 0, 'steady-state cache hit must not rescan unresolved diagnostics');
  assert.equal(registry.commitRevision, beforeRegistryRevision);
  assert.equal(graph.commitRevision, beforeGraphRevision);
});

test('a changed partition does not rescan unchanged partition projection contents', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();

  const buildingEntities = countedArray<ProjectedEntity>(building1);
  const buildingReferences = countedArray<ProjectedReferenceIntent>();
  const buildingUnresolved = countedArray<UnresolvedEntityReference>();
  const buildings = countedPartition(
    'buildings',
    ['building'],
    'b1',
    buildingEntities,
    buildingReferences,
    buildingUnresolved,
  );

  const trafficBefore = countedPartition(
    'traffic',
    ['traffic-vehicle'],
    't1',
    countedArray<ProjectedEntity>(traffic1),
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, trafficBefore]);

  reset(buildingEntities.counter);
  reset(buildingReferences.counter);
  reset(buildingUnresolved.counter);

  const trafficAfter = countedPartition(
    'traffic',
    ['traffic-vehicle'],
    't2',
    countedArray<ProjectedEntity>(traffic1, traffic2),
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, trafficAfter]);

  assert.equal(buildingEntities.counter.iterations, 0, 'unchanged entity partition must not be content-validated again');
  assert.equal(buildingReferences.counter.iterations, 0, 'unchanged reference partition must not be content-validated again');
  assert.equal(buildingUnresolved.counter.iterations, 0, 'unchanged unresolved partition must not be content-validated again');
  assert.equal(registry.activeCount, 3);
});

test('cached fast path still rejects a changed ownership manifest', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = countedPartition(
    'buildings',
    ['building'],
    'b1',
    countedArray<ProjectedEntity>(building1),
  );
  commitEntityProjectionPartitions(registry, graph, [buildings]);

  const invalidManifest = countedPartition(
    'buildings',
    ['building', 'firm'],
    'b2',
    countedArray<ProjectedEntity>(building1),
  );
  assert.throws(
    () => commitEntityProjectionPartitions(registry, graph, [invalidManifest]),
    /manifest changed/i,
  );
});
