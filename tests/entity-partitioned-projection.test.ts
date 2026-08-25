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
