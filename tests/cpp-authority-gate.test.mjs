import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateAuthorityState,
  validateTransition,
} from "../scripts/cpp/authority-gate.mjs";

const registryPath = new URL(
  "../docs/cpp/NATIVE_AUTHORITY_STATE.json",
  import.meta.url,
);
const registry = JSON.parse(await readFile(registryPath, "utf8"));

test("accepts current baseline registry", () => {
  assert.equal(validateAuthorityState(structuredClone(registry)), true);
});

test("rejects TS authoritative domain marked native owned", () => {
  const candidate = structuredClone(registry);
  candidate.domains.world.runtimeNativeOwnership = "owned";

  assert.throws(
    () => validateAuthorityState(candidate),
    /TS-authoritative domain must remain native-unowned/,
  );
});

test("rejects native authoritative domain that still allows TS mutation", () => {
  const candidate = structuredClone(registry);
  candidate.domains.world = {
    state: "native_authoritative",
    runtimeNativeOwnership: "owned",
    evidence: "test-artifacts/cpp-parity/world.json",
    typescriptMutationAllowed: true,
  };

  assert.throws(
    () => validateAuthorityState(candidate),
    /native_authoritative forbids TS mutation/,
  );
});

test("rejects native authoritative domain without evidence", () => {
  const candidate = structuredClone(registry);
  candidate.domains.world = {
    state: "native_authoritative",
    runtimeNativeOwnership: "owned",
    evidence: null,
    typescriptMutationAllowed: false,
  };

  assert.throws(
    () => validateAuthorityState(candidate),
    /native_authoritative requires evidence/,
  );
});

test("allows sequential TS to shadow transition", () => {
  assert.equal(
    validateTransition({
      before: registry.domains.world,
      after: {
        ...registry.domains.world,
        state: "shadow",
      },
    }),
    true,
  );
});

test("rejects TS authoritative directly to native authoritative", () => {
  assert.throws(
    () =>
      validateTransition({
        before: registry.domains.world,
        after: {
          state: "native_authoritative",
          runtimeNativeOwnership: "owned",
          evidence: "test-artifacts/cpp-parity/world.json",
          typescriptMutationAllowed: false,
        },
      }),
    /may not skip gates/,
  );
});

test("rejects moving authority state backward", () => {
  assert.throws(
    () =>
      validateTransition({
        before: {
          state: "parity_accepted",
          runtimeNativeOwnership: "unowned",
          evidence: "test-artifacts/cpp-parity/world.json",
          typescriptMutationAllowed: true,
        },
        after: {
          ...registry.domains.world,
          state: "shadow",
        },
      }),
    /may not move backward/,
  );
});
