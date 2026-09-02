# Testing — Civic Foundry Acceptance Contract

The permanent suite/command/platform matrix is `docs/TEST_MATRIX.md`. This document explains the testing architecture and the domain contracts those commands prove.

## Verification commands

### Tier 1 — fast

```bash
npm run verify:fast
```

Runs changed-file formatting, ESLint, repository policy, architecture policy, production TypeScript typecheck, test/tooling TypeScript typecheck, the complete Node test suite, and asset repository policy.

### Compatibility core gate

```bash
npm run verify
```

Runs the fast tier plus deterministic atlas/source validation and the production build.

### Tier 2 — full portable

```bash
npm run verify:full
```

This is the preferred portable completion gate. It runs the compatibility core gate and then the portable browser/visual acceptance stack:

```bash
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

`npm run test:smoke:portable` is the canonical aggregate for those browser/visual suites. CI decomposes `verify:full` into the same constituent steps so cheap deterministic failures occur before Chromium installation while local and CI acceptance remain semantically aligned.

### Supply-chain audit

```bash
npm run security:audit
```

This network-backed npm audit is separate from `verify:fast` so the inner loop remains usable without registry access. Canonical CI runs it before browser setup.

### Tier 3 — platform / infrastructure

Tier 3 is reserved for checks that genuinely require a non-portable environment, including Windows packaging/launch, GitHub administrative rules, and future native/GPU checks that cannot execute in the portable Linux/browser environment. Ordinary browser and visual smoke tests are not CI-only.

## TypeScript test compilation

Production and tests intentionally use separate compiler projects:

- `tsconfig.json` validates production `src/**/*.ts`;
- `tsconfig.tests.json` validates `tests/**/*.ts` and imported repository MJS tooling with `noEmit`.

Node strip-types execution is not treated as a replacement for test type safety. Both `npm run typecheck` and `npm run typecheck:tests` are required by the fast gate.

## Test classes

Civic Foundry tests are classified by contract rather than runner alone.

### Unit

Pure deterministic formulas, geometry, rules, validation, transitions, serialization helpers, and small utilities.

### Invariant

Conservation and integrity conditions such as no negative conserved weight, inventory/freight conservation, occupancy not exceeding capacity, no conflicting ownership, valid parcel/building references, cadastral topology/lineage validity, and no double-booked scarce service units.

### Deterministic replay / continuation

Equivalent authoritative save state, seed, and ordered commands must produce equivalent authoritative future state.

### Persistence and migration

Save V9 tests cover current Urban Fabric round-trip, corruption/reference rejection, deterministic continuation, and historical-format migration. Save V8 remains an explicit historical World Foundation envelope rather than being silently repurposed as V9.

### Compatibility oracle

Transitional systems preserve accepted behavior while a replacement is being built. A replacement must earn authority through parity and migration gates before compatibility code is retired.

### Integration

Cross-domain causal boundaries, especially cadastre ↔ lots/buildings/property, development ↔ economy/housing, transportation ↔ transit/services, freight ↔ inventory, save payloads ↔ live invariants, and simulation state ↔ presentation.

### Browser smoke

Compiled application behavior that Node-only tests cannot prove, including UI event ordering, canvas/picking behavior, overlay integration, save/load through compiled modules, runtime asset loading, and browser console/page errors.

### Visual smoke

Deterministic presentation scenes and interaction expectations. Visual checks remain downstream of static/unit/build gates and produce diagnostic evidence on failure.

### Performance

Fixed deterministic scenarios measure budgets separately from correctness assertions. Performance failures must not be disguised by weakening functional tests.

### Architecture / repository policy

Machine-enforced engineering contracts such as source dependency boundaries, forbidden generated output, large-file policy, formatting scope, and repository safety rules.

### Asset pipeline

Source policy, deterministic generation/validation, manifest/reference integrity, and runtime atlas readiness.

### Native Prism

No Rust workspace is present on current `main`. Prism-native/Rust checks remain branch-specific while Prism is a non-authoritative mirror/target program. They become a permanent mainline contract only after an accepted native workspace is integrated.

## Urban Fabric and Save V9 acceptance

The existing Node suite retains accepted Urban Fabric and World Foundation contracts, including cadastral topology/mutations, dimensional zoning, massing/development, lifecycle/redevelopment, property holdings, world foundation invariants, deterministic continuation, and adversarial persistence validation.

Current persistence remains:

```text
saveVersion: 9
gameVersion: 0.9.0-urban-fabric
```

Tests require exact Urban Fabric round-trip, deterministic continuation, deterministic V8 → V9 migration, no fabricated legal/property history, valid live parcel references, historical transaction lineage, mutation → save → hydrate → continue integrity, explicit Save V8 compatibility, and World Foundation restoration before dependent legacy gameplay construction.

Stack 8 changes no save field, save version, hydration authority, or migration semantics.

## Urban Fabric browser smoke

`tests/smoke/urban_fabric_smoke.py` boots the compiled application and verifies the live authority/presentation/save boundary. The deterministic scenario builds a real road and residential district, establishes required utilities, advances live simulation, requires canonical cadastral/building state, exercises cadastre/zoning overlays and picking, serializes the public save API, verifies Save V9 identity, hydrates, and confirms canonical parcel/building IDs remain stable.

This smoke is a permanent required component of `npm run test:smoke:portable`.

## CI behavior

`.github/workflows/ci.yml` is the single permanent workflow. Its canonical required job is `acceptance`.

Order is deliberate:

1. checkout with history needed for changed-file policy;
2. Node 22 setup and lockfile install;
3. fast deterministic verification;
4. network-backed dependency security audit;
5. Playwright/Pillow/Chromium setup;
6. deterministic asset source validation;
7. production build;
8. portable browser/visual acceptance;
9. diagnostic artifact upload on failure when `test-artifacts/` exists.

The browser setup and full smoke stack therefore do not run when formatting/type/policy/unit checks can fail first.

## Failure ownership

A required failure is evidence against the exact commit or PR merge ref under test. Do not mark a failing test as infrastructure without specific evidence. Diagnostic artifacts are preserved for failed runs when generated.

Historical feature-head CI remains evidence for the commit it actually tested. It must not be presented as evidence for a later state that did not execute that run.

## Completion rule

A tranche may be called green only after:

1. its relevant RED/contract failure was observed when test-first work applies;
2. the minimal implementation passes the focused test;
3. required fast checks pass;
4. required portable build/browser/visual checks pass;
5. platform-specific checks pass where they genuinely apply;
6. documentation reflects current authority and commands;
7. fresh exact-head CI evidence is read before claiming completion.

## Stack 8 architecture-hardening acceptance

Stack 8 adds permanent tests for engineering behavior rather than gameplay behavior. The focused suite is split by failure class:

- `tests/stack8-debugging-architecture.test.ts` — structured failures, deterministic serialization/hashing, transaction ordering and fail-stop rollback, causal trace, semantic revisions, reference-integrity primitives, performance attribution, repro bundles, scheduler contracts, and kernel failure diagnostics;
- `tests/stack8-core-diagnostics.test.ts` — renderer-independent `SimulationCore` health snapshot, selected BuildingV2/property reference-integrity summary, deterministic authority hashing, and proof that trace observations do not change authority;
- `tests/stack8-replay-diagnostics.test.ts` — deterministic snapshot comparison/assertion and N-tick profiling with an injected monotonic clock;
- `tests/stack8-numeric-safety.test.ts` — NaN/Infinity rejection at confirmed traffic authority boundaries before mutation;
- `tests/stack8-fuzz-soak.test.ts` — Save V9 continuation equivalence, fixed-seed transaction/revision fuzzing, bounded diagnostics, and deterministic checkpoint equivalence;
- `tests/stack8-presentation-lifecycle.test.ts` — explicit RAF/listener/timer/UI/GPU teardown ownership;
- `tests/architecture_policy.test.ts` — presentation-to-mutation firewall and direct-`Math.random()` ban in authoritative TypeScript.

### Deterministic soak contract

The ordinary Stack 8 CI suite executes two deterministic engine horizons:

- 500 ticks with 100-tick checkpoints;
- 10,000 ticks with 1,000-tick checkpoints.

The same test file records manual synthetic horizons of 100,000 and 1,000,000 ticks for deeper stress. These are engine stress horizons rather than calendar claims because `SimulationClock` currently defines only integer ticks and no canonical tick-to-day conversion.

Every horizon carries explicit budgets for event retention, diagnostic trace retention, command-queue depth, topology revision churn in the no-mutation fixture, and cross-domain invalid references. Twin fixed-seed cores must produce identical deterministic authority hashes at every checkpoint.

### Performance attribution

Performance attribution is diagnostic, not a gameplay feedback loop. Kernel/system measurements use an injectable monotonic clock in deterministic tests; production timing is observational. Stack 8 establishes calls/average/P95/max/over-budget/cache-hit instrumentation and leaves hotspot-specific optimization to measured follow-up work rather than changing simulation semantics speculatively.

No performance speedup is claimed by Stack 8. The before/after change is observability: before Stack 8 the runtime lacked stable per-system attribution; after Stack 8 the kernel can attribute timing and budget violations without feeding timing into simulation authority.

### Exact-head completion

Exact-head Stack 8 completion uses the repository's canonical `npm run verify:full` semantics plus fresh PR CI evidence. The CI workflow separately runs `verify:fast`, dependency audit, asset validation, production build, and `test:smoke:portable`, which is semantically equivalent to the portable completion gate.

No Rust workspace exists in this repository, so Prism-native `cargo` gates are not applicable. Prism remains non-authoritative.
