# Phase 7 Housing Market & Household Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's aggregate residential population loop with a deterministic adaptive-fidelity household and housing market that drives rents, ownership, migration, filtering, displacement, and residential development economics.

**Architecture:** Add a housing domain scheduler composed of focused household, income, supply, and choice systems. Weighted cohorts carry explicit residential assignments and split only when outcomes diverge; persistent building ledgers carry tenure-specific inventory, rents, sale values, vacancy, and redevelopment pressure. `SimulationCore` coordinates the housing domain, then publishes real housing economics into the existing developer pro forma/competition system while preserving V7 compatibility and deterministic replay.

**Tech Stack:** TypeScript ES modules; Node 22+ built-in `node:test`; strict `tsc`; existing browser DOM UI; deterministic simulation with no `Math.random()`.

**Spec:** `docs/superpowers/specs/2026-08-22-housing-market-household-simulation-design.md`

## Global Constraints

- Base branch is canonical V7 `main`; implementation branch is `feature/phase7-housing-market`.
- Keep save version `7` and game/package version `0.7.0-metropolitan`; this is an extension of Phase 7, not V8.
- Same seed + same commands + same save state must produce the same authoritative future state.
- No `Math.random()`, wall-clock time, unordered state-dependent iteration, or stochastic housing auctions.
- Weighted household cohorts are the default; weight-1 explicit households appear only through deterministic cohort splitting.
- A 250,000-resident-equivalent city must stabilize at a few thousand household entities, not one object per physical household.
- Housing units are conserved exactly: `rentalProductUnits = renterOccupiedUnits + vacantRentableUnits`, `forSaleProductUnits = ownerOccupiedUnits + vacantForSaleUnits`, and `rentalProductUnits + forSaleProductUnits + unavailableUnits = housingUnits`.
- Rental and for-sale supply are exclusive; a unit cannot exist in both markets simultaneously.
- Legacy `PopulationSystem.population` remains readable by existing consumers but stops independently creating/removing residents after housing activation.
- Full demographic lifecycle, detailed occupations/careers, banks, credit scores, foreclosure, housing-policy programs, and homelessness services remain out of scope.
- Residential developer underwriting must use achievable housing-market economics; positive generic residential demand alone cannot guarantee construction.
- Existing Phase 5 mobility, Phase 6 firms/freight, service systems, commercial/industrial development, and old V7 saves must remain functional.
- All work follows red-green-refactor TDD with a focused test before each implementation change.
- Final verification requires `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:smoke`.

---

## File Structure

### Create

- `src/data/housing.ts` — centralized cadence, affordability, mortgage, pricing, migration, cohort, tenure-product, and wage-bridge configuration.
- `src/simulation/housing/HousingTypes.ts` — immutable household, mortgage, building-ledger, market-input, diagnostics, development-signal, and save snapshot types.
- `src/simulation/housing/HouseholdCohortSystem.ts` — authoritative cohort state, deterministic create/split/merge/assign/displace/remove logic.
- `src/simulation/housing/HouseholdIncomeSystem.ts` — deterministic reconciliation of cohort workers against actual firm `filledJobs` and archetype wages.
- `src/simulation/housing/HousingSupplySystem.ts` — per-building housing ledgers, unit conservation, occupancy, product inventory, rent/price state.
- `src/simulation/housing/HousingChoiceSystem.ts` — rental affordability, mortgage qualification, household utility, rejection reasons, candidate ranking.
- `src/simulation/housing/HousingMarketSystem.ts` — cadence owner for conditions, household economics, pricing, search/matching, migration, displacement, merge-back, diagnostics, and comparable-market signals.
- `src/ui/HousingPanel.ts` — compact authoritative housing KPI presentation.
- `tests/housing-data.test.ts`
- `tests/household-cohorts.test.ts`
- `tests/household-income.test.ts`
- `tests/housing-supply.test.ts`
- `tests/housing-choice.test.ts`
- `tests/housing-market.test.ts`
- `tests/housing-integration.test.ts`
- `tests/housing-development.test.ts`
- `tests/housing-redevelopment.test.ts`
- `tests/housing-presentation.test.ts`
- `tests/housing-scale.test.ts`

### Modify

- `src/data/buildings.ts` — add `housingUnits` and `overcrowdingMultiplier` to every building definition.
- `src/data/economy.ts` — add housing wage values by firm archetype without changing Phase 6 production wage-cost semantics.
- `src/simulation/buildings/BuildingSystem.ts` — persist optional residential tenure-product metadata and add deterministic `removeById()` for redevelopment.
- `src/simulation/population/PopulationSystem.ts` — add authoritative `sync()` path and retain legacy `update()` only for compatibility tests/non-housing bootstrap.
- `src/simulation/traffic/TripGenerationSystem.ts` — accept explicit home-origin weights as an alternative to evenly distributing aggregate population.
- `src/simulation/mobility/PersonTripSystem.ts` — generate household-linked commuter demand when housing assignments/employer links exist.
- `src/simulation/development/DevelopmentTypes.ts` — carry housing product, market revenue, and redevelopment economics through feasibility/bids/awards/commitments.
- `src/simulation/development/DevelopmentFeasibilitySystem.ts` — evaluate tenure-specific residential products and occupied-parcel replacement costs while leaving non-residential formulas compatible.
- `src/simulation/development/DeveloperMarketSystem.ts` — product-aware IDs/ranking/preferences/commitments and deterministic residential product competition.
- `src/simulation/core/SimulationCore.ts` — instantiate housing domain, compose normalized housing conditions, synchronize population, route household travel, feed developer signals, and execute redevelopment.
- `src/save/saveV7.ts` — persist/validate/restore `housingMarket`; transparently bootstrap prior V7 saves that lack it.
- `src/ui/Inspector.ts` — expose per-building housing diagnostics for residential buildings.
- `src/app/GameApp.ts` — mount/update `HousingPanel` through a small integration point; do not add housing rendering logic directly into the large app class.
- `src/styles.css` — minimal panel/diagnostic styling consistent with existing UI.
- `tests/save-v7.test.ts` — housing round-trip, old-V7 bootstrap, corruption validation, deterministic continuation.
- `tests/development-feasibility.test.ts`, `tests/developer-market.test.ts`, `tests/development-integration.test.ts` — preserve non-residential behavior and add tenure-aware expectations.
- `tests/core-city-loop.test.ts`, `tests/city-foundation.test.ts` — adapt aggregate population assertions to housing authority only where necessary.
- `README.md`, `docs/SAVE_FORMAT.md` — document the deeper V7 housing baseline after implementation is green.

---

### Task 1: Housing data contracts and physical residential capacity

**Files:**
- Create: `src/data/housing.ts`
- Create: `src/simulation/housing/HousingTypes.ts`
- Modify: `src/data/buildings.ts`
- Modify: `src/data/economy.ts`
- Test: `tests/housing-data.test.ts`

**Interfaces:**
- Produces: `HousingProduct`, `HousingProductAllocation`, `HOUSING_CADENCE`, `HOUSING_CONFIG`, `HOUSING_PRODUCT_OPTIONS`, `LEGACY_V7_PRODUCT_RULES`, `HOUSEHOLD_WAGE_BY_ARCHETYPE`.
- Extends: `BuildingDefinition.housingUnits`, `BuildingDefinition.overcrowdingMultiplier`.
- Consumes: existing `BuildingIntensity`, `FirmArchetype`, and residential definition IDs.

- [ ] **Step 1: Write the failing catalog/config test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import {
  HOUSING_CADENCE,
  HOUSING_CONFIG,
  HOUSING_PRODUCT_OPTIONS,
  defaultLegacyProductAllocation,
} from '../src/data/housing.ts';

test('residential definitions expose physical household units and valid tenure products', () => {
  assert.deepEqual(HOUSING_CADENCE, { conditions: 10, economics: 50, market: 100, redevelopment: 250 });
  for (const definition of BUILDING_VARIANTS.residential) {
    assert.ok(definition.housingUnits > 0);
    assert.ok(definition.residentCapacity >= definition.housingUnits);
    assert.ok(definition.overcrowdingMultiplier >= 1 && definition.overcrowdingMultiplier <= 1.6);
    assert.ok(HOUSING_PRODUCT_OPTIONS[definition.id]!.length >= 1);
    const allocation = defaultLegacyProductAllocation(definition.id, definition.housingUnits);
    assert.equal(allocation.rentalUnits + allocation.forSaleUnits, definition.housingUnits);
  }
});

test('non-residential definitions cannot expose housing inventory', () => {
  for (const zone of ['commercial', 'industrial'] as const) {
    for (const definition of BUILDING_VARIANTS[zone]) assert.equal(definition.housingUnits, 0);
  }
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/housing-data.test.ts
```

Expected: FAIL because housing config and unit metadata do not exist.

- [ ] **Step 3: Add centralized housing config and exact initial constants**

Create `src/data/housing.ts` with these public contracts and first-pass calibration values:

```ts
import type { FirmArchetype } from './economy.ts';

export type HousingProduct = 'rental' | 'for_sale' | 'mixed';
export type HousingProductAllocation = Readonly<{ product: HousingProduct; rentalUnits: number; forSaleUnits: number }>;

export const HOUSING_CADENCE = Object.freeze({ conditions: 10, economics: 50, market: 100, redevelopment: 250 });

export const HOUSING_CONFIG = Object.freeze({
  targetOccupancy: 0.94,
  maxNormalRentChange: 0.03,
  severeVacancyRate: 0.25,
  maxSevereVacancyRentCut: 0.06,
  maxSalePriceChange: 0.04,
  comfortableBurden: 0.25,
  manageableBurden: 0.35,
  severeBurden: 0.50,
  maxNewMoveBurden: 0.50,
  downPaymentRatio: 0.20,
  transactionReserveRatio: 0.03,
  emergencyReserveMonths: 3,
  maxDebtServiceRatio: 0.35,
  mortgageTermYears: 30,
  ownerMoveFrictionBonus: 0.12,
  tenureMoveFrictionPerMarketCycle: 0.002,
  maxCandidateBuildings: 16,
  maxInboundHouseholdsPerMarketCycle: 24,
  outMigrationUnhousedCycles: 3,
  outMigrationSevereBurdenCycles: 4,
  cohortTargetMaxWeight: 40,
  salePriceToEffectiveRent: 180,
  sellingCostRatio: 0.06,
  demolitionCostRatio: 0.08,
  displacementCostPerHousehold: 800,
});

export const HOUSEHOLD_WAGE_BY_ARCHETYPE: Readonly<Record<FirmArchetype, number>> = Object.freeze({
  retail_local: 2_800,
  wholesale_logistics: 3_600,
  light_manufacturing: 4_200,
  assembly_manufacturing: 5_200,
});

export const HOUSING_PRODUCT_OPTIONS = Object.freeze({
  residential_cottage: ['for_sale', 'rental'] as const,
  residential_rowhouse: ['rental', 'for_sale', 'mixed'] as const,
  residential_apartment: ['rental', 'mixed'] as const,
});
```

Implement `defaultLegacyProductAllocation(definitionId, housingUnits)` deterministically as rental for apartments, 50/50 mixed for rowhouses (odd remainder assigned to rental), and for-sale for cottages. No historical mortgage is fabricated; owner cohorts bootstrapped from old V7 use `mortgage: null`.

- [ ] **Step 4: Extend `BuildingDefinition` and add exact physical unit counts**

Add:

```ts
housingUnits: number;
overcrowdingMultiplier: number;
```

Use:

```ts
residential_cottage: housingUnits = 4, overcrowdingMultiplier = 1.40
residential_rowhouse: housingUnits = 12, overcrowdingMultiplier = 1.35
residential_apartment: housingUnits = 32, overcrowdingMultiplier = 1.30
```

All commercial/industrial definitions use `housingUnits = 0` and `overcrowdingMultiplier = 1`.

Do not change the existing Phase 6 `ECONOMY_PRICES.wagePerJob`; household wage values are a separate housing-facing scale.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
node --experimental-strip-types --test tests/housing-data.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/housing.ts src/simulation/housing/HousingTypes.ts src/data/buildings.ts src/data/economy.ts tests/housing-data.test.ts
git commit -m "feat: define housing market data contracts"
```

---

### Task 2: Deterministic adaptive household cohorts

**Files:**
- Create: `src/simulation/housing/HouseholdCohortSystem.ts`
- Modify: `src/simulation/housing/HousingTypes.ts`
- Test: `tests/household-cohorts.test.ts`

**Interfaces:**
- Produces: `HouseholdCohort`, `MortgageProxy`, `HouseholdPreferenceWeights`, `HouseholdStateSnapshot`.
- Produces methods: `create()`, `list()`, `get()`, `split(id, weight, reason)`, `assignResidence()`, `markSearching()`, `markDisplaced()`, `remove()`, `mergeCompatible()`, `residentPopulation()`, `representedHouseholds()`, `snapshotState()`, `restoreState()`.
- Later tasks depend on stable IDs and exact conservation guarantees from this task.

- [ ] **Step 1: Write failing split/merge conservation tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { HouseholdCohortSystem } from '../src/simulation/housing/HouseholdCohortSystem.ts';

const seed = {
  weight: 10,
  householdSize: 3,
  workers: 2,
  employedWorkers: 1,
  employerFirmIds: ['firm:1'],
  grossIncome: 4_000,
  disposableHousingIncome: 3_200,
  tenure: 'renter' as const,
  buildingId: 'building:lot:1',
  unitRequirement: 1,
  vehicleAccess: true,
  liquidSavings: 8_000,
  mortgage: null,
};

test('cohort splitting preserves represented households population income and savings', () => {
  const system = new HouseholdCohortSystem();
  const original = system.create(seed, 0);
  const split = system.split(original.id, 3, 'capacity');
  assert.equal(split.branch.weight, 3);
  assert.equal(split.remainder.weight, 7);
  assert.equal(system.representedHouseholds(), 10);
  assert.equal(system.residentPopulation(), 30);
  assert.equal(system.list().reduce((s, h) => s + h.grossIncome * h.weight, 0), 40_000);
  assert.equal(system.list().reduce((s, h) => s + h.liquidSavings * h.weight, 0), 80_000);
});

test('compatible stable cohorts merge deterministically into lexical survivor', () => {
  const system = new HouseholdCohortSystem();
  const a = system.create(seed, 0);
  const b = system.create(seed, 0);
  const merged = system.mergeCompatible();
  assert.equal(merged, 1);
  const [survivor] = system.list();
  assert.equal(survivor!.id, [a.id, b.id].sort()[0]);
  assert.equal(survivor!.weight, 20);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/household-cohorts.test.ts
```

Expected: FAIL because `HouseholdCohortSystem` does not exist.

- [ ] **Step 3: Define household state explicitly**

`HouseholdCohort` must include at least:

```ts
export type HouseholdCohort = Readonly<{
  id: string;
  weight: number;
  householdSize: number;
  workers: number;
  employedWorkers: number;
  employerFirmIds: readonly string[];
  grossIncome: number;
  disposableHousingIncome: number;
  employmentStability: number;
  tenure: 'renter' | 'owner' | 'seeking';
  buildingId: string | null;
  unitRequirement: number;
  vehicleAccess: boolean;
  liquidSavings: number;
  mortgage: MortgageProxy | null;
  housingCost: number;
  housingCostBurden: number;
  affordabilityState: 'comfortable' | 'manageable' | 'stressed' | 'severe';
  preferences: HouseholdPreferenceWeights;
  moveFriction: number;
  residenceCycles: number;
  displacementState: 'none' | 'displaced' | 'unhoused';
  searchState: 'stable' | 'searching';
  arrearsCycles: number;
  severeBurdenCycles: number;
  unhousedCycles: number;
  lastMoveReason: string | null;
  createdTick: number;
}>;
```

Use `household:${nextId++}` IDs. `split()` keeps the original ID on the remainder and gives the branch a new ID. Reject non-integer/zero/oversized weights.

- [ ] **Step 4: Implement deterministic merge eligibility**

Merge only when cohorts match on:

```ts
householdSize, workers, employedWorkers, employerFirmIds, tenure, buildingId,
unitRequirement, vehicleAccess, affordabilityState, displacementState, searchState,
mortgage signature, preferences, grossIncome, disposableHousingIncome, housingCost
```

Choose lexical ID survivor and sum weights. Do not merge if combined weight would exceed `HOUSING_CONFIG.cohortTargetMaxWeight`.

- [ ] **Step 5: Add restore-validation tests and implementation**

Test duplicate IDs, zero weights, invalid worker counts, owner with `tenure='owner'` plus `buildingId=null`, negative savings, invalid mortgage principal/rate/payment, and non-finite numeric state. `restoreState()` must reject all of them before mutating current state.

- [ ] **Step 6: Run focused test and typecheck**

```bash
node --experimental-strip-types --test tests/household-cohorts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/housing/HousingTypes.ts src/simulation/housing/HouseholdCohortSystem.ts tests/household-cohorts.test.ts
git commit -m "feat: add adaptive household cohorts"
```

---

### Task 3: Firm-linked household employment and income bridge

**Files:**
- Create: `src/simulation/housing/HouseholdIncomeSystem.ts`
- Modify: `src/simulation/housing/HouseholdCohortSystem.ts`
- Test: `tests/household-income.test.ts`

**Interfaces:**
- Consumes: `FirmSystem.list()` records with actual `filledJobs`, archetype, `cashHealth`, and productivity.
- Produces: `HouseholdIncomeSystem.reconcile(cohorts, firms)` and `HouseholdIncomeSnapshot`.
- Must reconcile total cohort employed workers exactly to `min(totalHouseholdWorkers, sum(activeFirm.filledJobs))`.

- [ ] **Step 1: Write failing firm-quota and wage tests**

```ts
test('household employment reconciles exactly to actual filled firm jobs', () => {
  const households = makeHouseholds([{ weight: 10, workers: 1 }, { weight: 10, workers: 1 }]);
  const firms = [makeFirm('firm:a', 'retail_local', 7), makeFirm('firm:b', 'assembly_manufacturing', 5)];
  const system = new HouseholdIncomeSystem();
  system.reconcile(households, firms);
  assert.equal(households.list().reduce((s, h) => s + h.employedWorkers * h.weight, 0), 12);
});

test('higher-wage firm archetypes create higher household income under equal employment', () => {
  const retail = incomeForSingleEmployedHousehold('retail_local');
  const assembly = incomeForSingleEmployedHousehold('assembly_manufacturing');
  assert.ok(assembly > retail);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/household-income.test.ts
```

Expected: FAIL because household income reconciliation is absent.

- [ ] **Step 3: Implement deterministic job-slot allocation using actual firm quotas**

Sort active firms by:

```ts
(b.cashHealth - a.cashHealth) || a.id.localeCompare(b.id)
```

Treat each firm's `filledJobs` as a hard quota. Sort households by `id`. Allocate worker positions in passes (`workerIndex = 0..workers-1`). If a firm has fewer remaining slots than a cohort's weight, call `HouseholdCohortSystem.split()` so exactly that subset receives the job. Store one firm ID per employed worker position in `employerFirmIds`.

Wage per employed worker:

```ts
const healthModifier = clamp(0.85 + firm.cashHealth * 0.30, 0.85, 1.15);
const productivityModifier = clamp(0.90 + (firm.productivity - 1) * 0.20, 0.85, 1.20);
const wage = HOUSEHOLD_WAGE_BY_ARCHETYPE[firm.archetype] * healthModifier * productivityModifier;
```

Unemployed worker fallback income is `700` per worker per household. This is an explicit transitional proxy, not a modeled welfare payment.

Set `disposableHousingIncome = grossIncome * 0.80` and `employmentStability` to the average active employer cash health, or `0.25` when fully unemployed.

- [ ] **Step 4: Add deterministic repeatability test**

Run the same starting household snapshot and firm list through two separate systems and assert `deepEqual(householdsA.snapshotState(), householdsB.snapshotState())`.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/household-income.test.ts tests/household-cohorts.test.ts
npm run typecheck
git add src/simulation/housing/HouseholdIncomeSystem.ts src/simulation/housing/HouseholdCohortSystem.ts tests/household-income.test.ts
git commit -m "feat: connect household income to firms"
```

---

### Task 4: Persistent housing supply ledgers and tenure conservation

**Files:**
- Create: `src/simulation/housing/HousingSupplySystem.ts`
- Modify: `src/simulation/housing/HousingTypes.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/housing-supply.test.ts`

**Interfaces:**
- Produces: `HousingBuildingState`, `HousingSupplyStateSnapshot`.
- Produces methods: `syncBuildings()`, `list()`, `get()`, `availableRentalUnits()`, `availableForSaleUnits()`, `occupy()`, `vacate()`, `markUnavailable()`, `updateMarketState()`, `removeBuilding()`, `snapshotState()`, `restoreState()`.
- `Building` gains optional `housingProduct`, `rentalProductUnits`, `forSaleProductUnits` for new residential awards.

- [ ] **Step 1: Write failing unit-conservation tests**

```ts
test('housing ledger conserves physical units across tenure and vacancy states', () => {
  const supply = new HousingSupplySystem();
  supply.syncBuildings([occupiedResidential('residential_rowhouse')], 0);
  const before = supply.list()[0]!;
  supply.occupy(before.buildingId, 'renter', 3);
  supply.occupy(before.buildingId, 'owner', 2);
  const state = supply.get(before.buildingId)!;
  assert.equal(state.rentalProductUnits, state.renterOccupiedUnits + state.vacantRentableUnits);
  assert.equal(state.forSaleProductUnits, state.ownerOccupiedUnits + state.vacantForSaleUnits);
  assert.equal(state.rentalProductUnits + state.forSaleProductUnits + state.unavailableUnits, state.housingUnits);
});
```

Also test that attempting to occupy more units than the matching tenure inventory throws without partially mutating the ledger.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/housing-supply.test.ts
```

Expected: FAIL because housing supply state does not exist.

- [ ] **Step 3: Implement building synchronization and initial market state**

For a new ledger:

```ts
askingRent = definition.baseRent;
effectiveRent = definition.baseRent;
askingSalePrice = definition.baseRent * HOUSING_CONFIG.salePriceToEffectiveRent;
estimatedSalePrice = askingSalePrice;
quality = 0.70;
accessibility = 0.70;
habitability = 1;
```

Use product metadata from `Building` when present; otherwise use `defaultLegacyProductAllocation()`.

`syncBuildings()` must preserve existing market state and only add/remove ledgers as buildings become occupied or disappear. Construction buildings do not expose housing inventory.

- [ ] **Step 4: Implement exact mutation guards and restore validation**

Every `occupy`, `vacate`, `markUnavailable`, and restore path calls one invariant checker. Reject negative counts, non-integers, product totals above `housingUnits`, and non-finite/negative rents or prices.

- [ ] **Step 5: Add `BuildingSystem.removeById()` and optional product metadata**

```ts
removeById(id: string): Building | undefined {
  for (const [lotId, building] of this.buildings.entries()) {
    if (building.id === id) {
      this.buildings.delete(lotId);
      return { ...building };
    }
  }
  return undefined;
}
```

Keep all new residential product fields optional so historical fixtures remain source-compatible.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/housing-supply.test.ts
npm run typecheck
git add src/simulation/housing/HousingTypes.ts src/simulation/housing/HousingSupplySystem.ts src/simulation/buildings/BuildingSystem.ts tests/housing-supply.test.ts
git commit -m "feat: add persistent housing supply ledgers"
```

---

### Task 5: Housing choice, affordability, and mortgage qualification

**Files:**
- Create: `src/simulation/housing/HousingChoiceSystem.ts`
- Modify: `src/simulation/housing/HousingTypes.ts`
- Test: `tests/housing-choice.test.ts`

**Interfaces:**
- Produces: `HousingCandidate`, `HousingChoiceEvaluation`, `MortgageQuote`.
- Produces methods: `quoteMortgage()`, `evaluateCandidate()`, `rankCandidates()`.
- Consumes household preferences and normalized building quality/access/service conditions.

- [ ] **Step 1: Write failing affordability and mortgage-rate tests**

```ts
test('severely unaffordable rental is rejected despite superior neighborhood utility', () => {
  const system = new HousingChoiceSystem();
  const result = system.evaluateCandidate(lowIncomeHousehold(), expensiveExcellentRental(), choiceContext());
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReasons.includes('housing-burden'));
});

test('higher mortgage rates reduce maximum affordable purchase price', () => {
  const system = new HousingChoiceSystem();
  const household = qualifiedBuyer();
  const low = system.quoteMortgage(household, 0.04, 250_000);
  const high = system.quoteMortgage(household, 0.09, 250_000);
  assert.ok(low.monthlyPayment < high.monthlyPayment);
  assert.equal(low.paymentQualified, true);
  assert.equal(high.maximumAffordablePrice < low.maximumAffordablePrice, true);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/housing-choice.test.ts
```

- [ ] **Step 3: Implement the standard amortization equation**

```ts
function payment(principal: number, annualRate: number, years: number): number {
  const n = years * 12;
  if (annualRate === 0) return principal / n;
  const r = annualRate / 12;
  const factor = Math.pow(1 + r, n);
  return principal * (r * factor) / (factor - 1);
}
```

Qualification must enforce all three constraints from the spec: down payment + transaction reserve, debt-service ratio, and emergency reserve.

- [ ] **Step 4: Implement componentized utility with diagnostics**

Calculate and return named components rather than one opaque score:

```ts
{
  affordability,
  spaceFit,
  commuteAccess,
  services,
  neighborhood,
  tenureFit,
  vehicleFit,
  densityFit,
  stability,
  movingCost,
  overcrowdingPenalty,
  displacementRisk,
}
```

Normalize positive components to `[-1, 1]`, apply household preference weights, and sort equal candidates by `buildingId`. A carless household gets a `vehicleFit` penalty below `0.55` person accessibility and a positive score above `0.75`.

- [ ] **Step 5: Add carless-access and move-friction tests**

Assert that a carless cohort chooses the more accessible otherwise-equal building, and that an owner with long residence tenure refuses a marginal utility improvement that a newly arrived renter accepts.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/housing-choice.test.ts
npm run typecheck
git add src/simulation/housing/HousingChoiceSystem.ts src/simulation/housing/HousingTypes.ts tests/housing-choice.test.ts
git commit -m "feat: add housing choice and mortgage qualification"
```

---

### Task 6: Housing market cadence, pricing, search, matching, migration, and displacement

**Files:**
- Create: `src/simulation/housing/HousingMarketSystem.ts`
- Modify: `src/simulation/housing/HousingTypes.ts`
- Test: `tests/housing-market.test.ts`

**Interfaces:**
- Owns: `HouseholdCohortSystem`, `HouseholdIncomeSystem`, `HousingSupplySystem`, `HousingChoiceSystem`.
- Produces: `HousingMarketSnapshot`, `HousingMarketStateSnapshot`, `HousingMarketSystem.tick(input)`, `bootstrapLegacyPopulation()`, `displaceBuilding()`, `population()`, `travelDemand()`, `marketSignalForParcel()`.
- Input contract:

```ts
export type HousingMarketTickInput = Readonly<{
  tick: number;
  buildings: readonly Building[];
  firms: readonly Firm[];
  marketInterestRate: number;
  employmentVacancies: number;
  conditionsByBuilding: Readonly<Record<string, HousingBuildingConditions>>;
}>;
```

- [ ] **Step 1: Write failing rent-inertia tests**

```ts
test('persistent high vacancy lowers rent while qualified excess demand raises it gradually', () => {
  const vacant = marketFixture({ occupiedRentalUnits: 4, rentalUnits: 12, qualifiedApplicants: 0 });
  const tight = marketFixture({ occupiedRentalUnits: 12, rentalUnits: 12, qualifiedApplicants: 24 });
  vacant.stepMarketCycle();
  tight.stepMarketCycle();
  assert.ok(vacant.rentAfter < vacant.rentBefore);
  assert.ok(tight.rentAfter > tight.rentBefore);
  assert.ok(Math.abs(tight.rentAfter / tight.rentBefore - 1) <= HOUSING_CONFIG.maxNormalRentChange + 1e-9);
});
```

- [ ] **Step 2: Implement exact pricing pressure**

For rental-capable buildings:

```ts
const occupancyRate = rentalProductUnits === 0 ? 0 : renterOccupiedUnits / rentalProductUnits;
const occupancyPressure = clamp((occupancyRate - HOUSING_CONFIG.targetOccupancy) / 0.10, -1, 1);
const applicantPressure = clamp(qualifiedRentalApplicants / Math.max(1, vacantRentableUnits) - 1, -1, 1);
const incomeSupport = clamp(medianQualifiedIncome / Math.max(1, askingRent * 3) - 1, -0.5, 0.5);
const qualityPremium = (quality - 0.70) * 0.20;
const accessPremium = (accessibility - 0.70) * 0.20;
const distressPenalty = (1 - habitability) * 0.50;
const rawChange = 0.012 * occupancyPressure + 0.010 * applicantPressure + 0.004 * incomeSupport + 0.003 * qualityPremium + 0.003 * accessPremium - 0.020 * distressPenalty;
let bounded = clamp(rawChange, -HOUSING_CONFIG.maxNormalRentChange, HOUSING_CONFIG.maxNormalRentChange);
if (1 - occupancyRate >= HOUSING_CONFIG.severeVacancyRate) bounded = Math.min(bounded, -HOUSING_CONFIG.maxSevereVacancyRentCut);
```

Set `effectiveRent = askingRent * (1 - concessionRate)`, where `concessionRate = clamp((vacancyRate - 0.08) * 0.30, 0, 0.12)`.

For sale inventory, anchor price to `effectiveRent * salePriceToEffectiveRent`, then apply bounded quality/access/buyer-pressure/rate modifiers and clamp per-cycle change to `maxSalePriceChange`.

- [ ] **Step 3: Write failing search/matching and partial-cohort tests**

Create a 10-household cohort and only 3 matching vacant units. Assert the cohort deterministically splits 3/7, the branch moves, unit conservation holds, and the remainder stays searching.

- [ ] **Step 4: Implement bounded deterministic candidate generation**

For each searcher, build a set in this order: tenure-compatible + affordable, space-compatible, same/nearby neighborhood by Manhattan distance, high-access alternatives, ownership candidates if qualified, then lexical citywide fallback. Sort/deduplicate by building ID and truncate to `HOUSING_CONFIG.maxCandidateBuildings`.

Search order is:

```ts
displaced/unhoused first -> severe burden -> other searching -> household id
```

Apply the Task 5 move threshold to voluntary movers; displacement bypasses it.

- [ ] **Step 5: Write and implement migration persistence tests**

Test these exact behaviors:
- no viable housing => zero in-migration even with job vacancies;
- viable housing + job vacancies => bounded deterministic in-migration;
- displaced household remains in city during the first `outMigrationUnhousedCycles - 1` market cycles;
- at the threshold it leaves if still unhoused;
- severe burden requires `outMigrationSevereBurdenCycles` consecutive cycles before exit.

External migrant archetypes are deterministic and cycle through a fixed config list; do not use PRNG.

- [ ] **Step 6: Implement displacement and mortgage/savings economics**

`displaceBuilding(buildingId, reason)` vacates all represented units, retains income/savings/preferences/mortgage state, clears `buildingId`, sets `displacementState='displaced'`, `searchState='searching'`, and `lastMoveReason=reason`.

Every 50 ticks:
- call income reconciliation;
- amortize mortgages by one monthly-equivalent payment step;
- update burden state;
- add savings equal to `max(0, disposableHousingIncome - housingCost) * 0.05`, capped at 24 months of gross income;
- increment arrears/severe-burden counters where applicable.

- [ ] **Step 7: Add snapshot/restore determinism tests**

Serialize `HousingMarketStateSnapshot`, restore into a fresh system, run 500 identical ticks, and assert deep equality of final snapshots.

- [ ] **Step 8: Run tests and commit**

```bash
node --experimental-strip-types --test tests/housing-market.test.ts tests/housing-choice.test.ts tests/housing-supply.test.ts tests/household-income.test.ts
npm run typecheck
git add src/simulation/housing/HousingMarketSystem.ts src/simulation/housing/HousingTypes.ts tests/housing-market.test.ts
git commit -m "feat: add deterministic housing market clearing"
```

---

### Task 7: Make housing authoritative for population and household-origin travel

**Files:**
- Modify: `src/simulation/population/PopulationSystem.ts`
- Modify: `src/simulation/traffic/TripGenerationSystem.ts`
- Modify: `src/simulation/mobility/PersonTripSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/housing-integration.test.ts`
- Modify/Test: `tests/core-city-loop.test.ts`, `tests/city-foundation.test.ts`

**Interfaces:**
- `PopulationSystem.sync(population: number): void` becomes the housing-authority bridge.
- `HousingMarketSystem.travelDemand()` produces housed origin/employer-linked commute demand plus shopping-origin weights.
- `PersonTripSystem.generate()` accepts optional explicit housing travel demand; old aggregate path remains fallback for historical unit tests.

- [ ] **Step 1: Write failing population-authority integration test**

```ts
test('positive residential demand does not create population without viable housing', () => {
  const core = buildServicedJobsButNoHousingCity();
  core.step(500);
  assert.ok(core.demandSnapshot.residential > 0);
  assert.equal(core.housing.population(), 0);
  assert.equal(core.population.population, 0);
});
```

Also test that housing in-migration changes `core.population.population` exactly to `core.housing.population()`.

- [ ] **Step 2: Add `PopulationSystem.sync()` and remove independent growth after housing activation**

```ts
sync(population: number): void {
  if (!Number.isFinite(population) || population < 0) throw new Error('population sync must be non-negative and finite');
  this.population = Math.floor(population);
}
```

Keep `update()` unchanged for direct legacy tests, but `SimulationCore` must no longer call it after `HousingMarketSystem` is installed.

- [ ] **Step 3: Integrate housing cadence after fresh service conditions**

In `SimulationCore.step()` keep economy/mobility/traffic ordering, then at the 10-tick boundary use:

```ts
this.evaluateServiceLoop();
this.evaluateHousingMarket();
this.population.sync(this.housing.population());
this.evaluateDevelopmentMarket();
```

At 50 ticks, run `evaluateCoreCityLoop()` after housing synchronization. Do not call `population.update()` there.

`evaluateHousingMarket()` builds `conditionsByBuilding` from actual per-building utility/service/neighborhood state and current mobility accessibility; no zero-demand utility ratio may stand in for missing physical power/water infrastructure.

- [ ] **Step 4: Write household-origin travel tests**

Create two residential buildings with 80/20 resident weights and assert generated shopping origin traveler weight follows approximately 80/20 rather than 50/50. Create a cohort linked to `firm:1` and assert its commute destination is the building containing `firm:1`.

- [ ] **Step 5: Implement explicit travel demand path**

Add housing travel input records:

```ts
export type HouseholdTravelDemand = Readonly<{
  originBuildingId: string;
  destinationBuildingId?: string;
  commuterWeight: number;
  shoppingWeight: number;
}>;
```

`PersonTripSystem` creates commute trips directly when destination is supplied. Shopping destinations still use deterministic commercial choice. Unhoused/out-migrated households do not produce normal residential-origin trips.

- [ ] **Step 6: Run regression suite for core/mobility**

```bash
node --experimental-strip-types --test tests/housing-integration.test.ts tests/core-city-loop.test.ts tests/city-foundation.test.ts tests/mobility-integration.test.ts tests/person-trip-system.test.ts
npm run typecheck
```

If test filenames differ, use the existing mobility/person-trip test filenames returned by `ls tests | grep -E 'mobility|person|trip'`; do not create duplicate coverage under a guessed filename.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/population/PopulationSystem.ts src/simulation/traffic/TripGenerationSystem.ts src/simulation/mobility/PersonTripSystem.ts src/simulation/core/SimulationCore.ts tests/housing-integration.test.ts tests/core-city-loop.test.ts tests/city-foundation.test.ts
git commit -m "feat: make housing authoritative for population"
```

---

### Task 8: Tenure-aware residential developer underwriting

**Files:**
- Modify: `src/simulation/development/DevelopmentTypes.ts`
- Modify: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify: `src/simulation/development/DeveloperMarketSystem.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/housing-development.test.ts`
- Modify/Test: `tests/development-feasibility.test.ts`, `tests/developer-market.test.ts`, `tests/development-integration.test.ts`

**Interfaces:**
- Add optional residential fields to feasibility/bid/award/commitment: `housingProduct`, `rentalProductUnits`, `forSaleProductUnits`.
- Add `ResidentialDevelopmentMarketContext` with effective rent, sale price, rental vacancy, qualified rental pressure, qualified buyer pressure.
- `HousingMarketSystem.marketSignalForParcel()` supplies deterministic nearest-comparable + citywide fallback signals.

- [ ] **Step 1: Write failing tenure-product underwriting test**

```ts
test('residential underwriting chooses economically distinct rental and for-sale products', () => {
  const results = evaluateResidentialLotWithHousingSignals({
    effectiveRent: 650,
    salePrice: 145_000,
    rentalVacancyRate: 0.04,
    qualifiedRentalPressure: 1.4,
    qualifiedBuyerPressure: 0.4,
  });
  const rental = results.find(x => x.housingProduct === 'rental')!;
  const sale = results.find(x => x.housingProduct === 'for_sale')!;
  assert.notEqual(rental.stabilizedValue, sale.stabilizedValue);
  assert.ok(rental.effectiveGrossIncome > 0);
});
```

- [ ] **Step 2: Extend `DevelopmentParcelContext` without changing non-residential callers**

```ts
export type ResidentialDevelopmentMarketContext = Readonly<{
  effectiveRentPerUnit: number;
  salePricePerUnit: number;
  rentalVacancyRate: number;
  qualifiedRentalPressure: number;
  qualifiedBuyerPressure: number;
  allowedProducts: readonly HousingProduct[];
  existingUseValue?: number;
  demolitionCost?: number;
  displacementCost?: number;
  replacementBuildingId?: string;
}>;
```

Add optional `residentialMarket?: ResidentialDevelopmentMarketContext` to `DevelopmentParcelContext`.

- [ ] **Step 3: Implement product-specific residential value**

For rental projects:

```ts
const grossPotentialRent = effectiveRentPerUnit * definition.housingUnits;
const vacancyRate = clamp(residentialMarket.rentalVacancyRate, 0.02, 0.40);
const effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate);
const netOperatingIncome = effectiveGrossIncome * (1 - definition.operatingExpenseRatio) - propertyTaxes;
const stabilizedValue = netOperatingIncome / capRate;
```

For for-sale projects:

```ts
const grossSales = salePricePerUnit * definition.housingUnits;
const absorptionDiscount = clamp(1 - 0.08 * Math.max(0, 1 - residentialMarket.qualifiedBuyerPressure), 0.85, 1);
const stabilizedValue = grossSales * absorptionDiscount * (1 - HOUSING_CONFIG.sellingCostRatio);
const effectiveGrossIncome = stabilizedValue;
const netOperatingIncome = 0;
```

For mixed projects, use the persisted deterministic unit split and sum rental stabilized value plus net sale proceeds. Non-residential calculations keep their current formula.

- [ ] **Step 4: Make developer bidding product-aware**

Include `housingProduct ?? 'na'` in bid/award IDs and tie-breakers. Add optional developer housing preference values with defaults:

```ts
local_builder:          { rental: 0.00, for_sale: 0.035, mixed: 0.005 }
urban_developer:        { rental: 0.020, for_sale: 0.010, mixed: 0.030 }
institutional_developer:{ rental: 0.040, for_sale: 0.000, mixed: 0.020 }
industrial_specialist:  { rental: -0.020, for_sale: -0.020, mixed: -0.020 }
```

Old V7 developer snapshots lacking this field restore with zero housing preference; do not reject them.

- [ ] **Step 5: Persist product metadata into construction buildings**

`BuildingSystem.startDevelopment()` copies `housingProduct`, `rentalProductUnits`, and `forSaleProductUnits` from residential awards and validates that the two unit counts sum to `definition.housingUnits`.

- [ ] **Step 6: Verify generic demand no longer guarantees residential construction**

Add an integration test with positive `demandSnapshot.residential` but unaffordable/weak market rents or prices and assert no residential award occurs. Then raise qualified market economics and assert an award becomes possible.

- [ ] **Step 7: Run development regressions and commit**

```bash
node --experimental-strip-types --test tests/housing-development.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts
npm run typecheck
git add src/simulation/development src/simulation/buildings/BuildingSystem.ts src/simulation/core/SimulationCore.ts tests/housing-development.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts
git commit -m "feat: connect housing economics to development"
```

---

### Task 9: Occupied-parcel redevelopment, displacement cost, and filtering

**Files:**
- Modify: `src/simulation/housing/HousingMarketSystem.ts`
- Modify: `src/simulation/housing/HousingTypes.ts`
- Modify: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/housing-redevelopment.test.ts`

**Interfaces:**
- Produces: `HousingMarketSystem.redevelopmentSignal(buildingId)`.
- Feasibility result adds `existingUseValue`, `demolitionCost`, `displacementCost`, `redevelopmentGain`, `replacementBuildingId` where applicable.

- [ ] **Step 1: Write failing redevelopment hurdle test**

```ts
test('high-intensity zoning alone does not redevelop a viable occupied low-intensity building', () => {
  const result = redevelopmentResult({ replacementValue: 180_000, existingUseValue: 150_000, demolitionCost: 20_000, displacementCost: 20_000 });
  assert.equal(result.feasible, false);
  assert.ok(result.rejectionReasons.includes('redevelopment-gain'));
});

test('strong replacement economics can clear existing use demolition and displacement costs', () => {
  const result = redevelopmentResult({ replacementValue: 420_000, existingUseValue: 120_000, demolitionCost: 20_000, displacementCost: 16_000 });
  assert.ok(result.redevelopmentGain > 0);
});
```

- [ ] **Step 2: Implement existing-use and displacement economics**

For occupied residential buildings:

```ts
existingUseValue = Math.max(0, stabilizedRentalValue + ownerOccupiedValueShare);
demolitionCost = currentDefinition.baseConstructionCost * HOUSING_CONFIG.demolitionCostRatio;
displacementCost = representedHouseholdsInBuilding * HOUSING_CONFIG.displacementCostPerHousehold;
redevelopmentGain = replacementStabilizedValue - existingUseValue - demolitionCost - displacementCost;
```

Require replacement definition intensity rank to be strictly greater than current definition intensity and `redevelopmentGain > preFinanceDevelopmentCost * 0.05` before marking the candidate feasible.

- [ ] **Step 3: Change development opportunity enumeration carefully**

Every 10 ticks keep vacant-lot opportunities. Only when `tick % HOUSING_CADENCE.redevelopment === 0`, also evaluate occupied residential lots returned by housing redevelopment signals. Commercial/industrial occupied redevelopment remains out of scope.

- [ ] **Step 4: Execute an awarded replacement deterministically**

For an award with `replacementBuildingId`:

```ts
this.housing.displaceBuilding(replacementBuildingId, 'redevelopment');
const removed = this.buildings.removeById(replacementBuildingId);
if (!removed) {
  this.developerMarket.cancelProject(award.buildingId, 1);
  continue;
}
this.housing.removeSupplyBuilding(replacementBuildingId);
this.buildings.startDevelopment(this.clock.tick, lot, award);
```

If construction start throws, restore/cancel through a tested rollback helper rather than silently losing the prior state. The helper must snapshot the affected housing households/ledger before mutation and restore them if project start fails.

- [ ] **Step 5: Write deterministic filtering-chain test**

Construct three rental buildings A/B/C and three income tiers. Complete new high-end building D. Run enough market cycles to prove: high-income household moves A→D, middle-income moves B→A, lower-income moves C→B (or equivalent ordered chain), and at least one lower-income household gains an option in previously unavailable existing stock. Assert unit conservation after every move.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/housing-redevelopment.test.ts tests/housing-market.test.ts tests/housing-development.test.ts
npm run typecheck
git add src/simulation/housing src/simulation/development/DevelopmentFeasibilitySystem.ts src/simulation/core/SimulationCore.ts tests/housing-redevelopment.test.ts
git commit -m "feat: add endogenous residential redevelopment"
```

---

### Task 10: Extend Save V7 with housing state and deterministic old-V7 bootstrap

**Files:**
- Modify: `src/save/saveV7.ts`
- Modify: `src/save/save.ts` only if exported housing snapshot types require it
- Modify: `tests/save-v7.test.ts`
- Modify: `docs/SAVE_FORMAT.md` after tests are green

**Interfaces:**
- New serialized field: `housingMarket: HousingMarketStateSnapshot`.
- `hydrateCoreV7()` accepts both new V7 saves with housing state and prior V7 saves that lack the field.
- Old V7 migration preserves existing buildings/developer state and deterministically initializes housing from aggregate population without fabricating historical move events or mortgages.

- [ ] **Step 1: Write failing new-V7 round-trip test**

```ts
test('Save V7 round-trips authoritative housing state exactly', () => {
  const core = buildHousingCity();
  core.step(800);
  const save = serializeCore(core);
  assert.ok('housingMarket' in save);
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(serializeCore(loaded), save);
  core.step(500);
  loaded.step(500);
  assert.deepEqual(serializeCore(loaded), serializeCore(core));
});
```

- [ ] **Step 2: Write prior-V7 bootstrap test**

Create a normal new V7 save, delete `housingMarket` from a mutable clone, hydrate it, and assert:
- developer commitments remain unchanged;
- residential ledgers exist for occupied residential buildings;
- represented housing population equals the old aggregate population clipped only by configured practical overcrowding capacity;
- no `lastMoveReason='historical-*'` events are invented;
- no mortgage proxy is fabricated for legacy owners.

- [ ] **Step 3: Implement housing serialization and migration**

`serializeCoreV7()` always writes `housingMarket: core.housing.snapshotState()`.

In `hydrateCoreV7()`:
1. hydrate the inherited V6/V7 physical/economy/developer state exactly as today;
2. if `housingMarket` exists, validate references then `core.housing.restoreState()`;
3. otherwise call `core.housing.bootstrapLegacyPopulation(core.population.population, core.buildings.occupied(), core.clock.tick)`;
4. call `core.population.sync(core.housing.population())`;
5. rebuild derived housing conditions on the next normal cadence rather than inventing historical diagnostics.

- [ ] **Step 4: Add corruption tests**

Reject:
- household assignment to missing/non-residential building;
- ledger for missing building;
- duplicate household IDs;
- product unit totals that do not reconcile;
- represented occupants above practical overcrowding ceiling;
- non-finite/negative rent, price, income, savings, mortgage principal/rate/payment;
- housing population total inconsistent with household weights and sizes.

Validation must complete before mutating the hydrated core housing state.

- [ ] **Step 5: Run V7 plus historical save regressions**

```bash
node --experimental-strip-types --test tests/save-v7.test.ts tests/save-v6.test.ts tests/save-v5.test.ts tests/save-v4.test.ts tests/save-v3.test.ts
npm run typecheck
```

Expected: PASS; older explicit serializers/hydrators remain genuine compatibility tests.

- [ ] **Step 6: Commit**

```bash
git add src/save/saveV7.ts src/save/save.ts tests/save-v7.test.ts docs/SAVE_FORMAT.md
git commit -m "feat: persist Phase 7 housing market state"
```

---

### Task 11: Authoritative housing diagnostics and compact UI

**Files:**
- Create: `src/ui/HousingPanel.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/styles.css`
- Test: `tests/housing-presentation.test.ts`

**Interfaces:**
- `HousingMarketSnapshot` must expose: resident population, represented households, renter/owner households, vacant rental units, vacant for-sale units, rental vacancy rate, median/effective rent, median sale price, comfortable/manageable/stressed/severe burden counts, overcrowded households, displaced/unhoused households, active searchers, in/out migration in last cycle, turnover, ownership-qualified searchers, and citywide redevelopment pressure.
- `HousingMarketSystem.buildingDiagnostics(buildingId)` returns building-specific causes and market values.

- [ ] **Step 1: Write failing presentation test**

```ts
test('housing panel renders authoritative affordability vacancy tenure and displacement metrics', () => {
  const html = new HousingPanel().render(sampleHousingSnapshot());
  assert.match(html, /Vacancy/i);
  assert.match(html, /Rent/i);
  assert.match(html, /Owners/i);
  assert.match(html, /Severe burden/i);
  assert.match(html, /Displaced/i);
});
```

- [ ] **Step 2: Implement `HousingPanel` as a pure renderer**

Follow the existing `EconomyPanel` pattern: `render(snapshot): string`, no DOM queries and no invented values. Keep KPI formatting helpers local.

- [ ] **Step 3: Extend residential inspector diagnostics**

For selected residential buildings render:
- physical/product units and occupied/vacant split;
- asking/effective rent;
- sale price;
- qualified applicant/buyer pressure;
- resident income and burden;
- quality/access/habitability;
- top rent-change drivers;
- existing-use value and redevelopment pressure;
- number of residents at displacement risk.

Do not expose raw mutable system objects to the UI.

- [ ] **Step 4: Mount the panel without growing `GameApp` responsibilities**

`GameApp` may instantiate and call `HousingPanel`, but housing formatting/rendering logic stays in `src/ui/HousingPanel.ts`. Add only the minimal container/update integration in `GameApp.ts`.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types --test tests/housing-presentation.test.ts tests/economy-presentation.test.ts
npm run typecheck
npm run build
git add src/ui/HousingPanel.ts src/ui/Inspector.ts src/app/GameApp.ts src/styles.css tests/housing-presentation.test.ts
git commit -m "feat: expose housing market diagnostics"
```

---

### Task 12: Scale, determinism, regression sweep, documentation, and release-quality verification

**Files:**
- Create: `tests/housing-scale.test.ts`
- Modify: `README.md`
- Modify: `docs/SAVE_FORMAT.md`
- Modify tests only where this task discovers a genuine regression; production fixes must be separately explained in the commit.

**Interfaces:**
- No new gameplay interface; this task proves the integrated Phase 7 slice meets its acceptance contract.

- [ ] **Step 1: Add 250k-equivalent scale test**

Construct synthetic residential supply and cohorts representing at least 250,000 residents. Use cohort weights so initial entity count is under 5,000. Run at least 20 housing market cycles and assert:

```ts
assert.equal(system.population() >= 250_000, true);
assert.equal(system.households.list().length < 8_000, true);
assert.equal(system.validateUnitConservation(), true);
```

Record elapsed time only as diagnostic output; do not make wall-clock timing an authoritative simulation assertion. The acceptance criterion is bounded entity growth and completion without pathological all-to-all state explosion.

- [ ] **Step 2: Add deterministic twin-run stress test**

Create two identical 250k-equivalent systems, run the same 20 market cycles, and `deepEqual` their authoritative snapshots.

- [ ] **Step 3: Run the exact acceptance-behavior matrix**

Verify tests explicitly cover:
1. deterministic replay;
2. high vacancy lowers rents;
3. qualified excess demand raises rents gradually;
4. unaffordable units are rejected;
5. higher mortgage rates reduce purchasing power;
6. carless households prefer stronger accessibility when otherwise comparable;
7. overcrowding increases move/search pressure;
8. job loss can create burden and relocation;
9. displacement preserves household economics while forcing search;
10. persistent inability to rehouse can cause out-migration;
11. new supply can create a multi-step filtering chain;
12. positive generic residential demand does not guarantee construction;
13. effective rent/sale value feed developer underwriting;
14. occupied low-intensity parcels redevelop only after existing-use/demolition/displacement economics and developer hurdle clear;
15. prior V7 saves bootstrap deterministically;
16. new V7 housing state round-trips exactly;
17. commercial/industrial developer behavior remains compatible;
18. missing physical utilities still block private development;
19. unit conservation holds after move, split, displacement, redevelopment, save/load;
20. household entity count stays bounded at 250k-equivalent scale.

- [ ] **Step 4: Update documentation only after all focused tests are green**

README Phase 7 section must state that V7 now contains:
- adaptive household cohorts;
- rental/ownership markets;
- affordability/mortgage proxies;
- explicit residential assignments;
- migration/displacement/filtering;
- housing-market-driven development and redevelopment.

`docs/SAVE_FORMAT.md` must document `housingMarket` as a canonical V7 field and explain migration from older V7 saves lacking that field.

- [ ] **Step 5: Run full verification from a clean working tree**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
git status --short
```

Expected:
- all tests pass;
- typecheck passes;
- lint passes;
- build passes;
- smoke passes;
- only intentionally uncommitted files are shown; ideally output is empty.

- [ ] **Step 6: Commit documentation/scale verification artifacts**

```bash
git add tests/housing-scale.test.ts README.md docs/SAVE_FORMAT.md
git commit -m "test: verify Phase 7 housing market at scale"
```

- [ ] **Step 7: Run the complete verification commands again after the final commit**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```

Do not claim completion from an earlier run. Record the final test count and exact final commit SHA for the completion report.

---

## Dependency Order

Tasks must execute in order because the interfaces are cumulative:

`1 data/contracts -> 2 cohorts -> 3 income -> 4 supply -> 5 choice -> 6 market -> 7 core/population/mobility -> 8 developer underwriting -> 9 redevelopment -> 10 save -> 11 UI -> 12 scale/full verification`

Task 11 may be worked in parallel with Task 10 only after Task 6's `HousingMarketSnapshot` is stable. Tasks 8 and 9 must remain sequential because redevelopment relies on tenure-aware project economics.

## Review Gates

After each task:
1. run its focused test set;
2. run `npm run typecheck`;
3. inspect the diff for unrelated changes;
4. commit the task independently;
5. have a fresh reviewer verify spec compliance and code quality before moving on.

Any unexpected regression uses `superpowers:systematic-debugging` before attempting a fix. Any claim that the feature is complete requires `superpowers:verification-before-completion` and fresh final verification output.
