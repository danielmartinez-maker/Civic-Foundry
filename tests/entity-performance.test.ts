import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { assertEntityIntegrity } from '../src/entities/EntityDiagnostics.ts';
import { EntityReferenceGraph } from '../src/entities/EntityReferenceGraph.ts';
import { EntityRegistry } from '../src/entities/EntityRegistry.ts';
import { commitEntityProjection, type EntityProjectionData } from '../src/entities/EntityProjection.ts';
import type { ProjectedEntity, ProjectedReferenceIntent } from '../src/entities/EntityTypes.ts';

function syntheticProjection(): EntityProjectionData {
  const entities: ProjectedEntity[] = [];
  const references: ProjectedReferenceIntent[] = [];

  for (let i = 0; i < 4_000; i++) {
    const buildingId = `building:${i.toString().padStart(5, '0')}`;
    const firmId = `firm:${i.toString().padStart(5, '0')}`;
    entities.push({ kind: 'building', legacyId: buildingId, incarnationToken: `start:${i}` });
    entities.push({ kind: 'firm', legacyId: firmId, incarnationToken: `0|${buildingId}` });
    references.push({
      source: { kind: 'firm', legacyId: firmId },
      target: { kind: 'building', legacyId: buildingId },
      semantics: 'strong',
      relation: 'firm-building',
    });
  }

  for (let i = 0; i < 2_000; i++) {
    const suffix = i.toString().padStart(5, '0');
    const incidentId = `incident:${suffix}`;
    const buildingId = `building:${suffix}`;
    entities.push({ kind: 'incident', legacyId: incidentId, incarnationToken: `0|job:${suffix}` });
    references.push({
      source: { kind: 'incident', legacyId: incidentId },
      target: { kind: 'building', legacyId: buildingId },
      semantics: 'weak',
      relation: 'incident-building',
    });
  }

  return Object.freeze({
    entities: Object.freeze(entities),
    references: Object.freeze(references),
    unresolved: Object.freeze([]),
  });
}

test('10k entity projection and steady-state rebuild remain finite and integrity-safe', () => {
  const projection = syntheticProjection();
  assert.equal(projection.entities.length, 10_000);
  assert.equal(projection.references.length, 6_000);

  const registry = new EntityRegistry();
  const graph = new EntityReferenceGraph();

  const firstStart = performance.now();
  const first = commitEntityProjection(registry, graph, projection);
  assertEntityIntegrity(registry, graph);
  const firstMs = performance.now() - firstStart;

  assert.equal(first.activeEntities, 10_000);
  assert.equal(first.references, 6_000);
  assert.equal(first.unresolved.length, 0);
  assert.equal(registry.listHistorical().length, 0);
  const firstHandles = registry.listActive();

  const rebuildStart = performance.now();
  const rebuilt = commitEntityProjection(registry, graph, projection);
  assertEntityIntegrity(registry, graph);
  const rebuildMs = performance.now() - rebuildStart;

  assert.equal(rebuilt.activeEntities, 10_000);
  assert.equal(rebuilt.references, 6_000);
  assert.deepEqual(registry.listActive(), firstHandles);
  assert.equal(registry.listHistorical().length, 0);
  assert.ok(Number.isFinite(firstMs) && firstMs >= 0);
  assert.ok(Number.isFinite(rebuildMs) && rebuildMs >= 0);

  console.log('PHASE0B_ENTITY_10K_BENCHMARK', JSON.stringify({
    entities: projection.entities.length,
    references: projection.references.length,
    firstMs: Number(firstMs.toFixed(2)),
    rebuildMs: Number(rebuildMs.toFixed(2)),
  }));
});
