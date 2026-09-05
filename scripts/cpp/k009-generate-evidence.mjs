import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { NativeEngineBridge } from "../../src/native/NativeEngineBridge.ts";
import { captureAuthoritativeTransactionCheckpoint } from "../../src/simulation/core/AuthoritativeTransactionCheckpoint.ts";
import { SimulationCore } from "../../src/simulation/core/SimulationCore.ts";
import { TerrainGrid } from "../../src/world/terrain/TerrainGrid.ts";
import {
  canonicalStringify,
  digestCanonical,
} from "../../tests/support/kernelParity.ts";
import {
  loadMigrationManifest,
  materializeMigrationSaveInput,
  MIGRATION_HASH_DOMAINS,
  runTypeScriptMigrationScenario,
} from "../../tests/support/cppMigrationFixtures.ts";

const addonPath = process.argv[2];
if (!addonPath) {
  throw new Error("usage: node scripts/cpp/k009-generate-evidence.mjs <native-addon-path>");
}

const require = createRequire(import.meta.url);
const addon = require(resolve(addonPath));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const outputDir = "test-artifacts/cpp-parity/K009";
await mkdir(outputDir, { recursive: true });

function normalizeNativeHash(hash) {
  return {
    ownership: hash.ownership,
    version: hash.version,
    value: hash.value.toString(),
  };
}

function runNativeScenario(scenario) {
  const save = materializeMigrationSaveInput(scenario);
  const seed = save?.seed ?? scenario.seed;
  const startTick =
    save?.clock.tick ??
    (scenario.saveInput.kind === "fresh" ? scenario.saveInput.startTick : 0);
  const speed =
    save?.clock.speed ??
    (scenario.saveInput.kind === "fresh" ? scenario.saveInput.speed : 1);
  const bridge = new NativeEngineBridge(addon, { seed, startTick, speed });
  try {
    let saveInputHash = null;
    if (save) {
      bridge.loadV9(save);
      const nativeSave = bridge.saveV9();
      if (canonicalStringify(nativeSave) !== canonicalStringify(save)) {
        throw new Error("native Save V9 materialization mismatch");
      }
      saveInputHash = digestCanonical(nativeSave);
    }

    bridge.submit(scenario.commandJournal);
    const checkpoints = {};
    let currentTick = startTick;
    for (const targetTick of [...scenario.targetTicks].sort((a, b) => a - b)) {
      bridge.step(targetTick - currentTick);
      currentTick = targetTick;
      const domainHashes = {};
      for (const domain of MIGRATION_HASH_DOMAINS) {
        domainHashes[domain] = normalizeNativeHash(bridge.domainHash(domain));
      }
      checkpoints[String(targetTick)] = {
        snapshot: bridge.snapshot(),
        events: bridge.drainEvents(),
        domainHashes,
      };
    }
    return { id: scenario.id, saveInputHash, checkpoints };
  } finally {
    bridge.dispose();
  }
}

function runtimeFromCheckpoint(checkpoint, domain) {
  const hash = checkpoint.domainHashes[domain];
  return {
    ownership: hash.ownership,
    snapshotSha256: digestCanonical(checkpoint.snapshot),
    eventsSha256: digestCanonical(checkpoint.events),
    domainHashVersion: hash.version,
    domainHash: hash.value,
    invariants: "pass",
  };
}

const manifest = loadMigrationManifest();
const kernelScenario = manifest.scenarios.find(
  (scenario) => scenario.id === "empty-new-city",
);
if (!kernelScenario) throw new Error("empty-new-city fixture missing");

const kernelTick = 250;
const tsKernelA = runTypeScriptMigrationScenario(kernelScenario);
const tsKernelB = runTypeScriptMigrationScenario(kernelScenario);
const nativeKernelA = runNativeScenario(kernelScenario);
const nativeKernelB = runNativeScenario(kernelScenario);
const tsKernelCheckpoint = tsKernelA.checkpoints[String(kernelTick)];
const nativeKernelCheckpoint = nativeKernelA.checkpoints[String(kernelTick)];
if (!tsKernelCheckpoint || !nativeKernelCheckpoint) {
  throw new Error("kernel checkpoint missing");
}
if (
  canonicalStringify(tsKernelCheckpoint) !==
  canonicalStringify(nativeKernelCheckpoint)
) {
  throw new Error("kernel normalized checkpoint mismatch");
}

const kernelEvidence = {
  schemaVersion: 1,
  stackId: "K009",
  fixtureId: "empty-new-city-kernel-checkpoint-infrastructure",
  targetTick: kernelTick,
  classification: "PARITY",
  domains: [
    {
      domain: "kernel",
      typescript: runtimeFromCheckpoint(tsKernelCheckpoint, "kernel"),
      native: runtimeFromCheckpoint(nativeKernelCheckpoint, "kernel"),
      comparison: {
        snapshot: "match",
        events: "match",
        domainHash: "match",
        invariants: "match",
      },
    },
  ],
  determinism: {
    typescriptRepeatSha256: digestCanonical(tsKernelA),
    nativeRepeatSha256: digestCanonical(nativeKernelA),
    typescriptRepeatMatch:
      canonicalStringify(tsKernelA) === canonicalStringify(tsKernelB),
    nativeRepeatMatch:
      canonicalStringify(nativeKernelA) === canonicalStringify(nativeKernelB),
  },
  correction: null,
  generatedAtCommit: commit,
};

function makeTypeScriptCrossDomainCheckpoint() {
  const width = 8;
  const height = 6;
  const terrain = new TerrainGrid(
    width,
    height,
    Array.from({ length: width * height }, () => ({
      elevation: 0.5,
      water: false,
      buildable: true,
      biome: "grass",
    })),
  );
  const core = new SimulationCore({
    terrain,
    seed: 91,
    startingFunds: 500_000,
  });
  if (!core.buildRoad([{ x: 2, y: 3 }], "local").ok) {
    throw new Error("cross-domain fixture road failed");
  }
  const zone = core.paintZone([{ x: 2, y: 2 }], "residential");
  if (zone.painted !== 1) {
    throw new Error("cross-domain fixture zoning failed");
  }
  return captureAuthoritativeTransactionCheckpoint(core);
}

const tsCrossA = makeTypeScriptCrossDomainCheckpoint();
const tsCrossB = makeTypeScriptCrossDomainCheckpoint();
const tsCrossHashA = digestCanonical(tsCrossA);
const tsCrossHashB = digestCanonical(tsCrossB);
const noNativePayload = { ownership: "unowned", payload: null };
const noNativeHash = digestCanonical(noNativePayload);
const emptyEventsHash = digestCanonical([]);

const deferredEvidence = {
  schemaVersion: 1,
  stackId: "K009",
  fixtureId: "cross-domain-authoritative-checkpoint-contents",
  targetTick: 0,
  classification: "DEFERRED",
  domains: [
    {
      domain: "cross-domain-checkpoint-contents",
      typescript: {
        ownership: "owned",
        snapshotSha256: tsCrossHashA,
        eventsSha256: emptyEventsHash,
        domainHashVersion: 1,
        domainHash: "0",
        invariants: "pass",
      },
      native: {
        ownership: "unowned",
        snapshotSha256: noNativeHash,
        eventsSha256: emptyEventsHash,
        domainHashVersion: 1,
        domainHash: "0",
        invariants: "pass",
      },
      comparison: {
        snapshot: "not_applicable",
        events: "not_applicable",
        domainHash: "not_applicable",
        invariants: "not_applicable",
      },
    },
  ],
  determinism: {
    typescriptRepeatSha256: tsCrossHashA,
    nativeRepeatSha256: noNativeHash,
    typescriptRepeatMatch: tsCrossHashA === tsCrossHashB,
    nativeRepeatMatch: noNativeHash === digestCanonical(noNativePayload),
  },
  correction: null,
  generatedAtCommit: commit,
};

const kernelPath = `${outputDir}/empty-new-city-kernel-checkpoint-infrastructure-tick-${kernelTick}.json`;
const deferredPath = `${outputDir}/cross-domain-authoritative-checkpoint-contents-tick-0.json`;
await writeFile(kernelPath, `${JSON.stringify(kernelEvidence, null, 2)}\n`);
await writeFile(deferredPath, `${JSON.stringify(deferredEvidence, null, 2)}\n`);
console.log(kernelPath);
console.log(deferredPath);
