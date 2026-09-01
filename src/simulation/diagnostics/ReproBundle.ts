import { stableStringify } from "./DeterministicDiagnostics.ts";
import { engineFailure } from "./EngineFailure.ts";

export type ReproCommand = Readonly<{
  sequence: number;
  tick: number;
  type: string;
  payload: unknown;
}>;

export type ReproSchedulerSystem = Readonly<{
  id: string;
  cadence: Readonly<{ every: number; offset?: number }>;
  reads: readonly string[];
  writes: readonly string[];
  rngStreams: readonly string[];
  emits: readonly string[];
  invariants?: readonly string[];
  performanceBudgetMs?: number;
}>;

export type ReproBundle = Readonly<{
  bundleVersion: 1;
  gameVersion: string;
  saveVersion: number;
  startingTick: number;
  startingAuthorityHash: string;
  commands: readonly ReproCommand[];
  rngStreams: Readonly<Record<string, number>>;
  schedulerManifest: readonly ReproSchedulerSystem[];
  revisions: Readonly<Record<string, number>>;
  expectedFailureCode?: string;
  preFailureAuthorityHash?: string;
  invariantResults?: Readonly<Record<string, boolean>>;
  performance?: Readonly<Record<string, unknown>>;
}>;

export type ReproBundleInput = Omit<ReproBundle, "bundleVersion"> &
  Readonly<{ bundleVersion?: 1 }>;

function sortedNumberRecord(values: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))),
  );
}

export function createReproBundle(input: ReproBundleInput): ReproBundle {
  const commands = [...input.commands]
    .sort((a, b) => a.sequence - b.sequence || a.tick - b.tick || a.type.localeCompare(b.type))
    .map((command) => Object.freeze({ ...command }));
  const schedulerManifest = input.schedulerManifest.map((system) =>
    Object.freeze({
      ...system,
      cadence: Object.freeze({ ...system.cadence }),
      reads: Object.freeze([...system.reads]),
      writes: Object.freeze([...system.writes]),
      rngStreams: Object.freeze([...system.rngStreams]),
      emits: Object.freeze([...system.emits]),
      invariants:
        system.invariants === undefined ? undefined : Object.freeze([...system.invariants]),
    }),
  );
  const bundle: ReproBundle = Object.freeze({
    bundleVersion: 1,
    gameVersion: input.gameVersion,
    saveVersion: input.saveVersion,
    startingTick: input.startingTick,
    startingAuthorityHash: input.startingAuthorityHash,
    commands: Object.freeze(commands),
    rngStreams: sortedNumberRecord(input.rngStreams),
    schedulerManifest: Object.freeze(schedulerManifest),
    revisions: sortedNumberRecord(input.revisions),
    expectedFailureCode: input.expectedFailureCode,
    preFailureAuthorityHash: input.preFailureAuthorityHash,
    invariantResults: input.invariantResults,
    performance: input.performance,
  });
  stableStringify(bundle);
  return bundle;
}

export function serializeReproBundle(bundle: ReproBundle): string {
  return stableStringify(bundle);
}

export type ReproReplayResult = Readonly<{
  failureCode?: string;
  preFailureAuthorityHash: string;
}>;

export function replayReproBundle(
  bundle: ReproBundle,
  executor: (bundle: ReproBundle) => ReproReplayResult,
): ReproReplayResult {
  const result = executor(bundle);
  if (
    bundle.expectedFailureCode !== undefined &&
    result.failureCode !== bundle.expectedFailureCode
  ) {
    throw engineFailure(
      {
        code: "repro-failure-code-mismatch",
        category: "DeterminismFailure",
        domain: "replay",
        operation: "replay-repro-bundle",
        tick: bundle.startingTick,
      },
      `expected failure code ${bundle.expectedFailureCode}, got ${result.failureCode ?? "none"}`,
    );
  }
  if (
    bundle.preFailureAuthorityHash !== undefined &&
    result.preFailureAuthorityHash !== bundle.preFailureAuthorityHash
  ) {
    throw engineFailure(
      {
        code: "repro-authority-hash-mismatch",
        category: "DeterminismFailure",
        domain: "replay",
        operation: "replay-repro-bundle",
        tick: bundle.startingTick,
      },
      `expected pre-failure authority hash ${bundle.preFailureAuthorityHash}, got ${result.preFailureAuthorityHash}`,
    );
  }
  return Object.freeze({ ...result });
}
