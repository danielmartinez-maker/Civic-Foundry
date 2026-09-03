import assert from "node:assert/strict";
import test from "node:test";

import { buildCommands } from "../scripts/cpp/run-native-round.mjs";

test("default round gate configures builds and runs native label", () => {
  const commands = buildCommands();

  assert.deepEqual(commands.configure, ["cmake", ["--preset", "round-debug"]]);

  assert.deepEqual(commands.build, [
    "cmake",
    ["--build", "--preset", "round-debug"],
  ]);

  assert.deepEqual(commands.test, [
    "ctest",
    ["--preset", "round-debug", "--output-on-failure", "-L", "native"],
  ]);
});

test("round gate can target one test regex", () => {
  const commands = buildCommands({
    regex: "SaveV9|CAbi",
  });

  assert.deepEqual(commands.test, [
    "ctest",
    [
      "--preset",
      "round-debug",
      "--output-on-failure",
      "-L",
      "native",
      "-R",
      "SaveV9|CAbi",
    ],
  ]);
});

test("round gate can run all ctest registrations", () => {
  const commands = buildCommands({
    label: null,
  });

  assert.equal(commands.test[1].includes("-L"), false);
});
