import test from "node:test";
import assert from "node:assert/strict";

import { SimulationCore } from "../src/simulation/core/SimulationCore.ts";
import { captureAuthoritativeTransactionCheckpoint } from "../src/simulation/core/AuthoritativeTransactionCheckpoint.ts";
import {
  deterministicHash,
  stableStringify,
} from "../src/simulation/diagnostics/DeterministicDiagnostics.ts";
import { RevisionRegistry } from "../src/simulation/diagnostics/RevisionRegistry.ts";
import { CausalTraceBuffer } from "../src/simulation/diagnostics/CausalTrace.ts";
import { TransactionCoordinator } from "../src/simulation/transactions/TransactionCoordinator.ts";
import { hydrateCoreV9, serializeCoreV9 } from "../src/save/saveV9.ts";

const SOAK_HORIZONS = Object.freeze([
  Object.freeze({
    id: "ci-short",
    ticks: 500,
    checkpointEvery: 100,
    runInCi: true,
    budgets: Object.freeze({
      maxRetainedEvents: 512,
      maxTraceEntries: 512,
      maxCommandQueueDepth: 0,
      maxTopologyRevisionDelta: 0,
      maxInvalidReferences: 0,
    }),
  }),
  Object.freeze({
    id: "ci-extended",
    ticks: 10_000,
    checkpointEvery: 1_000,
    runInCi: true,
    budgets: Object.freeze({
      maxRetainedEvents: 512,
      maxTraceEntries: 512,
      maxCommandQueueDepth: 0,
      maxTopologyRevisionDelta: 0,
      maxInvalidReferences: 0,
    }),
  }),
  Object.freeze({
    id: "manual-long",
    ticks: 100_000,
    checkpointEvery: 10_000,
    runInCi: false,
    budgets: Object.freeze({
      maxRetainedEvents: 512,
      maxTraceEntries: 512,
      maxCommandQueueDepth: 0,
      maxTopologyRevisionDelta: 0,
      maxInvalidReferences: 0,
    }),
  }),
  Object.freeze({
    id: "manual-decade-scale-synthetic",
    ticks: 1_000_000,
    checkpointEvery: 100_000,
    runInCi: false,
    budgets: Object.freeze({
      maxRetainedEvents: 512,
      maxTraceEntries: 512,
      maxCommandQueueDepth: 0,
      maxTopologyRevisionDelta: 0,
      maxInvalidReferences: 0,
    }),
  }),
]);

function fixedSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function runDeterministicSoak(horizon: (typeof SOAK_HORIZONS)[number]): void {
  const left = new SimulationCore({ width: 14, height: 10, seed: 991 });
  const right = new SimulationCore({ width: 14, height: 10, seed: 991 });
  const initialTopologyRevision = left.roads.revision;
  const leftHashes: string[] = [];
  const rightHashes: string[] = [];

  for (
    let elapsed = horizon.checkpointEvery;
    elapsed <= horizon.ticks;
    elapsed += horizon.checkpointEvery
  ) {
    left.step(horizon.checkpointEvery);
    right.step(horizon.checkpointEvery);
    leftHashes.push(left.diagnostics.authorityHash());
    rightHashes.push(right.diagnostics.authorityHash());

    const leftDiagnostics = left.diagnostics.snapshot();
    const rightDiagnostics = right.diagnostics.snapshot();
    stableStringify(leftDiagnostics);
    stableStringify(rightDiagnostics);

    assert.equal(leftDiagnostics.simulation.faulted, false);
    assert.equal(rightDiagnostics.simulation.faulted, false);
    assert.ok(
      leftDiagnostics.simulation.retainedEvents <=
        horizon.budgets.maxRetainedEvents,
      `${horizon.id}: event journal retention budget`,
    );
    assert.ok(
      left.diagnostics.trace.list().length <= horizon.budgets.maxTraceEntries,
      `${horizon.id}: diagnostic trace retention budget`,
    );
    assert.ok(
      leftDiagnostics.simulation.commandQueueDepth <=
        horizon.budgets.maxCommandQueueDepth,
      `${horizon.id}: command queue depth budget`,
    );
    assert.ok(
      left.roads.revision - initialTopologyRevision <=
        horizon.budgets.maxTopologyRevisionDelta,
      `${horizon.id}: topology revision churn budget`,
    );
    assert.ok(
      leftDiagnostics.integrity.totalInvalidReferences <=
        horizon.budgets.maxInvalidReferences,
      `${horizon.id}: reference-integrity budget`,
    );
  }

  assert.deepEqual(leftHashes, rightHashes, `${horizon.id}: authority hashes`);
}

test("Save V9 remains unchanged and save-load-continue preserves deterministic authority", () => {
  const original = new SimulationCore({ width: 12, height: 10, seed: 801 });
  original.buildRoad(
    [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
    ],
    "local",
  );
  original.step(24);

  const save = serializeCoreV9(original);
  assert.equal(save.saveVersion, 9);
  assert.equal(save.gameVersion, "0.9.0-urban-fabric");
  const loaded = hydrateCoreV9(structuredClone(save));
  assert.equal(
    deterministicHash(serializeCoreV9(loaded)),
    deterministicHash(save),
  );

  original.step(64);
  loaded.step(64);
  assert.equal(
    deterministicHash(captureAuthoritativeTransactionCheckpoint(loaded)),
    deterministicHash(captureAuthoritativeTransactionCheckpoint(original)),
  );
});

test("fixed-seed transaction mutation fuzz always restores the exact pre-mutation hash", () => {
  const next = fixedSequence(0x5a17c0de);
  const state = { a: 7, b: 11, c: 13 };
  const coordinator = new TransactionCoordinator();
  for (const key of ["a", "b", "c"] as const) {
    coordinator.register({
      id: key,
      snapshot: () => state[key],
      restore: (value: number) => {
        state[key] = value;
      },
    });
  }

  for (let iteration = 0; iteration < 256; iteration++) {
    const before = deterministicHash(state);
    const checkpoint = coordinator.capture();
    const key = (["a", "b", "c"] as const)[next() % 3]!;
    state[key] += (next() % 31) - 15;
    coordinator.rollback(checkpoint);
    assert.equal(
      deterministicHash(state),
      before,
      `seed regression at iteration ${iteration}`,
    );
  }
});

test("revision and trace fuzz obey bounded retention and no-op invalidation budgets", () => {
  const next = fixedSequence(0x8badf00d);
  const revisions = new RevisionRegistry();
  revisions.ensure("topology");
  revisions.ensure("cadastre");
  revisions.declareCache("routes", ["topology"]);
  revisions.declareCache("parcels", ["cadastre"]);
  revisions.markRebuilt("routes");
  revisions.markRebuilt("parcels");
  const trace = new CausalTraceBuffer(32);

  let semanticTopologyChanges = 0;
  for (let iteration = 0; iteration < 500; iteration++) {
    const authority = next() % 2 === 0 ? "topology" : "cadastre";
    const changed = next() % 5 === 0;
    if (authority === "topology" && changed) semanticTopologyChanges += 1;
    revisions.recordMutation(
      authority,
      changed,
      `fuzz-${authority}-${iteration}`,
    );
    trace.append({
      code: changed ? "semantic-mutation" : "noop-observation",
      domain: authority,
      operation: "fuzz",
      tick: iteration,
    });
  }

  assert.equal(revisions.current("topology"), semanticTopologyChanges);
  assert.ok(trace.list().length <= 32);
  assert.equal(trace.snapshot().nextSequence, 501);
});

test("soak horizons are deterministic, explicit, and bound CI versus manual stress", () => {
  assert.deepEqual(
    SOAK_HORIZONS.map((horizon) => horizon.ticks),
    [500, 10_000, 100_000, 1_000_000],
  );
  assert.deepEqual(
    SOAK_HORIZONS.filter((horizon) => horizon.runInCi).map(
      (horizon) => horizon.ticks,
    ),
    [500, 10_000],
  );
  for (const horizon of SOAK_HORIZONS) {
    assert.equal(horizon.ticks % horizon.checkpointEvery, 0);
    assert.equal(horizon.budgets.maxRetainedEvents, 512);
    assert.equal(horizon.budgets.maxTraceEntries, 512);
    assert.equal(horizon.budgets.maxCommandQueueDepth, 0);
    assert.equal(horizon.budgets.maxInvalidReferences, 0);
  }
});

test("CI deterministic soak horizons preserve identical checkpoints and explicit budgets", () => {
  for (const horizon of SOAK_HORIZONS.filter(
    (candidate) => candidate.runInCi,
  )) {
    runDeterministicSoak(horizon);
  }
});
