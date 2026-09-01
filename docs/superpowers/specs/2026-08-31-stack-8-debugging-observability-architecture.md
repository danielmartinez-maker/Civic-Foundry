# Stack 8 — Debugging, Observability & Architecture Improvement Design

**Status:** Approved implementation design derived from the Stack 8 execution brief.

## Goal

Harden Civic Foundry’s existing TypeScript authority graph against cross-domain integration failures without changing gameplay semantics, Save V9, or Prism authority.

## Baseline

- Base: `main@6e1b98704635c1c66927453f458cdc6b4ad6877b` (Stack 0 merged).
- Save remains `saveVersion: 9`, `gameVersion: 0.9.0-urban-fabric`.
- `SimulationCore` remains the public compatibility façade.
- `SimulationKernel` remains the deterministic scheduler/orchestrator.
- `WorldFoundation`, `CadastralGraph`, current domain systems, and transitional systems retain their current authority.
- `GpuWorldRenderer` remains presentation-only.
- Prism remains non-authoritative.

## Architecture

Stack 8 adds reusable engineering substrates around accepted owners rather than centralizing domain semantics:

1. **Structured failures** — stable machine-readable codes and deterministic context for architectural failure classes.
2. **Deterministic diagnostics** — stable canonical serialization/hash helpers used only for diagnostics/replay comparisons.
3. **Transaction coordinator** — a narrow participant-based snapshot/restore coordinator with deterministic snapshot order and reverse rollback.
4. **Causal trace** — bounded deterministic engineering trace with stable codes and parent/child relationships.
5. **Revision/invalidation registry** — semantic revisions and explicit cache dependencies; unrelated changes do not invalidate unrelated caches.
6. **Reference-integrity primitives** — duplicate/dangling/stale/non-finite checks at ownership seams, never a second entity authority.
7. **Performance attribution** — per-operation/system call counts, average/P95/max, cache counters, and deterministic test clocks.
8. **Reproduction bundles** — deterministic versioned payloads containing starting tick/hash, command journal, RNG stream states, scheduler manifest, revisions, failure metadata, and optional invariant/performance data.
9. **Read-only runtime diagnostics** — aggregated health snapshot assembled by a narrow service behind `SimulationCore`.
10. **Architecture firewall expansion** — machine-enforced dependency rules and arbitrary-RNG bans for authoritative code.
11. **Developer tooling** — test/CLI helpers for authority hashes, traces, repro export/replay, snapshot comparison, and N-tick profiling.
12. **Reliability harnesses** — deterministic mutation/fuzz fixtures and bounded soak tests with explicit budgets.

## Data flow

```text
Input / Commands
      ↓
SimulationCore façade
      ↓
SimulationKernel
      ↓
Authoritative domain services
      ↓
Validated transactions
      ↓
Snapshots / events / revisions
      ↓
Read-only diagnostics + presentation projections
      ↓
Renderer

Prism mirror (parallel/read-only; no mutation path)
```

## Failure model

Structured failure categories:

- `InvariantViolation`
- `ReferenceIntegrityFailure`
- `TransactionFailure`
- `HydrationFailure`
- `DeterminismFailure`
- `SchedulingFailure`
- `TopologyReconciliationFailure`
- `ConservationFailure`
- `RendererSynchronizationFailure`
- `AssetRuntimeFailure`
- `CompatibilityBoundaryFailure`
- `ExternalRuntimeFailure`

Failures carry a stable code, category, domain, operation, tick, optional command/entity/revision/save metadata, and optional causal parent. Ordinary exceptions remain valid for local programming errors; the kernel normalizes architectural failures at the orchestration boundary.

## Determinism

Diagnostic infrastructure must not consume RNG or mutate authority. Canonical serialization sorts object keys, preserves array order, rejects unsupported/non-finite values, and contains no wall-clock timestamps. Repro bundle ordering and hashes therefore remain deterministic.

## Transactions

Participants own their snapshots and restore semantics. The coordinator owns only orchestration. Participant IDs are unique and sorted for capture; rollback is reverse capture order. A rollback failure is fail-stop and surfaced as `TransactionFailure`. Renderer/presentation code cannot register transaction participants.

## Scheduler contracts

Kernel system declarations extend the existing read/write/cadence contract with optional named RNG streams, emitted event types, invariant expectations, and performance budgets. Scheduler compilation continues to reject ambiguous read/write and write/write conflicts and exposes a stable manifest for diagnostics/replay.

## Revisions and caches

A semantic revision increments only when its owning authority reports a meaningful change. Derived caches declare revision dependencies and record the last observed revision vector. Diagnostics can explain each rebuild using stable invalidation codes.

## Diagnostics and performance

`SimulationDiagnosticsService` reads accepted domain APIs and snapshots; it never mutates. Kernel performance attribution wraps system execution and reports calls/avg/P95/max. Domain-specific profiling can use the same collector without coupling domains to the UI or renderer.

## Persistence / replay

No Save V10. Save V9 serialization/hydration remains unchanged. Stack 8 replay tooling accepts existing Save V9 plus ordered commands/ticks and compares deterministic authority hashes at checkpoints. Invalid hydration continues to fail before live mutation under Stack 0’s hardened validators.

## Resource lifecycle

Stack 8’s core changes are simulation-side and allocate bounded in-memory diagnostic structures. Browser/GPU lifecycle work is limited to read-only diagnostics and firewall verification unless a directly reproduced leak requires a focused fix; gameplay presentation semantics are unchanged.

## SimulationCore decomposition

Use a strangler approach: diagnostics, replay, hashing, and transaction orchestration live in narrow services/modules. `SimulationCore` exposes those services rather than absorbing their implementation. Existing public gameplay APIs remain compatible.

## Acceptance evidence

Implementation must add focused regressions for failure normalization, transaction rollback, repro determinism, scheduler contracts, revisions, reference integrity, numeric safety, causal trace, diagnostics, performance attribution, architecture firewall, deterministic fuzzing, and bounded soak/replay continuation. Exact-head `npm run verify` plus all current browser/visual CI smokes are mandatory before PASS status.
