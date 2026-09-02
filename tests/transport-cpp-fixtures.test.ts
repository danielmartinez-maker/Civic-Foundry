import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifestUrl = new URL(
  "./fixtures/cpp-transport/manifest.json",
  import.meta.url,
);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  fixtureVersion: number;
  saveVersion: number;
  baseline: string;
  scenarios: readonly {
    id: string;
    classification: "PARITY" | "CORRECTION" | "DEFERRED";
    expected: Record<string, unknown>;
    bugRefs?: readonly string[];
  }[];
};

const required = [
  "dead-end-local-road",
  "four-way-intersection",
  "mixed-road-classes",
  "one-way-pair",
  "turn-restriction",
  "signalized-intersection",
  "disconnected-components",
  "same-node-trip",
  "congestion",
  "road-edit-invalidation",
  "bus-line",
  "multi-line-transfer",
  "full-vehicle-crowding",
  "vehicle-failure",
  "parking-constrained-destination",
  "incident-capacity-reduction",
] as const;

test("Stack 2 migration manifest freezes every required transportation scenario", () => {
  assert.equal(manifest.fixtureVersion, 1);
  assert.equal(manifest.saveVersion, 9);
  assert.match(manifest.baseline, /^[0-9a-f]{40}$/u);
  const ids = manifest.scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, "fixture IDs must be unique");
  assert.deepEqual([...ids].sort(), [...required].sort());
  for (const scenario of manifest.scenarios) {
    assert.ok(
      Object.keys(scenario.expected).length > 0,
      `${scenario.id}: expected contract required`,
    );
    if (scenario.classification === "CORRECTION") {
      assert.ok(
        (scenario.bugRefs?.length ?? 0) > 0,
        `${scenario.id}: correction must cite a frozen defect`,
      );
    }
  }
});
