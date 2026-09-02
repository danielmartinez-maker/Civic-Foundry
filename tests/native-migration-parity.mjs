import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { NativeEngineBridge } from "../src/native/NativeEngineBridge.ts";
import { canonicalStringify, digestCanonical } from "./support/kernelParity.ts";
import {
  loadMigrationManifest,
  materializeMigrationSaveInput,
  MIGRATION_HASH_DOMAINS,
  runTypeScriptMigrationScenario,
} from "./support/cppMigrationFixtures.ts";

const require = createRequire(import.meta.url);
const addon = require(resolve(process.argv[2]));
const manifest = loadMigrationManifest();
const STACK1_URBAN_AUTHORITY_DOMAINS = Object.freeze([
  "cadastre",
  "zoning",
  "buildings",
  "property",
]);
const STACK1_PRIVATE_HASH_DOMAINS = new Set(["cadastre", "buildings"]);

function firstMismatch(left, right, path = "") {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${path}/length: ${left.length} !== ${right.length}`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const mismatch = firstMismatch(
        left[index],
        right[index],
        `${path}/${index}`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    const keyMismatch = firstMismatch(leftKeys, rightKeys, `${path}/$keys`);
    if (keyMismatch) return keyMismatch;
    for (const key of leftKeys) {
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      const mismatch = firstMismatch(
        left[key],
        right[key],
        `${path}/${escaped}`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  return `${path || "/"}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
}

function assertSame(left, right, label) {
  const mismatch = firstMismatch(left, right);
  assert.equal(mismatch, undefined, `${label}: first mismatch at ${mismatch}`);
}

function normalizeNativeHash(hash) {
  return {
    ownership: hash.ownership,
    version: hash.version,
    value: hash.value.toString(),
  };
}

function assertStack1UrbanAuthority(bridge, scenario, targetTick) {
  const expectedOwnership =
    scenario.saveInput.kind === "v9" ? "owned" : "unowned";
  for (const domain of STACK1_URBAN_AUTHORITY_DOMAINS) {
    const hash = normalizeNativeHash(bridge.domainHash(domain));
    assert.equal(
      hash.ownership,
      expectedOwnership,
      `${scenario.id} native ${domain} ownership at tick ${targetTick}`,
    );
    assert.equal(
      hash.version,
      1,
      `${scenario.id} native ${domain} hash version at tick ${targetTick}`,
    );
  }
}

function normalizeCrossLanguageComparable(result) {
  return {
    ...result,
    checkpoints: Object.fromEntries(
      Object.entries(result.checkpoints).map(([tick, checkpoint]) => [
        tick,
        {
          ...checkpoint,
          domainHashes: Object.fromEntries(
            Object.entries(checkpoint.domainHashes).map(([domain, hash]) => [
              domain,
              STACK1_PRIVATE_HASH_DOMAINS.has(domain)
                ? { ...hash, ownership: "unowned", value: "0" }
                : hash,
            ]),
          ),
        },
      ]),
    ),
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
      assertSame(
        nativeSave,
        save,
        `${scenario.id} native Save V9 materialization`,
      );
      saveInputHash = digestCanonical(nativeSave);
    }

    bridge.submit(scenario.commandJournal);
    const checkpoints = {};
    let currentTick = startTick;
    for (const targetTick of [...scenario.targetTicks].sort((a, b) => a - b)) {
      assert.ok(
        targetTick >= currentTick,
        `${scenario.id} target tick ${targetTick} precedes ${currentTick}`,
      );
      bridge.step(targetTick - currentTick);
      currentTick = targetTick;
      assertStack1UrbanAuthority(bridge, scenario, targetTick);
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

for (const scenario of manifest.scenarios) {
  const expected = runTypeScriptMigrationScenario(scenario);
  const actual = runNativeScenario(scenario);
  assertSame(
    normalizeCrossLanguageComparable(actual),
    expected,
    `${scenario.id} TypeScript/native shadow parity`,
  );
  assert.equal(
    canonicalStringify(runNativeScenario(scenario)),
    canonicalStringify(actual),
    `${scenario.id} native repeated run must be byte-identical`,
  );
}

console.log(
  `Native migration fixture parity passed for ${manifest.scenarios.length} scenarios.`,
);
