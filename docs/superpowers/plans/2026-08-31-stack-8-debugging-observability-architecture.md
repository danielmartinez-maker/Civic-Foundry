# Stack 8 Debugging, Observability & Architecture Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or equivalent TDD execution. Steps use checkbox syntax for tracking.

**Goal:** Add deterministic cross-domain debugging, observability, replay, transaction, reference-integrity, revision, performance, and architecture-firewall infrastructure without changing gameplay semantics or Save V9.

**Architecture:** Extend the existing `SimulationKernel` and `SimulationCore` façade with narrow engineering services. Reuse Stack 0’s accepted authoritative checkpoint/rollback model; do not centralize domain semantics or create duplicate authority. Keep all diagnostic data observational and deterministic.

**Tech Stack:** TypeScript 5.8.3, Node 22 built-in test runner, ES modules, existing GitHub Actions browser/visual smoke suite.

**Spec:** `docs/superpowers/specs/2026-08-31-stack-8-debugging-observability-architecture.md`

## Global Constraints

- Preserve Save V9 (`saveVersion: 9`, `gameVersion: 0.9.0-urban-fabric`).
- Preserve gameplay semantics and current authoritative owners.
- Prism remains non-authoritative.
- Renderer diagnostics remain observational.
- Diagnostic instrumentation consumes no simulation RNG and performs no simulation mutation.
- No Save V10, no ECS rewrite, no new gameplay systems.
- All deterministic payloads use stable ordering and exclude wall-clock data.
- All production changes are introduced test-first.

---

### Task 1: RED contracts for the Stack 8 substrate

**Files:**
- Create: `tests/stack8-debugging-architecture.test.ts`
- Modify: `tests/architecture_policy.test.ts`

**Interfaces under test:**
- `EngineFailure`, `engineFailure`, `normalizeEngineFailure`
- `stableStringify`, `deterministicHash`
- `TransactionCoordinator`
- `CausalTraceBuffer`
- `RevisionRegistry`
- `ReferenceIntegrityValidator`
- `PerformanceAttribution`
- `createReproBundle`, `serializeReproBundle`, `replayReproBundle`
- `assertFiniteNumber`, `assertFiniteRecord`
- `SimulationKernel.schedulerManifest()`, `SimulationKernel.lastFailure()`, extended diagnostics
- architecture firewall checks for renderer→mutation internals and `Math.random` in authoritative code

- [ ] Add minimal behavior-focused tests for each interface.
- [ ] Commit tests before implementation.
- [ ] Open a draft PR and confirm CI fails because Stack 8 modules/APIs do not yet exist or contracts are unmet.

### Task 2: Structured failures and deterministic diagnostics primitives

**Files:**
- Create: `src/simulation/diagnostics/EngineFailure.ts`
- Create: `src/simulation/diagnostics/DeterministicDiagnostics.ts`
- Create: `src/simulation/diagnostics/NumericSafety.ts`

**Produces:**
- Stable `EngineFailureCategory` union and immutable `EngineFailureMetadata`.
- `EngineFailure` carrying stable code/category/domain/operation/tick/context and optional cause.
- Canonical recursive serializer with sorted object keys and preserved array order.
- FNV-1a 64-bit diagnostic hash represented as lowercase hex.
- Narrow finite-number assertions that report deterministic ownership paths.

- [ ] Implement minimal code to satisfy RED tests.
- [ ] Ensure helpers import no renderer/UI/app modules and use no RNG.

### Task 3: Generalized deterministic transactions

**Files:**
- Create: `src/simulation/transactions/TransactionCoordinator.ts`
- Modify: `src/simulation/kernel/SimulationKernel.ts`

**Produces:**
- `TransactionParticipant<T>` with `id`, `snapshot`, `restore`.
- `TransactionCoordinator.capture()` with sorted participant IDs.
- `TransactionCoordinator.rollback()` in reverse capture order.
- Duplicate registration rejection.
- Fail-stop `TransactionFailure` on rollback failure.
- Kernel delegates participant capture/rollback to the coordinator while preserving exact Stack 0 semantics.

- [ ] Preserve pre-tick rollback order for clock/commands/events/RNG plus authoritative domains.
- [ ] Increment transaction rollback diagnostics only after successful rollback.
- [ ] Normalize kernel exceptions into structured failure metadata without replacing thrown programmer errors at local call sites.

### Task 4: Scheduler contracts and performance attribution

**Files:**
- Modify: `src/simulation/kernel/KernelTypes.ts`
- Modify: `src/simulation/kernel/SystemScheduler.ts`
- Create: `src/simulation/diagnostics/PerformanceAttribution.ts`
- Modify: `src/simulation/kernel/SimulationKernel.ts`

**Produces:**
- Optional `rngStreams`, `emits`, `invariants`, `performanceBudgetMs` on system definitions.
- Stable scheduler manifest sorted by compiled execution order.
- Stable conflict behavior retained.
- Per-system call count, average, P95, max, over-budget count.
- Injectable monotonic timing source for tests; production defaults to `performance.now()`.

- [ ] Ensure performance measurements never affect scheduling or authoritative results.
- [ ] Include manifest and timings in kernel diagnostics.

### Task 5: Causal trace, revisions, and reference integrity

**Files:**
- Create: `src/simulation/diagnostics/CausalTrace.ts`
- Create: `src/simulation/diagnostics/RevisionRegistry.ts`
- Create: `src/simulation/diagnostics/ReferenceIntegrity.ts`

**Produces:**
- Bounded deterministic ring buffer with monotonically increasing local sequence and optional parent sequence.
- Semantic revisions keyed by stable authority names.
- Cache dependency declarations and explicit invalidation reasons.
- Duplicate/dangling/stale reference validators operating on caller-supplied IDs and predicates only.

- [ ] No global entity registry or second authority.
- [ ] No hot-loop global scans are introduced into gameplay code.

### Task 6: Deterministic reproduction bundles and replay helpers

**Files:**
- Create: `src/simulation/diagnostics/ReproBundle.ts`
- Create: `src/simulation/diagnostics/ReplayDiagnostics.ts`

**Produces:**
- Versioned repro bundle payload with game/save version, starting tick/hash, command sequence, RNG stream state, scheduler manifest, revision vector, optional failure/invariant/performance metadata.
- Deterministic serialization.
- Replay helper contract `bundle -> executor -> same failure code + same pre-failure hash`.
- Snapshot comparison and checkpoint hash helpers.

- [ ] Reject non-finite/unsupported deterministic payload values.
- [ ] Exclude local paths and wall-clock timestamps from deterministic payload.

### Task 7: Read-only SimulationCore diagnostics service

**Files:**
- Create: `src/simulation/diagnostics/SimulationDiagnosticsService.ts`
- Modify: `src/simulation/core/SimulationCore.ts`

**Produces:**
- `core.diagnostics` narrow service.
- Read-only snapshot with kernel state, revisions, core domain counts, selected transport/transit/economy/freight counts, invalid-reference summary, performance metrics, deterministic authority hash.
- Trace/repro export hooks that read existing state only.

- [ ] Do not put diagnostic implementation logic in `SimulationCore`.
- [ ] Use accepted public domain APIs; no renderer dependency.
- [ ] Authority hash uses the existing authoritative transaction checkpoint as diagnostic input and never persists the hash.

### Task 8: Numeric boundary hardening

**Files:**
- Modify only the smallest confirmed boundaries needed by RED/adversarial tests, expected candidates:
  - `src/simulation/traffic/TrafficSystem.ts`
  - freight/service progression boundary modules if tests reproduce non-finite acceptance.

**Produces:**
- Deterministic rejection of NaN/Infinity before authoritative commit or metric poisoning.
- No silent clamping unless existing domain semantics already define clamping.

- [ ] Keep behavior for all finite valid inputs unchanged.

### Task 9: Architecture firewall expansion

**Files:**
- Modify: `scripts/check-architecture.mjs`
- Modify: `tests/architecture_policy.test.ts`

**Produces:**
- Existing layer rules retained.
- Renderer/UI/app cannot import mutation-internal modules designated under simulation transaction/mutation boundaries.
- Prism/native mirrors cannot import TypeScript mutation owners through prohibited paths.
- Authoritative TypeScript (`src/simulation`, `src/world`, `src/save`) fails policy on direct `Math.random()` use.
- Failure output identifies source, forbidden dependency/pattern, and allowed alternative.

- [ ] Keep checks deterministic and repository-local.

### Task 10: Deterministic fuzz, replay, and soak regressions

**Files:**
- Create: `tests/stack8-fuzz-soak.test.ts`

**Produces:**
- Fixed-seed mutation sequence for transaction/revision/reference primitives.
- Kernel injected-exception replay equivalence.
- Save V9 serialize→hydrate→continue authority-hash equivalence using existing save APIs.
- Bounded multi-horizon smoke (short CI horizon plus explicit larger manual horizon metadata).
- Explicit budgets for retained trace size, revision churn, queue depth, and deterministic checkpoint equality.

- [ ] No random CI seed generation.
- [ ] Commit any failing seed as a literal regression fixture.

### Task 11: Architecture baseline, regression matrix, and canonical docs

**Files:**
- Create: `docs/architecture/STACK_8_BASELINE_AND_FAILURE_MAP.md`
- Create: `docs/architecture/STACK_8_REGRESSION_MATRIX.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/SIMULATION.md`

**Produces:**
- Component ownership/read/write/snapshot/restore/revision/RNG/persistence/renderer map.
- Integration-boundary risk map.
- Cache/revision inventory.
- Event classification inventory.
- Resource/lifecycle audit table with explicit owners and deferred presentation-only leak items.
- Permanent cross-domain regression matrix.
- Mermaid/text architecture diagram and Stack 8 diagnostics/repro/transaction documentation.
- Before/after architecture review scores with evidence and remaining debt separated from gameplay scope.

### Task 12: Exact-head verification

**Commands:**
- `npm run verify`
- `npm run test:smoke`
- `npm run test:smoke:phase7`
- `npm run test:smoke:urban-fabric`
- `npm run test:smoke:isometric`
- `python tests/smoke/isometric_visual_smoke.py`

- [ ] Confirm full CI at exact branch head.
- [ ] Confirm Save V9/game version unchanged.
- [ ] Confirm no Prism authority transfer.
- [ ] Confirm branch is not merged without explicit authorization.
