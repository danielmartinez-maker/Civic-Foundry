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

type AccessCounter = { iterations: number; indexedReads: number };
type CountedArray<T> = Readonly<{ items: T[]; counter: AccessCounter }>;

function countedArray<T>(...items: T[]): CountedArray<T> {
  const counter: AccessCounter = { iterations: 0, indexedReads: 0 };
  const target = [...items];
  const proxy = new Proxy(target, {
    get(array, property, receiver) {
      if (property === Symbol.iterator) {
        return function* () {
          counter.iterations++;
          yield* array;
        };
      }
      if (typeof property === 'string' && /^\d+$/.test(property)) counter.indexedReads++;
      return Reflect.get(array, property, receiver);
    },
  });
  return { items: proxy, counter };
}

function reset(counter: AccessCounter): void {
  counter.iterations = 0;
  counter.indexedReads = 0;
}

function partition(
  id: string,
  ownedKinds: readonly EntityKind[],
  revisionKey: string,
  entities: readonly ProjectedEntity[],
  references: readonly ProjectedReferenceIntent[] = [],
  unresolved: readonly UnresolvedEntityReference[] = [],
): EntityProjectionPartition {
  return { id, ownedKinds, revisionKey, projection: { entities, references, unresolved } };
}

const building: ProjectedEntity = {
  kind: 'building',
  legacyId: 'building:1',
  incarnationToken: 'building-token:1',
};

function trafficEntity(id: string): ProjectedEntity {
  return { kind: 'traffic-vehicle', legacyId: id, incarnationToken: `trip:${id}` };
}

function trafficReference(id: string): ProjectedReferenceIntent {
  return {
    source: { kind: 'traffic-vehicle', legacyId: id },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'weak',
    relation: 'traffic-origin-building',
  };
}

test('changed partition references are scanned once to build an index, not rescanned for delta selection', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = partition('buildings', ['building'], 'b1', [building]);
  const before = partition(
    'traffic',
    ['traffic-vehicle'],
    't1',
    [trafficEntity('vehicle:1')],
    [trafficReference('vehicle:1')],
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, before]);

  const references = countedArray<ProjectedReferenceIntent>(
    trafficReference('vehicle:1'),
    trafficReference('vehicle:2'),
  );
  const after = partition(
    'traffic',
    ['traffic-vehicle'],
    't2',
    [trafficEntity('vehicle:1'), trafficEntity('vehicle:2')],
    references.items,
  );

  commitEntityProjectionPartitions(registry, graph, [buildings, after]);

  assert.equal(references.counter.iterations, 1, 'changed references should be iterated once during validation/index construction');
  assert.equal(references.counter.indexedReads, 0, 'delta selection and target-kind checks must use the cached index');
});

test('removing a source uses the cached previous entity index without rescanning the previous entity array', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const buildings = partition('buildings', ['building'], 'b1', [building]);
  const previousEntities = countedArray<ProjectedEntity>(
    trafficEntity('vehicle:1'),
    trafficEntity('vehicle:2'),
    trafficEntity('vehicle:3'),
  );
  const before = partition(
    'traffic',
    ['traffic-vehicle'],
    't1',
    previousEntities.items,
    [trafficReference('vehicle:1'), trafficReference('vehicle:2'), trafficReference('vehicle:3')],
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, before]);
  reset(previousEntities.counter);

  const after = partition(
    'traffic',
    ['traffic-vehicle'],
    't2',
    [trafficEntity('vehicle:1'), trafficEntity('vehicle:3')],
    [trafficReference('vehicle:1'), trafficReference('vehicle:3')],
  );
  commitEntityProjectionPartitions(registry, graph, [buildings, after]);

  assert.equal(previousEntities.counter.iterations, 0, 'previous partition entities must be served from the cached legacy-key index');
  assert.equal(previousEntities.counter.indexedReads, 0);
  assert.equal(registry.activeCount, 3);
});

test('unchanged unresolved diagnostics retain object identity across an unrelated partition delta', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const firm: ProjectedEntity = { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm-token:1' };
  const diagnostic: UnresolvedEntityReference = {
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:missing' },
    semantics: 'weak',
    relation: 'firm-building',
    reason: 'historical building incarnation unavailable',
  };
  const firms = partition('firms', ['firm'], 'f1', [firm], [], [diagnostic]);
  const trafficBefore = partition('traffic', ['traffic-vehicle'], 't1', [trafficEntity('vehicle:1')]);

  const first = commitEntityProjectionPartitions(registry, graph, [firms, trafficBefore]);
  assert.equal(first.unresolved.length, 1);
  const firstDiagnostic = first.unresolved[0]!;

  const trafficAfter = partition(
    'traffic',
    ['traffic-vehicle'],
    't2',
    [trafficEntity('vehicle:1'), trafficEntity('vehicle:2')],
  );
  const second = commitEntityProjectionPartitions(registry, graph, [firms, trafficAfter]);

  assert.equal(second.unresolved.length, 1);
  assert.strictEqual(second.unresolved[0], firstDiagnostic, 'unchanged frozen diagnostics should be reused instead of deep-cloned');
});
