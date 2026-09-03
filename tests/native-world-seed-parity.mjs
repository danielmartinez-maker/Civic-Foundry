import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { NativeEngineBridge } from "../src/native/NativeEngineBridge.ts";
import { RandomStreamRegistry } from "../src/simulation/kernel/RandomStreamRegistry.ts";
import { WorldFoundation } from "../src/world/foundation/WorldFoundation.ts";
import {
  WORLD_FORM_PRESETS,
  resolveWorldGenerationConfig,
} from "../src/world/generation/WorldGenerationConfig.ts";

const require = createRequire(import.meta.url);
const addon = require(resolve(process.argv[2]));

const SEED_CASES = Object.freeze(
  Array.from({ length: 128 }, (_, index) =>
    // Knuth's multiplicative constant gives a stable spread across uint32.
    Math.imul(index + 1, 0x9e3779b1) >>> 0,
  ),
);

const ABSOLUTE_FLOAT_TOLERANCE = 1e-6;
const RELATIVE_FLOAT_TOLERANCE = 1e-9;

function numericMismatch(expected, actual) {
  if (Number.isSafeInteger(expected) && Number.isSafeInteger(actual)) {
    return expected === actual ? undefined : `${expected} !== ${actual}`;
  }
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
    return Object.is(expected, actual)
      ? undefined
      : `${String(expected)} !== ${String(actual)}`;
  }
  const tolerance = Math.max(
    ABSOLUTE_FLOAT_TOLERANCE,
    RELATIVE_FLOAT_TOLERANCE * Math.max(Math.abs(expected), Math.abs(actual)),
  );
  const delta = Math.abs(expected - actual);
  return delta <= tolerance
    ? undefined
    : `${expected} !== ${actual} (delta=${delta}, tolerance=${tolerance})`;
}

function firstMismatch(expected, actual, path = "$") {
  if (typeof expected === "number" && typeof actual === "number") {
    const mismatch = numericMismatch(expected, actual);
    return mismatch ? `${path}: ${mismatch}` : undefined;
  }
  if (Object.is(expected, actual)) return undefined;

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return `${path}.length: ${expected.length} !== ${actual.length}`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = firstMismatch(
        expected[index],
        actual[index],
        `${path}[${index}]`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }

  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.length !== actualKeys.length) {
      return `${path} keys: ${JSON.stringify(expectedKeys)} !== ${JSON.stringify(actualKeys)}`;
    }
    for (let index = 0; index < expectedKeys.length; index += 1) {
      if (expectedKeys[index] !== actualKeys[index]) {
        return `${path} keys: ${JSON.stringify(expectedKeys)} !== ${JSON.stringify(actualKeys)}`;
      }
    }
    for (const key of expectedKeys) {
      const mismatch = firstMismatch(
        expected[key],
        actual[key],
        `${path}.${key}`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }

  return `${path}: ${JSON.stringify(expected)} !== ${JSON.stringify(actual)}`;
}

function generateTypeScriptWorld(seed, config) {
  return WorldFoundation.generate({
    seed,
    config,
    randomRegistry: new RandomStreamRegistry(seed),
  }).snapshotAuthoritative();
}

function generateNativeWorld(seed, config) {
  const bridge = new NativeEngineBridge(addon, { seed });
  try {
    return bridge.createWorld({ seed, config });
  } finally {
    bridge.dispose();
  }
}

let executed = 0;
for (let index = 0; index < SEED_CASES.length; index += 1) {
  const seed = SEED_CASES[index];
  const preset = WORLD_FORM_PRESETS[index % WORLD_FORM_PRESETS.length];
  const config = resolveWorldGenerationConfig({
    width: 11 + (index % 3),
    height: 7 + (index % 2),
    metersPerCell: index % 2 === 0 ? 30 : 20,
    preset,
  });

  const expected = generateTypeScriptWorld(seed, config);
  const actual = generateNativeWorld(seed, config);
  const mismatch = firstMismatch(expected, actual);
  assert.equal(
    mismatch,
    undefined,
    `Stack 1 world parity failed for seed=${seed} preset=${preset}: first mismatch at ${mismatch}`,
  );
  executed += 1;
}

assert.ok(executed >= 100, "Stack 1 differential world parity must cover 100+ fixed seeds");
console.log(
  `Native/TypeScript world differential parity passed for ${executed} fixed seeds across ${WORLD_FORM_PRESETS.length} presets.`,
);
