import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLASSIFICATION = new Set(["PARITY", "CORRECTION", "DEFERRED"]);
const COMPARISON = new Set(["match", "mismatch", "not_applicable"]);
const OWNERSHIP = new Set(["owned", "unowned"]);

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const UNSIGNED = /^(0|[1-9][0-9]*)$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateRuntime(runtime, prefix) {
  assert(OWNERSHIP.has(runtime?.ownership), `${prefix}.ownership invalid`);
  assert(
    SHA256.test(runtime?.snapshotSha256 ?? ""),
    `${prefix}.snapshotSha256 invalid`,
  );
  assert(
    SHA256.test(runtime?.eventsSha256 ?? ""),
    `${prefix}.eventsSha256 invalid`,
  );
  assert(
    Number.isInteger(runtime?.domainHashVersion) &&
      runtime.domainHashVersion >= 1,
    `${prefix}.domainHashVersion invalid`,
  );
  assert(
    UNSIGNED.test(runtime?.domainHash ?? ""),
    `${prefix}.domainHash invalid`,
  );
  assert(
    runtime?.invariants === "pass" || runtime?.invariants === "fail",
    `${prefix}.invariants invalid`,
  );
}

function validateComparison(comparison, prefix) {
  for (const key of ["snapshot", "events", "domainHash", "invariants"]) {
    assert(COMPARISON.has(comparison?.[key]), `${prefix}.${key} invalid`);
  }
}

export function validateEvidence(evidence) {
  assert(evidence?.schemaVersion === 1, "schemaVersion must equal 1");
  assert(
    typeof evidence?.stackId === "string" && evidence.stackId.length > 0,
    "stackId required",
  );
  assert(
    typeof evidence?.fixtureId === "string" && evidence.fixtureId.length > 0,
    "fixtureId required",
  );
  assert(
    Number.isInteger(evidence?.targetTick) && evidence.targetTick >= 0,
    "targetTick invalid",
  );
  assert(
    CLASSIFICATION.has(evidence?.classification),
    "classification invalid",
  );
  assert(
    Array.isArray(evidence?.domains) && evidence.domains.length > 0,
    "domains required",
  );
  assert(
    COMMIT.test(evidence?.generatedAtCommit ?? ""),
    "generatedAtCommit invalid",
  );

  assert(
    SHA256.test(evidence?.determinism?.typescriptRepeatSha256 ?? ""),
    "typescript repeat SHA invalid",
  );
  assert(
    SHA256.test(evidence?.determinism?.nativeRepeatSha256 ?? ""),
    "native repeat SHA invalid",
  );
  assert(
    typeof evidence?.determinism?.typescriptRepeatMatch === "boolean",
    "typescriptRepeatMatch invalid",
  );
  assert(
    typeof evidence?.determinism?.nativeRepeatMatch === "boolean",
    "nativeRepeatMatch invalid",
  );

  const seenDomains = new Set();

  for (const entry of evidence.domains) {
    assert(
      typeof entry?.domain === "string" && entry.domain.length > 0,
      "domain name required",
    );
    assert(!seenDomains.has(entry.domain), `duplicate domain ${entry.domain}`);
    seenDomains.add(entry.domain);

    validateRuntime(entry.typescript, `${entry.domain}.typescript`);
    validateRuntime(entry.native, `${entry.domain}.native`);
    validateComparison(entry.comparison, `${entry.domain}.comparison`);

    if (evidence.classification === "PARITY") {
      assert(
        entry.typescript.ownership === "owned",
        `${entry.domain}: TS must be owned for PARITY`,
      );
      assert(
        entry.native.ownership === "owned",
        `${entry.domain}: native must be owned for PARITY`,
      );
      for (const value of Object.values(entry.comparison)) {
        assert(value === "match", `${entry.domain}: PARITY comparison must match`);
      }
    }

    if (evidence.classification === "DEFERRED") {
      assert(
        entry.native.ownership === "unowned",
        `${entry.domain}: DEFERRED native ownership must be unowned`,
      );
      assert(
        entry.native.domainHash === "0",
        `${entry.domain}: DEFERRED native hash must be zero`,
      );
      for (const value of Object.values(entry.comparison)) {
        assert(
          value === "not_applicable",
          `${entry.domain}: DEFERRED comparisons must be not_applicable`,
        );
      }
    }
  }

  assert(
    evidence.determinism.typescriptRepeatMatch,
    "TypeScript repeat determinism failed",
  );
  assert(
    evidence.determinism.nativeRepeatMatch,
    "Native repeat determinism failed",
  );

  if (evidence.classification === "CORRECTION") {
    assert(
      typeof evidence?.correction?.issue === "string" &&
        evidence.correction.issue.length > 0,
      "CORRECTION issue required",
    );
    assert(
      typeof evidence?.correction?.regressionTest === "string" &&
        evidence.correction.regressionTest.length > 0,
      "CORRECTION regressionTest required",
    );
    assert(
      typeof evidence?.correction?.rationale === "string" &&
        evidence.correction.rationale.length > 0,
      "CORRECTION rationale required",
    );
  } else {
    assert(
      evidence.correction === null,
      "correction must be null unless classification is CORRECTION",
    );
  }

  return true;
}

async function main() {
  const path = process.argv[2];

  if (!path) {
    throw new Error(
      "Usage: node scripts/cpp/parity-evidence.mjs <evidence.json>",
    );
  }

  const evidence = JSON.parse(await readFile(path, "utf8"));
  validateEvidence(evidence);
  console.log(`Parity evidence valid: ${path}`);
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  await main();
}
