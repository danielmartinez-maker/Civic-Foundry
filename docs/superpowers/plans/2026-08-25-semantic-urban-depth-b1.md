# Semantic Urban Depth Pass B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authoritative mixed-use, quality, condition/lifecycle, private parking, renovation, V8 persistence, and state-driven isometric presentation while preserving V7 gameplay parity for migrated buildings.

**Architecture:** Keep `BuildingSystem` as the compatibility owner of building identity/placement/base construction state and add a focused `UrbanFabricDomain` keyed by building ID for B1 semantic state. All downstream capacity, tax, lifecycle, and presentation consumers read through a derived `UrbanBuildingView`; developer awards create semantic tuples, V8 persists them exactly, and the Pass A renderer composes layered sprites from authoritative state only.

**Tech Stack:** TypeScript 5 ES modules, Node 22 strip-types test runner, Canvas2D isometric renderer, Python Playwright/Chromium browser smokes, Python/Pillow atlas validation, build-time SVG/raster atlas generation, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-25-semantic-urban-depth-b1-design.md`

## Global Constraints

- Preserve determinism: same seed + authoritative state + ordered commands produce the same future.
- Preserve one authoritative owner per fact; `BuildingSystem` owns identity/lot/cell/base definition/base construction state, `UrbanFabricDomain` owns B1 semantics.
- Presentation must never infer gameplay state from appearance.
- Existing V7 saves migrate deliberately to V8; no fabricated pre-V8 condition history.
- Migrated V7 buildings must preserve immediate resident capacity, job capacity, tax base, utility demand, and garbage demand.
- `areaShareBps` must be integer basis points summing to exactly 10,000 per building.
- Private parking is building/site inventory only; no curb supply, parking occupancy, cruising, trip generation, or lane effects in B1.
- Formal parks/recreation, arbitrary parcel geometry, ownership/assembly, FAR/setback UI, and unit/suite micro-simulation remain out of scope.
- Condition updates every 100 simulation ticks and are frame-rate independent.
- No new runtime npm dependencies.
- Keep Node 22 test-loaded TypeScript within erasable syntax; do not use constructor parameter properties.
- Every task uses TDD: prove RED before implementation, prove GREEN after implementation, then commit.
- Do not weaken existing Phase 6/7, Pass A interaction, Pass A visual, audit, lint, or save regression gates.

---

## File Structure Locked by This Plan

### New simulation/data files

- `src/data/urbanFabric.ts` — immutable quality, parking, condition, renovation, and deterministic rounding constants/rules.
- `src/data/urbanPrototypes.ts` — authoritative use-component templates for all 13 structural definitions, including four mixed-use prototypes.
- `src/simulation/urban/UrbanTypes.ts` — B1 semantic state and snapshot types.
- `src/simulation/urban/UrbanFabricDomain.ts` — authoritative semantic state, invariant validation, lifecycle transitions, snapshot/restore.
- `src/simulation/urban/UrbanBuildingView.ts` — derived combined building + semantic read model; owns no state.
- `src/simulation/urban/UrbanConditionSystem.ts` — 100-tick condition cadence, adequacy calculation, lifecycle transitions.
- `src/simulation/urban/RenovationSystem.ts` — eligibility, project commitments, deterministic duration/cost, completion.
- `src/simulation/urban/UrbanDevelopmentCandidate.ts` — stable semantic candidate enumeration and fingerprinting.
- `src/save/saveV8.ts` — V8 envelope, validation, V7 migration, exact restore.
- `src/rendering/UrbanOverlayLayer.ts` — quality/condition/mixed-use/parking/renovation analytical overlays.

### Existing files expected to change

- `src/data/buildings.ts` — add four mixed-use structural definitions and preserve existing nine definitions.
- `src/simulation/buildings/BuildingSystem.ts` — expose stable hooks required for semantic state creation/removal/replacement, without taking B1 semantic ownership.
- `src/simulation/development/DevelopmentTypes.ts` — semantic candidate/feasibility/bid/commitment fields.
- `src/simulation/development/DevelopmentFeasibilitySystem.ts` — component revenue/vacancy, quality, parking economics.
- `src/simulation/development/DeveloperMarketSystem.ts` — stable semantic candidate bids/tie-breaks.
- `src/simulation/development/RedevelopmentExecutionSystem.ts` — semantic replacement/exclusivity integration.
- `src/simulation/housing/HousingTenureSystem.ts` and `src/simulation/housing/HousingRelocationSystem.ts` — residential-component-only effective capacity and reconciliation.
- `src/simulation/employment/EmploymentSystem.ts` and economy/firm placement call sites — job-component-only effective capacity and condemnation checks.
- `src/simulation/tax/TaxSystem.ts` and tax call sites — per-use component tax allocation exactly once.
- `src/simulation/core/SimulationCore.ts` — instantiate/schedule B1 domains, route derived views, lifecycle cleanup, expose snapshots.
- `src/save/save.ts` — V8 becomes default serializer/hydrator while retaining V4–V7 exports.
- `src/app/GameApp.ts` — V8 save label/key and new semantic overlay controls.
- `src/ui/Inspector.ts` — semantic building inspection fields.
- `src/rendering/passes/ObjectRenderPass.ts` — layered semantic building composition.
- `src/rendering/assets/AssetTypes.ts`, `AssetManifest.ts`, `VariantSelector.ts` — semantic layer queries and stable identity rules.
- `tools/isometric_art.py`, `tools/render_isometric_atlases.py`, `assets/isometric/manifest.json` — B1 art coverage and layered atlas generation.
- `.github/workflows/ci.yml`, `package.json` — B1 smoke/scale scripts added to existing gates without removing audit/Pass A gates.

### New tests/smokes

- `tests/urban-fabric-domain.test.ts`
- `tests/urban-building-view.test.ts`
- `tests/urban-mixed-use-integration.test.ts`
- `tests/urban-development-economics.test.ts`
- `tests/urban-condition.test.ts`
- `tests/urban-renovation.test.ts`
- `tests/save-v8.test.ts`
- `tests/urban-presentation.test.ts`
- `tests/urban-scale.test.ts`
- `tests/smoke/urban_b1_smoke.py`
- `tests/smoke/urban_b1_visual_smoke.py`

---

### Task 1: Semantic Types, Balancing Data, and `UrbanFabricDomain`

**Files:**
- Create: `src/data/urbanFabric.ts`
- Create: `src/data/urbanPrototypes.ts`
- Create: `src/simulation/urban/UrbanTypes.ts`
- Create: `src/simulation/urban/UrbanFabricDomain.ts`
- Test: `tests/urban-fabric-domain.test.ts`

**Interfaces:**
- Produces `BuildingQualityTier`, `BuildingConditionBand`, `PrivateParkingProfile`, `UrbanLifecycleState`, `UrbanUseComponent`, `UrbanBuildingState`, `UrbanFabricStateSnapshot`, `RenovationCommitment`.
- Produces `UrbanFabricDomain.install(state)`, `get(buildingId)`, `list()`, `remove(buildingId)`, `replace(buildingId,state)`, `snapshotState()`, `restoreState(snapshot, liveBuildingIds)`, `validateAgainst(liveBuildingIds)`.
- Produces `conditionBandFor(score,lifecycle)` and deterministic `roundNonNegative(value)` in `src/data/urbanFabric.ts`.
- Later tasks must use these exact types rather than defining duplicate enums.

- [ ] **Step 1: Write failing invariant/conservation tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';

const state = {
  buildingId: 'building:lot:1,1',
  useComponents: [
    { use: 'residential' as const, areaShareBps: 7500, residentCapacity: 24, jobCapacity: 0, taxBase: 300 },
    { use: 'commercial' as const, areaShareBps: 2500, residentCapacity: 0, jobCapacity: 8, taxBase: 100 },
  ],
  qualityTier: 'standard' as const,
  conditionScore: 100,
  lifecycleState: 'lease-up' as const,
  conditionEstablishedTick: 0,
  lastConditionTick: 0,
  renovationCount: 0,
  parking: { profile: 'standard' as const, spaces: 8 },
};

test('urban fabric accepts conserved mixed-use state and rejects invalid shares', () => {
  const domain = new UrbanFabricDomain();
  domain.install(state);
  assert.equal(domain.get(state.buildingId)?.useComponents.reduce((sum, item) => sum + item.areaShareBps, 0), 10_000);
  assert.throws(() => domain.install({ ...state, buildingId: 'bad', useComponents: [{ ...state.useComponents[0]!, areaShareBps: 9000 }] }), /10,000/);
});
```

- [ ] **Step 2: Run RED test**

Run: `node --experimental-strip-types --test tests/urban-fabric-domain.test.ts`
Expected: FAIL because the new urban modules do not exist.

- [ ] **Step 3: Implement immutable types, constants, prototype templates, and domain validation**

Use explicit validation rules:

```ts
export function validateUseComponents(items: readonly UrbanUseComponent[]): void {
  if (items.length === 0) throw new Error('urban use components must be non-empty');
  const total = items.reduce((sum, item) => sum + item.areaShareBps, 0);
  if (total !== 10_000) throw new Error('urban use area shares must sum to 10,000');
  for (const item of items) {
    if (!Number.isInteger(item.areaShareBps) || item.areaShareBps <= 0) throw new Error('areaShareBps must be a positive integer');
    if (item.use === 'residential' && item.jobCapacity !== 0) throw new Error('residential component cannot own job capacity');
    if (item.use !== 'residential' && item.residentCapacity !== 0) throw new Error('non-residential component cannot own resident capacity');
    for (const value of [item.residentCapacity, item.jobCapacity, item.taxBase]) if (!Number.isFinite(value) || value < 0) throw new Error('component values must be finite and non-negative');
  }
}
```

`restoreState()` must reject duplicate IDs, unknown live-building references, missing records for live B1 buildings when called in strict V8 mode, invalid enum values, non-integer/negative parking, and condition outside `[0,100]`.

- [ ] **Step 4: Run focused tests and full unit suite**

Run:
`node --experimental-strip-types --test tests/urban-fabric-domain.test.ts`
`npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/urbanFabric.ts src/data/urbanPrototypes.ts src/simulation/urban/UrbanTypes.ts src/simulation/urban/UrbanFabricDomain.ts tests/urban-fabric-domain.test.ts
git commit -m "feat: add authoritative urban fabric domain"
```

---

### Task 2: V7-Parity `UrbanBuildingView` Adapter and Core Ownership Wiring

**Files:**
- Create: `src/simulation/urban/UrbanBuildingView.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/urban-building-view.test.ts`

**Interfaces:**
- Consumes `UrbanFabricDomain` from Task 1 and `BuildingSystem`/`definitionForBuilding`.
- Produces `UrbanBuildingView` with `residentialCapacity`, `commercialJobCapacity`, `industrialJobCapacity`, `jobCapacity`, `taxBaseByUse`, `taxBase`, `powerDemand`, `waterDemand`, `garbageGeneration`, `occupancyEligible`, `conditionCapacityMultiplier`, `qualityTier`, `parking`.
- Produces `buildUrbanBuildingView(building,state)` and `buildUrbanBuildingViews(buildings,domain)` sorted by building ID.
- `SimulationCore` gains `readonly urbanFabric` and derived `urbanBuildingViews()`; no downstream system is migrated in this task yet.

- [ ] **Step 1: Write failing V7-parity tests**

```ts
test('migrated single-use standard legacy-none view preserves V7 nominal metrics', () => {
  const core = seededCoreWithCompletedBuildings();
  core.initializeUrbanFabricFromLegacy(core.clock.tick);
  for (const building of core.buildings.list()) {
    const definition = definitionForBuilding(building);
    const view = core.urbanBuildingView(building.id)!;
    assert.equal(view.residentialCapacity, definition.residentCapacity);
    assert.equal(view.jobCapacity, definition.jobCapacity);
    assert.equal(view.taxBase, definition.taxBase);
    assert.equal(view.powerDemand, definition.powerDemand);
    assert.equal(view.waterDemand, definition.waterDemand);
    assert.equal(view.garbageGeneration, definition.garbageGeneration);
  }
});
```

- [ ] **Step 2: Run RED test**

Run: `node --experimental-strip-types --test tests/urban-building-view.test.ts`
Expected: FAIL because view/core APIs do not exist.

- [ ] **Step 3: Implement legacy semantic initialization and derived adapter**

Legacy initialization rules must be exact:

```ts
{
  qualityTier: 'standard',
  conditionScore: 80,
  lifecycleState: building.status === 'construction' ? 'construction' : 'stabilized',
  conditionEstablishedTick: migrationTick,
  lastConditionTick: migrationTick,
  renovationCount: 0,
  parking: { profile: 'legacy-none', spaces: 0 },
}
```

Create the single-use component from the existing definition with `areaShareBps: 10_000`. Do not alter `BuildingSystem` ownership; add only hooks required to keep semantic records synchronized on creation/removal/replacement.

- [ ] **Step 4: Run parity tests and existing regressions**

Run:
`node --experimental-strip-types --test tests/urban-building-view.test.ts`
`npm test`
Expected: PASS with unchanged existing behavior.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/urban/UrbanBuildingView.ts src/simulation/core/SimulationCore.ts src/simulation/buildings/BuildingSystem.ts tests/urban-building-view.test.ts
git commit -m "feat: add urban building parity adapter"
```

---

### Task 3: Mixed-Use Prototypes and Downstream Capacity/Tax Integration

**Files:**
- Modify: `src/data/buildings.ts`
- Modify: `src/data/urbanPrototypes.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/housing/HousingTenureSystem.ts`
- Modify: `src/simulation/housing/HousingRelocationSystem.ts`
- Modify: `src/simulation/employment/EmploymentSystem.ts`
- Modify: `src/simulation/tax/TaxSystem.ts`
- Modify relevant economy/firm placement call sites under `src/simulation/economy/`
- Modify relevant service/utility/garbage aggregation call sites reached from `SimulationCore`
- Test: `tests/urban-mixed-use-integration.test.ts`

**Interfaces:**
- Adds definitions `residential_mainstreet_mixed`, `residential_urban_mixed`, `commercial_mixed_block`, `commercial_mixed_tower`.
- `UrbanBuildingView.taxBaseByUse` is the sole source for mixed-use per-use taxation.
- Housing receives only `view.residentialCapacity`; employment/firms receive only `view.jobCapacity` and use-specific job capacities.
- Utility/garbage demands remain definition-authoritative in B1 and therefore preserve V7 parity unless a mixed-use definition explicitly declares different values.

- [ ] **Step 1: Write failing mixed-use conservation/integration tests**

```ts
test('mixed-use building allocates capacity and tax base exactly once', () => {
  const view = makeMixedUseView('residential_mainstreet_mixed', {
    residential: { residents: 24, taxBase: 300 },
    commercial: { jobs: 8, taxBase: 100 },
  });
  assert.equal(view.residentialCapacity, 24);
  assert.equal(view.jobCapacity, 8);
  assert.equal(view.taxBase, 400);
  assert.deepEqual(view.taxBaseByUse, { residential: 300, commercial: 100, industrial: 0 });
  const revenue = calculateUrbanTax(view, { residential: 0.10, commercial: 0.12, industrial: 0.08 });
  assert.equal(revenue, 42);
});
```

Add integration cases proving housing never sees the commercial job component, firms never see residential capacity, and redevelopment can award a legal equal-intensity mixed-use definition.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/urban-mixed-use-integration.test.ts`
Expected: FAIL because prototypes and downstream adapters are absent.

- [ ] **Step 3: Add the four definitions and replace direct capacity/tax consumers with views**

Use explicit prototype component templates; do not infer resident/job capacity by multiplying area share. Keep industrial single-use. Preserve current zone as dominant-use legal envelope exactly as the spec defines.

Where current code accepts raw `Building[]`, construct stable derived inputs in `SimulationCore` and pass those into systems rather than teaching each system how to query `UrbanFabricDomain` directly.

- [ ] **Step 4: Run focused integration plus all development/housing/economy tests**

Run:
`node --experimental-strip-types --test tests/urban-mixed-use-integration.test.ts tests/development-integration.test.ts tests/economy-integration.test.ts tests/housing*.test.ts`
`npm test`
Expected: PASS and no V7 parity regression.

- [ ] **Step 5: Commit**

```bash
git add src/data/buildings.ts src/data/urbanPrototypes.ts src/simulation/core/SimulationCore.ts src/simulation/housing src/simulation/employment src/simulation/tax src/simulation/economy tests/urban-mixed-use-integration.test.ts
git commit -m "feat: integrate authoritative mixed-use capacity"
```

---

### Task 4: Quality and Private-Parking Developer Economics

**Files:**
- Create: `src/simulation/urban/UrbanDevelopmentCandidate.ts`
- Modify: `src/data/urbanFabric.ts`
- Modify: `src/simulation/development/DevelopmentTypes.ts`
- Modify: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify: `src/simulation/development/DeveloperMarketSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/urban-development-economics.test.ts`
- Extend: `tests/development-feasibility.test.ts`
- Extend: `tests/developer-market.test.ts`

**Interfaces:**
- Produces `UrbanDevelopmentCandidate = { definitionId, qualityTier, parkingProfile, parkingSpaces, useMixKey }`.
- `enumerateUrbanCandidates(definitions, context)` returns stable order: definition ID → quality rank → parking rank.
- `DevelopmentFeasibilityResult`, `DevelopmentBid`, `DevelopmentAward`, and `DeveloperCommitment` gain `qualityTier`, `parkingProfile`, `parkingSpaces`, `useMixKey`.
- Winning award installs matching semantic state in `UrbanFabricDomain` when `BuildingSystem` creates the building.

- [ ] **Step 1: Write failing quality/parking monotonicity and ordering tests**

```ts
test('semantic candidates have stable explicit ordering', () => {
  const candidates = enumerateUrbanCandidates(definitionsShuffled(), parcelContext());
  const keys = candidates.map((item) => `${item.definitionId}|${item.qualityTier}|${item.parkingProfile}`);
  assert.deepEqual(keys, [...keys].sort(explicitSemanticCandidateComparator));
});

test('quality cost multipliers are monotonic', () => {
  assert.ok(qualityProfile('economy').hardConstructionCost < qualityProfile('standard').hardConstructionCost);
  assert.ok(qualityProfile('standard').hardConstructionCost < qualityProfile('premium').hardConstructionCost);
  assert.ok(qualityProfile('premium').hardConstructionCost < qualityProfile('luxury').hardConstructionCost);
});
```

Also test parking baseline deterministic rounding and reduced/standard/abundant/structured cost ordering at equal capacity.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/urban-development-economics.test.ts`
Expected: FAIL on missing semantic candidate API.

- [ ] **Step 3: Implement component-specific feasibility**

For each component, compute revenue/vacancy from its own R/C/I market signal, then aggregate NOI. Apply centralized quality multipliers and access/service threshold increments. Calculate parking baseline from component capacities, derive spaces from profile, add explicit parking cost, and apply reduced-parking rent penalty only as a bounded function of weak person accessibility.

Do not grant abundant parking a traffic/access benefit in B1.

- [ ] **Step 4: Update developer bidding/commitments and award installation**

Tie-breaks must use explicit semantic comparator, then existing developer deterministic key. Award creation must preserve all semantic fields through building completion and save/load.

- [ ] **Step 5: Run development tests and full suite**

Run:
`node --experimental-strip-types --test tests/urban-development-economics.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts`
`npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/urban/UrbanDevelopmentCandidate.ts src/data/urbanFabric.ts src/simulation/development src/simulation/core/SimulationCore.ts tests/urban-development-economics.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts
git commit -m "feat: add quality and parking development economics"
```

---

### Task 5: Condition Scheduler and Authoritative Lifecycle

**Files:**
- Create: `src/simulation/urban/UrbanConditionSystem.ts`
- Modify: `src/simulation/urban/UrbanFabricDomain.ts`
- Modify: `src/simulation/urban/UrbanBuildingView.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/urban-condition.test.ts`

**Interfaces:**
- Produces `MaintenanceAdequacyInput`, `MaintenanceAdequacyTrace`, `calculateMaintenanceAdequacy(input)`, `conditionWearFor100Ticks(state,input)`, `UrbanConditionSystem.updateThroughTick(targetTick, context)`.
- Condition iteration is sorted by building ID.
- `UrbanBuildingView.conditionCapacityMultiplier` maps maintained/new/aging=1, neglected=0.85, renovating=0.5, condemned/abandoned=0 for new placement; abandonment effective capacity is always zero.

- [ ] **Step 1: Write failing cadence-equivalence and monotonic-wear tests**

```ts
test('condition is identical for chunked and single-tick stepping', () => {
  const a = makeConditionHarness();
  const b = makeConditionHarness();
  a.step(1_000);
  for (let i = 0; i < 1_000; i += 1) b.step(1);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('condition never improves without renovation', () => {
  const harness = makeConditionHarness({ conditionScore: 80 });
  harness.step(5_000);
  assert.ok(harness.state().conditionScore <= 80);
});
```

Add quality-resilience directionality and band transition assertions at 70/50/25 boundaries.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/urban-condition.test.ts`
Expected: FAIL because condition scheduler does not exist.

- [ ] **Step 3: Implement 100-tick cadence and adequacy trace**

Use only current authoritative inputs: occupancy utilization, utility ratio, service/neighborhood quality, market rent strength by use, and firm distress. Clamp adequacy to `[0,1]`. The formula may change wear speed but must never yield negative wear.

Register one kernel/domain schedule in `SimulationCore`; do not add per-frame work.

- [ ] **Step 4: Implement lease-up/stabilized/aging/neglected/condemned/abandoned transitions**

Completion starts `lease-up` at condition 100. Stabilize after first successful occupancy/firm reconciliation or 300 ticks. Condemnation blocks new placement. Abandonment is allowed only after both housing and firm occupancy are zero.

- [ ] **Step 5: Run focused and full tests**

Run:
`node --experimental-strip-types --test tests/urban-condition.test.ts tests/core-city-loop.test.ts`
`npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/urban/UrbanConditionSystem.ts src/simulation/urban/UrbanFabricDomain.ts src/simulation/urban/UrbanBuildingView.ts src/simulation/core/SimulationCore.ts tests/urban-condition.test.ts
git commit -m "feat: add deterministic building condition lifecycle"
```

---

### Task 6: Renovation Projects, Exclusivity, and Occupancy/Firm Reconciliation

**Files:**
- Create: `src/simulation/urban/RenovationSystem.ts`
- Modify: `src/simulation/urban/UrbanTypes.ts`
- Modify: `src/simulation/urban/UrbanFabricDomain.ts`
- Modify: `src/simulation/development/RedevelopmentExecutionSystem.ts`
- Modify: `src/simulation/housing/HousingRelocationSystem.ts`
- Modify economy/firm reconciliation call sites under `src/simulation/economy/`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/urban-renovation.test.ts`

**Interfaces:**
- Produces `RenovationCommitment` containing `buildingId`, `developerId`, `startTick`, `completionTick`, `cost`, `targetCondition: 90`.
- Produces `RenovationSystem.evaluateCandidates(...)`, `start(...)`, `tick(...)`, `snapshotState()`, `restoreState()`.
- Renovation and redevelopment commitments are mutually exclusive by building ID.

- [ ] **Step 1: Write failing eligibility/exclusivity/capacity tests**

```ts
test('renovation is mutually exclusive with redevelopment and halves capacity', () => {
  const harness = makeUrbanHarness({ conditionScore: 55, lifecycleState: 'aging' });
  const commitment = harness.startRenovation();
  assert.equal(harness.view().conditionCapacityMultiplier, 0.5);
  assert.throws(() => harness.startRedevelopment(), /renovation|commitment/);
  harness.stepTo(commitment.completionTick);
  assert.equal(harness.state().conditionScore, 90);
  assert.equal(harness.state().renovationCount, 1);
  assert.equal(harness.state().lifecycleState, 'lease-up');
});
```

Add tests that condemnation/renovation capacity loss deterministically displaces excess housing allocations and prevents firm references above effective job capacity.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/urban-renovation.test.ts`
Expected: FAIL because renovation system is absent.

- [ ] **Step 3: Implement deterministic renovation pro forma and state machine**

Cost is a centralized quality/definition-adjusted fraction of replacement hard cost; duration is deterministic from definition complexity/quality. Renovation never changes definition, use mix, quality, parking, lot, or coordinates.

- [ ] **Step 4: Wire reconciliation and cleanup**

When effective capacity drops, run housing/firm reconciliation before final abandonment. Bulldoze removes semantic record and renovation commitment. Redevelopment removes old semantic state before installing replacement state. No orphan housing/service/firm references may remain.

- [ ] **Step 5: Run focused integration and full suite**

Run:
`node --experimental-strip-types --test tests/urban-renovation.test.ts tests/housing*.test.ts tests/economy*.test.ts tests/development-integration.test.ts`
`npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/urban/RenovationSystem.ts src/simulation/urban/UrbanTypes.ts src/simulation/urban/UrbanFabricDomain.ts src/simulation/development/RedevelopmentExecutionSystem.ts src/simulation/housing/HousingRelocationSystem.ts src/simulation/economy src/simulation/core/SimulationCore.ts tests/urban-renovation.test.ts
git commit -m "feat: add authoritative building renovation"
```

---

### Task 7: V8 Persistence and Deterministic V7 Migration

**Files:**
- Create: `src/save/saveV8.ts`
- Modify: `src/save/save.ts`
- Modify: `src/app/GameApp.ts`
- Modify any save-version assertions in existing tests/smokes that intentionally target the primary serializer.
- Test: `tests/save-v8.test.ts`

**Interfaces:**
- Produces `SaveV8` with `saveVersion: 8`, `gameVersion: '0.8.0-urban-fabric'`, `urbanFabricState`, renovation commitments, and semantic developer commitment fields.
- `serializeCore(core): SaveV8` becomes default.
- `hydrateCore(input)` accepts V8 and delegates V7-or-earlier through existing V7 migration before installing the B1 baseline.
- Primary UI storage key becomes `civic-foundry-save-v8`; loading falls back through V7/V6 legacy keys without deleting them.

- [ ] **Step 1: Write failing exact-save and migration tests**

```ts
test('V7 migration creates standard maintained legacy-none semantics without changing nominal metrics', () => {
  const v7 = makeV7Fixture();
  const core = hydrateCore(v7);
  const v8 = serializeCore(core);
  assert.equal(v8.saveVersion, 8);
  for (const state of v8.urbanFabricState.buildings) {
    assert.equal(state.qualityTier, 'standard');
    assert.equal(state.conditionScore, 80);
    assert.deepEqual(state.parking, { profile: 'legacy-none', spaces: 0 });
  }
});

test('V8 serialize/hydrate is authoritative-state exact', () => {
  const first = makeSemanticCore();
  const raw = JSON.stringify(serializeCore(first));
  const restored = hydrateCore(JSON.parse(raw));
  assert.equal(JSON.stringify(serializeCore(restored)), raw);
});
```

Add negative validation tests for duplicate/missing semantic records, bad area shares, invalid enums, bad parking, abandoned occupancy, and renovation/redevelopment conflicts.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/save-v8.test.ts`
Expected: FAIL because V8 serializer is absent.

- [ ] **Step 3: Implement V8 envelope and migration**

Do not mutate V7 data before the existing V7 hydrator validates it. Migrate after obtaining a valid `SimulationCore`. Set `conditionEstablishedTick` and `lastConditionTick` to the migration tick; do not create historical samples. First wear update is the next 100-tick boundary after migration.

- [ ] **Step 4: Update primary UI save slot and preserve legacy fallback**

Change the button copy/notifications to V8 and write `civic-foundry-save-v8`. Keep explicit fallback reads of V7 then V6 keys for compatibility. Update browser tests only where they assert the primary current save version; never rewrite legacy-version unit fixtures that intentionally test old migration.

- [ ] **Step 5: Run save tests, smokes that exercise save/load, and full suite**

Run:
`node --experimental-strip-types --test tests/save-v8.test.ts tests/save*.test.ts`
`npm test`
`npm run build`
`npm run smoke:phase6`
`npm run smoke:phase7`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/save/saveV8.ts src/save/save.ts src/app/GameApp.ts tests/save-v8.test.ts tests/smoke
 git commit -m "feat: add V8 urban fabric persistence"
```

---

### Task 8: Inspector and Semantic Analytical Overlays

**Files:**
- Create: `src/rendering/UrbanOverlayLayer.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/rendering/passes/OverlayRenderPass.ts`
- Test: `tests/urban-presentation.test.ts`

**Interfaces:**
- Adds `UrbanOverlayMode = 'none' | 'quality' | 'condition' | 'mixed-use' | 'parking' | 'renovation-status'`.
- `mapUrbanOverlay(core, mode)` returns projected-cell scalar/category data derived only from `UrbanBuildingView`/`UrbanFabricDomain`.
- Inspector shows definition/dominant zone, use mix percentages/capacities, quality, condition score/band, lifecycle, age ticks, parking profile/spaces, developer/project info, maintenance adequacy trace, renovation/redevelopment state.

- [ ] **Step 1: Write failing presentation mapping tests**

```ts
test('condition overlay is sourced from authoritative semantic state', () => {
  const core = makeSemanticCore({ conditionScore: 42, lifecycleState: 'neglected' });
  const cells = mapUrbanOverlay(core, 'condition');
  assert.equal(cells[0]?.band, 'neglected');
});
```

Add tests that overlays remain mutually exclusive with existing traffic/service/transit/economy modes and that inspector percentages derive from basis points exactly.

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/urban-presentation.test.ts`
Expected: FAIL because overlay/inspection mapping does not exist.

- [ ] **Step 3: Implement UI and projection integration**

Use the existing Pass A projected-diamond overlay painter and camera. Do not create a second projection path. Keep overlays above objects/vehicles according to current compositor contract and selection above analytical overlays.

- [ ] **Step 4: Run presentation tests, typecheck, and Pass A interaction smoke**

Run:
`node --experimental-strip-types --test tests/urban-presentation.test.ts`
`npm run typecheck`
`npm run smoke:isometric`
Expected: PASS with pan/zoom/rotation unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/UrbanOverlayLayer.ts src/ui/Inspector.ts src/app/GameApp.ts src/rendering/WorldRenderer.ts src/rendering/passes/OverlayRenderPass.ts tests/urban-presentation.test.ts
git commit -m "feat: expose semantic urban inspection and overlays"
```

---

### Task 9: Layered B1 Raster Art, Manifest Coverage, and Object Composition

**Files:**
- Modify: `src/rendering/assets/AssetTypes.ts`
- Modify: `src/rendering/assets/AssetManifest.ts`
- Modify: `src/rendering/assets/VariantSelector.ts`
- Modify: `src/rendering/passes/ObjectRenderPass.ts`
- Modify: `tools/isometric_art.py`
- Modify: `tools/render_isometric_atlases.py`
- Modify: `assets/isometric/manifest.json`
- Extend asset validation tests, or create `tests/urban-art-manifest.test.ts`

**Interfaces:**
- Adds semantic layer categories for `building-base`, `mixed-use-detail`, `quality-detail`, `condition-detail`, `parking-site`, `renovation-prop` while preserving existing Pass A asset IDs/fallback behavior.
- Stable architectural `variantKey` depends on building identity/family, not condition/quality/camera list order.
- Layer resolution accepts authoritative `qualityTier`, derived condition band/lifecycle, parking profile, mixed-use prototype, and orientation.

- [ ] **Step 1: Write failing manifest-coverage and stable-identity tests**

```ts
test('semantic layers do not change architectural base identity', () => {
  const base = selectUrbanBaseVariant('building:1', familyEntries, 0);
  const rotated = selectUrbanBaseVariant('building:1', familyEntries, 3);
  const neglected = selectUrbanBaseVariant('building:1', familyEntries, 0, { condition: 'neglected' });
  assert.equal(base.variantKey, rotated.variantKey);
  assert.equal(base.variantKey, neglected.variantKey);
});
```

Validator coverage must require at least five base variants for each existing low/medium/high R/C/I family where the manifest marks the family `b1-diverse`, at least four for each new mixed-use prototype, and nonblank coverage for every quality/condition/parking/renovation semantic layer required by the spec.

- [ ] **Step 2: Run RED asset tests/validation**

Run:
`node --experimental-strip-types --test tests/urban-art-manifest.test.ts`
`npm run validate:assets`
Expected: FAIL on missing B1 layer coverage.

- [ ] **Step 3: Expand deterministic original art generator and manifest**

Generate restrained North American architecture with explicit orientation frames for asymmetric sprites. Quality changes materials/detail rather than hue alone. Condition layers may show wear/boarding/scaffolding only for matching semantic state and must not imply fire/flood/crime. Parking treatment stays inside the existing logical footprint.

- [ ] **Step 4: Compose semantic layers in `ObjectRenderPass`**

Draw site/parking → base architecture → mixed-use detail → quality detail → condition detail → renovation/condemnation props using one depth command per building and internal ordered layer paints. Preserve culling before paint and Pass A rotation/picking contracts.

- [ ] **Step 5: Run asset validation/build and visual unit checks**

Run:
`node --experimental-strip-types --test tests/urban-art-manifest.test.ts`
`npm run validate:assets`
`npm run build`
`npm run smoke:isometric-visual`
Expected: PASS and zero missing-asset diagnostics.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/assets src/rendering/passes/ObjectRenderPass.ts tools/isometric_art.py tools/render_isometric_atlases.py assets/isometric/manifest.json tests/urban-art-manifest.test.ts
git commit -m "feat: add layered semantic urban art"
```

---

### Task 10: Scale, Browser/Visual Validation, CI Gate, and Production Report

**Files:**
- Create: `tests/urban-scale.test.ts`
- Create: `tests/smoke/urban_b1_smoke.py`
- Create: `tests/smoke/urban_b1_visual_smoke.py`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/art/PASS_B1_REPORT.md`

**Interfaces:**
- Adds scripts `smoke:urban-b1`, `smoke:urban-b1-visual`, and `test:urban-scale`.
- CI retains all prior gates and appends B1 scale/browser/visual/save migration gates.
- Production report records exact final head/run IDs only after execution.

- [ ] **Step 1: Write the 10,000-record scale test**

```ts
test('urban fabric validates and snapshots 10,000 deterministic records', () => {
  const domain = new UrbanFabricDomain();
  const ids: string[] = [];
  for (let i = 0; i < 10_000; i += 1) {
    const id = `building:${i}`;
    ids.push(id);
    domain.install(makeSyntheticUrbanState(id, i));
  }
  domain.validateAgainst(new Set(ids));
  const first = JSON.stringify(domain.snapshotState());
  const second = JSON.stringify(domain.snapshotState());
  assert.equal(second, first);
  assert.equal(domain.list().length, 10_000);
});
```

Do not assert wall-clock timing in CI; record elapsed telemetry for diagnosis while testing bounded O(n) operations and deterministic output.

- [ ] **Step 2: Write B1 browser smoke**

The smoke must use the real UI and verify:
- mixed-use building exists and inspector reports both uses;
- each semantic overlay aligns before/after pan/zoom and all four rotations;
- V8 save/load returns exact authoritative semantic state;
- condition/renovation state is visible only when authoritative;
- no page errors or missing-asset diagnostics.

- [ ] **Step 3: Write B1 visual smoke**

Create at least eight deterministic scenes covering: mixed-use medium, mixed-use high, all four quality tiers, maintained/aging/neglected/abandoned/renovating states, reduced/standard/abundant/structured parking, and a dense heterogeneous city. Analyze Playwright screenshot bytes through Pillow, not live `getImageData()`, to avoid canvas-taint failures from atlas images.

Each scene must enforce a PNG byte floor, visible-sample floor, luminance range, sampled-color floor, and zero asset diagnostics; thresholds must be calibrated from the first known-good B1 screenshots and then committed as constants in the smoke script.

- [ ] **Step 4: Add scripts and CI without removing prior gates**

`package.json` must retain the audit linter and Pass A asset/smoke commands. `.github/workflows/ci.yml` order:

1. tests;
2. typecheck;
3. independent lint;
4. asset-source validation;
5. build;
6. Phase 6 browser smoke;
7. Phase 7 browser smoke;
8. Pass A interaction smoke;
9. Pass A visual smoke;
10. B1 scale test;
11. B1 semantic browser smoke;
12. B1 dense-city visual smoke.

- [ ] **Step 5: Run complete local/CI-equivalent gate**

Run:
`npm test`
`npm run typecheck`
`npm run lint`
`npm run validate:assets`
`npm run build`
`npm run smoke:phase6`
`npm run smoke:phase7`
`npm run smoke:isometric`
`npm run smoke:isometric-visual`
`npm run test:urban-scale`
`npm run smoke:urban-b1`
`npm run smoke:urban-b1-visual`
Expected: every command exits 0.

- [ ] **Step 6: Write production report from executed evidence**

`docs/art/PASS_B1_REPORT.md` must record:
- scope shipped;
- authoritative ownership boundaries;
- V7→V8 migration rules actually implemented;
- exact test count and command results;
- browser/visual scene coverage;
- asset family counts;
- defects discovered/fixed during execution;
- deferred B2/Phase 2R/3R items;
- exact verified feature-head SHA and GitHub Actions run ID.

Do not write “pending”, “expected”, or estimated pass results into the final report.

- [ ] **Step 7: Commit verification/report**

```bash
git add tests/urban-scale.test.ts tests/smoke/urban_b1_smoke.py tests/smoke/urban_b1_visual_smoke.py package.json .github/workflows/ci.yml docs/art/PASS_B1_REPORT.md
git commit -m "test: verify Semantic Urban Depth Pass B1"
```

- [ ] **Step 8: Open/review PR and verify exact PR head**

Push the implementation branch, open a PR to `main`, and require GitHub Actions success on the exact PR head. If `main` advances, reconcile normally, rerun the entire gate on the reconciled head, then merge using expected-head SHA protection. After merge, require the push-triggered CI run on the merged `main` SHA to pass the same full gate.

---

## Plan-Level Acceptance Checklist

Before claiming B1 complete, verify all of the following against executed evidence:

- [ ] Every live V8 building has exactly one valid semantic record and no semantic record references a missing building.
- [ ] Migrated V7 buildings preserve immediate nominal resident/job/tax/utility/garbage metrics.
- [ ] Mixed-use area shares sum to 10,000 and resident/job/tax accounting reconciles without duplication.
- [ ] Development can deterministically choose legal structural definition × quality × parking tuples using component-specific market signals.
- [ ] Quality is saved authoritative state and changes cost/rent/operating-expense/condition resilience monotonically as specified.
- [ ] Private parking is saved integer inventory and affects project economics without traffic/curb semantics.
- [ ] Condition is authoritative, 100-tick deterministic, monotonic between renovations, and frame-rate independent.
- [ ] Condemnation blocks new placement and abandonment cannot retain household/firm occupancy.
- [ ] Renovation is explicit, mutually exclusive with redevelopment, halves capacity during work, and resets condition to 90 on completion.
- [ ] V8 save/load is exact; V7 migration is deterministic and emits no fabricated pre-V8 history.
- [ ] Inspector/overlays read authoritative state only and remain aligned under Pass A pan/zoom/four-rotation camera behavior.
- [ ] Layered B1 art has required family/quality/condition/parking/renovation coverage and zero missing-asset diagnostics.
- [ ] 10,000-record semantic validation/snapshot test passes deterministically.
- [ ] Existing audit, unit, typecheck, lint, build, Phase 6/7, Pass A interaction, and Pass A visual gates remain green.
- [ ] B1 browser and dense-city visual smokes pass on the exact final PR head and again on merged `main`.
