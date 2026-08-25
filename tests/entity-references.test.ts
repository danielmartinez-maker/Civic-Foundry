import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import { EntityProjectionBuilder, commitEntityProjection } from '../src/entities/EntityProjection.ts';

function baseProjection(): EntityProjectionBuilder {
  return new EntityProjectionBuilder()
    .entity({ kind: 'building', legacyId: 'building:1', incarnationToken: 'start:10' })
    .entity({ kind: 'firm', legacyId: 'firm:1', incarnationToken: 'formed:12' });
}

test('strong firm-building reference resolves to active exact handles', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const projection = baseProjection().reference({
    source: { kind: 'firm', legacyId: 'firm:1' },
    target: { kind: 'building', legacyId: 'building:1' },
    semantics: 'strong',
    relation: 'firm-building',
  });
  const result = commitEntityProjection(registry, graph, projection.build());
  assert.equal(result.references, 1);
  const [edge] = graph.list();
  assert.equal(edge?.source.generation, 1);
  assert.equal(edge?.target.generation, 1);
  assert.equal(registry.isActive(edge!.target), true);
});

test('strong and owned references reject inactive or missing targets atomically', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  commitEntityProjection(registry, graph, baseProjection().build());
  const beforeRegistry = registry.snapshot();
  const beforeGraph = graph.snapshot();

  const invalid = new EntityProjectionBuilder()
    .entity({ kind: 'firm', legacyId: 'firm:1', incarnationToken: 'formed:12' })
    .reference({
      source: { kind: 'firm', legacyId: 'firm:1' },
      target: { kind: 'building', legacyId: 'missing' },
      semantics: 'strong',
      relation: 'firm-building',
    });
  assert.throws(() => commitEntityProjection(registry, graph, invalid.build()), /strong.*target|target.*strong/i);
  assert.deepEqual(registry.snapshot(), beforeRegistry);
  assert.deepEqual(graph.snapshot(), beforeGraph);
});

test('weak exact-token reference can remain bound to a historical generation', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  commitEntityProjection(registry, graph, baseProjection().build());
  const firstBuilding = registry.require('building', 'building:1');

  const replacement = new EntityProjectionBuilder()
    .entity({ kind: 'building', legacyId: 'building:1', incarnationToken: 'start:20' })
    .entity({ kind: 'firm', legacyId: 'firm:1', incarnationToken: 'formed:12' })
    .reference({
      source: { kind: 'firm', legacyId: 'firm:1' },
      target: { kind: 'building', legacyId: 'building:1' },
      targetIncarnationToken: 'start:10',
      semantics: 'weak',
      relation: 'historic-firm-building',
    });
  commitEntityProjection(registry, graph, replacement.build());
  const [edge] = graph.list();
  assert.deepEqual(edge?.target, firstBuilding);
  assert.equal(registry.isActive(edge!.target), false);
  assert.equal(registry.isKnown(edge!.target), true);
});

test('unprovable weak reference remains unresolved instead of retargeting current entity', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const projection = new EntityProjectionBuilder()
    .entity({ kind: 'firm', legacyId: 'firm:1', incarnationToken: 'formed:12' })
    .reference({
      source: { kind: 'firm', legacyId: 'firm:1' },
      target: { kind: 'building', legacyId: 'missing' },
      targetIncarnationToken: 'unknown-old-building',
      semantics: 'weak',
      relation: 'historic-firm-building',
    });
  const result = commitEntityProjection(registry, graph, projection.build());
  assert.equal(graph.list().length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.match(result.unresolved[0]!.reason, /exact|known|resolve/i);
});

test('duplicate equivalent reference edges are rejected deterministically', () => {
  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();
  const intent = {
    source: { kind: 'firm' as const, legacyId: 'firm:1' },
    target: { kind: 'building' as const, legacyId: 'building:1' },
    semantics: 'strong' as const,
    relation: 'firm-building',
  };
  const projection = baseProjection().reference(intent).reference(intent);
  assert.throws(() => commitEntityProjection(registry, graph, projection.build()), /duplicate.*reference/i);
});

test('reference graph snapshots are independent of intent insertion order', () => {
  const intents = [
    {
      source: { kind: 'firm' as const, legacyId: 'firm:1' },
      target: { kind: 'building' as const, legacyId: 'building:1' },
      semantics: 'strong' as const,
      relation: 'firm-building-a',
    },
    {
      source: { kind: 'firm' as const, legacyId: 'firm:1' },
      target: { kind: 'building' as const, legacyId: 'building:1' },
      semantics: 'weak' as const,
      relation: 'firm-building-b',
    },
  ];
  const registryA = new EntityRegistry();
  const graphA = new EntityReferenceGraph();
  const registryB = new EntityRegistry();
  const graphB = new EntityReferenceGraph();
  const a = baseProjection();
  const b = baseProjection();
  for (const intent of intents) a.reference(intent);
  for (const intent of [...intents].reverse()) b.reference(intent);
  commitEntityProjection(registryA, graphA, a.build());
  commitEntityProjection(registryB, graphB, b.build());
  assert.deepEqual(graphA.snapshot(), graphB.snapshot());
});
