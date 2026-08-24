# Phase 7 Tenure, Housing Search & Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 7 tenure economics and persistent aggregate housing relocation/displacement as one deterministic package.

**Architecture:** Add a derived `HousingTenureSystem` and an authoritative `HousingRelocationSystem`, refactor `HousingChoiceSystem` to report from persisted allocations, then integrate the new state into redevelopment, Save V7, and the existing Land/Housing UI. Existing market-rent and development-underwriting systems remain authoritative; no individual household agents are introduced.

**Tech Stack:** TypeScript, Node 22 test runner, existing DOM/canvas UI, Save V7, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-08-23-phase-7-tenure-relocation-design.md`

## Global Constraints

- Keep `saveVersion: 7` and `gameVersion: '0.7.0-metropolitan'`.
- Preserve deterministic ordering and finite non-negative aggregate resident mass.
- No individual household/person agents.
- Market rent must come from the existing `LandHousingMarketSystem` + `DevelopmentPolicySystem` channel.
- Regular voluntary relocation runs only on the 50-tick city loop; forced displacement may reconcile immediately.
- Final exact head must pass Tests, Typecheck, Lint, Build, and the Phase 7 Chromium smoke.

---

### Task 1: Shared housing economics and tenure options

**Files:**
- Create: `src/simulation/housing/HousingEconomics.ts`
- Create: `src/simulation/housing/HousingTenureSystem.ts`
- Test: `tests/housing-tenure-relocation.test.ts`

**Interfaces:**
- Produces `HousingTenure`, band profiles, desired tenure shares, `housingAffordabilityScore()`, `housingQualityScore()`, `HousingTenureOption`, `HousingTenureSnapshot`, and `HousingTenureSystem.evaluate()`.
- Consumes current occupied residential building inputs already normalized by `SimulationCore`.

- [ ] **Step 1: Write failing tenure tests**

Create tests proving capacity conservation, deterministic intensity splits, rent passthrough, finite purchase-price/owner-cost calculations, and higher financing rates increasing monthly owner burden under identical rent conditions.

```ts
const low = system.evaluate(0.045, [{ ...base, intensity: 'low', capacity: 100, askingRent: 1000 }]);
assert.equal(low.byBuilding.home.ownershipCapacity, 60);
assert.equal(low.byBuilding.home.rentalCapacity, 40);
const highRate = system.evaluate(0.10, [{ ...base, intensity: 'low', capacity: 100, askingRent: 1000 }]);
assert.ok(highRate.byBuilding.home.monthlyOwnerCost > low.byBuilding.home.monthlyOwnerCost);
```

- [ ] **Step 2: Run CI and capture RED**

Expected: new suite fails because `HousingEconomics.ts` / `HousingTenureSystem.ts` do not exist while the existing suite remains green.

- [ ] **Step 3: Implement shared helpers and tenure system**

`HousingEconomics.ts` exports the exact Phase 7 band constants and scoring helpers. `HousingTenureSystem` implements intensity shares, purchase capitalization, and annuity owner-cost equations from the spec.

- [ ] **Step 4: Run CI to GREEN for Task 1**

Expected: tenure tests pass with no existing regressions.

- [ ] **Step 5: Commit**

Commit message: `feat: add Phase 7 housing tenure economics`.

---

### Task 2: Persistent cohort ledger and deterministic relocation

**Files:**
- Create: `src/simulation/housing/HousingRelocationSystem.ts`
- Modify: `tests/housing-tenure-relocation.test.ts`

**Interfaces:**
- Consumes `HousingTenureOption[]`, authoritative population, and optional prior state.
- Produces `HousingRelocationState`, `HousingRelocationSnapshot`, `initialize()`, `reconcile()`, `displaceBuilding()`, `snapshotState()`, and `restoreState()`.

- [ ] **Step 1: Add failing relocation tests**

Cover resident conservation, capacity limits, deterministic ordering, exact cross-tenure preference scoring, displaced-first search, unplaced-before-new entrant priority, partial cohort moves, voluntary 2% cap, severe-burden stay-in-place on failed search, and deterministic population contraction.

```ts
const first = system.reconcile({ population: 100, options });
assert.equal(first.housedResidents + first.unplacedResidents, 100);
assert.deepEqual(system.snapshotState(), repeat.snapshotState());
```

- [ ] **Step 2: Run CI and capture RED**

Expected: failures reference missing relocation subsystem/behavior only.

- [ ] **Step 3: Implement authoritative relocation state**

Use merged `(buildingId, band, tenure)` allocations, explicit unplaced cohorts, strict priority queues, reserved-current-slot behavior for burdened movers, stable candidate ordering, and cumulative/per-cycle diagnostics.

- [ ] **Step 4: Run CI to GREEN for Task 2**

Expected: all relocation unit tests pass.

- [ ] **Step 5: Commit**

Commit message: `feat: add deterministic housing relocation ledger`.

---

### Task 3: Refactor housing choice and integrate core orchestration

**Files:**
- Modify: `src/simulation/housing/HousingChoiceSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/housing-choice-redevelopment.test.ts`
- Modify: `tests/housing-tenure-relocation.test.ts`

**Interfaces:**
- `HousingChoiceSystem.evaluate()` consumes tenure options plus relocation snapshot/state and reports existing public affordability/building fields from authoritative allocations.
- `SimulationCore` exposes `housingTenureSnapshot` and `housingRelocationSnapshot` and adds the 50-tick housing pipeline.

- [ ] **Step 1: Add failing core integration tests**

Prove existing occupied residents persist between cycles, market/financing changes update costs without re-sorting the whole city, new population reconciles into the ledger, and current `HousingChoiceSnapshot` assigned residents match relocation allocations.

- [ ] **Step 2: Run CI and capture RED**

Expected: integration tests fail against current stateless housing choice.

- [ ] **Step 3: Refactor `HousingChoiceSystem`**

Move shared band/scoring constants to `HousingEconomics.ts`; preserve existing snapshot field names where practical. Remove authoritative fresh allocation from reporting.

- [ ] **Step 4: Wire `SimulationCore`**

Add `refreshHousingTenure()`, `reconcileHousing()`, and revised `refreshHousingChoice()`; update city-loop ordering exactly as specified. Development 10-tick refreshes remain derived-only except explicit displacement.

- [ ] **Step 5: Run CI to GREEN for Task 3**

Expected: core and pre-existing housing/redevelopment tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat: integrate persistent tenure housing into core loop`.

---

### Task 4: Redevelopment displacement and lower-income protection

**Files:**
- Modify: `src/simulation/development/DevelopmentPolicySystem.ts`
- Modify: `src/simulation/development/RedevelopmentExecutionSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/development-policy-controls.test.ts`
- Modify: `tests/redevelopment-execution.test.ts`
- Modify: `tests/housing-tenure-relocation.test.ts`

**Interfaces:**
- Adds `lowerIncomeRelocationProtection` to `DevelopmentPolicyState`, default `0.90`, bounds `[0.50, 1.00]`.
- Redevelopment admission consumes actual lower-income occupants plus lower-affordable vacancy excluding the source building.

- [ ] **Step 1: Add failing policy/redevelopment tests**

Prove default/bounds, actual-cohort displacement, spare-but-unaffordable capacity not satisfying protection, and a protective setting blocking an otherwise feasible replacement.

- [ ] **Step 2: Run CI and capture RED**

Expected: new policy field and lower-income admission behavior are missing.

- [ ] **Step 3: Implement policy and admission safeguard**

Compute lower-income affordable vacancy from tenure options using shared lower-band affordability score and exclude the candidate source building.

- [ ] **Step 4: Hook real displacement into replacement and bulldoze paths**

Snapshot relocation state before destructive replacement, call `displaceBuilding()`, restore housing state on replacement failure, and immediately reconcile after successful residential removal.

- [ ] **Step 5: Run CI to GREEN for Task 4**

Expected: existing redevelopment protections plus new lower-income protection pass.

- [ ] **Step 6: Commit**

Commit message: `feat: add housing displacement protection to redevelopment`.

---

### Task 5: Save V7 persistence and backward compatibility

**Files:**
- Modify: `src/save/saveV7.ts`
- Modify: `tests/save-v7.test.ts`
- Modify: `tests/housing-tenure-relocation.test.ts`

**Interfaces:**
- Adds optional `housingState?: HousingRelocationState` to Save V7.
- Serialization writes relocation state; hydration restores valid state or deterministic zero-history initialization when absent.

- [ ] **Step 1: Add failing persistence/validation tests**

Cover V7 round trip, old V7 missing state, V6 migration, duplicate allocation keys, missing/non-residential building refs, invalid band/tenure, non-finite/negative residents, and capacity violations.

- [ ] **Step 2: Run CI and capture RED**

Expected: housing state is not yet persisted/restored.

- [ ] **Step 3: Implement Save V7 extension and validation**

Validate before restore; do not re-sort valid persisted occupants; initialize old saves with zero historical movement counters.

- [ ] **Step 4: Run CI to GREEN for Task 5**

Expected: save compatibility suite passes.

- [ ] **Step 5: Commit**

Commit message: `feat: persist Phase 7 housing relocation state`.

---

### Task 6: Land/Housing UI, overlays, inspector, and policy control

**Files:**
- Modify: `src/ui/DevelopmentPolicyPanel.ts`
- Modify: `src/ui/LandHousingPanel.ts`
- Modify: `src/ui/LandHousingUiController.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/rendering/LandHousingOverlayLayer.ts`
- Modify: `src/styles.css`
- Modify: `tests/development-policy-presentation.test.ts`
- Modify: `tests/land-housing-presentation.test.ts`
- Modify: `tests/smoke/phase7_land_housing_smoke.py`

**Interfaces:**
- Adds one policy percent input for lower-income relocation protection.
- Adds tenure/relocation metrics and overlay modes `tenure` / `relocation-pressure`.

- [ ] **Step 1: Add failing presentation tests**

Assert new metric/test IDs, policy input, inspector rows, and overlay mode selectors.

- [ ] **Step 2: Run CI and capture RED**

Expected: presentation tests fail only for missing new UI elements.

- [ ] **Step 3: Implement panel/controller/policy UI**

Render renter/owner shares, vacancy, costs, movement/displacement, unplaced residents, and lower-income slack. Apply/restore the added policy value through the existing controller.

- [ ] **Step 4: Implement overlays and inspector**

Use the exact formulas from the spec and preserve overlay mutual exclusion.

- [ ] **Step 5: Extend Chromium smoke**

Check tenure/relocation metrics, both overlays, policy update, displacement diagnostics, and save/load restoration.

- [ ] **Step 6: Run CI/presentation tests to GREEN**

Expected: unit/presentation suite passes before browser smoke.

- [ ] **Step 7: Commit**

Commit message: `feat: expose tenure and relocation intelligence`.

---

### Task 7: Long-run invariants, documentation, and exact-head verification

**Files:**
- Create or modify: `tests/housing-tenure-relocation-long-run.test.ts`
- Modify: `README.md`

**Interfaces:**
- No new runtime interfaces; closure/verification only.

- [ ] **Step 1: Add deterministic long-run invariant test**

Run repeated city/housing cycles and assert resident conservation, capacity constraints, finite values, non-negative vacancy, and identical results from identical state.

- [ ] **Step 2: Update README/roadmap**

Document tenure economics, persistent relocation/displacement, Save V7 housing state, Land/Housing UI, and Phase 7 mechanical completion.

- [ ] **Step 3: Run exact-head CI**

Required green steps: Tests, Typecheck, Lint, Build.

- [ ] **Step 4: Run Phase 7 Chromium smoke**

Required output: Phase 7 smoke success with tenure/relocation assertions included.

- [ ] **Step 5: Review PR diff and review threads**

Resolve implementation issues; do not merge with open blockers.

- [ ] **Step 6: Merge with expected-head protection**

Merge only the exact verified branch head into `main`.
