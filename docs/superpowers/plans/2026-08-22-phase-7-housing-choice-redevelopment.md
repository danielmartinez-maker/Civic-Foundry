# Phase 7 Housing Choice & Redevelopment Pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic aggregate housing affordability/choice and residential redevelopment pressure that feed existing residential demand and migration without adding demographic agents or destructive redevelopment.

**Architecture:** Add a derived `HousingChoiceSystem` that allocates weighted income-band residents across occupied residential buildings and computes effective affordable capacity. `SimulationCore` feeds that effective capacity into the existing demand channel and applies a bounded affordability migration modifier. Add a derived `RedevelopmentPressureSystem` that compares current residential use value against feasible higher-intensity replacements, including demolition and displacement costs, but never mutates occupied parcels.

**Tech Stack:** TypeScript 5.8 ES modules, Node 22 built-in test runner, existing Civic Foundry deterministic simulation systems.

**Spec:** `docs/superpowers/specs/2026-08-22-phase-7-housing-choice-redevelopment-design.md`

## Global Constraints

- Canonical runtime/save baseline remains V7 `0.7.0-metropolitan`.
- This branch is stacked on `phase7-land-housing-market`; do not duplicate or remove that slice.
- No Save V7 schema mutation.
- No individual household/person objects, demographic history, tenure, leases, mortgages, or moving queues.
- No automatic demolition/replacement of occupied parcels.
- No commercial/industrial redevelopment in this slice.
- All new state is derived, immutable at the snapshot boundary, finite, bounded, and deterministic.
- No `Math.random()`, wall-clock data, hidden smoothing, or fabricated migration/redevelopment history.

---

### Task 1: Aggregate housing affordability and choice engine

**Files:**
- Create: `src/simulation/housing/HousingChoiceSystem.ts`
- Create: `tests/housing-choice.test.ts`

**Interfaces:**
- Produces `HousingChoiceSystem`, `HousingIncomeBand`, `HousingOption`, `HousingBuildingAllocation`, `HousingBandSnapshot`, and `HousingChoiceSnapshot`.
- `HousingChoiceSystem.evaluate(population: number, options: readonly HousingOption[]): HousingChoiceSnapshot` is the only mutation/evaluation entry point.
- `HousingChoiceSystem.snapshot(): HousingChoiceSnapshot` returns the latest immutable result.

- [ ] **Step 1: Write failing unit tests**

Create `tests/housing-choice.test.ts` covering:

```ts
const cheap = {
  buildingId: 'building:cheap',
  capacity: 20,
  monthlyRent: 420,
  personAccessibility: 0.75,
  serviceQuality: 0.75,
  neighborhoodQuality: 0.75,
  utilityRatio: 1,
} as const;
const expensive = { ...cheap, buildingId: 'building:expensive', monthlyRent: 900 };

const result = new HousingChoiceSystem().evaluate(30, [expensive, cheap]);
assert.ok(result.byBuilding['building:cheap']!.assignedResidents > 0);
assert.ok(result.effectiveAffordableCapacity < result.physicalCapacity);
```

Add separate assertions that:

- a modestly more expensive but materially higher-quality building can receive more residents than a lower-quality alternative;
- multiplying all rents upward lowers `effectiveAffordableCapacity` and `affordabilityIndex` and raises `costBurdenShare`;
- assignments never exceed building capacity or total population;
- reversing input option order produces deep-equal snapshots;
- empty stock yields zero capacity/assignments, all population unplaced, and affordability index `1`;
- negative/non-finite population, capacity, or rent is rejected.

- [ ] **Step 2: Run CI and verify RED**

Open a stacked PR against `phase7-land-housing-market` after the failing test commit. Expected failure: module `HousingChoiceSystem.ts` does not exist.

- [ ] **Step 3: Implement `HousingChoiceSystem` minimally**

Use these fixed profiles:

```ts
const BAND_PROFILES = Object.freeze({
  lower: { share: 0.45, monthlyIncome: 1_500, maxRentBurden: 0.35 },
  middle: { share: 0.40, monthlyIncome: 2_600, maxRentBurden: 0.32 },
  upper: { share: 0.15, monthlyIncome: 4_500, maxRentBurden: 0.28 },
});
```

Implement helpers:

```ts
function affordabilityScore(monthlyRent: number, monthlyIncome: number, maxBurden: number): number {
  const burden = monthlyRent / monthlyIncome;
  return clamp01((2 * maxBurden - burden) / maxBurden);
}

function qualityScore(option: HousingOption): number {
  return clamp01(
    0.30 * option.neighborhoodQuality
    + 0.25 * option.serviceQuality
    + 0.25 * option.personAccessibility
    + 0.20 * option.utilityRatio,
  );
}
```

Allocate bands in `upper`, `middle`, `lower` order. For each band, sort buildings by descending:

```text
choiceWeight = 0.05 + 0.60 * affordabilityScore + 0.35 * qualityScore
```

and stable `buildingId` on ties. Greedily assign weighted residents to remaining capacity.

Compute effective affordable capacity independently from assignments using the population-share-weighted affordability score per building.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the repository CI through the PR. Expected: `tests/housing-choice.test.ts` passes and all pre-existing tests remain green.

- [ ] **Step 5: Commit**

Commit message: `feat: add aggregate housing choice system`

---

### Task 2: Integrate affordability with `SimulationCore`, demand, and migration

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/development-integration.test.ts`
- Modify: `tests/core-city-loop.test.ts` if a focused demand/migration assertion belongs there; otherwise keep all new assertions in `development-integration.test.ts`.

**Interfaces:**
- `SimulationCore.housingChoice` is a `HousingChoiceSystem`.
- `SimulationCore.housingChoiceSnapshot` exposes the latest `HousingChoiceSnapshot`.
- Private `refreshHousingChoice()` derives housing options from current occupied residential buildings and current parcel market signals.
- Private parcel-local context helper is shared by housing and development underwriting.

- [ ] **Step 1: Write failing core integration tests**

Add tests proving:

```ts
core.step(100);
const housing = core.housingChoiceSnapshot;
assert.ok(Number.isFinite(housing.affordabilityIndex));
assert.ok(housing.physicalCapacity >= housing.effectiveAffordableCapacity);
assert.ok(housing.housedResidents <= core.population.population);
```

Build two otherwise-equivalent residential supply scenarios directly through deterministic systems or core fixtures where one uses lower market rents. Assert the lower-rent scenario has greater `effectiveAffordableCapacity` and that passing this value through `DemandSystem` yields lower residential demand than the same physical stock with lower effective capacity.

Add a determinism assertion for two identical cores.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: `SimulationCore` has no `housingChoice`/`housingChoiceSnapshot` integration.

- [ ] **Step 3: Refactor parcel-local context derivation**

Inside `SimulationCore.ts`, add a private helper returning:

```ts
type LocalParcelContext = Readonly<{
  roadAccessBonus: number;
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
  constructionCostIndex: number;
  zoningMaxIntensity: BuildingIntensity;
}>;
```

`developmentContextForLot()` must use this helper, then call `landHousingMarket.parcelSignal()` exactly once and return the existing `DevelopmentParcelContext`.

- [ ] **Step 4: Implement `refreshHousingChoice()`**

Instantiate `HousingChoiceSystem` in the constructor and initialize its empty snapshot.

For each occupied residential building with a matching lot:

```ts
const definition = definitionForBuilding(building);
const local = this.localParcelContextForLot(lot);
const market = this.landHousingMarket.parcelSignal('residential', {
  personAccessibility: local.personAccessibility,
  freightAccessibility: local.freightAccessibility,
  serviceQuality: local.serviceQuality,
  neighborhoodQuality: local.neighborhoodQuality,
  utilityRatio: local.utilityRatio,
  frontageAccessBonus: local.roadAccessBonus,
});

option.monthlyRent = definition.baseRent * market.marketRentMultiplier;
option.capacity = definition.residentCapacity;
```

Evaluate with current `population.population`.

- [ ] **Step 5: Wire demand and migration consequences**

In `evaluateCoreCityLoop()`:

1. call `refreshHousingChoice()` before `DemandSystem.evaluate()`;
2. pass `housingChoiceSnapshot.effectiveAffordableCapacity` as `housingCapacity`;
3. keep `PopulationSystem.update()` hard capacity equal to raw `buildings.residentialCapacity()`;
4. multiply the existing attractiveness by:

```ts
const affordabilityFactor = 0.85 + 0.15 * this.housingChoiceSnapshot.affordabilityIndex;
attractiveness = clamp01(attractiveness * affordabilityFactor);
```

5. after population update, call `refreshLandHousingMarket()` and `refreshHousingChoice()` so public metrics represent the latest market/population state.

- [ ] **Step 6: Run full CI and verify GREEN**

Expected: existing city-growth/save determinism tests remain green, plus new housing integration tests pass.

- [ ] **Step 7: Commit**

Commit message: `feat: connect housing affordability to city demand`

---

### Task 3: Residential redevelopment pressure engine

**Files:**
- Create: `src/simulation/development/RedevelopmentPressureSystem.ts`
- Create: `tests/redevelopment-pressure.test.ts`

**Interfaces:**
- Consumes existing `DevelopmentFeasibilityResult` objects only; it does not run underwriting itself.
- Produces `ResidentialRedevelopmentInput`, `ResidentialRedevelopmentPressure`, and `RedevelopmentPressureSnapshot`.
- `evaluate(inputs: readonly ResidentialRedevelopmentInput[]): RedevelopmentPressureSnapshot` updates the latest immutable snapshot.
- `snapshot(): RedevelopmentPressureSnapshot` returns it.

- [ ] **Step 1: Write failing unit tests**

Use compact fabricated feasibility results with only economically relevant fields populated through a helper. Cover:

```ts
const result = system.evaluate([{
  buildingId: 'building:1',
  lotId: 'lot:1',
  existingDefinitionId: 'residential_cottage',
  existingBaseConstructionCost: 35_000,
  assignedResidents: 5,
  existingEvaluation: existing,
  replacementEvaluations: [replacement],
}]);
assert.ok(result.parcels[0]!.pressure > 0);
```

Also assert:

- no feasible higher-intensity replacement yields zero pressure and no best replacement ID;
- a sufficiently profitable replacement yields positive pressure;
- higher `assignedResidents` lowers pressure through displacement cost;
- candidates are ranked by descending pressure then stable `lotId`;
- repeated identical inputs deep-equal;
- invalid negative/non-finite construction cost or assigned residents is rejected.

- [ ] **Step 2: Run CI and verify RED**

Expected: missing `RedevelopmentPressureSystem.ts`.

- [ ] **Step 3: Implement minimal pressure engine**

Use:

```ts
const demolitionCost = input.existingBaseConstructionCost * 0.08;
const displacementCost = input.assignedResidents * 250;
const currentUseValue = Math.max(1, input.existingEvaluation.stabilizedValue);
const replacementCostExLand = Math.max(0, candidate.totalDevelopmentCost - candidate.landValue);
const netRedevelopmentValue = candidate.stabilizedValue
  - replacementCostExLand
  - currentUseValue
  - demolitionCost
  - displacementCost;
const pressure = clamp(netRedevelopmentValue / currentUseValue, 0, 1.25);
```

Filter replacement evaluations to `legal && feasible && zone === 'residential'` and exclude `definitionId === existingDefinitionId`. `SimulationCore` is responsible for supplying only strictly higher-intensity candidates; the pressure engine remains definition-catalog agnostic.

Set `highPressureCount` at `pressure >= 0.25` and compute finite average pressure.

- [ ] **Step 4: Run focused/full CI and verify GREEN**

Expected: unit tests pass without changing existing development behavior.

- [ ] **Step 5: Commit**

Commit message: `feat: add residential redevelopment pressure`

---

### Task 4: Wire redevelopment diagnostics, document the slice, and verify

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/development-integration.test.ts`
- Modify: `tests/save-v7.test.ts` only if an explicit derived-state continuation assertion is useful; do not modify save production files.
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- `SimulationCore.redevelopmentPressure` is a `RedevelopmentPressureSystem`.
- `SimulationCore.redevelopmentPressureSnapshot` exposes the latest `RedevelopmentPressureSnapshot`.
- A dedicated private `DevelopmentFeasibilitySystem` instance computes redevelopment current/replacement economics so normal developer-market `lastEvaluations()` diagnostics are not overwritten.

- [ ] **Step 1: Write failing core redevelopment tests**

Add an integration fixture with an occupied low-intensity residential building on a parcel whose current zoning/access/utilities allow higher intensity. After a core-city refresh, assert:

```ts
const snapshot = core.redevelopmentPressureSnapshot;
assert.ok(snapshot.parcels.some((item) => item.lotId === targetLotId));
assert.ok(snapshot.parcels.every((item) => item.pressure >= 0 && item.pressure <= 1.25));
```

Create two identical cores and assert deep-equal redevelopment snapshots.

Where practical, create an intentionally weak-access case where higher-intensity replacement is not feasible and assert pressure is zero.

- [ ] **Step 2: Run CI and verify RED**

Expected: missing core redevelopment fields/wiring.

- [ ] **Step 3: Implement `refreshRedevelopmentPressure()`**

For each occupied residential building:

1. find its lot;
2. get current definition via `definitionForBuilding()`;
3. derive `DevelopmentParcelContext` via the shared helper;
4. evaluate current definition once;
5. evaluate only residential definitions with `INTENSITY_RANK[candidate.intensity] > INTENSITY_RANK[current.intensity]`;
6. read assigned residents from `housingChoiceSnapshot.byBuilding[building.id]?.assignedResidents ?? 0`;
7. pass inputs to `RedevelopmentPressureSystem.evaluate()`.

Call `refreshRedevelopmentPressure()` at the end of each 50-tick core-city loop after the final market/housing refresh.

- [ ] **Step 4: Verify save neutrality**

Do not change `src/save/saveV7.ts` or any other save production file. Existing V7 round-trip and deterministic future continuation tests must stay green. Derived housing/redevelopment snapshots may differ immediately after hydration until the next deterministic core-city evaluation; authoritative serialized state must remain identical.

- [ ] **Step 5: Update documentation**

README Phase 7 bullets should state:

- aggregate income-band affordability and housing allocation;
- effective affordable capacity feeding residential demand;
- bounded affordability effect on migration;
- residential redevelopment pressure diagnostics with demolition/displacement economics;
- actual occupied-parcel redevelopment remains deferred.

Update architecture and development log with the same causal boundaries.

- [ ] **Step 6: Run full repository verification**

Required GitHub Actions steps:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all green.

- [ ] **Step 7: Review scope/determinism**

Confirm:

- no save production file changed;
- no `Math.random()` or wall-clock input added;
- no automatic demolition or resident/firm deletion added;
- no UI-generated housing outcomes;
- new allocations/pressure are stable under input-order reversal where specified;
- only residential redevelopment is evaluated;
- branch diff remains stacked cleanly on `phase7-land-housing-market`.

- [ ] **Step 8: Commit and prepare stacked PR**

Commit message: `docs: record phase 7 housing choice progress`

Keep the PR base as `phase7-land-housing-market` until PR #8 lands; retarget to `main` only after the dependency is merged.