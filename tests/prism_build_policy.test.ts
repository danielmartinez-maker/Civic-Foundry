import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  prismPreflightCommands,
  prismVerificationCommands,
} from "../scripts/prism-verify.mjs";

test("Prism verification keeps the native gate deterministic and explicit", () => {
  assert.deepEqual(prismPreflightCommands, [
    [
      "node",
      "--experimental-strip-types",
      "scripts/prism-p2a-fixtures.ts",
      "--check",
    ],
  ]);
  assert.deepEqual(prismVerificationCommands, [
    ["fmt", "--all", "--", "--check"],
    [
      "clippy",
      "--workspace",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ],
    ["test", "--workspace", "--locked"],
    [
      "test",
      "-p",
      "prism-core",
      "--release",
      "--test",
      "p0_invariants",
      "--locked",
    ],
    [
      "test",
      "-p",
      "prism-core",
      "--release",
      "--test",
      "p1_invariants",
      "--locked",
    ],
    [
      "test",
      "-p",
      "prism-domain",
      "--release",
      "--test",
      "p2a_invariants",
      "--locked",
    ],
    ["check", "--workspace", "--all-targets", "--locked"],
  ]);
});

test("Prism workspace includes the P2A domain crate", () => {
  const cargoToml = readFileSync(
    new URL("../engine/prism/Cargo.toml", import.meta.url),
    "utf8",
  );
  assert.match(cargoToml, /members\s*=\s*\[[^\]]*"domain"[^\]]*\]/s);
});

test("Linux CI keeps the P2A release invariant gate explicit", () => {
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(ci, /name: Prism P2A release invariants/);
  assert.match(
    ci,
    /cargo test -p prism-domain --release --test p2a_invariants --locked/,
  );
});
