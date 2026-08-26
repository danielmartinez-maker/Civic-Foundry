# Civic Foundry 2.0 — Phase 0B Partitioned Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 0B whole-registry rebuilds with deterministic partitioned delta transactions while preserving exact registry/reference semantics, V7 compatibility, save behavior, and same-tick kernel synchronization.

**Architecture:** `LegacyV7EntityProjector` exposes deterministic per-owner partitions. `EntityRegistry` and `EntityReferenceGraph` gain per-kind/source indexes and staged partial updates. `EntityProjection` coordinates all changed partitions as one atomic transaction and keeps the existing full projection path as the correctness oracle.

**Tech Stack:** TypeScript 5.x ES modules, Node 22 built-in test runner with `--experimental-strip-types`, existing `SimulationKernel`, existing V7 authoritative domain APIs, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-phase-0b-partitioned-projection-design.md`

## Global Constraints

- V7 domain systems remain authoritative for gameplay state.
- `entity-registry-sync` still runs after `legacy-v7-city` every kernel tick.
- Registry/reference state after each completed tick must be observationally equivalent to a deterministic full V7 projection.
- Save V7 remains unchanged; no entity registry, partition cache, or graph state is serialized.
- Generation-aware handles and exact historical identity semantics remain unchanged.
- Strong/owned references require active exact targets; weak references never silently retarget.
- Failed synchronization must leave registry, graph, partition cache, unresolved diagnostics, and revision counters unchanged.
- No gameplay formulas, cadence, RNG consumption, routing, economy, transit, housing, service, rendering, or UI behavior changes.
- Canonical ordering uses ordinal comparison only.
- The immutable Phase 0A V7 parity fixture must remain exact.
- Controlled developed-city performance target remains <=5% median regression versus the anchored 1,625.1 ms pre-0B baseline.
- TDD is mandatory for each production behavior change.

---

### Task 1: Minimal partition manifest and per-kind registry index

**Files:**
- Modify: `src/entities/EntityProjection.ts`
- Modify: `src/entities/EntityRegistry.ts`
- Test: `tests/entity-partitioned-projection.test.ts`

**Interfaces:**
- Produces `EntityProjectionPartition` and `commitEntityProjectionPartitions()`.
- Produces `EntityRegistry.preparePartitionProjection(ownedKinds, entities)` and a prepared partial-registry type.
- Preserves `commitEntityProjection()` and `prepareProjection()` unchanged for full-path compatibility.

- [ ] **Step 1: Run the existing partition test and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/entity-partitioned-projection.test.ts
```

Expected: FAIL because `EntityProjectionPartition` and/or `commitEntityProjectionPartitions()` are not implemented.

- [ ] **Step 2: Add the partition contract and manifest validation**

Add to `EntityProjection.ts`:

```ts
export type EntityProjectionPartition = Readonly<{
  id: string;
  ownedKinds: readonly EntityKind[];
  revisionKey: string;
  projection: EntityProjectionData;
}>;
```

Validation rules:
- non-empty partition ID;
- non-empty `ownedKinds`;
- partition IDs unique;
- each `EntityKind` owned by at most one partition;
- every projected entity kind belongs to that partition;
- every reference/unresolved source kind belongs to that partition;
- canonicalize partitions by `id` with `ordinalCompare`.

- [ ] **Step 3: Add the per-kind active registry index**

Add:

```ts
private activeLegacyKeysByKind = new Map<EntityKind, Set<string>>();
```

Add internal helpers that rebuild/update this index only from committed registry state. `preparePartitionProjection()` must read only sets for `ownedKinds`, never iterate `activeByLegacyKey` globally.

Define:

```ts
export type PreparedEntityPartitionProjection = Readonly<{
  ownedKinds: readonly EntityKind[];
  nextActiveByLegacyKey: ReadonlyMap<string, EntityRecord>;
  removedLegacyKeys: readonly string[];
  knownUpdatesByHandleKey: ReadonlyMap<string, EntityRecord>;
  highestGenerationUpdatesByLegacyKey: ReadonlyMap<string, number>;
  baseRevision: number;
}>;
```

- [ ] **Step 4: Implement a minimal two-partition coordinator**

`commitEntityProjectionPartitions()` must:
1. validate/canonicalize the manifest;
2. treat all partitions as changed on first call;
3. stage registry partial updates without mutating live state;
4. resolve references against a staged view that includes all partition entity changes;
5. stage graph state through the existing full graph preparation for this first green step;
6. commit registry and graph only after all preparation succeeds;
7. return total active/reference counts and deterministic unresolved diagnostics.

For this first green step, graph replacement may still use the full graph path. Registry work must already be partition-scoped so the existing 1,000-lot/traffic test proves no global active-map scan.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --experimental-strip-types --test tests/entity-partitioned-projection.test.ts tests/entity-registry.test.ts tests/entity-references.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/EntityProjection.ts src/entities/EntityRegistry.ts tests/entity-partitioned-projection.test.ts
git commit -m "feat: add partitioned entity registry staging"
```

---

### Task 2: Partial reference-graph replacement

**Files:**
- Modify: `src/entities/EntityReferenceGraph.ts`
- Modify: `src/entities/EntityProjection.ts`
- Test: `tests/entity-partitioned-projection.test.ts`
- Test: `tests/entity-references.test.ts`

**Interfaces:**
- Produces `EntityReferenceGraph.preparePartition(ownedSourceKinds, references, view)`.
- Maintains source-kind/source-handle indexes and total reference count without flattening/sorting the complete graph on every partial commit.

- [ ] **Step 1: Add failing tests for graph isolation**

Add cases proving:
- traffic-only reference changes do not iterate unrelated firm/transit source edges;
- a changed partition cannot delete edges whose source kind it does not own;
- `graph.snapshot()` after partitioned updates equals the full-path snapshot.

Use an iteration-counting map around the new source-kind index to prove scoped access.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/entity-partitioned-projection.test.ts tests/entity-references.test.ts
```

Expected: FAIL on missing/scanning partial graph behavior.

- [ ] **Step 3: Add graph indexes**

Maintain:

```ts
private referencesBySourceKey = new Map<string, readonly EntityReference[]>();
private sourceKeysByKind = new Map<EntityKind, Set<string>>();
private referenceCount = 0;
private flattenedCache: readonly EntityReference[] | undefined;
```

`preparePartition()` validates exactly the same source/target semantics as `prepare()`, but only replaces edges whose source kinds are owned by the partition.

- [ ] **Step 4: Commit graph deltas atomically**

The coordinator must prepare all changed reference partitions before mutating graph state. Commit only after every registry and graph stage succeeds. Invalidate the flattened cache on successful graph mutation only.

- [ ] **Step 5: Run focused tests and static checks**

```bash
node --experimental-strip-types --test tests/entity-partitioned-projection.test.ts tests/entity-references.test.ts tests/entity-diagnostics.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/EntityReferenceGraph.ts src/entities/EntityProjection.ts tests/entity-partitioned-projection.test.ts tests/entity-references.test.ts
git commit -m "perf: partition entity reference updates"
```

---

### Task 3: Atomic multi-partition overlays and failure retry

**Files:**
- Modify: `src/entities/EntityRegistry.ts`
- Modify: `src/entities/EntityProjection.ts`
- Test: `tests/entity-partitioned-projection.test.ts`

**Interfaces:**
- Produces a staged multi-partition `KnownEntityView` that resolves against the final same-transaction entity state.
- Coordinator cache is keyed by `(registry, graph)` and partition ID/revision key.

- [ ] **Step 1: Add failing tests**

Add cases for:
- building replacement and firm retarget/closure in the same tick resolves independent of partition caller order;
- weak traffic reference remains bound to the old exact generation when building replacement occurs in the same transaction;
- failed strong-reference validation leaves registry snapshot, graph snapshot, commit revisions, and cached partition revision keys unchanged;
- retrying the same authoritative revision after a failure re-runs the changed partition rather than being incorrectly skipped.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/entity-partitioned-projection.test.ts
```

- [ ] **Step 3: Implement transaction overlay**

Stage all changed registry partitions into one overlay before reference resolution. `resolve`, `isActive`, `isKnown`, and `resolveKnownByToken` must observe the final staged state across every changed partition plus unchanged committed partitions.

- [ ] **Step 4: Add coordinator cache**

Use an internal `WeakMap<EntityRegistry, ...>` containing:
- exact graph identity;
- registry/graph commit revisions;
- last committed revision key by partition ID;
- unresolved diagnostics by partition ID;
- previous immutable commit result.

Update this cache only after successful registry + graph commit.

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/entity-partitioned-projection.test.ts tests/entity-registry.test.ts tests/entity-references.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/EntityRegistry.ts src/entities/EntityProjection.ts tests/entity-partitioned-projection.test.ts
git commit -m "feat: make partitioned entity commits atomic"
```

---

### Task 4: Partition-producing V7 projector

**Files:**
- Modify: `src/entities/LegacyV7EntityProjector.ts`
- Test: `tests/entity-v7-projector.test.ts`
- Test: `tests/entity-partitioned-projection.test.ts`

**Interfaces:**
- Produces `LegacyV7EntityProjector.projectPartitions(source)`.
- `project(source)` remains deterministic composition of partitions and serves as the correctness oracle.

- [ ] **Step 1: Add failing projector partition tests**

Verify exact initial partition ownership:

```text
lots -> lot
buildings -> building
firms -> firm
utilities -> utility-facility
services -> service-facility
transit -> transit-stop, transit-line
traffic -> traffic-vehicle
service-vehicles -> service-vehicle
freight -> freight-vehicle
incidents -> incident
```

Also prove:
- traffic revision change does not re-list lots/buildings;
- building revision invalidates traffic/firms/incidents partitions when exact weak/strong reference output can change;
- full `project()` output equals canonical composition of `projectPartitions()`.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/entity-v7-projector.test.ts
```

- [ ] **Step 3: Extract deterministic partition builders**

Move existing entity/reference loops into focused private partition builders. Reuse existing cached lists and `buildingToken()`/weak-reference evidence rules; do not change identity semantics.

- [ ] **Step 4: Implement revision-key cache by partition ID**

Revision dependencies:
- `lots`: lot revision;
- `buildings`: building + lot revisions;
- `firms`: firm + building revisions;
- `utilities`: utility revision;
- `services`: service-facility revision;
- `transit`: transit revision;
- `traffic`: traffic + building revisions;
- `service-vehicles`: service-vehicle + service-facility revisions;
- `freight`: freight + firm revisions;
- `incidents`: incident + building revisions.

If required revision inputs are unavailable, rebuild that partition instead of guessing a stable key.

- [ ] **Step 5: Run focused tests**

```bash
node --experimental-strip-types --test tests/entity-v7-projector.test.ts tests/entity-partitioned-projection.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/LegacyV7EntityProjector.ts tests/entity-v7-projector.test.ts tests/entity-partitioned-projection.test.ts
git commit -m "perf: partition V7 entity projection"
```

---

### Task 5: SimulationCore integration and hydration equivalence

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify only if required: `src/persistence/saveV7.ts`
- Test: existing Phase 0B integration/save tests
- Test: `tests/entity-partitioned-projection.test.ts`

**Interfaces:**
- Runtime kernel sync uses `projectPartitions()` + `commitEntityProjectionPartitions()`.
- Full projection path remains available for hydration oracle tests and diagnostics.

- [ ] **Step 1: Add failing integration tests**

Prove:
- normal tick uses partitioned synchronization and updates a changed traffic/freight/incident partition immediately;
- unchanged ticks leave registry/graph commit revisions unchanged;
- hydrate then first incremental tick yields the same canonical entity/reference state as a fresh full projection;
- hydration consumes no tick and no gameplay RNG draw.

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/entity-integration.test.ts tests/entity-hydration.test.ts tests/save-v7.test.ts
```

Use the actual existing file names if hydration/save coverage is currently colocated; do not create duplicate coverage files merely to match this command.

- [ ] **Step 3: Switch runtime sync to partitions**

`rebuildEntityProjection()`/kernel synchronization must call the partitioned projector/coordinator. Keep Save V7 schema and hydration restore order unchanged.

- [ ] **Step 4: Run integration and parity gates**

```bash
node --experimental-strip-types --test tests/entity-*.test.ts
node --experimental-strip-types --test tests/phase0a-v7-parity.test.ts
npm run typecheck
```

If the parity test has a different exact repository filename, run the committed immutable Phase 0A parity test by its actual path.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/core/SimulationCore.ts src/persistence/saveV7.ts tests
git commit -m "perf: integrate partitioned entity synchronization"
```

Do not include `saveV7.ts` if no change was required.

---

### Task 6: Diagnostics/index invariants and 10k complexity proof

**Files:**
- Modify: `src/entities/EntityDiagnostics.ts`
- Test: `tests/entity-diagnostics.test.ts`
- Test: `tests/entity-performance.test.ts`

**Interfaces:**
- Diagnostics validate per-kind registry/source indexes without exposing mutable internals.
- Performance diagnostic proves traffic-only update cost does not scale with 10,000 unrelated durable entities.

- [ ] **Step 1: Add failing index-integrity tests**

Corrupt a test-only cast of:
- registry per-kind index;
- graph source-kind index;

and verify deterministic integrity failure messages.

- [ ] **Step 2: Add the 10k partition test**

Construct 10,000 lot entities plus one traffic partition. Commit once, then change only traffic and assert the update does not iterate the lot index or full active map. Emit timing for diagnostics, but do not use a flaky hosted-runner millisecond assertion.

- [ ] **Step 3: Run RED**

```bash
node --experimental-strip-types --test tests/entity-diagnostics.test.ts tests/entity-performance.test.ts
```

- [ ] **Step 4: Implement index diagnostics**

Validate:
- every active entity appears in exactly its kind index;
- every indexed active key resolves to a committed active record of that kind;
- every graph source key is indexed under its source kind;
- every indexed graph source has committed edges of that kind.

- [ ] **Step 5: Run GREEN**

```bash
node --experimental-strip-types --test tests/entity-diagnostics.test.ts tests/entity-performance.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/entities/EntityDiagnostics.ts tests/entity-diagnostics.test.ts tests/entity-performance.test.ts
git commit -m "test: verify partitioned entity indexes"
```

---

### Task 7: Controlled performance acceptance

**Files:**
- No production files unless new evidence identifies a remaining root cause.
- Disposable benchmark branches/CI configuration only; do not merge benchmark-only package-script changes.

**Interfaces:**
- Acceptance benchmark remains the existing developed-city Phase 6 5,000-tick diagnostic.

- [ ] **Step 1: Run anchored pre-0B benchmark**

Run the same isolated workload five times from the Phase 0A anchor commit `b063ef10211ea35780c13a08b7f33eec6bc3b1c4` and record the five `economy5000_ms` values. Existing accepted baseline median is 1,625.1 ms; rerun only if environment parity needs confirmation.

- [ ] **Step 2: Run post-0B benchmark**

Run the identical workload five times from the current Phase 0B head on a disposable branch with no concurrent full test suite in the measurement process.

- [ ] **Step 3: Calculate median regression**

```text
regression_pct = ((post_median / pre_median) - 1) * 100
```

Acceptance: `regression_pct <= 5.0`.

- [ ] **Step 4: If >5%, stop and return to systematic debugging**

Do not weaken the target or continue to documentation/completion. Add instrumentation to identify the remaining changed-partition cost before another production optimization.

- [ ] **Step 5: Close all disposable benchmark PRs unmerged**

Preserve only the measured evidence in the implementation summary/PR discussion.

---

### Task 8: Documentation, full verification, review, and completion gate

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify if appropriate: `README.md`
- Update: `docs/superpowers/plans/2026-08-24-phase-0b-partitioned-projection.md` only to check completed boxes if the repository workflow tracks plan completion.

**Interfaces:**
- Documents V7-authoritative compatibility projection, partition ownership, exact generation/reference semantics, and performance rationale.

- [ ] **Step 1: Update architecture documentation**

Document:
- kernel order `legacy-v7-city -> entity-registry-sync -> entity-reference-invariants`;
- full vs partitioned projection responsibilities;
- partition ownership/revision keys;
- derived/non-persisted registry state;
- Save V7 authority;
- no gameplay ownership migration in 0B.

- [ ] **Step 2: Run complete automated verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 3: Run immutable parity/save verification**

Run the actual repository paths for:
- Phase 0A V7 parity fixture;
- Save V7 canonical/schema tests;
- Phase 0B hydrate/determinism tests.

Expected: exact PASS; do not update the parity fixture.

- [ ] **Step 4: Run browser smoke**

```bash
npm run test:smoke:phase7
```

Run the existing browser/Chromium smoke environment used for Phase 0A. Expected: PASS.

- [ ] **Step 5: Synchronize with current `main`**

Compare current `main` with the feature branch. Incorporate only non-conflicting upstream commits without altering verified Phase 0B behavior. Re-run affected gates after synchronization.

- [ ] **Step 6: Invoke `superpowers:requesting-code-review`**

Review exact Phase 0B diff against both the original 0B spec and the partitioned-projection addendum. Resolve findings through TDD/systematic debugging as applicable.

- [ ] **Step 7: Invoke `superpowers:verification-before-completion`**

Collect fresh evidence for tests, typecheck, lint, build, parity, save/hydration, performance, browser smoke, and exact feature-head SHA.

- [ ] **Step 8: Keep PR #20 draft until every gate passes**

Do not merge or mark ready until the user explicitly selects the branch-finishing action after all completion evidence is presented.
