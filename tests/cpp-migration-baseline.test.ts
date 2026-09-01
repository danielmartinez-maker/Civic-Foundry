import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalStringify,
  runKernelParityScenarios,
} from "./support/kernelParity.ts";

const manifest = JSON.parse(
  readFileSync("tests/fixtures/cpp-migration/manifest.json", "utf8"),
) as {
  baselineCommit: string;
  scenarios: Array<{
    id: string;
    classification: string;
    expectedDomainHashes: Record<string, string>;
  }>;
};
const frozen = JSON.parse(
  readFileSync("tests/fixtures/kernel-v7-parity/baseline.json", "utf8"),
) as {
  scenarios: Record<string, { checkpoints: Record<string, string> }>;
};

test("C++ migration baseline names the exact accepted TypeScript commit and required scenarios", () => {
  assert.equal(
    manifest.baselineCommit,
    "9ed741834e49d211555d2ee3131f1bb6797b4b0a",
  );
  assert.deepEqual(
    manifest.scenarios.map((scenario) => scenario.id),
    [
      "empty-new-city",
      "small-road-zoning-city",
      "saved-urban-fabric-v9-city",
      "active-transit-city",
      "active-freight-economy-city",
      "cadastral-history-city",
    ],
  );
  assert.ok(
    manifest.scenarios.every((scenario) =>
      ["PARITY", "CORRECTION", "DEFERRED"].includes(scenario.classification),
    ),
  );
  assert.ok(
    manifest.scenarios.every(
      (scenario) => Object.keys(scenario.expectedDomainHashes).length > 0,
    ),
  );
});

test("frozen TypeScript migration oracle is byte-identical across repeated normalized runs", () => {
  const first = canonicalStringify(runKernelParityScenarios());
  const second = canonicalStringify(runKernelParityScenarios());
  assert.equal(first, second);
});

test("manifest pins accepted legacy domain hashes rather than recomputing expected values", () => {
  assert.equal(
    manifest.scenarios[0]?.expectedDomainHashes[
      "legacy-authoritative-save@250"
    ],
    frozen.scenarios["empty-boundaries"]?.checkpoints["tick-250"],
  );
  assert.equal(
    manifest.scenarios[1]?.expectedDomainHashes[
      "legacy-authoritative-save@500"
    ],
    frozen.scenarios["city-development"]?.checkpoints["tick-500"],
  );
  assert.equal(
    manifest.scenarios[3]?.expectedDomainHashes[
      "legacy-authoritative-save@1000"
    ],
    frozen.scenarios.transit?.checkpoints["tick-1000"],
  );
  assert.equal(
    manifest.scenarios[4]?.expectedDomainHashes[
      "legacy-authoritative-save@2000"
    ],
    frozen.scenarios["economy-freight"]?.checkpoints["tick-2000"],
  );
});
