# Cadastral Runtime Mutation Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Urban Fabric 2.0 Task 13 by exposing safe, deterministic, all-or-nothing cadastral mutations through `SimulationCore` while preserving canonical building identity, zoning/property references, historical transaction truth, Save V9, and legacy compatibility.

**Architecture:** Add `CadastralRuntimeMutationService` in the simulation layer. It stages a low-level `CadastralMutationSystem` operation against a cloned `CadastralGraph`, rewrites and validates dependent domain snapshots, then commits owners in a fixed order with rollback. World/cadastre remains dependency-clean and no 3R transportation behavior is introduced.

**Tech Stack:** TypeScript/Node 22, Node test runner, existing Clipper2 geometry kernel, existing Civic Foundry deterministic simulation/save systems.

**Spec:** `docs/superpowers/specs/2026-08-26-cadastral-runtime-mutation-service-design.md`

## Global Constraints

- `WorldFoundation` remains the sole physical/geographic authority.
- `CadastralGraph` remains the sole legal-land/topology authority.
- `BuildingSystem`, `ZoningSystem`, and `PropertyMarketSystem` retain authority for their respective domains.
- `LotSystem` is derived compatibility state only.
- Default persistence remains Save V9 / `0.9.0-urban-fabric`; no Save V10.
- V7/V8 migration behavior and legacy identifiers must not silently change.
- A rejected/failed runtime mutation leaves canonical snapshots unchanged.
- Historical property transactions keep historical parcel IDs; lineage validates retired IDs.
- No 3R transportation network behavior is added.
- TDD is mandatory: every production behavior starts with a failing test.

---

### Task 1: Make Property Transaction History Lineage-Aware

**Files:**
- Modify: `src/simulation/development/PropertyMarketSystem.ts`
- Test: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Produces: `PropertyMarketRestoreOptions` and `PropertyMarketSystem.restore(snapshot, options?)`.
- `options.isHistoricalParcelId(parcelId)` authorizes a transaction reference to a retired historical parcel without authorizing current holdings to use that ID.

- [ ] **Step 1: Write the failing history-restore test**

Create `tests/urban-fabric-runtime-mutations.test.ts` with a focused property-market test:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { PropertyMarketSystem } from '../src/simulation/development/PropertyMarketSystem.ts';

test('property history may reference a retired parcel when cadastral lineage recognizes it', () => {
  const market = new PropertyMarketSystem();
  const snapshot = {
    holdings: [{ parcelId: 'parcel:child', ownerId: 'owner:b', reservationValue: 120_000 }],
    transactions: [{
      id: 'property:tx:1',
      tick: 3,
      parcelIds: ['parcel:parent'],
      buyerId: 'owner:b',
      sellerId: 'owner:a',
      purpose: 'sale' as const,
      price: 120_000,
      landValue: 80_000,
      improvementValue: 40_000,
    }],
    nextTransactionId: 2,
  } as const;

  market.restore(snapshot, { isHistoricalParcelId: (id) => id === 'parcel:parent' });
  assert.deepEqual(market.snapshot(), snapshot);
});
```

Also assert that the same snapshot still throws when `restore(snapshot)` is called without the historical validator.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts
```

Expected: FAIL because `PropertyMarketSystem.restore` does not accept lineage-aware options and transaction validation requires every transaction parcel to be a current holding.

- [ ] **Step 3: Implement the narrow restore option**

Add:

```ts
export type PropertyMarketRestoreOptions = Readonly<{
  isHistoricalParcelId?: (parcelId: string) => boolean;
}>;
```

Change:

```ts
restore(snapshot: PropertyMarketSnapshot, options: PropertyMarketRestoreOptions = {}): void
```

Pass `options.isHistoricalParcelId ?? (() => false)` into `validateTransactionHistory`. In historical transaction validation, replace the current unconditional live-holding requirement with:

```ts
if (!liveParcelIds.has(parcelId) && !isHistoricalParcelId(parcelId)) {
  throw new Error(`property transaction references missing holding or historical parcel: ${parcelId}`);
}
```

Do **not** relax `validateHoldings`; current holdings must still identify live parcels at the coordinator/save validation boundary.

- [ ] **Step 4: Verify GREEN plus existing property tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-hbu.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/development/PropertyMarketSystem.ts tests/urban-fabric-runtime-mutations.test.ts
git commit -m "feat: validate property history through parcel lineage"
```

---

### Task 2: Add Staged Runtime Split Transactions

**Files:**
- Create: `src/simulation/land/CadastralRuntimeMutationService.ts`
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Consumes: `CadastralGraph`, `CadastralMutationSystem`, `BuildingSystem`, `ZoningSystem`, `PropertyMarketSystem`, `LotSystem`, and a legacy zone resolver.
- Produces: `CadastralRuntimeMutationService`, `CadastralRuntimeMutationResult`, `splitParcel()`.

Use this dependency shape:

```ts
export type CadastralRuntimeMutationDependencies = Readonly<{
  cadastre: CadastralGraph;
  buildings: BuildingSystem;
  zoning: ZoningSystem;
  propertyMarket: PropertyMarketSystem;
  lots: LotSystem;
  legacyZoneResolver: (parcel: Parcel) => ZoneType | undefined;
}>;
```

- [ ] **Step 1: Add failing split success and split rejection tests**

Build a `SimulationCore` fixture from explicit flat terrain, one road, and one zoned/developed parcel. Rebuild the cadastre, then choose a vertical cut that leaves the existing `BuildingV2.footprint` wholly on one side.

Required assertions for success:

```ts
const beforeBuilding = core.buildings.listV2()[0]!;
const source = beforeBuilding.parcelIds[0]!;
const result = service.splitParcel(source, cut);
assert.equal(result.committed, true);
const afterBuilding = core.buildings.getV2ById(beforeBuilding.id)!;
assert.equal(afterBuilding.id, beforeBuilding.id);
assert.deepEqual(afterBuilding.lifecycle, beforeBuilding.lifecycle);
assert.ok(afterBuilding.parcelIds.every((id) => core.cadastre.getParcel(id)));
```

For a cut intersecting the building footprint:

```ts
const before = snapshots(core);
const result = service.splitParcel(source, crossingCut);
assert.equal(result.committed, false);
assert.ok(result.rejectionReasons.includes('building-crosses-split'));
assert.deepEqual(snapshots(core), before);
```

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts
```

Expected: FAIL because `CadastralRuntimeMutationService` does not exist.

- [ ] **Step 3: Implement staged split plumbing**

Create the service with snapshot helpers and a private staged-graph operation. For split:

```ts
const originalCadastre = deps.cadastre.snapshot();
const stagedGraph = new CadastralGraph(originalCadastre);
const lowLevel = new CadastralMutationSystem(stagedGraph).splitParcel(parcelId, cutLine);
if (!lowLevel.committed) return lowLevel;
```

Stage buildings by sorting `buildings.listV2()` by ID. For each building that references the retired source, resolve exactly one child whose polygon completely contains the footprint. Use existing `polygonIntersection` + `polygonArea`; containment succeeds when intersection area matches footprint area within `0.01 m²`.

If zero children contain the footprint, reject `building-outside-resulting-parcel`; if more than one child has positive material overlap or no single child contains the full footprint, reject `building-crosses-split`.

Stage zoning by removing the source assignment and cloning it to every child, preserving district and overlays.

Stage holdings by removing the source holding and allocating its reservation value by child-area ratio in integer cents. Sort child IDs; assign rounding residual to the last child. Preserve owner and transaction history.

Historical transaction validation uses:

```ts
const historicalIds = new Set(stagedGraph.listLineage().flatMap((event) => event.sourceParcelIds));
const isHistoricalParcelId = (id: string) => historicalIds.has(id);
```

Create a temporary `LotSystem` and call `rebuildFromCadastre(stagedGraph, legacyZoneResolver)` before commit to prove compatibility projection can be derived.

- [ ] **Step 4: Implement fixed-order commit with rollback**

Keep original building/zoning/property snapshots. Commit only after all staged validation passes:

```ts
deps.cadastre.replaceSnapshot(stagedGraph.snapshot());
deps.zoning.restoreParcelAssignments(stagedAssignments);
deps.buildings.restoreV2(stagedBuildings);
deps.propertyMarket.restore(stagedProperty, { isHistoricalParcelId });
deps.lots.rebuildFromCadastre(deps.cadastre, deps.legacyZoneResolver);
```

Wrap commit in `try/catch`. On error, restore original cadastre, assignments, V2 buildings, property state using historical IDs from the original cadastre, then rebuild lots from original cadastre. Return a rejection containing `runtime-commit-rollback`.

- [ ] **Step 5: Verify GREEN and regression surface**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-mutations.test.ts tests/urban-fabric-integration.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/land/CadastralRuntimeMutationService.ts tests/urban-fabric-runtime-mutations.test.ts
git commit -m "feat: add atomic runtime parcel splits"
```

---

### Task 3: Add Assembly, Right-of-Way, and Easement Transactions

**Files:**
- Modify: `src/simulation/land/CadastralRuntimeMutationService.ts`
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Produces: `assembleParcels()`, `dedicateRightOfWay()`, `createEasement()`, `removeEasement()` on the same service.

- [ ] **Step 1: Write failing assembly tests**

Add an assembly fixture with two adjacent parcels. Required behavior:

```ts
const result = service.assembleParcels([leftId, rightId]);
assert.equal(result.committed, true);
const assembledId = result.resultingParcelIds[0]!;
assert.ok(core.cadastre.getParcel(assembledId));
assert.ok(core.buildings.listV2().every((building) =>
  building.parcelIds.every((id) => core.cadastre.getParcel(id))));
assert.equal(core.propertyMarket.ownerOf(assembledId), 'owner:a');
```

Add two rejection tests:

- different property owners → `conflicting-property-owners` and no snapshot change;
- different explicit parcel assignments → `conflicting-zoning-assignments` and no snapshot change.

If any source parcel has a current property holding, require **all** source parcels to have holdings and all to share one owner. This avoids creating an assembled parcel with partially undefined ownership.

- [ ] **Step 2: Verify assembly RED**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts
```

Expected: FAIL because assembly is not exposed by the runtime service.

- [ ] **Step 3: Implement assembly staging and rewrites**

Run low-level `assembleParcels` on the staged graph. Rewrite every building source parcel ID to the single assembled ID and deduplicate/sort `parcelIds`.

For zoning, compare source assignments after normalizing `{districtId, overlayIds}`. If more than one distinct explicit assignment exists, reject. Otherwise install that assignment on the assembled parcel.

For property state, require complete ownership coverage when any source holding exists. Sum reservation values exactly in cents and install one assembled holding. Keep historical transactions unchanged.

- [ ] **Step 4: Write failing right-of-way and easement tests**

Right-of-way success must transfer building/zoning/holding references to the one residual parcel and scale reservation value by `residual.areaM2 / source.areaM2`.

Right-of-way geometry intersecting the active building must return `building-outside-resulting-parcel` and preserve all snapshots.

Easement create/remove must commit through the runtime service while leaving buildings, zoning, and property snapshots deep-equal.

- [ ] **Step 5: Implement right-of-way/easement through the common transaction path**

`dedicateRightOfWay` uses low-level one-to-one `parcelReferenceRewrites`. Rewrite buildings only when their footprint remains fully contained in the residual parcel; transfer zoning; transfer/scaled holding; preserve history.

`createEasement` and `removeEasement` stage/validate/commit cadastre without dependent ID rewrites.

- [ ] **Step 6: Verify GREEN**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-mutations.test.ts tests/urban-fabric-fuzz.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/land/CadastralRuntimeMutationService.ts tests/urban-fabric-runtime-mutations.test.ts
git commit -m "feat: coordinate runtime cadastral mutations"
```

---

### Task 4: Wire `SimulationCore.cadastralMutations` and Preserve Building Identity

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`
- Modify: `tests/urban-fabric-integration.test.ts`

**Interfaces:**
- Produces: `SimulationCore.readonly cadastralMutations`.
- `core.step()` must preserve surviving canonical building identity/lifecycle after parcel-ID rewrites.

- [ ] **Step 1: Write failing public-core continuation test**

Use the public core API, not a directly constructed service:

```ts
const buildingBefore = core.buildings.listV2()[0]!;
const lifecycleBefore = structuredClone(buildingBefore.lifecycle);
const result = core.cadastralMutations.splitParcel(sourceId, safeCut);
assert.equal(result.committed, true);
core.step(10);
const buildingAfter = core.buildings.getV2ById(buildingBefore.id);
assert.ok(buildingAfter);
assert.deepEqual(buildingAfter.lifecycle, lifecycleBefore);
assert.equal(buildingAfter.yearBuilt, buildingBefore.yearBuilt);
assert.equal(buildingAfter.entitlement.approvalTick, buildingBefore.entitlement.approvalTick);
```

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-integration.test.ts
```

Expected: FAIL because `SimulationCore.cadastralMutations` is absent and/or `reconcileCanonicalBuildingProjection()` replaces the surviving canonical ID after a parcel mutation.

- [ ] **Step 3: Construct and expose the service**

Import `CadastralRuntimeMutationService`, add:

```ts
readonly cadastralMutations: CadastralRuntimeMutationService;
```

Construct it after `cadastre`, `propertyMarket`, and other owner systems exist, passing `legacyZoneForParcel` as the compatibility resolver.

- [ ] **Step 4: Make reconciliation stable-identity aware**

When `reconcileCanonicalBuildingProjection()` projects one legacy building onto a parcel, resolve an existing V2 building in this priority order:

1. exact proposed canonical ID;
2. unused existing building whose `parcelIds` contains the current parcel ID, `typologyId` matches, and footprint matches the projection geometrically within `0.01 m²` symmetric-difference tolerance.

Track consumed existing IDs so one V2 building cannot match two legacy buildings.

When a spatial match exists, preserve its `id`, lifecycle, entitlement, yearBuilt, project metadata, and other canonical state; only apply the existing legacy construction→occupied status transition rule.

- [ ] **Step 5: Verify continuation GREEN**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-integration.test.ts tests/core-city-loop.test.ts tests/development-integration.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/core/SimulationCore.ts tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-integration.test.ts
git commit -m "feat: expose safe cadastral runtime authority"
```

---

### Task 5: Make Save V9 Accept Historical Parcel Transactions

**Files:**
- Modify: `src/save/saveV9.ts`
- Modify: `tests/save-v9.test.ts`
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`

**Interfaces:**
- Save schema stays `saveVersion: 9`, `gameVersion: '0.9.0-urban-fabric'`.
- `validateUrbanFabricReferences` must distinguish current references from historical transaction references.

- [ ] **Step 1: Write failing mutation → Save V9 → hydrate test**

After a successful runtime split with a pre-existing property transaction:

```ts
const transactionBefore = structuredClone(core.propertyMarket.listTransactions()[0]);
const save = serializeCoreV9(core);
assert.equal(save.saveVersion, 9);
const restored = hydrateCoreV9(structuredClone(save));
assert.deepEqual(restored.propertyMarket.listTransactions()[0], transactionBefore);
assert.deepEqual(restored.cadastre.snapshot(), core.cadastre.snapshot());
assert.deepEqual(restored.buildings.listV2(), core.buildings.listV2());
```

Then `restored.step(10)` and assert no building/zoning/holding live reference points to a missing parcel.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/save-v9.test.ts tests/urban-fabric-runtime-mutations.test.ts
```

Expected: FAIL because `validateUrbanFabricReferences` currently requires historical transaction parcel IDs to be live parcels and `propertyMarket.restore` is called without the lineage validator.

- [ ] **Step 3: Update V9 validation without changing schema**

In `validateUrbanFabricReferences`, continue using `requireParcel` for zoning assignments, buildings, and current holdings.

For transactions, build:

```ts
const historicalParcelIds = new Set(
  core.cadastre.listLineage().flatMap((event) => event.sourceParcelIds),
);
```

Accept transaction parcel IDs when `core.cadastre.getParcel(id)` exists **or** `historicalParcelIds.has(id)`.

Call:

```ts
core.propertyMarket.restore(save.propertyMarket, {
  isHistoricalParcelId: (id) => historicalParcelIds.has(id),
});
```

- [ ] **Step 4: Verify GREEN plus V8 migration**

```bash
node --experimental-strip-types --test tests/save-v9.test.ts tests/save-v8.test.ts tests/save-v7-migration.test.ts tests/urban-fabric-runtime-mutations.test.ts
npm run typecheck
```

Expected: PASS and V8 behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/save/saveV9.ts tests/save-v9.test.ts tests/urban-fabric-runtime-mutations.test.ts
git commit -m "feat: persist cadastral mutation history in save v9"
```

---

### Task 6: Determinism, Rollback, Documentation, and Final Gate

**Files:**
- Modify: `tests/urban-fabric-runtime-mutations.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SIMULATION.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/DEVELOPMENT_LOG.md`
- Modify: `docs/superpowers/plans/2026-08-26-urban-fabric-2.0-reconciliation.md`

**Interfaces:**
- Final Task 13 contract: public safe service, deterministic snapshots/results, rollback, Save V9 compatibility.

- [ ] **Step 1: Add deterministic twin-core test**

Construct two identical cores and apply the same split/assembly request. Assert:

```ts
assert.deepEqual(resultA, resultB);
assert.deepEqual(coreA.cadastre.snapshot(), coreB.cadastre.snapshot());
assert.deepEqual(coreA.buildings.listV2(), coreB.buildings.listV2());
assert.deepEqual(coreA.zoning.listParcelAssignments(), coreB.zoning.listParcelAssignments());
assert.deepEqual(coreA.propertyMarket.snapshot(), coreB.propertyMarket.snapshot());
```

- [ ] **Step 2: Add forced rollback test**

Use a narrow injectable commit hook or test-only dependency wrapper rather than production global state. Force the property restore step to throw after cadastre/zoning/buildings have been written. Assert the service returns `runtime-commit-rollback` and every canonical snapshot equals the pre-mutation snapshot.

The production hook must be minimal:

```ts
commitFaultInjector?: (stage: 'cadastre' | 'zoning' | 'buildings' | 'property' | 'lots') => void;
```

Keep it optional and only invoke it immediately before each commit stage. Do not add a general event framework.

- [ ] **Step 3: Run focused deterministic/rollback tests**

```bash
node --experimental-strip-types --test tests/urban-fabric-runtime-mutations.test.ts tests/urban-fabric-fuzz.test.ts tests/save-v9.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Update documentation**

Document:

```text
CadastralGraph = legal-land authority
CadastralRuntimeMutationService = cross-domain transaction boundary
LotSystem = derived compatibility facade
```

State that split/assembly/right-of-way/easement runtime mutations stage dependent references before commit; historical property transactions retain retired parcel IDs through lineage; Save V9 schema is unchanged; transportation network mutation remains 3R scope.

Update the reconciliation checkpoint to mark the prior “raw mutation not exposed” gap resolved only after exact-head CI succeeds.

- [ ] **Step 5: Run the complete repository gate**

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
```

Expected: every command exits `0`. CI must additionally pass Isometric Pass A visual smoke.

- [ ] **Step 6: Scope review**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Confirm no 3R transportation ownership, lane/intersection/routing implementation, Save V10 schema, or unrelated refactor entered the branch.

- [ ] **Step 7: Commit final docs/gate checkpoint**

```bash
git add tests/urban-fabric-runtime-mutations.test.ts docs/ARCHITECTURE.md docs/SIMULATION.md docs/TESTING.md docs/DEVELOPMENT_LOG.md docs/superpowers/plans/2026-08-26-urban-fabric-2.0-reconciliation.md
git commit -m "docs: close Urban Fabric runtime mutation gate"
```

## Self-Review Results

- **Spec coverage:** Split, assembly, right-of-way, easements, zoning inheritance, property conservation/history, building identity, rollback, determinism, Save V9, legacy facade, and full CI each map to an explicit task.
- **Placeholder scan:** No implementation step depends on TBD/TODO or unspecified validation. Concrete ambiguity rule: partial property-holding coverage blocks assembly when any source holding exists.
- **Type consistency:** Public service remains `CadastralRuntimeMutationService`; public result uses the low-level mutation result field names; Save stays V9; property restore option is consistently named `isHistoricalParcelId`.
- **Scope:** No transportation network mutation or Save V10 is included.
