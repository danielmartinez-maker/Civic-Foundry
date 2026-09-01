import { deterministicHash } from "./DeterministicDiagnostics.ts";
import { engineFailure } from "./EngineFailure.ts";

export type DeterministicSnapshotComparison = Readonly<{
  equal: boolean;
  leftHash: string;
  rightHash: string;
}>;

export function compareDeterministicSnapshots(
  left: unknown,
  right: unknown,
): DeterministicSnapshotComparison {
  const leftHash = deterministicHash(left);
  const rightHash = deterministicHash(right);
  return Object.freeze({ equal: leftHash === rightHash, leftHash, rightHash });
}

export function assertDeterministicSnapshotEquality(
  left: unknown,
  right: unknown,
  operation = "compare-snapshots",
): void {
  const comparison = compareDeterministicSnapshots(left, right);
  if (comparison.equal) return;
  throw engineFailure(
    {
      code: "deterministic-snapshot-mismatch",
      category: "DeterminismFailure",
      domain: "replay",
      operation,
      tick: 0,
    },
    `deterministic snapshot mismatch: ${comparison.leftHash} != ${comparison.rightHash}`,
  );
}

export type TickProfile = Readonly<{
  ticks: number;
  elapsedMs: number;
  averageMsPerTick: number;
  startingAuthorityHash: string;
  finalAuthorityHash: string;
}>;

export function profileTicks(
  options: Readonly<{
    ticks: number;
    step: (ticks: number) => void;
    captureAuthority: () => unknown;
    now?: () => number;
  }>,
): TickProfile {
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new Error("profile tick count must be a non-negative integer");
  }
  const now =
    options.now ??
    (() =>
      typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now()
        : 0);
  const startingAuthorityHash = deterministicHash(options.captureAuthority());
  const started = now();
  options.step(options.ticks);
  const elapsedMs = Math.max(0, now() - started);
  const finalAuthorityHash = deterministicHash(options.captureAuthority());
  return Object.freeze({
    ticks: options.ticks,
    elapsedMs,
    averageMsPerTick: options.ticks === 0 ? 0 : elapsedMs / options.ticks,
    startingAuthorityHash,
    finalAuthorityHash,
  });
}
