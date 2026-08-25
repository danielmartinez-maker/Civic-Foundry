import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry, type KnownEntityView } from '../src/entities/EntityRegistry.ts';
import {
  EntityReferenceGraph,
  type EntityReference,
  type PreparedReferencePartition,
} from '../src/entities/EntityReferenceGraph.ts';
import {
  commitEntityProjectionPartitions,
  type EntityProjectionData,
  type EntityProjectionPartition,
} from '../src/entities/EntityProjection.ts';
import {
  canonicalHandleKey,
  type EntityKind,
  type ProjectedEntity,
} from '../src/entities/EntityTypes.ts';

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

const building1: ProjectedEntity = Object.freeze({
  kind: 'building', legacyId: 'building:1', incarnationToken: 'build:1',
});
const building2: ProjectedEntity = Object.freeze({
  kind: 'building', legacyId: 'building:2', incarnationToken: 'build:2',
});
const traffic1: ProjectedEntity = Object.freeze({
  kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1|10',
});
const traffic2: ProjectedEntity = Object.freeze({
  kind: 'traffic-vehicle', legacyId: 'vehicle:2', incarnationToken: 'trip:2|11',
});

type DeltaGraph = EntityReferenceGraph & {
  prepareSourceDelta: (
    ownedSourceKinds: readonly EntityKind[],
    references: readonly EntityReference[],
    removedSourceKeys: readonly string[],
    view: KnownEntityView,
  ) => PreparedReferencePartition;
};

function trafficIntent(sourceId: string, targetId: string) {
  return Object.freeze({
    source: Object.freeze({ kind: 'traffic-vehicle' as const, legacyId: sourceId }),
    target: Object.freeze({ kind: 'building' as const, legacyId: targetId }),
    semantics: 'weak' as const,
    relation: 'traffic-origin-building',
  });
}

test('reference graph source delta changes only explicit source buckets', () => {
  const registry = new EntityRegistry();
  registry.commitPrepared(registry.prepareProjection([building1, building2, traffic1, traffic2]));
  const graph = new EntityReferenceGraph();
  const vehicle1 = registry.require('traffic-vehicle', 'vehicle:1');
  const vehicle2 = registry.require('traffic-vehicle', 'vehicle:2');
  const target1 = registry.require('building', 'building:1');
  const target2 = registry.require('building', 'building:2');
  const before1: EntityReference = Object.freeze({ source: vehicle1, target: target1, semantics: 'weak', relation: 'traffic-origin-building' });
  const before2: EntityReference = Object.freeze({ source: vehicle2, target: target1, semantics: 'weak', relation: 'traffic-origin-building' });
  graph.commitPrepared(graph.prepare([before1, before2], registry));

  const changed2: EntityReference = Object.freeze({ source: vehicle2, target: target2, semantics: 'weak', relation: 'traffic-origin-building' });
  const deltaGraph = graph as DeltaGraph;
  const prepared = deltaGraph.prepareSourceDelta(['traffic-vehicle'], [changed2], [], registry);
  assert.equal(prepared.replacementsBySourceKey.size, 1);
  assert.equal(prepared.removedSourceKeys.length, 0);
  graph.commitPreparedPartition(prepared);
  assert.deepEqual(graph.outgoing(vehicle1), [before1]);
  assert.deepEqual(graph.outgoing(vehicle2), [changed2]);

  const removal = deltaGraph.prepareSourceDelta(
    ['traffic-vehicle'],
    [],
    [canonicalHandleKey(vehicle1)],
    registry,
  );
  graph.commitPreparedPartition(removal);
  assert.deepEqual(graph.outgoing(vehicle1), []);
  assert.deepEqual(graph.outgoing(vehicle2), [changed2]);
});

test('stable targets resolve only changed source references through the delta path', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = partition('buildings', ['building'], 'b1', projection([building1]));
  const trafficBefore = partition('traffic', ['traffic-vehicle'], 't1', projection(
    [traffic1],
    [trafficIntent('vehicle:1', 'building:1')],
  ));
  commitEntityProjectionPartitions(registry, graph, [buildings, trafficBefore]);

  let fullCalls = 0;
  const full = graph.preparePartition.bind(graph);
  graph.preparePartition = (...args) => { fullCalls++; return full(...args); };
  let deltaCalls = 0;
  const deltaReferenceCounts: number[] = [];
  const deltaGraph = graph as DeltaGraph;
  const originalDelta = deltaGraph.prepareSourceDelta?.bind(graph);
  if (originalDelta) {
    deltaGraph.prepareSourceDelta = (kinds, references, removed, view) => {
      deltaCalls++;
      deltaReferenceCounts.push(references.length);
      return originalDelta(kinds, references, removed, view);
    };
  }

  const trafficAfter = partition('traffic', ['traffic-vehicle'], 't2', projection(
    [traffic1, traffic2],
    [trafficIntent('vehicle:1', 'building:1'), trafficIntent('vehicle:2', 'building:1')],
  ));
  commitEntityProjectionPartitions(registry, graph, [buildings, trafficAfter]);

  assert.equal(deltaCalls, 1, 'stable targets should use one source-delta graph preparation');
  assert.deepEqual(deltaReferenceCounts, [1], 'only the newly added vehicle reference should be resolved');
  assert.equal(fullCalls, 0, 'stable-target source churn must not fall back to a full partition graph rebuild');
  assert.equal(graph.count, 2);
});

test('source delta preserves and removes unresolved diagnostics by changed source', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const noBuildings = partition('buildings', ['building'], 'b0', projection([]));
  const trafficBefore = partition('traffic', ['traffic-vehicle'], 't1', projection(
    [traffic1],
    [trafficIntent('vehicle:1', 'missing-building')],
  ));
  let result = commitEntityProjectionPartitions(registry, graph, [noBuildings, trafficBefore]);
  assert.equal(result.unresolved.length, 1);

  let deltaCalls = 0;
  const deltaGraph = graph as DeltaGraph;
  const originalDelta = deltaGraph.prepareSourceDelta?.bind(graph);
  if (originalDelta) {
    deltaGraph.prepareSourceDelta = (kinds, references, removed, view) => {
      deltaCalls++;
      return originalDelta(kinds, references, removed, view);
    };
  }

  const trafficTwo = partition('traffic', ['traffic-vehicle'], 't2', projection(
    [traffic1, traffic2],
    [trafficIntent('vehicle:1', 'missing-building'), trafficIntent('vehicle:2', 'missing-building')],
  ));
  result = commitEntityProjectionPartitions(registry, graph, [noBuildings, trafficTwo]);
  assert.deepEqual(result.unresolved.map((item) => item.source.legacyId), ['vehicle:1', 'vehicle:2']);

  const trafficOnlyTwo = partition('traffic', ['traffic-vehicle'], 't3', projection(
    [traffic2],
    [trafficIntent('vehicle:2', 'missing-building')],
  ));
  result = commitEntityProjectionPartitions(registry, graph, [noBuildings, trafficOnlyTwo]);
  assert.deepEqual(result.unresolved.map((item) => item.source.legacyId), ['vehicle:2']);
  assert.equal(deltaCalls, 2, 'both stable-target source changes should use the delta path');
});

test('target handle replacement forces full reference re-resolution', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildingsBefore = partition('buildings', ['building'], 'b1', projection([building1]));
  const trafficBefore = partition('traffic', ['traffic-vehicle'], 't1', projection(
    [traffic1],
    [trafficIntent('vehicle:1', 'building:1')],
  ));
  commitEntityProjectionPartitions(registry, graph, [buildingsBefore, trafficBefore]);

  const fullReferenceCounts: number[] = [];
  const full = graph.preparePartition.bind(graph);
  graph.preparePartition = (kinds, references, view) => {
    fullReferenceCounts.push(references.length);
    return full(kinds, references, view);
  };

  const replacement: ProjectedEntity = Object.freeze({
    kind: 'building', legacyId: 'building:1', incarnationToken: 'build:replacement',
  });
  const buildingsAfter = partition('buildings', ['building'], 'b2', projection([replacement]));
  const trafficAfter = partition('traffic', ['traffic-vehicle'], 't2', projection(
    [traffic1],
    [trafficIntent('vehicle:1', 'building:1')],
  ));
  commitEntityProjectionPartitions(registry, graph, [buildingsAfter, trafficAfter]);

  assert.equal(fullReferenceCounts.includes(1), true, 'target generation changes must force full source-partition resolution');
  const vehicle = registry.require('traffic-vehicle', 'vehicle:1');
  const outgoing = graph.outgoing(vehicle);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0]!.target.generation, 2);
});
