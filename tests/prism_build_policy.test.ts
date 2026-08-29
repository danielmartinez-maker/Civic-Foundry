import assert from "node:assert/strict";
import test from "node:test";

import { prismVerificationCommands } from "../scripts/prism-verify.mjs";

test("Prism verification keeps the native gate deterministic and explicit", () => {
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
    ["check", "--workspace", "--all-targets", "--locked"],
  ]);
});
