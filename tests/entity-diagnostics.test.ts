import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry, type KnownEntityView } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import {
  EntityProjectionBuilder,
  commitEntityProjection,
  commitEntityProjectionPartitions,
  type EntityProjectionData,
  type EntityProjectionPartition,
} from '../src/entities/EntityProjection.ts';
import { assertEntityIntegrity, buildEntityDiagnostics } from '../src/entities/EntityDiagnostics.ts';
import type { EntityKind } from '../src/entities/EntityTypes.ts';

function validState() {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const result = commitEntityProjection(registry, graph, new EntityProjectionBuilder()
    .entity({ kind: 'building', legacyId: 'b1', incarnationToken: '10' })
    .entity({ kind: 'firm', legacyId: 'f1', incarnationToken: '12' })
    .reference({
      source: { kind: 'firm', legacyId: 'f1' },
      target: { kind: 'building', legacyId: 'b1' },
      semantics: 'strong',
      relation: 'firm-building',
    })
    .unresolved({
      source: { kind: 'firm', legacyId: 'f1' },
      target: { kind: 'building', legacyId: 'historic-b' },
      semantics: 'weak',
      relation: 'historic-firm-building',
      reason: 'exact historic incarnation not reconstructable',
    })
    .build());
  return { registry, graph, result };
}

test('entity diagnostics count active, historical, references and unresolved deterministically', () => {
  const { registry, graph, result } = validState();
  const snapshot = buildEntityDiagnostics(registry, graph, result.unresolved);
  assert.equal(snapshot.activeEntities, 2);
  assert.equal(snapshot.historicalEntities, 0);
  assert.equal(snapshot.references, 1);
  assert.equal(snapshot.unresolvedReferences, 1);
  assert.deepEqual(snapshot.activeByKind, { building: 1, firm: 1 });
  assert.equal(snapshot.unresolved[0]?.relation, 'historic-firm-building');
  assert.doesNotThrow(() => assertEntityIntegrity(registry, graph));
});

test('historical counts update after replacement while unresolved weak references remain diagnostics only', () => {
  const { registry, graph } = validState();
  const result = commitEntityProjection(registry, graph, new EntityProjectionBuilder()
    .entity({ kind: 'building', legacyId: 'b1', incarnationToken: '20' })
    .unresolved({
      source: { kind: 'building', legacyId: 'b1' },
      target: { kind: 'building', legacyId: 'old-b' },
      semantics: 'weak',
      relation: 'historic-link',
      reason: 'not reconstructable',
    })
    .build());
  const snapshot = buildEntityDiagnostics(registry, graph, result.unresolved);
  assert.equal(snapshot.activeEntities, 1);
  assert.ok(snapshot.historicalEntities >= 2);
  assert.equal(snapshot.unresolvedReferences, 1);
  assert.doesNotThrow(() => assertEntityIntegrity(registry, graph));
});

test('integrity assertion catches a graph whose source and target are unknown to the committed registry', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const source = { kind: 'firm' as const, legacyId: 'ghost-firm', generation: 1 };
  const target = { kind: 'building' as const, legacyId: 'ghost-building', generation: 1 };
  const permissiveView: KnownEntityView = {
    resolve: () => undefined,
    resolveKnownByToken: () => undefined,
    isActive: () => true,
    isKnown: () => true,
  };
  graph.commitPrepared(graph.prepare([{ source, target, semantics: 'strong', relation: 'firm-building' }], permissiveView));
  assert.throws(() => assertEntityIntegrity(registry, graph), /source.*active|unknown/i);
});

test('diagnostic output is stable regardless of unresolved input order', () => {
  const { registry, graph } = validState();
  const unresolved = [
    { source: { kind: 'firm' as const, legacyId: 'f1' }, target: { kind: 'building' as const, legacyId: 'z' }, semantics: 'weak' as const, relation: 'z-link', reason: 'z' },
    { source: { kind: 'firm' as const, legacyId: 'f1' }, target: { kind: 'building' as const, legacyId: 'a' }, semantics: 'weak' as const, relation: 'a-link', reason: 'a' },
  ];
  assert.deepEqual(
    buildEntityDiagnostics(registry, graph, unresolved),
    buildEntityDiagnostics(registry, graph, [...unresolved].reverse()),
  );
});

class ValuesCountingMap<K, V> extends Map<K, V> {
  valuesCalls = 0;

  override values() {
    this.valuesCalls += 1;
    return super.values();
  }
}

test('per-tick integrity assertion validates active state without scanning all historical records', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  for (let generation = 1; generation <= 100; generation++) {
    commitEntityProjection(registry, graph, new EntityProjectionBuilder()
      .entity({ kind: 'building', legacyId: 'b1', incarnationToken: `generation:${generation}` })
      .build());
  }

  const internals = registry as unknown as { knownByHandleKey: Map<string, unknown> };
  const counted = new ValuesCountingMap(internals.knownByHandleKey);
  internals.knownByHandleKey = counted;

  assert.doesNotThrow(() => assertEntityIntegrity(registry, graph));
  assert.equal(counted.valuesCalls, 0, 'integrity checks must not snapshot the full historical registry each tick');
});

test('integrity assertion detects a corrupt registry active-kind index deterministically', () => {
  const { registry, graph } = validState();
  const internals = registry as unknown as {
    activeLegacyKeysByKind: Map<EntityKind, Set<string>>;
  };
  assert.ok(internals.activeLegacyKeysByKind.get('firm')?.size);
  internals.activeLegacyKeysByKind.get('firm')!.clear();

  assert.throws(
    () => assertEntityIntegrity(registry, graph),
    /registry.*kind index.*firm|kind index.*registry.*firm/i,
  );
});

test('integrity assertion detects a corrupt reference source-kind index deterministically', () => {
  const { registry, graph } = validState();
  const internals = graph as unknown as {
    sourceKeysByKind: Map<EntityKind, Set<string>>;
  };
  assert.ok(internals.sourceKeysByKind.get('firm')?.size);
  internals.sourceKeysByKind.get('firm')!.clear();

  assert.throws(
    () => assertEntityIntegrity(registry, graph),
    /reference.*source-kind index.*firm|source-kind index.*reference.*firm/i,
  );
});

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

class IterationCountingMap<K, V> extends Map<K, V> {
  iterations = 0;

  override [Symbol.iterator]() {
    this.iterations += 1;
    return super[Symbol.iterator]();
  }

  override entries() {
    this.iterations += 1;
    return super.entries();
  }

  override values() {
    this.iterations += 1;
    return super.values();
  }
}

test('10k durable entities plus traffic churn do not scan unrelated registry or graph indexes', () => {
  const lots = partition('lots', ['lot'], 'lots:1', projection(
    Array.from({ length: 10_000 }, (_, index) => ({
      kind: 'lot' as const,
      legacyId: `lot:${index}`,
      incarnationToken: `lot:${index}`,
    })),
  ));
  const buildings = partition('buildings', ['building'], 'buildings:1', projection([
    { kind: 'building', legacyId: 'building:1', incarnationToken: 'building:1' },
  ]));
  const firms = partition('firms', ['firm'], 'firms:1|buildings:1', projection([
    { kind: 'firm', legacyId: 'firm:1', incarnationToken: 'firm:1|building:1' },
  ], [{
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  }]));
  const traffic1 = partition('traffic', ['traffic-vehicle'], 'traffic:1|buildings:1', projection([
    { kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1|10' },
  ], [{
    source: { kind: 'traffic-vehicle', legacyId: 'vehicle:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'weak',
    relation: 'traffic-origin-building',
  }]));

  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  commitEntityProjectionPartitions(registry, graph, [lots, buildings, firms, traffic1]);

  const registryInternals = registry as unknown as {
    activeByLegacyKey: Map<string, unknown>;
  };
  const graphInternals = graph as unknown as {
    referencesBySourceKey: Map<string, unknown>;
    sourceKeysByKind: Map<EntityKind, Set<string>>;
  };
  const countedActive = new IterationCountingMap(registryInternals.activeByLegacyKey);
  const countedReferences = new IterationCountingMap(graphInternals.referencesBySourceKey);
  const countedSourceKinds = new IterationCountingMap(graphInternals.sourceKeysByKind);
  registryInternals.activeByLegacyKey = countedActive;
  graphInternals.referencesBySourceKey = countedReferences;
  graphInternals.sourceKeysByKind = countedSourceKinds;

  const traffic2 = partition('traffic', ['traffic-vehicle'], 'traffic:2|buildings:1', projection([
    { kind: 'traffic-vehicle', legacyId: 'vehicle:1', incarnationToken: 'trip:1|10', metadata: { status: 'moving' } },
  ], [{
    source: { kind: 'traffic-vehicle', legacyId: 'vehicle:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'weak',
    relation: 'traffic-origin-building',
  }]));
  commitEntityProjectionPartitions(registry, graph, [lots, buildings, firms, traffic2]);

  assert.equal(countedActive.iterations, 0, 'traffic-only registry staging must not scan 10k durable active records');
  assert.equal(countedReferences.iterations, 0, 'traffic-only graph staging must not scan unrelated source buckets');
  assert.equal(countedSourceKinds.iterations, 0, 'traffic-only graph staging must address source-kind buckets directly');
  assert.equal(registry.listActive('lot').length, 10_000);
});
