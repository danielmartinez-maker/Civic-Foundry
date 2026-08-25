import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import {
  commitEntityProjection,
  commitEntityProjectionPartitions,
  type EntityProjectionData,
  type EntityProjectionPartition,
} from '../src/entities/EntityProjection.ts';
import type { EntityKind } from '../src/entities/EntityTypes.ts';

function projection(
  entities: EntityProjectionData['entities'],
  references: EntityProjectionData['references'] = [],
): EntityProjectionData {
  return Object.freeze({ entities: Object.freeze([...entities]), references: Object.freeze([...references]), unresolved: Object.freeze([]) });
}

function partition(
  id: string,
  ownedKinds: readonly EntityKind[],
  revisionKey: string,
  data: EntityProjectionData,
): EntityProjectionPartition {
  return Object.freeze({ id, ownedKinds: Object.freeze([...ownedKinds]), revisionKey, projection: data });
}

function fullData(partitions: readonly EntityProjectionPartition[]): EntityProjectionData {
  return projection(
    partitions.flatMap((item) => item.projection.entities),
    partitions.flatMap((item) => item.projection.references),
  );
}

class IterationCountingMap<K, V> extends Map<K, V> {
  iterations = 0;
  override [Symbol.iterator]() { this.iterations++; return super[Symbol.iterator](); }
  override entries() { this.iterations++; return super.entries(); }
  override values() { this.iterations++; return super.values(); }
}

class IterationCountingSet<T> extends Set<T> {
  iterations = 0;
  override [Symbol.iterator]() { this.iterations++; return super[Symbol.iterator](); }
  override entries() { this.iterations++; return super.entries(); }
  override values() { this.iterations++; return super.values(); }
}

test('partitioned projection matches full atomic projection when only one source partition changes', () => {
  const buildingPartition = partition('buildings', ['building'], 'b1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1', metadata: { status: 'occupied' } },
  ]));
  const firmPartition1 = partition('firms', ['firm'], 'f1|b1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1|building:1', metadata: { status: 'forming' } },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));

  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  commitEntityProjectionPartitions(registry, graph, [buildingPartition, firmPartition1]);

  const internals = registry as unknown as { activeByLegacyKey: Map<string, unknown> };
  const stableRecord = [...internals.activeByLegacyKey.values()].find((record) =>
    (record as { handle: { legacyId: string } }).handle.legacyId === 'building:1');
  assert.ok(stableRecord);

  const firmPartition2 = partition('firms', ['firm'], 'f2|b1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1|building:1', metadata: { status: 'operating' } },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  const nextPartitions = [buildingPartition, firmPartition2] as const;
  commitEntityProjectionPartitions(registry, graph, nextPartitions);

  const fullRegistry = new EntityRegistry();
  const fullGraph = new EntityReferenceGraph();
  commitEntityProjection(fullRegistry, fullGraph, fullData(nextPartitions));

  assert.deepEqual(registry.snapshot(), fullRegistry.snapshot());
  assert.deepEqual(graph.snapshot(), fullGraph.snapshot());
  const stableRecordAfter = [...internals.activeByLegacyKey.values()].find((record) =>
    (record as { handle: { legacyId: string } }).handle.legacyId === 'building:1');
  assert.strictEqual(stableRecordAfter, stableRecord, 'unchanged partition records must retain immutable identity');
});

test('transient partition update does not iterate unrelated active registry records', () => {
  const lots = partition('lots', ['lot'], 'lots:1', projection(
    Array.from({ length: 1000 }, (_, index) => ({
      kind: 'lot' as const,
      legacyId: `lot:${index}`,
      incarnationToken: `lot:${index}`,
    })),
  ));
  const traffic1 = partition('traffic', ['traffic-vehicle'], 'traffic:1', projection([]));
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  commitEntityProjectionPartitions(registry, graph, [lots, traffic1]);

  const internals = registry as unknown as { activeByLegacyKey: Map<string, unknown> };
  const counted = new IterationCountingMap(internals.activeByLegacyKey);
  internals.activeByLegacyKey = counted;

  const traffic2 = partition('traffic', ['traffic-vehicle'], 'traffic:2', projection([
    { kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1|10', metadata: { status: 'moving' } },
  ]));
  commitEntityProjectionPartitions(registry, graph, [lots, traffic2]);

  assert.equal(counted.iterations, 0, 'partial commit must use the per-kind index instead of scanning all active entities');
  assert.equal(registry.listActive('lot').length, 1000);
  assert.equal(registry.listActive('traffic-vehicle').length, 1);
});

test('unchanged partition revision is not restaged when another partition changes', () => {
  const lots = partition('lots', ['lot'], 'lots:1', projection(
    Array.from({ length: 1000 }, (_, index) => ({
      kind: 'lot' as const,
      legacyId: `lot:${index}`,
      incarnationToken: `lot:${index}`,
    })),
  ));
  const traffic1 = partition('traffic', ['traffic-vehicle'], 'traffic:1', projection([]));
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  commitEntityProjectionPartitions(registry, graph, [lots, traffic1]);

  const internals = registry as unknown as { activeLegacyKeysByKind: Map<EntityKind, Set<string>> };
  const originalLotKeys = internals.activeLegacyKeysByKind.get('lot');
  assert.ok(originalLotKeys);
  const countedLotKeys = new IterationCountingSet(originalLotKeys);
  internals.activeLegacyKeysByKind.set('lot', countedLotKeys);

  const traffic2 = partition('traffic', ['traffic-vehicle'], 'traffic:2', projection([
    { kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1|10' },
  ]));
  commitEntityProjectionPartitions(registry, graph, [lots, traffic2]);

  assert.equal(countedLotKeys.iterations, 0, 'unchanged lot partition must not be restaged for traffic churn');
});

test('identical partition manifest is an O(partitions) no-op without registry or graph recommit', () => {
  const buildings = partition('buildings', ['building'], 'b1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1' },
  ]));
  const firms = partition('firms', ['firm'], 'f1|b1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1' },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const first = commitEntityProjectionPartitions(registry, graph, [firms, buildings]);
  const registryRevision = registry.commitRevision;
  const graphRevision = graph.commitRevision;

  const second = commitEntityProjectionPartitions(registry, graph, [buildings, firms]);

  assert.strictEqual(second, first, 'unchanged manifest should reuse the prior immutable result');
  assert.equal(registry.commitRevision, registryRevision);
  assert.equal(graph.commitRevision, graphRevision);
});

test('simultaneous building replacement and firm update resolve against the final staged entity view independent of partition order', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const b1 = partition('buildings', ['building'], 'b1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1' },
  ]));
  const f1 = partition('firms', ['firm'], 'f1|b1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1' },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  commitEntityProjectionPartitions(registry, graph, [b1, f1]);

  const b2 = partition('buildings', ['building'], 'b2', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:2' },
  ]));
  const f2 = partition('firms', ['firm'], 'f2|b2', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1', metadata: { status: 'operating' } },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  commitEntityProjectionPartitions(registry, graph, [f2, b2]);

  assert.equal(registry.require('building', 'building:1').generation, 2);
  const firmEdge = graph.list().find((edge) => edge.relation === 'firm-building');
  assert.equal(firmEdge?.target.generation, 2);
});

test('failed partition transaction does not advance revisions and the same revision key remains retryable', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = partition('buildings', ['building'], 'b1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1' },
  ]));
  const traffic1 = partition('traffic', ['traffic-vehicle'], 't1|b1', projection([]));
  commitEntityProjectionPartitions(registry, graph, [buildings, traffic1]);
  const beforeRegistry = registry.snapshot();
  const beforeGraph = graph.snapshot();
  const registryRevision = registry.commitRevision;
  const graphRevision = graph.commitRevision;

  const badTraffic = partition('traffic', ['traffic-vehicle'], 't2|b1', projection([
    { kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1' },
  ], [{
    source: { kind: 'traffic-vehicle', legacyId: 'vehicle:1' },
    target: { kind: 'building', legacyId: 'missing' },
    semantics: 'strong',
    relation: 'vehicle-destination-building',
  }]));
  assert.throws(() => commitEntityProjectionPartitions(registry, graph, [buildings, badTraffic]), /strong.*target|target.*strong/i);
  assert.deepEqual(registry.snapshot(), beforeRegistry);
  assert.deepEqual(graph.snapshot(), beforeGraph);
  assert.equal(registry.commitRevision, registryRevision);
  assert.equal(graph.commitRevision, graphRevision);

  const correctedTrafficSameRevision = partition('traffic', ['traffic-vehicle'], 't2|b1', projection([
    { kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1' },
  ], [{
    source: { kind: 'traffic-vehicle', legacyId: 'vehicle:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'weak',
    relation: 'vehicle-destination-building',
  }]));
  commitEntityProjectionPartitions(registry, graph, [buildings, correctedTrafficSameRevision]);
  assert.equal(registry.listActive('traffic-vehicle').length, 1);
  assert.equal(graph.list().some((edge) => edge.relation === 'vehicle-destination-building'), true);
});
