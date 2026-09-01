import test from "node:test";
import assert from "node:assert/strict";

import { EngineFailure } from "../src/simulation/diagnostics/EngineFailure.ts";
import {
  assertDeterministicSnapshotEquality,
  compareDeterministicSnapshots,
  profileTicks,
} from "../src/simulation/diagnostics/ReplayDiagnostics.ts";

test("replay diagnostics compare canonical snapshots independent of object key order", () => {
  const comparison = compareDeterministicSnapshots(
    { z: 2, nested: { b: true, a: 1 } },
    { nested: { a: 1, b: true }, z: 2 },
  );
  assert.equal(comparison.equal, true);
  assert.equal(comparison.leftHash, comparison.rightHash);
});

test("replay diagnostics surface deterministic snapshot mismatch as a structured failure", () => {
  assert.throws(
    () =>
      assertDeterministicSnapshotEquality(
        { tick: 4, value: 10 },
        { tick: 4, value: 11 },
        "stack8-regression",
      ),
    (error: unknown) =>
      error instanceof EngineFailure &&
      error.code === "deterministic-snapshot-mismatch" &&
      error.category === "DeterminismFailure" &&
      error.operation === "stack8-regression",
  );
});

test("tick profiling is deterministic with an injected clock and reports before/after authority hashes", () => {
  let now = 10;
  const authority = { tick: 0 };
  const profile = profileTicks({
    ticks: 4,
    step: (ticks) => {
      authority.tick += ticks;
      now += 8;
    },
    captureAuthority: () => authority,
    now: () => now,
  });

  assert.equal(profile.ticks, 4);
  assert.equal(profile.elapsedMs, 8);
  assert.equal(profile.averageMsPerTick, 2);
  assert.notEqual(profile.startingAuthorityHash, profile.finalAuthorityHash);
  assert.throws(
    () =>
      profileTicks({
        ticks: -1,
        step: () => {},
        captureAuthority: () => null,
        now: () => 0,
      }),
    /non-negative integer/,
  );
});
