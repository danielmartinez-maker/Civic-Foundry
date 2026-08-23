# Phase 7 Land & Housing Market Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a deterministic derived land/housing market whose parcel rent, vacancy and land-value signals drive developer underwriting.

**Architecture:** Add one focused `LandHousingMarketSystem` under the development domain. It derives immutable zone snapshots and parcel signals from existing authoritative simulation state; `SimulationCore` refreshes it on the core-city cadence and `DevelopmentFeasibilitySystem` consumes its explicit market outputs. The slice is save-neutral because no new authoritative history is stored.

**Tech Stack:** TypeScript 5.8 ES modules, Node 22 built-in test runner, existing Civic Foundry simulation systems.

**Spec:** `docs/superpowers/specs/2026-08-22-phase-7-land-housing-market-design.md`

## Global Constraints

- V7 (`0.7.0-metropolitan`) remains the canonical save/runtime baseline.
- No Save V7 schema mutation in this slice.
- Same authoritative state must produce identical market snapshots and development outcomes.
- No `Math.random()`, wall-clock data, hidden market history, household cohorts, income bands, tenure, or occupied-parcel redevelopment.
- Existing development, economy, mobility, service, save and build behavior must remain green.

---

### Task 1: Derived land/housing market engine

**Files:**
- Create: `tests/land-housing-market.test.ts`
- Create: `src/simulation/development/LandHousingMarketSystem.ts`

**Interfaces:**
- Produces `LandHousingMarketSystem`, `LandHousingMarketSnapshot`, `ZonePropertyMarketSnapshot`, and `ParcelMarketSignal`.
- `evaluate(inputs)` updates and returns the latest immutable market snapshot.
- `parcelSignal(zone, localContext)` returns bounded parcel-level `marketPressure`, `marketRentMultiplier`, `marketVacancyRate`, and `landValueMultiplier`.

- [ ] **Step 1: Write failing unit tests**

Cover:

```ts
const scarce = system.evaluate({
  demand: { residential: 0.8, commercial: 0.2, industrial: 0.2 },
  population: 95,
  residentialCapacity: 100,
  employmentUtilization: 0.8,
  personAccessibility: 0.8,
  freightAccessibility: 0.7,
  serviceQuality: 0.8,
  utilityRatio: 1,
});
const abundant = system.evaluate({ ...same, population: 30 });
assert.ok(scarce.housingPressure > abundant.housingPressure);
assert.ok(scarce.housingRentIndex > abundant.housingRentIndex);
assert.ok(scarce.housingVacancyRate < abundant.housingVacancyRate);
```

Also test stronger commercial demand, industrial freight weighting, local service/utility penalties, deterministic deep equality, and input validation.

- [ ] **Step 2: Run CI and verify RED**

Open/update the branch PR and verify GitHub Actions fails because `LandHousingMarketSystem.ts` does not exist.

- [ ] **Step 3: Implement the minimal market system**

Use finite validation and bounded formulas. Export:

```ts
export type LandHousingMarketInputs = Readonly<{
  demand: Readonly<Record<ZoneType, number>>;
  population: number;
  residentialCapacity: number;
  employmentUtilization: number;
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  utilityRatio: number;
}>;

export type ParcelMarketContext = Readonly<{
  personAccessibility: number;
  freightAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
  frontageAccessBonus: number;
}>;
```

Keep all outputs immutable and clamped to the design bounds.

- [ ] **Step 4: Run CI and verify GREEN for unit behavior**

Expected: the new market tests pass and pre-existing tests remain green.

- [ ] **Step 5: Commit**

Commit message: `feat: add derived land housing market`

---

### Task 2: Make underwriting consume explicit market signals

**Files:**
- Modify: `src/simulation/development/DevelopmentTypes.ts`
- Modify: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify: `tests/development-feasibility.test.ts`

**Interfaces:**
- `DevelopmentParcelContext` gains required numeric fields:
  - `marketPressure`
  - `marketRentMultiplier`
  - `marketVacancyRate`
  - `landValueMultiplier`

- [ ] **Step 1: Write failing underwriting tests**

Extend `baseContext` with neutral market values and add tests proving:

```ts
const weak = system.evaluateLot(lot, [project], { ...baseContext, marketRentMultiplier: 0.8 })[0]!;
const strong = system.evaluateLot(lot, [project], { ...baseContext, marketRentMultiplier: 1.3 })[0]!;
assert.ok(strong.achievableRent > weak.achievableRent);
assert.ok(strong.returnOnCost > weak.returnOnCost);
```

Add separate vacancy and land-value monotonicity assertions.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: context/type/formulas do not yet consume the explicit market fields.

- [ ] **Step 3: Implement minimal underwriting changes**

Validate all four new fields. Replace internal price-formation formulas with:

```ts
const achievableRent = definition.baseRent * clamp(context.marketRentMultiplier, 0.50, 2.00);
const vacancyRate = clamp(context.marketVacancyRate + (definition.baseVacancy - 0.10), 0.03, 0.35);
const landValue = ZONE_BASE_LAND_VALUE[definition.zone] * clamp(context.landValueMultiplier, 0.40, 2.00);
```

Keep access/service/utility/legal gates and all cost/financing/return calculations intact.

- [ ] **Step 4: Run CI and verify GREEN**

Expected: market signal tests and existing feasibility/developer tests pass.

- [ ] **Step 5: Commit**

Commit message: `feat: drive underwriting from market signals`

---

### Task 3: Wire the market into SimulationCore

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/development-integration.test.ts`

**Interfaces:**
- `SimulationCore.landHousingMarket` is a `LandHousingMarketSystem`.
- `SimulationCore.landHousingMarketSnapshot` exposes the latest derived snapshot.
- `developmentContextForLot()` must call `parcelSignal()` and include all four market fields.

- [ ] **Step 1: Write failing integration tests**

Add a test that creates a development core, advances at least one 50-tick core-city evaluation, and asserts:

```ts
assert.ok(core.landHousingMarketSnapshot.housingRentIndex > 0);
assert.ok(core.landHousingMarketSnapshot.housingVacancyRate >= 0.03);
assert.ok(core.landHousingMarketSnapshot.housingVacancyRate <= 0.35);
assert.deepEqual(
  first.landHousingMarketSnapshot,
  second.landHousingMarketSnapshot,
);
```

Also retain the existing deterministic award test to prove integration does not break development.

- [ ] **Step 2: Run CI and verify RED**

Expected failure: `SimulationCore` has no market instance/snapshot and development contexts lack the new required fields.

- [ ] **Step 3: Implement core wiring**

Instantiate the market system in the constructor. Initialize a valid zero-city snapshot. After `DemandSystem.evaluate()` in `evaluateCoreCityLoop()`, call:

```ts
this.landHousingMarketSnapshot = this.landHousingMarket.evaluate({
  demand: this.demandSnapshot,
  population: this.population.population,
  residentialCapacity: this.buildings.residentialCapacity(),
  employmentUtilization: this.employmentSnapshot.totalJobs === 0
    ? 0
    : this.employmentSnapshot.employed / this.employmentSnapshot.totalJobs,
  personAccessibility: this.mobilitySnapshot.personAccessibility,
  freightAccessibility: this.trafficSnapshot.jobAccessibility,
  serviceQuality,
  utilityRatio: Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio),
});
```

In `developmentContextForLot()`, derive the parcel signal from the already computed local access/service/neighborhood/utility values and spread its four values into the returned context.

- [ ] **Step 4: Run CI and verify GREEN**

Expected: all test/typecheck/lint/build steps pass.

- [ ] **Step 5: Commit**

Commit message: `feat: integrate land housing market with development`

---

### Task 4: Regression verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_LOG.md`

- [ ] **Step 1: Update docs only after behavior is green**

Document that Phase 7 now has a derived land/housing market supplying rent, vacancy and land-value signals to developer pro formas, while household housing choice/redevelopment remain in progress.

- [ ] **Step 2: Run full verification**

Required GitHub Actions commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all green.

- [ ] **Step 3: Review diff for scope and determinism**

Confirm no save-format files changed, no random/time-dependent behavior entered the market system, no UI fabricated market values, and no unrelated refactor landed.

- [ ] **Step 4: Commit**

Commit message: `docs: record phase 7 land housing market progress`

- [ ] **Step 5: Merge only after required CI is green**

Use the repository's normal PR workflow and retain `main` as the canonical baseline.