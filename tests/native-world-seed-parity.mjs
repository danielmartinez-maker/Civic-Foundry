import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  Array.from(
    { length: 128 },
    (_, index) =>
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

function normalizedHashValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isSafeInteger(value)
      ? value
      : Math.round(value / ABSOLUTE_FLOAT_TOLERANCE);
  }
  if (Array.isArray(value)) return value.map(normalizedHashValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizedHashValue(value[key])]),
    );
  }
  return value;
}

function domainHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(normalizedHashValue(value)))
    .digest("hex");
}

function terrainFieldHashes(snapshot) {
  const firstSample = snapshot.terrain.samples[0];
  assert.ok(firstSample, "generated terrain must contain at least one sample");
  return Object.fromEntries(
    Object.keys(firstSample)
      .sort()
      .map((field) => [
        field,
        domainHash(snapshot.terrain.samples.map((sample) => sample[field])),
      ]),
  );
}

function hydrologyStageHashes(snapshot) {
  const hydrology = snapshot.hydrology;
  return Object.freeze({
    depressionResolution: domainHash(hydrology.conditionedElevationMeters),
    drainageDirectionGraph: domainHash(hydrology.receiver),
    watershedAssignment: domainHash({
      watersheds: hydrology.watersheds,
      watershedIds: hydrology.watershedIds,
    }),
    flowAccumulation: domainHash(hydrology.flowAccumulation),
    channelGeneration: domainHash(hydrology.channels),
    floodSusceptibility: domainHash(hydrology.floodSusceptibility),
  });
}

function assertNamedHashes(expectedHashes, actualHashes, label, seed, preset) {
  assert.deepEqual(
    Object.keys(actualHashes),
    Object.keys(expectedHashes),
    `Stack 1 ${label} schema mismatch for seed=${seed} preset=${preset}`,
  );
  for (const field of Object.keys(expectedHashes)) {
    assert.equal(
      actualHashes[field],
      expectedHashes[field],
      `Stack 1 ${label} hash mismatch for seed=${seed} preset=${preset} field=${field}`,
    );
  }
}

function assertDomainHashes(expected, actual, seed, preset) {
  assertNamedHashes(
    terrainFieldHashes(expected),
    terrainFieldHashes(actual),
    "terrain field",
    seed,
    preset,
  );
  assertNamedHashes(
    hydrologyStageHashes(expected),
    hydrologyStageHashes(actual),
    "hydrology stage",
    seed,
    preset,
  );
}

function scenarioForCase(index) {
  if (index % 32 !== 0) return undefined;
  const polygon = Object.freeze({
    points: Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 3, y: 0 }),
      Object.freeze({ x: 3, y: 3 }),
      Object.freeze({ x: 0, y: 3 }),
    ]),
  });
  return Object.freeze({
    id: `seed-matrix-scenario:${index}`,
    elevationOverrides: Object.freeze([
      Object.freeze({ x: 1, y: 1, elevationMeters: 73.25 + index }),
    ]),
    permanentWaterPolygons: Object.freeze([
      Object.freeze({ class: "lake", polygon }),
    ]),
    soilRegions: Object.freeze([
      Object.freeze({ soilClass: "clay", polygon }),
    ]),
    groundwaterRegions: Object.freeze([
      Object.freeze({ depthMeters: 1.75, polygon }),
    ]),
    contaminationRegions: Object.freeze([
      Object.freeze({ index: 0.35, polygon }),
    ]),
  });
}

function generateTypeScriptWorld(seed, config, scenario) {
  return WorldFoundation.generate({
    seed,
    config,
    randomRegistry: new RandomStreamRegistry(seed),
    ...(scenario === undefined ? {} : { scenario }),
  }).snapshotAuthoritative();
}

function generateNativeWorld(seed, config, scenario) {
  const bridge = new NativeEngineBridge(addon, { seed });
  try {
    return bridge.createWorld({
      seed,
      config,
      ...(scenario === undefined ? {} : { scenario }),
    });
  } finally {
    bridge.dispose();
  }
}

let executed = 0;
let scenarioCases = 0;
for (let index = 0; index < SEED_CASES.length; index += 1) {
  const seed = SEED_CASES[index];
  const preset = WORLD_FORM_PRESETS[index % WORLD_FORM_PRESETS.length];
  const config = resolveWorldGenerationConfig({
    width: 11 + (index % 3),
    height: 7 + (index % 2),
    metersPerCell: index % 2 === 0 ? 30 : 20,
    preset,
  });
  const scenario = scenarioForCase(index);
  if (scenario !== undefined) scenarioCases += 1;

  const expected = generateTypeScriptWorld(seed, config, scenario);
  const actual = generateNativeWorld(seed, config, scenario);
  assertDomainHashes(expected, actual, seed, preset);
  const mismatch = firstMismatch(expected, actual);
  assert.equal(
    mismatch,
    undefined,
    `Stack 1 world parity failed for seed=${seed} preset=${preset}: first mismatch at ${mismatch}`,
  );
  executed += 1;
}

assert.ok(
  executed >= 100,
  "Stack 1 differential world parity must cover 100+ fixed seeds",
);
assert.ok(
  scenarioCases >= 4,
  "Stack 1 differential world parity must cover scenario overrides",
);
console.log(
  `Native/TypeScript world differential parity passed for ${executed} fixed seeds across ${WORLD_FORM_PRESETS.length} presets, ${scenarioCases} scenario-override cases, per-field terrain hashes, and named hydrology-stage hashes.`,
);
