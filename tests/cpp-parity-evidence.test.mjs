import assert from "node:assert/strict";
import test from "node:test";

import { validateEvidence } from "../scripts/cpp/parity-evidence.mjs";

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);

function runtime(ownership = "owned", domainHash = "123") {
  return {
    ownership,
    snapshotSha256: SHA,
    eventsSha256: SHA,
    domainHashVersion: 1,
    domainHash,
    invariants: "pass",
  };
}

function parityEvidence() {
  return {
    schemaVersion: 1,
    stackId: "K001",
    fixtureId: "empty-new-city",
    targetTick: 100,
    classification: "PARITY",
    domains: [
      {
        domain: "kernel",
        typescript: runtime(),
        native: runtime(),
        comparison: {
          snapshot: "match",
          events: "match",
          domainHash: "match",
          invariants: "match",
        },
      },
    ],
    determinism: {
      typescriptRepeatSha256: SHA,
      nativeRepeatSha256: SHA,
      typescriptRepeatMatch: true,
      nativeRepeatMatch: true,
    },
    correction: null,
    generatedAtCommit: COMMIT,
  };
}

function deferredEvidence() {
  const evidence = parityEvidence();
  evidence.classification = "DEFERRED";
  evidence.domains[0].native = runtime("unowned", "0");
  evidence.domains[0].comparison = {
    snapshot: "not_applicable",
    events: "not_applicable",
    domainHash: "not_applicable",
    invariants: "not_applicable",
  };
  return evidence;
}

function correctionEvidence() {
  const evidence = parityEvidence();
  evidence.classification = "CORRECTION";
  evidence.domains[0].comparison.snapshot = "mismatch";
  evidence.correction = {
    issue: "SIM-016",
    regressionTest: "FreightConservation.DeliveredOverflowIsPreserved",
    rationale:
      "Native implementation intentionally fixes accepted cataloged freight destruction defect.",
  };
  return evidence;
}

test("accepts strict parity evidence", () => {
  assert.equal(validateEvidence(parityEvidence()), true);
});

test("rejects parity with mismatch", () => {
  const evidence = parityEvidence();
  evidence.domains[0].comparison.snapshot = "mismatch";

  assert.throws(
    () => validateEvidence(evidence),
    /PARITY comparison must match/,
  );
});

test("accepts deferred unowned domain", () => {
  assert.equal(validateEvidence(deferredEvidence()), true);
});

test("rejects deferred owned native domain", () => {
  const evidence = deferredEvidence();
  evidence.domains[0].native.ownership = "owned";

  assert.throws(
    () => validateEvidence(evidence),
    /DEFERRED native ownership must be unowned/,
  );
});

test("correction requires issue and regression test", () => {
  const evidence = correctionEvidence();
  evidence.correction.regressionTest = "";

  assert.throws(
    () => validateEvidence(evidence),
    /CORRECTION regressionTest required/,
  );
});

test("rejects nondeterministic repeat evidence", () => {
  const evidence = parityEvidence();
  evidence.determinism.nativeRepeatMatch = false;

  assert.throws(
    () => validateEvidence(evidence),
    /Native repeat determinism failed/,
  );
});
