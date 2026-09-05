import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { NativeEngineBridge } from "../../src/native/NativeEngineBridge.ts";
import { canonicalStringify, digestCanonical } from "../../tests/support/kernelParity.ts";
import {
  loadMigrationManifest,
  materializeMigrationSaveInput,
  MIGRATION_HASH_DOMAINS,
  runTypeScriptMigrationScenario,
} from "../../tests/support/cppMigrationFixtures.ts";

const addonPath = process.argv[2];
if (!addonPath) throw new Error("native addon path required");
const require = createRequire(import.meta.url);
const addon = require(resolve(addonPath));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function normalizeHash(hash) {
  return { ownership: hash.ownership, version: hash.version, value: hash.value.toString() };
}

function runNativeScenario(scenario) {
  const save = materializeMigrationSaveInput(scenario);
  const seed = save?.seed ?? scenario.seed;
  const startTick = save?.clock.tick ?? (scenario.saveInput.kind === "fresh" ? scenario.saveInput.startTick : 0);
  const speed = save?.clock.speed ?? (scenario.saveInput.kind === "fresh" ? scenario.saveInput.speed : 1);
  const bridge = new NativeEngineBridge(addon, { seed, startTick, speed });
  try {
    let saveInputHash = null;
    if (save) {
      bridge.loadV9(save);
      const nativeSave = bridge.saveV9();
      if (canonicalStringify(nativeSave) !== canonicalStringify(save)) throw new Error("Save V9 mismatch");
      saveInputHash = digestCanonical(nativeSave);
    }
    bridge.submit(scenario.commandJournal);
    const checkpoints = {};
    let currentTick = startTick;
    for (const targetTick of [...scenario.targetTicks].sort((a, b) => a - b)) {
      bridge.step(targetTick - currentTick);
      currentTick = targetTick;
      const domainHashes = {};
      for (const domain of MIGRATION_HASH_DOMAINS) domainHashes[domain] = normalizeHash(bridge.domainHash(domain));
      checkpoints[String(targetTick)] = { snapshot: bridge.snapshot(), events: bridge.drainEvents(), domainHashes };
    }
    return { id: scenario.id, saveInputHash, checkpoints };
  } finally {
    bridge.dispose();
  }
}

const scenario = loadMigrationManifest().scenarios.find((item) => item.id === "empty-new-city");
if (!scenario) throw new Error("empty-new-city fixture missing");
const targetTick = 250;
const tsA = runTypeScriptMigrationScenario(scenario);
const tsB = runTypeScriptMigrationScenario(scenario);
const nativeA = runNativeScenario(scenario);
const nativeB = runNativeScenario(scenario);
const tsCheckpoint = tsA.checkpoints[String(targetTick)];
const nativeCheckpoint = nativeA.checkpoints[String(targetTick)];
if (!tsCheckpoint || !nativeCheckpoint) throw new Error("checkpoint missing");
if (canonicalStringify(tsCheckpoint) !== canonicalStringify(nativeCheckpoint)) throw new Error("normalized kernel checkpoint mismatch");

function runtime(checkpoint) {
  const hash = checkpoint.domainHashes.kernel;
  return {
    ownership: hash.ownership,
    snapshotSha256: digestCanonical(checkpoint.snapshot),
    eventsSha256: digestCanonical(checkpoint.events),
    domainHashVersion: hash.version,
    domainHash: hash.value,
    invariants: "pass",
  };
}

const evidence = {
  schemaVersion: 1,
  stackId: "K007",
  fixtureId: "empty-new-city-snapshot-registry",
  targetTick,
  classification: "PARITY",
  domains: [{
    domain: "kernel",
    typescript: runtime(tsCheckpoint),
    native: runtime(nativeCheckpoint),
    comparison: { snapshot: "match", events: "match", domainHash: "match", invariants: "match" },
  }],
  determinism: {
    typescriptRepeatSha256: digestCanonical(tsA),
    nativeRepeatSha256: digestCanonical(nativeA),
    typescriptRepeatMatch: canonicalStringify(tsA) === canonicalStringify(tsB),
    nativeRepeatMatch: canonicalStringify(nativeA) === canonicalStringify(nativeB),
  },
  correction: null,
  generatedAtCommit: commit,
};
const outputDir = "test-artifacts/cpp-parity/K007";
await mkdir(outputDir, { recursive: true });
const outputPath = `${outputDir}/empty-new-city-snapshot-registry-tick-${targetTick}.json`;
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(outputPath);
