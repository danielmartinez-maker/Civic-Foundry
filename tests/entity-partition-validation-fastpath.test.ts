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

class CountingArray<T> extends Array<T> {
  iterations = 0;

  override [Symbol.iterator](): ArrayIterator<T> {
    this.iterations++;
    return super[Symbol.iterator]();
  }

  reset(): void { this.iterations = 0; }
}

function countedPartition(
  id: string,
  ownedKinds: readonly EntityKind[],
  revisionKey: string,
  entities: CountingArray<ProjectedEntity>,
  references = new CountingArray<ProjectedReferenceIntent>(),
  unresolved = new CountingArray<UnresolvedEntityReference>(),
): EntityProjectionPartition {
  return {
    id,
    ownedKinds,
    revisionKey,
    projection: { entities, references, unresolved },
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
  const entities = new CountingArray<ProjectedEntity>(building1);
  const references = new CountingArray<ProjectedReferenceIntent>();
  const unresolved = new CountingArray<UnresolvedEntityReference>();
  const buildings = countedPartition('buildings', ['building'], 'b1', entities, references, unresolved);

  commitEntityProjectionPartitions(registry, graph, [buildings]);
  entities.reset();
  references.reset();
  unresolved.reset();

  const beforeRegistryRevision = registry.commitRevision;
  const beforeGraphRevision = graph.commitRevision;
  commitEntityProjectionPartitions(registry, graph, [buildings]);

  assert.equal(entities.iterations, 0, 'steady-state cache hit must not rescan projected entities');
  assert.equal(references.iterations, 0, 'steady-state cache hit must not rescan projected references');
  assert.equal(unresolved.iterations, 0, 'steady-state cache hit must not rescan unresolved diagnostics');
  assert.equal(registry.commitRevision, beforeRegistryRevision);
  assert.equal(graph.commitRevision, beforeGraphRevision);
});

test('a changed partition does not rescan unchanged partition projection contents', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();

  const buildingEntities = new CountingArray<ProjectedEntity>(building1);
  const buildingReferences = new CountingArray<ProjectedReferenceIntent>();
  const buildingUnresolved = new CountingArray<UnresolvedEntityReference>();
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
    new CountingArray<ProjectedEntity>(traffic1),
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, trafficBefore]);

  buildingEntities.reset();
  buildingReferences.reset();
  buildingUnresolved.reset();

  const trafficAfter = countedPartition(
    'traffic',
    ['traffic-vehicle'],
    't2',
    new CountingArray<ProjectedEntity>(traffic1, traffic2),
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, trafficAfter]);

  assert.equal(buildingEntities.iterations, 0, 'unchanged entity partition must not be content-validated again');
  assert.equal(buildingReferences.iterations, 0, 'unchanged reference partition must not be content-validated again');
  assert.equal(buildingUnresolved.iterations, 0, 'unchanged unresolved partition must not be content-validated again');
  assert.equal(registry.activeCount, 3);
});

test('cached fast path still rejects a changed ownership manifest', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = countedPartition(
    'buildings',
    ['building'],
    'b1',
    new CountingArray<ProjectedEntity>(building1),
  );
  commitEntityProjectionPartitions(registry, graph, [buildings]);

  const invalidManifest = countedPartition(
    'buildings',
    ['building', 'firm'],
    'b2',
    new CountingArray<ProjectedEntity>(building1),
  );
  assert.throws(
    () => commitEntityProjectionPartitions(registry, graph, [invalidManifest]),
    /manifest changed/i,
  );
});
