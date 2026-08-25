# Semantic Urban Depth Pass B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authoritative mixed-use, quality, condition/lifecycle, private parking, renovation, V8 persistence, and state-driven isometric presentation while preserving V7 gameplay parity for migrated buildings.

**Architecture:** Keep `BuildingSystem` as the compatibility owner of building identity, placement, base definition, and base construction status. Add `UrbanFabricDomain` as the sole owner of B1 semantic state keyed by building ID, expose one derived `UrbanBuildingView` adapter to downstream systems, extend development awards with semantic tuple fields, persist them in V8, and drive Pass A’s isometric renderer from those authoritative fields only.

**Tech Stack:** TypeScript 5 ES modules, Node 22 strip-types tests, Canvas2D isometric renderer, Python Playwright/Chromium browser smokes, Python/Pillow screenshot analysis, build-time atlas generation, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-semantic-urban-depth-b1-design.md`

## Global Constraints

- Same seed + authoritative state + ordered commands must remain deterministic.
- `BuildingSystem` owns identity/lot/cell/base definition/base construction state; `UrbanFabricDomain` owns B1 semantics.
- Presentation must not manufacture mixed-use, quality, condition, parking, or lifecycle state.
- V7 saves migrate to V8 without fabricated pre-V8 condition history.
- Migrated V7 buildings preserve immediate resident capacity, job capacity, tax base, utility demand, and garbage demand.
- Use-component basis points are integers summing to exactly `10_000` per building.
- Private parking is building/site inventory only; no curb supply, occupancy, cruising, trip generation, or lane effects in B1.
- Formal parks/recreation, arbitrary parcel geometry, ownership/assembly, FAR/setback UI, and unit/suite micro-simulation remain out of scope.
- Condition updates every 100 simulation ticks and must be frame-rate independent.
- No new runtime npm dependencies.
- Node 22 test-loaded TypeScript must remain erasable syntax; no constructor parameter properties.
- Every task follows TDD: write RED test, run RED, implement, run GREEN, commit.
- Existing audit, Phase 6/7, Pass A interaction, Pass A visual, lint, typecheck, build, and save regressions may not be weakened.

---

## File Map

### New files
- `src/data/urbanFabric.ts` — quality, parking, condition, renovation constants and deterministic helpers.
- `src/data/urbanPrototypes.ts` — use-component templates for the nine existing and four mixed-use definitions.
- `src/simulation/urban/UrbanTypes.ts` — B1 semantic state/snapshot types.
- `src/simulation/urban/UrbanFabricDomain.ts` — authoritative semantic records and invariants.
- `src/simulation/urban/UrbanBuildingView.ts` — derived combined building/semantic read model.
- `src/simulation/urban/UrbanDevelopmentCandidate.ts` — stable semantic candidate enumeration.
- `src/simulation/urban/UrbanConditionSystem.ts` — condition cadence and lifecycle transitions.
- `src/simulation/urban/RenovationSystem.ts` — renovation commitments and completion.
- `src/save/saveV8.ts` — V8 envelope, migration, validation.
- `src/rendering/UrbanOverlayLayer.ts` — B1 analytical overlays.
- `tests/urban-fabric-domain.test.ts`
- `tests/urban-building-view.test.ts`
- `tests/urban-mixed-use-integration.test.ts`
- `tests/urban-development-economics.test.ts`
- `tests/urban-condition.test.ts`
- `tests/urban-renovation.test.ts`
- `tests/save-v8.test.ts`
- `tests/urban-presentation.test.ts`
- `tests/urban-art-manifest.test.ts`
- `tests/urban-scale.test.ts`
- `tests/smoke/urban_b1_smoke.py`
- `tests/smoke/urban_b1_visual_smoke.py`
- `docs/art/PASS_B1_REPORT.md`

### Existing files expected to change
- `src/data/buildings.ts`
- `src/simulation/buildings/BuildingSystem.ts`
- `src/simulation/core/SimulationCore.ts`
- `src/simulation/development/DevelopmentTypes.ts`
- `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- `src/simulation/development/DeveloperMarketSystem.ts`
- `src/simulation/development/RedevelopmentExecutionSystem.ts`
- `src/simulation/housing/HousingTenureSystem.ts`
- `src/simulation/housing/HousingRelocationSystem.ts`
- `src/simulation/tax/TaxSystem.ts`
- `src/simulation/economy/FirmSystem.ts`
- `src/simulation/economy/EconomyScheduler.ts`
- `src/save/save.ts`
- `src/app/GameApp.ts`
- `src/ui/Inspector.ts`
- `src/rendering/WorldRenderer.ts`
- `src/rendering/passes/OverlayRenderPass.ts`
- `src/rendering/passes/ObjectRenderPass.ts`
- `src/rendering/assets/AssetTypes.ts`
- `src/rendering/assets/AssetManifest.ts`
- `src/rendering/assets/VariantSelector.ts`
- `tools/isometric_art.py`
- `tools/render_isometric_atlases.py`
- `assets/isometric/manifest.json`
- `package.json`
- `.github/workflows/ci.yml`

---

### Task 1: Authoritative Urban Semantic Domain

**Files:**
- Create: `src/data/urbanFabric.ts`
- Create: `src/data/urbanPrototypes.ts`
- Create: `src/simulation/urban/UrbanTypes.ts`
- Create: `src/simulation/urban/UrbanFabricDomain.ts`
- Test: `tests/urban-fabric-domain.test.ts`

**Interfaces:**
- `BuildingQualityTier = 'economy' | 'standard' | 'premium' | 'luxury'`
- `BuildingConditionBand = 'new' | 'maintained' | 'aging' | 'neglected' | 'abandoned'`
- `PrivateParkingProfile = 'legacy-none' | 'reduced' | 'standard' | 'abundant' | 'structured'`
- `UrbanLifecycleState = 'construction' | 'lease-up' | 'stabilized' | 'aging' | 'neglected' | 'renovating' | 'condemned' | 'abandoned'`
- `UrbanFabricDomain.install/get/list/remove/replace/snapshotState/restoreState/validateAgainst`

- [ ] **Step 1: Write the failing domain test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';

test('mixed-use semantic state conserves basis points and rejects invalid shares', () => {
  const domain = new UrbanFabricDomain();
  domain.install({
    buildingId: 'building:lot:1,1',
    useComponents: [
      { use: 'residential', areaShareBps: 7500, residentCapacity: 24, jobCapacity: 0, taxBase: 300 },
      { use: 'commercial', areaShareBps: 2500, residentCapacity: 0, jobCapacity: 8, taxBase: 100 },
    ],
    qualityTier: 'standard', conditionScore: 100, lifecycleState: 'lease-up',
    conditionEstablishedTick: 0, lastConditionTick: 0, renovationCount: 0,
    parking: { profile: 'standard', spaces: 8 },
  });
  assert.equal(domain.list().length, 1);
  assert.throws(() => domain.install({
    ...domain.list()[0]!, buildingId: 'bad',
    useComponents: [{ use: 'residential', areaShareBps: 9000, residentCapacity: 10, jobCapacity: 0, taxBase: 100 }],
  }), /10,000/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-fabric-domain.test.ts`
Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement validation and immutable snapshots**

Use explicit validation:

```ts
export function validateUseComponents(items: readonly UrbanUseComponent[]): void {
  if (items.length === 0) throw new Error('urban use components must be non-empty');
  if (items.reduce((sum, item) => sum + item.areaShareBps, 0) !== 10_000) {
    throw new Error('urban use area shares must sum to 10,000');
  }
  for (const item of items) {
    if (!Number.isInteger(item.areaShareBps) || item.areaShareBps <= 0) throw new Error('areaShareBps must be a positive integer');
    if (item.use === 'residential' && item.jobCapacity !== 0) throw new Error('residential component cannot own job capacity');
    if (item.use !== 'residential' && item.residentCapacity !== 0) throw new Error('non-residential component cannot own resident capacity');
    for (const value of [item.residentCapacity, item.jobCapacity, item.taxBase]) {
      if (!Number.isFinite(value) || value < 0) throw new Error('component values must be finite and non-negative');
    }
  }
}
```

`restoreState()` must reject duplicate IDs, bad enums, non-integer/negative parking, condition outside `[0,100]`, unknown building references, and strict V8 missing records.

- [ ] **Step 4: Run GREEN and regression suite**

Run: `node --experimental-strip-types --test tests/urban-fabric-domain.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/urbanFabric.ts src/data/urbanPrototypes.ts src/simulation/urban/UrbanTypes.ts src/simulation/urban/UrbanFabricDomain.ts tests/urban-fabric-domain.test.ts
git commit -m "feat: add authoritative urban fabric domain"
```

---

### Task 2: V7-Parity `UrbanBuildingView`

**Files:**
- Create: `src/simulation/urban/UrbanBuildingView.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/urban-building-view.test.ts`

**Interfaces:**
- `buildUrbanBuildingView(building,state)` returns residential/commercial/industrial capacity, `jobCapacity`, `taxBaseByUse`, total tax base, power/water/garbage demand, occupancy eligibility, condition capacity multiplier, quality tier, and parking.
- `SimulationCore` gains `readonly urbanFabric`, `urbanBuildingView(buildingId)`, `urbanBuildingViews()`, and `initializeUrbanFabricFromLegacy(migrationTick)`.

- [ ] **Step 1: Write failing parity test**

```ts
test('legacy baseline reproduces V7 nominal metrics', () => {
  const core = seededCoreWithCompletedBuildings();
  core.initializeUrbanFabricFromLegacy(core.clock.tick);
  for (const building of core.buildings.list()) {
    const def = definitionForBuilding(building);
    const view = core.urbanBuildingView(building.id)!;
    assert.equal(view.residentialCapacity, def.residentCapacity);
    assert.equal(view.jobCapacity, def.jobCapacity);
    assert.equal(view.taxBase, def.taxBase);
    assert.equal(view.powerDemand, def.powerDemand);
    assert.equal(view.waterDemand, def.waterDemand);
    assert.equal(view.garbageGeneration, def.garbageGeneration);
  }
});
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-building-view.test.ts`
Expected: FAIL on missing APIs.

- [ ] **Step 3: Implement exact legacy baseline**

```ts
qualityTier: 'standard'
conditionScore: 80
parking: { profile: 'legacy-none', spaces: 0 }
lifecycleState: building.status === 'construction' ? 'construction' : 'stabilized'
conditionEstablishedTick: migrationTick
lastConditionTick: migrationTick
renovationCount: 0
```

Use one single-use component with `areaShareBps: 10_000`. `BuildingSystem` may expose synchronization hooks but must not own semantic fields.

- [ ] **Step 4: Run GREEN and full tests**

Run: `node --experimental-strip-types --test tests/urban-building-view.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/urban/UrbanBuildingView.ts src/simulation/core/SimulationCore.ts src/simulation/buildings/BuildingSystem.ts tests/urban-building-view.test.ts
git commit -m "feat: add urban building parity adapter"
```

---

### Task 3: Mixed-Use Definitions and Capacity/Tax Consumers

**Files:**
- Modify: `src/data/buildings.ts`
- Modify: `src/data/urbanPrototypes.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/housing/HousingTenureSystem.ts`
- Modify: `src/simulation/housing/HousingRelocationSystem.ts`
- Modify: `src/simulation/tax/TaxSystem.ts`
- Modify: `src/simulation/economy/FirmSystem.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`
- Test: `tests/urban-mixed-use-integration.test.ts`

**Interfaces:**
- Add structural definitions `residential_mainstreet_mixed`, `residential_urban_mixed`, `commercial_mixed_block`, `commercial_mixed_tower`.
- Add derived `UrbanBusinessSite = { buildingId, dominantZone, commercialJobCapacity, industrialJobCapacity, totalJobCapacity, occupancyEligible }` for `FirmSystem`/`EconomyScheduler` instead of raw zone-only eligibility.
- `TaxSystem.calculateUrbanRevenue(views)` taxes `taxBaseByUse` exactly once per use.
- `HousingTenureSystem` receives only effective residential capacity.

- [ ] **Step 1: Write failing mixed-use accounting test**

```ts
test('mixed-use capacity and tax are allocated once', () => {
  const view = makeMixedUseView({ residentialCapacity: 24, commercialJobCapacity: 8, residentialTaxBase: 300, commercialTaxBase: 100 });
  assert.equal(view.residentialCapacity, 24);
  assert.equal(view.jobCapacity, 8);
  assert.equal(view.taxBase, 400);
  const revenue = tax.calculateUrbanRevenue([view]);
  assert.equal(revenue.total, 300 * tax.getRate('residential') + 100 * tax.getRate('commercial'));
});
```

Also assert housing sees `24`, firm eligibility sees `8`, and residential capacity is never passed as jobs.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-mixed-use-integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add four explicit prototypes and compatibility envelope**

Use explicit component capacities/tax allocation; never derive unlike resident/job units from area share. Industrial stays single-use. Existing zone remains dominant-use envelope: low R/C single-use only, medium/high R/C may use equal-intensity dominant mixed-use, industrial single-use.

- [ ] **Step 4: Replace exact consumers**

- `SimulationCore.ts`: construct stable sorted `UrbanBuildingView[]` and pass derived capacities.
- `HousingTenureSystem.ts` / `HousingRelocationSystem.ts`: use residential component capacity only.
- `TaxSystem.ts`: accept per-use component tax bases.
- `FirmSystem.ts`: replace `syncEligibleBuildings(buildings: Building[])` with `syncEligibleSites(sites: UrbanBusinessSite[])`; cap firm job capacity by the site’s effective job capacity.
- `EconomyScheduler.ts`: replace `EconomyTickInputs.buildings?: Building[]` with `businessSites?: UrbanBusinessSite[]`; cache sites by building ID and close/reconcile firms when a site becomes ineligible or loses capacity.

- [ ] **Step 5: Run GREEN plus housing/economy/development regressions**

Run: `node --experimental-strip-types --test tests/urban-mixed-use-integration.test.ts tests/development-integration.test.ts tests/economy-integration.test.ts tests/housing*.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/buildings.ts src/data/urbanPrototypes.ts src/simulation/core/SimulationCore.ts src/simulation/housing/HousingTenureSystem.ts src/simulation/housing/HousingRelocationSystem.ts src/simulation/tax/TaxSystem.ts src/simulation/economy/FirmSystem.ts src/simulation/economy/EconomyScheduler.ts tests/urban-mixed-use-integration.test.ts
git commit -m "feat: integrate authoritative mixed-use capacity"
```

---

### Task 4: Quality and Private-Parking Development Economics

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
- `UrbanDevelopmentCandidate = { definitionId, qualityTier, parkingProfile, parkingSpaces, useMixKey }`.
- Candidate order: definition ID → quality rank (`economy`, `standard`, `premium`, `luxury`) → parking rank (`reduced`, `standard`, `abundant`, `structured`).
- `DevelopmentFeasibilityResult`, bid, award, and commitment carry `qualityTier`, `parkingProfile`, `parkingSpaces`, `useMixKey`.

- [ ] **Step 1: Write failing ordering/monotonicity tests**

```ts
test('semantic candidate order is insertion-order independent', () => {
  const a = enumerateUrbanCandidates(shuffledDefinitionsA(), context());
  const b = enumerateUrbanCandidates(shuffledDefinitionsB(), context());
  assert.deepEqual(a, b);
});

test('quality construction cost increases monotonically', () => {
  assert.ok(profile('economy').hardConstructionCost < profile('standard').hardConstructionCost);
  assert.ok(profile('standard').hardConstructionCost < profile('premium').hardConstructionCost);
  assert.ok(profile('premium').hardConstructionCost < profile('luxury').hardConstructionCost);
});
```

Add deterministic parking baseline/profile/cost tests.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-development-economics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement component-specific feasibility**

Use separate R/C/I demand/rent/vacancy signals per component, centralized quality multipliers, premium/luxury access/service threshold increments, deterministic parking baseline rounding, explicit parking cost, and reduced-parking rent penalty only when person accessibility is weak. Do not add traffic benefits for abundant parking.

- [ ] **Step 4: Persist semantic fields through bids/awards/commitments and install winning state**

Award creation must install exact semantic tuple in `UrbanFabricDomain` when the building is created/replaced.

- [ ] **Step 5: Run GREEN and all development tests**

Run: `node --experimental-strip-types --test tests/urban-development-economics.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/urban/UrbanDevelopmentCandidate.ts src/data/urbanFabric.ts src/simulation/development/DevelopmentTypes.ts src/simulation/development/DevelopmentFeasibilitySystem.ts src/simulation/development/DeveloperMarketSystem.ts src/simulation/core/SimulationCore.ts tests/urban-development-economics.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts
git commit -m "feat: add quality and parking development economics"
```

---

### Task 5: Condition Cadence and Lifecycle

**Files:**
- Create: `src/simulation/urban/UrbanConditionSystem.ts`
- Modify: `src/simulation/urban/UrbanFabricDomain.ts`
- Modify: `src/simulation/urban/UrbanBuildingView.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`
- Test: `tests/urban-condition.test.ts`

**Interfaces:**
- `calculateMaintenanceAdequacy(input)` returns a clamped score plus contribution trace.
- `UrbanConditionSystem.updateThroughTick(targetTick, context)` processes every crossed 100-tick boundary in building-ID order.
- Effective capacity: new/maintained/aging `1.0`; neglected `0.85`; renovating `0.5`; condemned/abandoned new-placement eligibility `0`; abandoned effective capacity `0`.

- [ ] **Step 1: Write failing cadence/wear tests**

```ts
test('chunked stepping equals one-tick stepping', () => {
  const a = makeConditionHarness();
  const b = makeConditionHarness();
  a.step(1000);
  for (let i = 0; i < 1000; i += 1) b.step(1);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('condition never improves without renovation', () => {
  const h = makeConditionHarness({ conditionScore: 80 });
  h.step(5000);
  assert.ok(h.state().conditionScore <= 80);
});
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-condition.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement 100-tick wear and adequacy trace**

Inputs are occupancy utilization, utility ratio, service/neighborhood quality, current market rent strength by use, and firm distress from `EconomyScheduler`. Adequacy may slow/accelerate wear but cannot reverse it. Quality resilience scales wear directionally.

- [ ] **Step 4: Implement lifecycle transitions**

Completion → `lease-up` at 100. First successful occupancy/firm reconciliation or 300 ticks → `stabilized`. Score below 70 → `aging`, below 50 → `neglected`, below 25 → `condemned`. `abandoned` requires zero housing allocations and zero active firm.

- [ ] **Step 5: Run GREEN and full tests**

Run: `node --experimental-strip-types --test tests/urban-condition.test.ts tests/core-city-loop.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/urban/UrbanConditionSystem.ts src/simulation/urban/UrbanFabricDomain.ts src/simulation/urban/UrbanBuildingView.ts src/simulation/core/SimulationCore.ts src/simulation/economy/EconomyScheduler.ts tests/urban-condition.test.ts
git commit -m "feat: add deterministic building condition lifecycle"
```

---

### Task 6: Renovation and Reconciliation

**Files:**
- Create: `src/simulation/urban/RenovationSystem.ts`
- Modify: `src/simulation/urban/UrbanTypes.ts`
- Modify: `src/simulation/urban/UrbanFabricDomain.ts`
- Modify: `src/simulation/development/RedevelopmentExecutionSystem.ts`
- Modify: `src/simulation/housing/HousingRelocationSystem.ts`
- Modify: `src/simulation/economy/FirmSystem.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/urban-renovation.test.ts`

**Interfaces:**
- `RenovationCommitment = { buildingId, developerId, startTick, completionTick, cost, targetCondition: 90 }`.
- `RenovationSystem.evaluateCandidates/start/tick/snapshotState/restoreState`.
- Renovation and redevelopment are mutually exclusive by building ID.

- [ ] **Step 1: Write failing renovation test**

```ts
test('renovation halves capacity, blocks redevelopment, and restores condition to 90', () => {
  const h = makeUrbanHarness({ conditionScore: 55, lifecycleState: 'aging' });
  const job = h.startRenovation();
  assert.equal(h.view().conditionCapacityMultiplier, 0.5);
  assert.throws(() => h.startRedevelopment(), /renovation|commitment/);
  h.stepTo(job.completionTick);
  assert.equal(h.state().conditionScore, 90);
  assert.equal(h.state().renovationCount, 1);
  assert.equal(h.state().lifecycleState, 'lease-up');
});
```

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-renovation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement deterministic renovation pro forma/state machine**

Cost = centralized quality/definition-adjusted fraction of replacement hard cost. Duration derives deterministically from definition complexity/quality. Renovation never changes definition, use mix, quality, parking, lot, or coordinates.

- [ ] **Step 4: Reconcile housing/firms and cleanup**

When effective capacity drops, `HousingRelocationSystem` displaces excess residential allocations deterministically; `FirmSystem`/`EconomyScheduler` cap/close firm occupancy above effective job capacity. Bulldoze removes semantic state and active renovation commitment. Redevelopment removes old semantic state before installing replacement semantic state.

- [ ] **Step 5: Run GREEN and integration suite**

Run: `node --experimental-strip-types --test tests/urban-renovation.test.ts tests/housing*.test.ts tests/economy*.test.ts tests/development-integration.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/urban/RenovationSystem.ts src/simulation/urban/UrbanTypes.ts src/simulation/urban/UrbanFabricDomain.ts src/simulation/development/RedevelopmentExecutionSystem.ts src/simulation/housing/HousingRelocationSystem.ts src/simulation/economy/FirmSystem.ts src/simulation/economy/EconomyScheduler.ts src/simulation/core/SimulationCore.ts tests/urban-renovation.test.ts
git commit -m "feat: add authoritative building renovation"
```

---

### Task 7: V8 Persistence and V7 Migration

**Files:**
- Create: `src/save/saveV8.ts`
- Modify: `src/save/save.ts`
- Modify: `src/app/GameApp.ts`
- Test: `tests/save-v8.test.ts`
- Update only primary-current-version assertions in `tests/smoke/phase6_smoke.py`, `tests/smoke/phase7_smoke.py`, and Pass A smokes if they assert the default save version.

**Interfaces:**
- `SaveV8`: `saveVersion: 8`, `gameVersion: '0.8.0-urban-fabric'`, all V7 authoritative state, `urbanFabricState`, renovation commitments, semantic developer commitment fields.
- `serializeCore(core): SaveV8` default.
- `hydrateCore(input)` accepts V8 and older saves through existing V7 migration.
- Primary storage key `civic-foundry-save-v8`; fallback reads V7 then V6 keys.

- [ ] **Step 1: Write failing V8/migration tests**

```ts
test('V7 migration establishes explicit B1 baseline', () => {
  const core = hydrateCore(makeV7Fixture());
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 8);
  for (const state of save.urbanFabricState.buildings) {
    assert.equal(state.qualityTier, 'standard');
    assert.equal(state.conditionScore, 80);
    assert.deepEqual(state.parking, { profile: 'legacy-none', spaces: 0 });
  }
});

test('V8 round trip is byte-equivalent authoritative state', () => {
  const raw = JSON.stringify(serializeCore(makeSemanticCore()));
  assert.equal(JSON.stringify(serializeCore(hydrateCore(JSON.parse(raw)))), raw);
});
```

Add rejection tests for duplicates, missing live records, bad shares/enums/parking/condition, abandoned occupancy, and conflicting commitments.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/save-v8.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement envelope/migration/validation**

Hydrate older saves through existing V7 logic first, then establish B1 baseline. Set `conditionEstablishedTick` and `lastConditionTick` to migration tick; first wear update occurs only at the next 100-tick boundary.

- [ ] **Step 4: Update primary UI save slot**

Button/notification copy becomes V8. Write `civic-foundry-save-v8`; read V8, then V7, then V6. Do not alter legacy fixture semantics.

- [ ] **Step 5: Run GREEN plus save/browser regression**

Run: `node --experimental-strip-types --test tests/save-v8.test.ts tests/save*.test.ts && npm test && npm run build && npm run smoke:phase6 && npm run smoke:phase7`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/save/saveV8.ts src/save/save.ts src/app/GameApp.ts tests/save-v8.test.ts tests/smoke/phase6_smoke.py tests/smoke/phase7_smoke.py tests/smoke/isometric_pass_a_smoke.py tests/smoke/isometric_visual_smoke.py
git commit -m "feat: add V8 urban fabric persistence"
```

---

### Task 8: Inspector and Analytical Overlays

**Files:**
- Create: `src/rendering/UrbanOverlayLayer.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/rendering/passes/OverlayRenderPass.ts`
- Test: `tests/urban-presentation.test.ts`

**Interfaces:**
- `UrbanOverlayMode = 'none' | 'quality' | 'condition' | 'mixed-use' | 'parking' | 'renovation-status'`.
- `mapUrbanOverlay(core, mode)` derives all overlay values from `UrbanFabricDomain`/`UrbanBuildingView`.

- [ ] **Step 1: Write failing overlay/inspector test**

```ts
test('condition overlay uses authoritative semantic state', () => {
  const core = makeSemanticCore({ conditionScore: 42, lifecycleState: 'neglected' });
  assert.equal(mapUrbanOverlay(core, 'condition')[0]?.band, 'neglected');
});
```

Also test exact use-mix percentages from basis points and mutual exclusion with existing traffic/service/transit/economy overlays.

- [ ] **Step 2: Run RED**

Run: `node --experimental-strip-types --test tests/urban-presentation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement inspector fields and projected overlays**

Inspector includes definition/dominant zone, use mix/capacity, quality, condition score/band, lifecycle, age ticks, parking, developer/project data, maintenance adequacy trace, and renovation/redevelopment status. Use Pass A’s existing camera/projected diamond overlay path only.

- [ ] **Step 4: Run GREEN and interaction regression**

Run: `node --experimental-strip-types --test tests/urban-presentation.test.ts && npm run typecheck && npm run smoke:isometric`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/UrbanOverlayLayer.ts src/ui/Inspector.ts src/app/GameApp.ts src/rendering/WorldRenderer.ts src/rendering/passes/OverlayRenderPass.ts tests/urban-presentation.test.ts
git commit -m "feat: expose semantic urban inspection and overlays"
```

---

### Task 9: Layered B1 Raster Art and Manifest

**Files:**
- Modify: `src/rendering/assets/AssetTypes.ts`
- Modify: `src/rendering/assets/AssetManifest.ts`
- Modify: `src/rendering/assets/VariantSelector.ts`
- Modify: `src/rendering/passes/ObjectRenderPass.ts`
- Modify: `tools/isometric_art.py`
- Modify: `tools/render_isometric_atlases.py`
- Modify: `assets/isometric/manifest.json`
- Test: `tests/urban-art-manifest.test.ts`

**Interfaces:**
- Semantic layer categories: `building-base`, `mixed-use-detail`, `quality-detail`, `condition-detail`, `parking-site`, `renovation-prop`.
- Base architectural `variantKey` depends on building identity/family; quality/condition/parking layers may change without changing base identity.

- [ ] **Step 1: Write failing coverage/identity tests**

```ts
test('semantic overlays do not change base architectural identity', () => {
  const base = selectUrbanBaseVariant('building:1', entries, 0);
  const rotated = selectUrbanBaseVariant('building:1', entries, 3);
  const neglected = selectUrbanBaseVariant('building:1', entries, 0, { condition: 'neglected' });
  assert.equal(base.variantKey, rotated.variantKey);
  assert.equal(base.variantKey, neglected.variantKey);
});
```

Manifest coverage requires at least five base variants for each existing low/medium/high R/C/I family marked `b1-diverse`, four per mixed-use prototype, and nonblank quality/condition/parking/renovation layer coverage.

- [ ] **Step 2: Run RED validation**

Run: `node --experimental-strip-types --test tests/urban-art-manifest.test.ts && npm run validate:assets`
Expected: FAIL on missing B1 coverage.

- [ ] **Step 3: Expand original art generator/manifest**

Quality changes materials/detail, not hue alone. Condition art shows restrained wear/boarding/scaffolding only for matching state and never implies unrelated fire/flood/crime. Parking treatment stays within the existing logical footprint.

- [ ] **Step 4: Compose layers in `ObjectRenderPass`**

Order: site/parking → base architecture → mixed-use detail → quality detail → condition detail → renovation/condemnation props. Preserve culling before painting, one building depth position, rotation stability, and Pass A picking.

- [ ] **Step 5: Run GREEN asset/build/visual checks**

Run: `node --experimental-strip-types --test tests/urban-art-manifest.test.ts && npm run validate:assets && npm run build && npm run smoke:isometric-visual`
Expected: PASS with zero missing-asset diagnostics.

- [ ] **Step 6: Commit**

```bash
git add src/rendering/assets/AssetTypes.ts src/rendering/assets/AssetManifest.ts src/rendering/assets/VariantSelector.ts src/rendering/passes/ObjectRenderPass.ts tools/isometric_art.py tools/render_isometric_atlases.py assets/isometric/manifest.json tests/urban-art-manifest.test.ts
git commit -m "feat: add layered semantic urban art"
```

---

### Task 10: Scale, Browser/Visual Verification, CI, and Production Report

**Files:**
- Create: `tests/urban-scale.test.ts`
- Create: `tests/smoke/urban_b1_smoke.py`
- Create: `tests/smoke/urban_b1_visual_smoke.py`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/art/PASS_B1_REPORT.md`

**Interfaces:**
- Add scripts `test:urban-scale`, `smoke:urban-b1`, `smoke:urban-b1-visual`.
- CI keeps every current audit/Pass A gate and appends B1 scale/browser/visual gates.

- [ ] **Step 1: Write 10,000-record deterministic scale test**

```ts
test('urban domain validates and snapshots 10,000 records deterministically', () => {
  const domain = new UrbanFabricDomain();
  const ids: string[] = [];
  for (let i = 0; i < 10_000; i += 1) {
    const id = `building:${i}`;
    ids.push(id);
    domain.install(makeSyntheticUrbanState(id, i));
  }
  domain.validateAgainst(new Set(ids));
  assert.equal(JSON.stringify(domain.snapshotState()), JSON.stringify(domain.snapshotState()));
  assert.equal(domain.list().length, 10_000);
});
```

Do not use brittle wall-clock pass/fail thresholds; log elapsed telemetry while asserting deterministic bounded O(n) operations.

- [ ] **Step 2: Write B1 semantic browser smoke**

Exercise the real UI and verify mixed-use inspector fields, all B1 overlays across pan/zoom/four rotations, exact V8 save/load semantic state, lifecycle-dependent visibility, and zero page/asset diagnostics.

- [ ] **Step 3: Write B1 visual smoke**

Create at least eight deterministic scenes spanning mixed-use medium/high, all four quality tiers, maintained/aging/neglected/abandoned/renovating states, all four new-build parking profiles, and one dense heterogeneous city. Analyze Playwright screenshot bytes with Pillow rather than `getImageData()`.

- [ ] **Step 4: Add scripts and CI in exact order**

1. tests
2. typecheck
3. independent lint
4. asset validation
5. build
6. Phase 6 smoke
7. Phase 7 smoke
8. Pass A interaction smoke
9. Pass A visual smoke
10. B1 scale test
11. B1 semantic browser smoke
12. B1 dense-city visual smoke

- [ ] **Step 5: Run complete gate**

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

- [ ] **Step 6: Write `PASS_B1_REPORT.md` from executed evidence only**

Record shipped scope, ownership boundary, exact migration behavior, test count/results, browser/visual coverage, asset counts, defects/fixes, deferred B2/Phase 2R/3R work, exact verified feature SHA, and exact Actions run ID. Do not record estimated/pending pass results.

- [ ] **Step 7: Commit verification/report**

```bash
git add tests/urban-scale.test.ts tests/smoke/urban_b1_smoke.py tests/smoke/urban_b1_visual_smoke.py package.json .github/workflows/ci.yml docs/art/PASS_B1_REPORT.md
git commit -m "test: verify Semantic Urban Depth Pass B1"
```

- [ ] **Step 8: PR/merge verification**

Open the implementation PR to `main`, require the entire gate on the exact PR head, reconcile normally if `main` moves, re-run the complete gate after reconciliation, merge with expected-head SHA protection, then require the push-triggered CI run on the merged `main` SHA to pass the same gate.

---

## Final Acceptance Checklist

- [ ] Every live V8 building has exactly one valid semantic record; no semantic record references a missing building.
- [ ] Migrated V7 buildings preserve immediate nominal resident/job/tax/utility/garbage behavior.
- [ ] Mixed-use area shares sum to 10,000 and resident/job/tax accounting never duplicates value.
- [ ] Development deterministically selects legal definition × quality × parking tuples from component-specific market signals.
- [ ] Quality is authoritative and has the specified monotonic cost/rent/opex/resilience effects.
- [ ] Private parking is authoritative integer inventory with economics only, not fake traffic effects.
- [ ] Condition is authoritative, deterministic on 100-tick cadence, frame-rate independent, and non-improving without renovation.
- [ ] Condemnation blocks new placement and abandonment retains no household/firm occupancy.
- [ ] Renovation is explicit, mutually exclusive with redevelopment, halves capacity during work, and resets condition to 90.
- [ ] V8 save/load is exact; V7 migration is deterministic and creates no fabricated history.
- [ ] Inspector/overlays use authoritative state only and preserve Pass A camera/picking/depth behavior.
- [ ] Layered art has required mixed-use/quality/condition/parking/renovation coverage and zero missing-asset diagnostics.
- [ ] 10,000-record deterministic domain scale test passes.
- [ ] Existing audit/unit/typecheck/lint/build/Phase 6/7/Pass A gates remain green.
- [ ] B1 semantic and dense visual smokes pass on exact final PR head and merged `main` head.
