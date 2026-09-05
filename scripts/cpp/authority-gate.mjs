import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const STATE = new Set([
  "typescript_authoritative",
  "shadow",
  "parity_accepted",
  "native_authoritative",
  "typescript_removed",
]);

const OWNERSHIP = new Set(["owned", "unowned"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateAuthorityState(registry) {
  assert(registry?.schemaVersion === 1, "schemaVersion must equal 1");
  assert(
    registry?.domains && typeof registry.domains === "object",
    "domains required",
  );

  for (const [domain, record] of Object.entries(registry.domains)) {
    assert(STATE.has(record?.state), `${domain}.state invalid`);
    assert(
      OWNERSHIP.has(record?.runtimeNativeOwnership),
      `${domain}.runtimeNativeOwnership invalid`,
    );
    assert(
      typeof record?.typescriptMutationAllowed === "boolean",
      `${domain}.typescriptMutationAllowed invalid`,
    );

    if (record.state === "typescript_authoritative") {
      assert(
        record.runtimeNativeOwnership === "unowned",
        `${domain}: TS-authoritative domain must remain native-unowned`,
      );
      assert(
        record.typescriptMutationAllowed === true,
        `${domain}: TS-authoritative domain must allow TS mutation`,
      );
    }

    if (record.state === "shadow") {
      assert(
        record.typescriptMutationAllowed === true,
        `${domain}: shadow must preserve TS gameplay authority`,
      );
    }

    if (record.state === "parity_accepted") {
      assert(
        typeof record.evidence === "string" && record.evidence.length > 0,
        `${domain}: parity_accepted requires evidence`,
      );
      assert(
        record.typescriptMutationAllowed === true,
        `${domain}: parity_accepted has not cut over yet`,
      );
    }

    if (record.state === "native_authoritative") {
      assert(
        record.runtimeNativeOwnership === "owned",
        `${domain}: native_authoritative requires native owned`,
      );
      assert(
        record.typescriptMutationAllowed === false,
        `${domain}: native_authoritative forbids TS mutation`,
      );
      assert(
        typeof record.evidence === "string" && record.evidence.length > 0,
        `${domain}: native_authoritative requires evidence`,
      );
    }

    if (record.state === "typescript_removed") {
      assert(
        record.runtimeNativeOwnership === "owned",
        `${domain}: removed TS implementation requires native owned`,
      );
      assert(
        record.typescriptMutationAllowed === false,
        `${domain}: removed TS implementation cannot mutate`,
      );
      assert(
        typeof record.evidence === "string" && record.evidence.length > 0,
        `${domain}: removed TS implementation requires evidence`,
      );
    }
  }

  return true;
}

export function validateTransition({ before, after }) {
  const order = [
    "typescript_authoritative",
    "shadow",
    "parity_accepted",
    "native_authoritative",
    "typescript_removed",
  ];

  const beforeIndex = order.indexOf(before.state);
  const afterIndex = order.indexOf(after.state);

  assert(beforeIndex >= 0 && afterIndex >= 0, "invalid transition state");

  if (afterIndex < beforeIndex) {
    throw new Error(
      `authority transition may not move backward: ${before.state} -> ${after.state}`,
    );
  }

  if (afterIndex - beforeIndex > 1) {
    throw new Error(
      `authority transition may not skip gates: ${before.state} -> ${after.state}`,
    );
  }

  return true;
}

async function main() {
  const path = process.argv[2] ?? "docs/cpp/NATIVE_AUTHORITY_STATE.json";
  const registry = JSON.parse(await readFile(path, "utf8"));

  validateAuthorityState(registry);
  console.log(`Native authority registry valid: ${path}`);
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  await main();
}
