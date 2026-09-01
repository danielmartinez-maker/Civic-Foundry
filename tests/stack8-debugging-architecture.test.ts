import test from 'node:test';
import assert from 'node:assert/strict';

import { SimulationClock } from '../src/simulation/core/SimulationClock.ts';
import { SimulationKernel } from '../src/simulation/kernel/SimulationKernel.ts';
import {
  EngineFailure,
  engineFailure,
  normalizeEngineFailure,
} from '../src/simulation/diagnostics/EngineFailure.ts';
import {
  deterministicHash,
  stableStringify,
} from '../src/simulation/diagnostics/DeterministicDiagnostics.ts';
import {
  assertFiniteNumber,
  assertFiniteRecord,
} from '../src/simulation/diagnostics/NumericSafety.ts';
import { TransactionCoordinator } from '../src/simulation/transactions/TransactionCoordinator.ts';
import { CausalTraceBuffer } from '../src/simulation/diagnostics/CausalTrace.ts';
import { RevisionRegistry } from '../src/simulation/diagnostics/RevisionRegistry.ts';
import { ReferenceIntegrityValidator } from '../src/simulation/diagnostics/ReferenceIntegrity.ts';
import { PerformanceAttribution } from '../src/simulation/diagnostics/PerformanceAttribution.ts';
import {
  createReproBundle,
  replayReproBundle,
  serializeReproBundle,
} from '../src/simulation/diagnostics/ReproBundle.ts';

test('structured failures preserve stable machine-readable architecture context', () => {
  const failure = engineFailure({
    code: 'cadastre-dangling-building',
    category: 'ReferenceIntegrityFailure',
    domain: 'cadastre',
    operation: 'validate-building-reference',
    tick: 41,
    commandId: 'cmd-7',
    entityIds: ['building-2', 'parcel-9'],
    revisions: { cadastre: 12, buildings: 4 },
    saveVersion: 9,
    parentOperation: 'hydrate-v9',
  }, 'building references a missing parcel');

  assert.ok(failure instanceof EngineFailure);
  assert.equal(failure.code, 'cadastre-dangling-building');
  assert.equal(failure.category, 'ReferenceIntegrityFailure');
  assert.deepEqual(failure.entityIds, ['building-2', 'parcel-9']);
  assert.deepEqual(failure.toJSON(), {
    name: 'EngineFailure',
    message: 'building references a missing parcel',
    code: 'cadastre-dangling-building',
    category: 'ReferenceIntegrityFailure',
    domain: 'cadastre',
    operation: 'validate-building-reference',
    tick: 41,
    commandId: 'cmd-7',
    entityIds: ['building-2', 'parcel-9'],
    revisions: { buildings: 4, cadastre: 12 },
    saveVersion: 9,
    parentOperation: 'hydrate-v9',
  });

  const normalized = normalizeEngineFailure(new Error('boom'), {
    code: 'kernel-system-exception',
    category: 'SchedulingFailure',
    domain: 'kernel',
    operation: 'step',
    tick: 3,
  });
  assert.equal(normalized.code, 'kernel-system-exception');
  assert.equal(normalized.message, 'boom');
});

test('deterministic diagnostics canonicalize object keys and reject illegal numeric state', () => {
  const left = { z: 2, nested: { b: true, a: [3, 2, 1] }, a: 'x' };
  const right = { a: 'x', nested: { a: [3, 2, 1], b: true }, z: 2 };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(deterministicHash(left), deterministicHash(right));
  assert.notEqual(deterministicHash(left), deterministicHash({ ...right, z: 3 }));
  assert.throws(() => stableStringify({ bad: Number.NaN }), /non-finite number at \$\.bad/);
  assert.throws(() => stableStringify({ bad: Number.POSITIVE_INFINITY }), /non-finite number at \$\.bad/);
});

test('numeric guards report deterministic ownership paths without clamping', () => {
  assert.equal(assertFiniteNumber(4.5, 'traffic.weight'), 4.5);
  assert.throws(() => assertFiniteNumber(Number.NaN, 'traffic.weight'), /traffic\.weight must be finite/);
  assert.throws(
    () => assertFiniteRecord({ speed: 30, nested: { cost: Number.NEGATIVE_INFINITY } }, 'route'),
    /route\.nested\.cost must be finite/,
  );
});

test('transaction coordinator snapshots in stable id order and rolls back in reverse order', () => {
  const trace: string[] = [];
  const a = { value: 1 };
  const b = { value: 2 };
  const coordinator = new TransactionCoordinator();
  coordinator.register({ id: 'b', snapshot: () => { trace.push('snapshot:b'); return b.value; }, restore: (value) => { trace.push('restore:b'); b.value = value; } });
  coordinator.register({ id: 'a', snapshot: () => { trace.push('snapshot:a'); return a.value; }, restore: (value) => { trace.push('restore:a'); a.value = value; } });

  const checkpoint = coordinator.capture();
  a.value = 100;
  b.value = 200;
  coordinator.rollback(checkpoint);

  assert.deepEqual(trace, ['snapshot:a', 'snapshot:b', 'restore:b', 'restore:a']);
  assert.deepEqual({ a: a.value, b: b.value }, { a: 1, b: 2 });
  assert.deepEqual(coordinator.listParticipantIds(), ['a', 'b']);
  assert.throws(() => coordinator.register({ id: 'a', snapshot: () => 0, restore: () => {} }), /duplicate transaction participant: a/);
});

test('transaction rollback failure is fail-stop structured architecture failure', () => {
  const coordinator = new TransactionCoordinator();
  coordinator.register({ id: 'domain', snapshot: () => 1, restore: () => { throw new Error('restore failed'); } });
  const checkpoint = coordinator.capture();
  assert.throws(
    () => coordinator.rollback(checkpoint),
    (error: unknown) => error instanceof EngineFailure && error.code === 'transaction-rollback-failed' && error.category === 'TransactionFailure',
  );
});

test('causal trace is deterministic, bounded, and preserves parent-child relations', () => {
  const trace = new CausalTraceBuffer(3);
  const root = trace.append({ code: 'route-invalidated', domain: 'transport', operation: 'route', tick: 9, entityIds: ['trip-1'] });
  const child = trace.append({ code: 'vehicle-rerouted', domain: 'transport', operation: 'reroute', tick: 9, parentSequence: root.sequence, entityIds: ['vehicle-1'] });
  trace.append({ code: 'cache-rebuild', domain: 'transport', operation: 'path-cache', tick: 9 });
  trace.append({ code: 'trip-complete', domain: 'transport', operation: 'complete', tick: 10, parentSequence: child.sequence });

  assert.deepEqual(trace.list().map((item) => item.code), ['vehicle-rerouted', 'cache-rebuild', 'trip-complete']);
  assert.equal(trace.list()[0]!.parentSequence, root.sequence);
  assert.equal(trace.snapshot().nextSequence, 5);
});

test('revision registry invalidates only caches that depend on changed authority', () => {
  const revisions = new RevisionRegistry();
  revisions.ensure('topology');
  revisions.ensure('cadastre');
  revisions.declareCache('routes', ['topology']);
  revisions.declareCache('parcel-visuals', ['cadastre']);
  revisions.markRebuilt('routes');
  revisions.markRebuilt('parcel-visuals');

  assert.equal(revisions.needsRebuild('routes'), false);
  assert.equal(revisions.needsRebuild('parcel-visuals'), false);
  assert.equal(revisions.recordMutation('topology', false, 'noop'), 0);
  assert.equal(revisions.needsRebuild('routes'), false);
  assert.equal(revisions.recordMutation('topology', true, 'road-built'), 1);
  assert.equal(revisions.needsRebuild('routes'), true);
  assert.equal(revisions.needsRebuild('parcel-visuals'), false);
  assert.equal(revisions.cacheStatus('routes').reason, 'road-built');
});

test('reference integrity validator reports duplicate, dangling, stale and non-finite seams', () => {
  const validator = new ReferenceIntegrityValidator();
  validator.unique('parcel', ['p-1', 'p-1']);
  validator.reference('building', 'b-1', 'parcelId', 'parcel', 'missing', () => false);
  validator.revision('route', 'r-1', 'topology', 3, 4);
  validator.finite('inventory', 'firm-1', 'quantity', Number.NaN);

  assert.deepEqual(validator.failures().map((failure) => failure.code), [
    'duplicate-entity-id',
    'dangling-reference',
    'stale-reference-revision',
    'non-finite-authoritative-state',
  ]);
  assert.throws(() => validator.throwIfAny('save-v9'), (error: unknown) => error instanceof EngineFailure && error.code === 'reference-integrity-failed');
});

test('performance attribution exposes calls average p95 max budget and cache hit rate', () => {
  const perf = new PerformanceAttribution();
  perf.record('pathfind', 2, { budgetMs: 4, cache: 'hit' });
  perf.record('pathfind', 4, { budgetMs: 4, cache: 'miss' });
  perf.record('pathfind', 8, { budgetMs: 4, cache: 'hit' });
  const snapshot = perf.snapshot().pathfind!;
  assert.equal(snapshot.calls, 3);
  assert.equal(snapshot.averageMs, 14 / 3);
  assert.equal(snapshot.p95Ms, 8);
  assert.equal(snapshot.maxMs, 8);
  assert.equal(snapshot.overBudget, 1);
  assert.equal(snapshot.cacheHitRate, 2 / 3);
});

test('repro bundles serialize deterministically and replay the same failure code and pre-failure hash', () => {
  const bundle = createReproBundle({
    gameVersion: '0.9.0-urban-fabric',
    saveVersion: 9,
    startingTick: 12,
    startingAuthorityHash: 'aa11',
    commands: [
      { sequence: 2, tick: 14, type: 'B', payload: { y: 2, x: 1 } },
      { sequence: 1, tick: 13, type: 'A', payload: null },
    ],
    rngStreams: { traffic: 7, development: 3 },
    schedulerManifest: [{ id: 'legacy-v7-city', cadence: { every: 1 }, reads: [], writes: ['legacy-v7-city'], rngStreams: [], emits: [] }],
    revisions: { topology: 4, cadastre: 8 },
    expectedFailureCode: 'forced-test-failure',
    preFailureAuthorityHash: 'bb22',
  });

  const serialized = serializeReproBundle(bundle);
  assert.equal(serialized, serializeReproBundle(createReproBundle({
    ...bundle,
    rngStreams: { development: 3, traffic: 7 },
    revisions: { cadastre: 8, topology: 4 },
  })));

  const result = replayReproBundle(bundle, () => ({ failureCode: 'forced-test-failure', preFailureAuthorityHash: 'bb22' }));
  assert.deepEqual(result, { failureCode: 'forced-test-failure', preFailureAuthorityHash: 'bb22' });
  assert.throws(
    () => replayReproBundle(bundle, () => ({ failureCode: 'different', preFailureAuthorityHash: 'bb22' })),
    (error: unknown) => error instanceof EngineFailure && error.code === 'repro-failure-code-mismatch',
  );
});

test('kernel exposes stable scheduler contracts, structured failure state and performance diagnostics', () => {
  let now = 0;
  const kernel = new SimulationKernel({ clock: new SimulationClock(), seed: 9, now: () => now });
  kernel.registerSystem({
    id: 'profiled',
    reads: ['roads'],
    writes: ['traffic'],
    rngStreams: ['traffic'],
    emits: ['TrafficUpdated'],
    invariants: ['traffic-finite'],
    performanceBudgetMs: 4,
    cadence: { every: 1 },
    execute: () => { now += 5; },
  });
  kernel.step(1);
  assert.deepEqual(kernel.schedulerManifest(), [{
    id: 'profiled',
    cadence: { every: 1, offset: 0 },
    reads: ['roads'],
    writes: ['traffic'],
    rngStreams: ['traffic'],
    emits: ['TrafficUpdated'],
    invariants: ['traffic-finite'],
    performanceBudgetMs: 4,
  }]);
  assert.equal(kernel.diagnosticSnapshot().performance.profiled?.calls, 1);
  assert.equal(kernel.diagnosticSnapshot().performance.profiled?.overBudget, 1);

  const failing = new SimulationKernel({ clock: new SimulationClock(), seed: 1, now: () => 0 });
  failing.registerSystem({ id: 'boom', reads: [], writes: ['state'], cadence: { every: 1 }, execute: () => { throw new Error('forced'); } });
  assert.throws(() => failing.step(1), /forced/);
  assert.equal(failing.lastFailure()?.category, 'SchedulingFailure');
  assert.equal(failing.lastFailure()?.code, 'kernel-step-failed');
  assert.equal(failing.diagnosticSnapshot().transactionRollbacks, 1);
});
