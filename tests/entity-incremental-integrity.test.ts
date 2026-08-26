import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph, type EntityReference } from '../src/entities/EntityReferenceGraph.ts';
import {
  commitEntityProjectionPartitions,
  type EntityProjectionData,
  type EntityProjectionPartition,
} from '../src/entities/EntityProjection.ts';
import { assertEntityIntegrity } from '../src/entities/EntityDiagnostics.ts';
import { canonicalLegacyKey, type EntityKind, type ProjectedEntity } from '../src/entities/EntityTypes.ts';

function projection(
  entities: EntityProjectionData['entities'],
  references: EntityProjectionData['references'] = [],
): EntityProjectionData {
  return Object.freeze({
    entities: Object.freeze([...entities]),
    references: Object.freeze([...references]),
    unresolved: Object.freeze([]),
  });
}

function partition(
  id: string,
  ownedKinds: readonly EntityKind[],
  revisionKey: string,
  data: EntityProjectionData,
): EntityProjectionPartition {
  return Object.freeze({
    id,
    ownedKinds: Object.freeze([...ownedKinds]),
    revisionKey,
    projection: data,
  });
}

const traffic1: ProjectedEntity = Object.freeze({
  kind: 'traffic-vehicle',
  legacyId: 'vehicle:1',
  incarnationToken: 'trip:1|10',
  metadata: Object.freeze({ purpose: 'commute' }),
});
const traffic2: ProjectedEntity = Object.freeze({
  kind: 'traffic-vehicle',
  legacyId: 'vehicle:2',
  incarnationToken: 'trip:2|11',
  metadata: Object.freeze({ purpose: 'shopping' }),
});

test('partition registry staging contains only new or changed active records', () => {
  const registry = new EntityRegistry();
  registry.commitPreparedPartitions([
    registry.preparePartitionProjection(['traffic-vehicle'], [traffic1]),
  ]);

  const prepared = registry.preparePartitionProjection(['traffic-vehicle'], [traffic1, traffic2]);

  assert.equal(prepared.activeUpdatesByLegacyKey.size, 1);
  assert.equal(
    prepared.activeUpdatesByLegacyKey.has(canonicalLegacyKey(traffic2)),
    true,
    'the newly added vehicle must be the only active update',
  );
});

test('reference partition staging contains only changed source buckets', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'building:1' },
    { kind: 'building', legacyId: 'building:2', incarnationToken: 'building:2' },
    traffic1,
    traffic2,
  ]));
  const graph = new EntityReferenceGraph();
  const vehicle1 = registry.require('traffic-vehicle', 'vehicle:1');
  const vehicle2 = registry.require('traffic-vehicle', 'vehicle:2');
  const building1 = registry.require('building', 'building:1');
  const building2 = registry.require('building', 'building:2');
  const unchanged: EntityReference = Object.freeze({
    source: vehicle1,
    target: building1,
    semantics: 'weak',
    relation: 'traffic-origin-building',
  });
  const beforeVehicle2: EntityReference = Object.freeze({
    source: vehicle2,
    target: building1,
    semantics: 'weak',
    relation: 'traffic-origin-building',
  });
  graph.commitPrepared(graph.prepare([unchanged, beforeVehicle2], registry));

  const changedVehicle2: EntityReference = Object.freeze({
    source: vehicle2,
    target: building2,
    semantics: 'weak',
    relation: 'traffic-origin-building',
  });
  const prepared = graph.preparePartition(
    ['traffic-vehicle'],
    [unchanged, changedVehicle2],
    registry,
  );

  assert.equal(prepared.replacementsBySourceKey.size, 1);
  assert.equal(prepared.removedSourceKeys.length, 0);
});

test('partition transaction rejects deletion of a target retained by an unchanged strong source', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings1 = partition('buildings', ['building'], 'b1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1' },
  ]));
  const firms1 = partition('firms', ['firm'], 'f1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1' },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  commitEntityProjectionPartitions(registry, graph, [buildings1, firms1]);
  const beforeRegistry = registry.snapshot();
  const beforeGraph = graph.snapshot();
  const beforeRegistryRevision = registry.commitRevision;
  const beforeGraphRevision = graph.commitRevision;

  const buildings2 = partition('buildings', ['building'], 'b2', projection([]));
  assert.throws(
    () => commitEntityProjectionPartitions(registry, graph, [buildings2, firms1]),
    /strong|inbound|reference|target/i,
  );

  assert.deepEqual(registry.snapshot(), beforeRegistry);
  assert.deepEqual(graph.snapshot(), beforeGraph);
  assert.equal(registry.commitRevision, beforeRegistryRevision);
  assert.equal(graph.commitRevision, beforeGraphRevision);
});

class IterationCountingMap<K, V> extends Map<K, V> {
  iterations = 0;
  override [Symbol.iterator]() { this.iterations++; return super[Symbol.iterator](); }
  override entries() { this.iterations++; return super.entries(); }
  override values() { this.iterations++; return super.values(); }
}

test('successful partition transaction certifies integrity so the kernel invariant does not full-scan committed state', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = partition('buildings', ['building'], 'b1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1' },
  ]));
  const firms = partition('firms', ['firm'], 'f1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1' },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  commitEntityProjectionPartitions(registry, graph, [buildings, firms]);

  const registryInternals = registry as unknown as { activeByLegacyKey: Map<string, unknown> };
  const graphInternals = graph as unknown as { referencesBySourceKey: Map<string, unknown> };
  const countedRegistry = new IterationCountingMap(registryInternals.activeByLegacyKey);
  const countedGraph = new IterationCountingMap(graphInternals.referencesBySourceKey);
  registryInternals.activeByLegacyKey = countedRegistry;
  graphInternals.referencesBySourceKey = countedGraph;

  assert.doesNotThrow(() => assertEntityIntegrity(registry, graph));
  assert.equal(countedRegistry.iterations, 0, 'certified partition commits must not trigger a global registry scan');
  assert.equal(countedGraph.iterations, 0, 'certified partition commits must not trigger a global graph scan');
});
