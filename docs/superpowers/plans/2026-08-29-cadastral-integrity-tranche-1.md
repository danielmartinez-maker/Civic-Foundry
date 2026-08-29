# Cadastral Integrity Tranche 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary road/zoning edits transactional with canonical cadastral state so they cannot erase legal history or leave dependent parcel references dangling.

**Architecture:** Add `LegacyCadastreRebuildService` as a focused reconciliation boundary between legacy parcel regeneration and canonical Urban Fabric owners. Geometry-identical parcels retain canonical IDs/history; topology changes that would retire protected parcels are rejected; unprotected topology changes may commit with deterministic boundary-adjustment lineage. `SimulationCore` snapshots and restores legacy road/zoning/treasury state around edits so reconciliation failure rolls back the full gameplay action.

**Tech Stack:** TypeScript, Node 22 built-in test runner, existing `CadastralGraph`/`ParcelGenerationSystem`/`PropertyMarketSystem`/`BuildingSystem`/`ZoningSystem`/`LotSystem` APIs.

**Spec:** `docs/superpowers/specs/2026-08-29-cadastral-integrity-tranche-1-design.md`

## Global Constraints

- Preserve Save V9 schema and `gameVersion: '0.9.0-urban-fabric'`.
- Do not change public `SimulationCore.buildRoad`, `paintZone`, or `bulldozeAt` signatures.
- Do not rewrite existing historical lineage rows.
- Do not guess split/merge semantics for protected parcels; reject and roll back instead.
- All production changes require a failing regression test first.

---

### Task 1: Regression tests for history and stable identity

**Files:**
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Consumes: existing `SimulationCore`, `CadastralRuntimeMutationService`, `PropertyMarketSystem`.
- Produces: regression tests that define stable-geometry rebuild behavior.

- [ ] **Step 1: Add a failing test that preserves easements and lineage across an unrelated road edit**

Create a fixture with a canonical residential parcel, split it safely using `CadastralRuntimeMutationService`, create an access easement on one surviving child, snapshot `listEasements()` and `listLineage()`, then build a road in an unrelated unzoned area. Assert the road succeeds and the easement/lineage snapshots remain deeply equal.

- [ ] **Step 2: Add a failing test that preserves parcel zoning/property/BuildingV2 metadata across an unrelated zoning edit**

Use the existing split fixture, capture the canonical BuildingV2 ID and lifecycle plus parcel assignment and property snapshot, paint a remote unconnected residential cell, and assert all existing canonical references remain unchanged.

- [ ] **Step 3: Verify RED**

Push the test-only commit to the draft PR branch and confirm the PR CI fails because current `rebuildCadastreFromLegacyState()` replaces `easements`/`lineage` with empty arrays.

- [ ] **Step 4: Commit**

Commit message: `test: expose legacy cadastral rebuild state loss`

---

### Task 2: Add geometry-stable legacy cadastre reconciliation

**Files:**
- Create: `src/simulation/land/LegacyCadastreRebuildService.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Consumes:
  - `CadastralSnapshot`
  - candidate snapshot from `ParcelGenerationSystem.rebuild(...)`
  - `BuildingSystem.listV2()`
  - `ZoningSystem.listParcelAssignments()`
  - `PropertyMarketSystem.snapshot()`
- Produces:
  - `LegacyCadastreRebuildResult = { committed: boolean; rejectionReason?: string }`
  - `LegacyCadastreRebuildService.rebuild(candidate: CadastralSnapshot, tick: number): LegacyCadastreRebuildResult`

- [ ] **Step 1: Implement deterministic polygon fingerprint matching**

For every old and candidate parcel, obtain the polygon from temporary `CadastralGraph` instances, normalize it, rotate the point sequence to the lexicographically smallest coordinate, compare both winding directions, and serialize rounded coordinates. Match only exact fingerprints.

- [ ] **Step 2: Preserve IDs for exact-geometry survivors**

For each matched candidate parcel, replace candidate parcel ID references across candidate parcels, edges and blocks with the old canonical ID. Retain the old parcel's `ownerId` and `historicalParentIds`; retain candidate geometry/frontage/access/zoning district fields.

- [ ] **Step 3: Preserve existing lineage and easements**

Carry forward prior lineage unchanged. Carry forward prior easements after verifying every easement parcel ID is present among geometry-stable survivors; otherwise reject with `protected-parcel-topology-change`.

- [ ] **Step 4: Protect all canonical dependencies**

Build the protected parcel ID set from explicit parcel zoning assignments, property holdings, BuildingV2 `parcelIds`, and easements. If any protected old parcel lacks an exact-geometry survivor, reject with `protected-parcel-topology-change` before touching live state.

- [ ] **Step 5: Record unprotected topology changes**

If old and reconciled live parcel ID sets differ after stable matches, append one sorted deterministic lineage row:

```ts
{
  id: `legacy-boundary-adjustment:${nextIndex}`,
  tick,
  kind: 'boundary-adjustment',
  sourceParcelIds: [...retiredUnprotected].sort(),
  resultingParcelIds: [...newUnprotected].sort(),
}
```

Only append when at least one source or result exists.

- [ ] **Step 6: Validate before commit**

Construct `new CadastralGraph(reconciledSnapshot)` and a temporary `LotSystem` projection. Do not mutate live state unless both succeed.

- [ ] **Step 7: Commit live cadastre and derived lots**

Replace `core.cadastre` with the reconciled snapshot and rebuild `core.lots`. Canonical zoning assignments, BuildingV2, and property state are unchanged because protected parcel IDs are guaranteed stable.

- [ ] **Step 8: Run the Task 1 regression tests**

Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `fix: preserve cadastral history on legacy rebuilds`

---

### Task 3: Transactional rollback for road and zoning edits

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Consumes: `LegacyCadastreRebuildService.rebuild(...)` from Task 2.
- Produces: private SimulationCore helpers that snapshot/restore legacy edit state.

- [ ] **Step 1: Add failing road rollback test**

Create a multi-cell protected parcel with canonical zoning, property holding, BuildingV2 and an easement. Attempt to build a road through an undeveloped cell of that same parcel so generated geometry would retire the protected parcel. Assert:

```ts
assert.equal(result.ok, false);
assert.match(result.reason ?? '', /cadastral reconciliation failed/);
assert.deepEqual(core.roads.list(), roadsBefore);
assert.equal(core.treasury.balance, treasuryBefore.balance);
assert.deepEqual(core.treasury.transactions, treasuryBefore.transactions);
assert.deepEqual(snapshots(core), canonicalBefore);
```

- [ ] **Step 2: Verify RED**

Push the test-only commit and confirm PR CI fails because the road currently commits and the protected parcel is regenerated.

- [ ] **Step 3: Implement legacy edit snapshot/restore helpers**

Snapshot:

```ts
{
  roads: this.roads.list(),
  roadRevision: this.roads.revision,
  zoningCells: this.zoning.list(),
  treasuryBalance: this.treasury.balance,
  treasuryTransactions: this.treasury.transactions.map((tx) => ({ ...tx })),
  cadastre: this.cadastre.snapshot(),
  parcelAssignments: this.zoning.listParcelAssignments(),
  buildingsV2: this.buildings.listV2(),
  property: this.propertyMarket.snapshot(),
}
```

Restore roads before legacy zoning so zoning cells that were temporarily covered by a road are valid again. Then restore treasury, cadastre, parcel assignments, BuildingV2, property state with historical-lineage predicate, and derive lots from restored cadastre.

- [ ] **Step 4: Wrap `buildRoad`**

Snapshot before `super.buildRoad`. If inherited placement fails, return it unchanged. If cadastral reconciliation rejects or throws, restore and return `{ ok: false, cost: result.cost, reason: 'cadastral reconciliation failed' }`.

- [ ] **Step 5: Wrap `paintZone`**

Snapshot before `super.paintZone`. If zero cells paint, return unchanged. If reconciliation rejects or throws, restore and return `{ painted: 0 }`.

- [ ] **Step 6: Wrap road/zone branches of `bulldozeAt`**

Snapshot before inherited bulldoze. Building bulldoze does not invoke legacy cadastral regeneration and remains outside this tranche. If road/zone reconciliation fails, restore and return `{ ok: false, reason: 'cadastral reconciliation failed' }`.

- [ ] **Step 7: Run targeted tests**

Expected: new road rollback test and Task 1 tests PASS.

- [ ] **Step 8: Commit**

Commit message: `fix: rollback unsafe legacy land edits`

---

### Task 4: Zoning rollback and unprotected topology lineage

**Files:**
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`
- Modify: `src/simulation/land/LegacyCadastreRebuildService.ts` only if RED exposes a defect.

**Interfaces:**
- Consumes: Task 2/3 behavior.
- Produces: complete acceptance coverage for the tranche.

- [ ] **Step 1: Add protected zoning topology-change test**

Repaint one cell inside a protected multi-cell parcel to another legacy zone so generation would split the parcel. Assert `painted === 0` and canonical/legacy snapshots are restored exactly.

- [ ] **Step 2: Verify RED or existing GREEN**

If the test already passes solely from Task 3 implementation, record that result; do not change production code unnecessarily.

- [ ] **Step 3: Add unprotected topology lineage test**

Create zoned land with no BuildingV2, parcel zoning assignment, property holding, or easement. Repaint a subset to force a split. Assert the edit succeeds and one deterministic `boundary-adjustment` lineage event records the retired source and resulting parcel IDs.

- [ ] **Step 4: Verify RED**

The new lineage test must fail before any required production adjustment.

- [ ] **Step 5: Make the minimal lineage adjustment if needed**

Keep lineage ordering deterministic and preserve all prior rows byte-for-byte.

- [ ] **Step 6: Commit**

Commit message: `test: lock legacy land reconciliation invariants`

---

### Task 5: Full verification and review

**Files:**
- No production scope expansion.

- [ ] **Step 1: Run/observe complete PR CI**

Required gates from `.github/workflows/ci.yml`:

```text
npm run verify
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

Expected: every job/step succeeds on the final branch SHA.

- [ ] **Step 2: Review branch diff against the spec**

Confirm no Save V9 schema changes, no unrelated renderer/economy work, and no changes to public SimulationCore method signatures.

- [ ] **Step 3: Review test quality**

Each regression must fail on the pre-fix implementation for the intended reason, then pass on the final implementation.

- [ ] **Step 4: Update the draft PR summary**

Document RED evidence, final CI evidence, changed files, rollback semantics, and explicitly state that `main` has not been merged without separate approval.
