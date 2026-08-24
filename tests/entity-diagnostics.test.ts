import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry, type KnownEntityView } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import { EntityProjectionBuilder, commitEntityProjection } from '../src/entities/EntityProjection.ts';
import { assertEntityIntegrity, buildEntityDiagnostics } from '../src/entities/EntityDiagnostics.ts';

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
