import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canonicalStringify,
  runKernelParityScenarios,
} from "./support/kernelParity.ts";
import {
  loadMigrationManifest,
  runTypeScriptMigrationCorpus,
} from "./support/cppMigrationFixtures.ts";

const manifest = loadMigrationManifest();
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
  assert.equal(manifest.version, 2);
  assert.equal(manifest.saveVersion, 9);
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
      ["PARITY", "CORRECTION", "DEFERRED"].includes(
        scenario.classification,
      ),
    ),
  );
  assert.ok(
    manifest.scenarios.every(
      (scenario) => Object.keys(scenario.expectedDomainHashes).length > 0,
    ),
  );
});

test("every C++ migration scenario records executable save input and an ordered command journal", () => {
  for (const scenario of manifest.scenarios) {
    assert.ok(
      scenario.saveInput.kind === "fresh" || scenario.saveInput.kind === "v9",
      `${scenario.id} must record an executable saveInput`,
    );
    assert.ok(
      Array.isArray(scenario.commandJournal),
      `${scenario.id} must record commandJournal`,
    );
    assert.ok(scenario.targetTicks.length > 0, `${scenario.id} needs target ticks`);
    let previousSequence = 0;
    for (const command of scenario.commandJournal) {
      assert.ok(
        Number.isInteger(command.sequence) &&
          command.sequence > previousSequence,
      );
      assert.ok(Number.isInteger(command.tick) && command.tick >= 0);
      assert.equal(typeof command.type, "string");
      assert.ok(command.type.trim().length > 0);
      assert.ok(Object.prototype.hasOwnProperty.call(command, "payload"));
      previousSequence = command.sequence;
    }
  }
});

test("frozen TypeScript migration oracle is byte-identical across repeated normalized runs", () => {
  const first = canonicalStringify(runKernelParityScenarios());
  const second = canonicalStringify(runKernelParityScenarios());
  assert.equal(first, second);
});

test("executable migration corpus is byte-identical across repeated TypeScript shadow runs", () => {
  const first = canonicalStringify(runTypeScriptMigrationCorpus(manifest));
  const second = canonicalStringify(runTypeScriptMigrationCorpus(manifest));
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
