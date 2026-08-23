# Phase 7 Housing Market & Household Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's aggregate residential population loop with a deterministic adaptive-fidelity household and housing market that drives rents, ownership, migration, filtering, displacement, and residential development economics.

**Architecture:** Add a housing-domain scheduler composed of focused cohort, income, supply, and choice systems. Weighted cohorts carry real residential assignments and split only when outcomes diverge; persistent building ledgers carry tenure-specific inventory, rents, sale values, vacancy, and redevelopment pressure. `SimulationCore` coordinates the domain and feeds real housing economics into the existing developer pro forma/competition system while preserving V7 and all Phase 5/6 systems.

**Tech Stack:** TypeScript ES modules; Node 22+ built-in `node:test`; strict `tsc`; existing DOM UI; deterministic simulation with no `Math.random()`.

**Spec:** `docs/superpowers/specs/2026-08-22-housing-market-household-simulation-design.md`

## Global Constraints

- Base: canonical V7 `main`; implementation branch: `feature/phase7-housing-market`.
- Keep save version `7` and game/package version `0.7.0-metropolitan`; do not create V8.
- Same seed + commands + save state must produce the same authoritative future state.
- No `Math.random()`, wall-clock time, unordered state-dependent iteration, or stochastic housing auctions.
- Weighted cohorts are default; weight-1 entities arise only from deterministic splitting.
- 250,000 resident-equivalent scale must remain a few thousand household entities, not one entity per physical household.
- Unit invariants are exact: `rentalProductUnits = renterOccupiedUnits + vacantRentableUnits`; `forSaleProductUnits = ownerOccupiedUnits + vacantForSaleUnits`; `rentalProductUnits + forSaleProductUnits + unavailableUnits = housingUnits`.
- One unit cannot be simultaneously rental and for-sale inventory.
- `PopulationSystem.population` remains a compatibility aggregate but does not independently grow/shrink population after housing activation.
- Full demographics, careers/skills, banks, credit scores, foreclosure, detailed housing policy, and homelessness services remain deferred.
- Positive generic residential demand alone cannot guarantee construction.
- Existing mobility, firms/freight, services, commercial/industrial development, and old V7 saves remain functional.
- TDD is mandatory: RED focused test -> minimal GREEN implementation -> refactor -> focused test/typecheck -> commit.
- Final verification: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:smoke`.

---

## File Map

### Create
- `src/data/housing.ts` — cadence, affordability, pricing, mortgage, migration, product, wage, and cohort constants.
- `src/simulation/housing/HousingTypes.ts` — shared immutable housing/household interfaces.
- `src/simulation/housing/HouseholdCohortSystem.ts` — create/split/merge/assignment/displacement/save state.
- `src/simulation/housing/HouseholdIncomeSystem.ts` — firm-quota employment and household income.
- `src/simulation/housing/HousingSupplySystem.ts` — building ledgers and unit conservation.
- `src/simulation/housing/HousingChoiceSystem.ts` — affordability, mortgage qualification, utility, rejection reasons.
- `src/simulation/housing/HousingMarketSystem.ts` — cadence, pricing, search/matching, migration, filtering signals, diagnostics.
- `src/ui/HousingPanel.ts` — authoritative housing KPI renderer.
- Tests: `housing-data`, `household-cohorts`, `household-income`, `housing-supply`, `housing-choice`, `housing-market`, `housing-integration`, `housing-development`, `housing-redevelopment`, `housing-presentation`, `housing-scale`.

### Modify
- `src/data/buildings.ts`, `src/data/economy.ts`
- `src/simulation/buildings/BuildingSystem.ts`
- `src/simulation/population/PopulationSystem.ts`
- `src/simulation/traffic/TripGenerationSystem.ts`
- `src/simulation/mobility/PersonTripSystem.ts`
- `src/simulation/development/DevelopmentTypes.ts`
- `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- `src/simulation/development/DeveloperMarketSystem.ts`
- `src/simulation/core/SimulationCore.ts`
- `src/save/saveV7.ts`
- `src/ui/Inspector.ts`, `src/app/GameApp.ts`, `src/styles.css`
- `tests/save-v7.test.ts`, existing development/core regression tests
- `README.md`, `docs/SAVE_FORMAT.md`

---

### Task 1: Housing data/config and physical residential capacity

**Files:** Create `src/data/housing.ts`, `src/simulation/housing/HousingTypes.ts`, `tests/housing-data.test.ts`; modify `src/data/buildings.ts`.

**Interfaces produced:**

```ts
export type HousingProduct = 'rental' | 'for_sale' | 'mixed';
export type HousingProductAllocation = Readonly<{ product: HousingProduct; rentalUnits: number; forSaleUnits: number }>;
export type MigrantArchetype = Readonly<{ householdSize: number; workers: number; vehicleAccess: boolean; tenurePreference: 'renter' | 'owner'; savingsMonths: number }>;
```

- [ ] **Step 1: Write RED tests for housing units/product rules**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import { HOUSING_CADENCE, HOUSING_PRODUCT_OPTIONS, defaultLegacyProductAllocation } from '../src/data/housing.ts';

test('residential definitions expose valid physical housing inventory', () => {
  assert.deepEqual(HOUSING_CADENCE, { conditions: 10, economics: 50, market: 100, redevelopment: 250 });
  for (const d of BUILDING_VARIANTS.residential) {
    assert.ok(d.housingUnits > 0);
    assert.ok(d.residentCapacity >= d.housingUnits);
    assert.ok(d.overcrowdingMultiplier >= 1 && d.overcrowdingMultiplier <= 1.6);
    assert.ok(HOUSING_PRODUCT_OPTIONS[d.id]!.length > 0);
    const a = defaultLegacyProductAllocation(d.id, d.housingUnits);
    assert.equal(a.rentalUnits + a.forSaleUnits, d.housingUnits);
  }
});
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types --test tests/housing-data.test.ts
```

- [ ] **Step 3: Add centralized exact configuration**

```ts
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
  salePriceToEffectiveRent: 60,
  sellingCostRatio: 0.06,
  demolitionCostRatio: 0.08,
  displacementCostPerHousehold: 800,
  unemployedWorkerFallbackIncome: 700,
  disposableIncomeRatio: 0.80,
  savingsRate: 0.05,
  savingsCapMonths: 24,
});

export const HOUSEHOLD_WAGE_BY_ARCHETYPE = Object.freeze({
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

export const LEGACY_V7_PRODUCT_RULES = Object.freeze({
  residential_cottage: 'for_sale',
  residential_rowhouse: 'mixed',
  residential_apartment: 'rental',
} as const);

export const MIGRANT_ARCHETYPES: readonly MigrantArchetype[] = Object.freeze([
  Object.freeze({ householdSize: 1, workers: 1, vehicleAccess: false, tenurePreference: 'renter', savingsMonths: 1 }),
  Object.freeze({ householdSize: 2, workers: 1, vehicleAccess: true, tenurePreference: 'renter', savingsMonths: 2 }),
  Object.freeze({ householdSize: 3, workers: 2, vehicleAccess: true, tenurePreference: 'owner', savingsMonths: 3 }),
  Object.freeze({ householdSize: 4, workers: 2, vehicleAccess: true, tenurePreference: 'owner', savingsMonths: 4 }),
]);
```

`defaultLegacyProductAllocation()` uses `LEGACY_V7_PRODUCT_RULES`; mixed rowhouse units split 50/50 with odd remainder assigned to rental.

- [ ] **Step 4: Extend all building definitions**

Add `housingUnits` and `overcrowdingMultiplier` to `BuildingDefinition`. Use residential counts `4/12/32` and multipliers `1.40/1.35/1.30` for cottage/rowhouse/apartment. Commercial/industrial use `0` and `1`.

- [ ] **Step 5: GREEN + typecheck + commit**

```bash
node --experimental-strip-types --test tests/housing-data.test.ts
npm run typecheck
git add src/data/housing.ts src/simulation/housing/HousingTypes.ts src/data/buildings.ts tests/housing-data.test.ts
git commit -m "feat: define housing market contracts"
```

---

### Task 2: Adaptive household cohort state

**Files:** Create `src/simulation/housing/HouseholdCohortSystem.ts`, `tests/household-cohorts.test.ts`; extend `HousingTypes.ts`.

**Core types:**

```ts
export type MortgageProxy = Readonly<{ originalPrincipal: number; remainingPrincipal: number; annualRate: number; scheduledPayment: number; purchaseTick: number }>;
export type HouseholdPreferenceWeights = Readonly<{ affordability: number; commute: number; services: number; neighborhood: number; space: number; density: number; tenure: number; stability: number }>;
export type HouseholdCohort = Readonly<{
  id: string; weight: number; householdSize: number; workers: number; employedWorkers: number;
  employerFirmIds: readonly string[]; grossIncome: number; disposableHousingIncome: number; employmentStability: number;
  tenure: 'renter' | 'owner' | 'seeking'; buildingId: string | null; unitRequirement: number; vehicleAccess: boolean;
  liquidSavings: number; mortgage: MortgageProxy | null; housingCost: number; housingCostBurden: number;
  affordabilityState: 'comfortable' | 'manageable' | 'stressed' | 'severe'; preferences: HouseholdPreferenceWeights;
  moveFriction: number; residenceCycles: number; displacementState: 'none' | 'displaced' | 'unhoused';
  searchState: 'stable' | 'searching'; arrearsCycles: number; severeBurdenCycles: number; unhousedCycles: number;
  lastMoveReason: string | null; createdTick: number;
}>;
```

`create(input, tick)` accepts required physical/economic seed fields and fills deterministic defaults for preferences, counters, burden, move friction, and search state.

- [ ] **Step 1: RED conservation tests**

```ts
test('split preserves households population income and savings', () => {
  const s = new HouseholdCohortSystem();
  const h = s.create({ weight: 10, householdSize: 3, workers: 2, tenure: 'renter', buildingId: 'building:a', unitRequirement: 1, vehicleAccess: true, liquidSavings: 8_000 }, 0);
  const split = s.split(h.id, 3, 'capacity');
  assert.equal(split.branch.weight, 3);
  assert.equal(split.remainder.weight, 7);
  assert.equal(s.representedHouseholds(), 10);
  assert.equal(s.residentPopulation(), 30);
});
```

Add a merge test proving lexical survivor ID and exact conserved weighted sums.

- [ ] **Step 2: RED run**

```bash
node --experimental-strip-types --test tests/household-cohorts.test.ts
```

- [ ] **Step 3: Implement deterministic IDs/split/merge**

Use `household:${nextId++}`. Original ID remains with split remainder; new branch gets a new ID. Reject non-integer weights and any split `<=0` or `>= original.weight`.

Merge only stable cohorts matching household size, workers/employment, employer IDs, tenure, building, unit requirement, vehicle access, burden state, search/displacement state, mortgage signature, preference vector, gross income, housing cost, and savings-per-household; refuse merges above `cohortTargetMaxWeight`.

- [ ] **Step 4: Add restore validation**

Reject duplicate IDs, zero/negative weight, `employedWorkers > workers`, owner with no building, negative/non-finite economic values, or invalid mortgage fields before mutating current state.

- [ ] **Step 5: GREEN + commit**

```bash
node --experimental-strip-types --test tests/household-cohorts.test.ts
npm run typecheck
git add src/simulation/housing/HousingTypes.ts src/simulation/housing/HouseholdCohortSystem.ts tests/household-cohorts.test.ts
git commit -m "feat: add adaptive household cohorts"
```

---

### Task 3: Firm-linked employment and household income

**Files:** Create `HouseholdIncomeSystem.ts`, `tests/household-income.test.ts`; modify `HouseholdCohortSystem.ts`.

**Contract:** `reconcile(cohorts: HouseholdCohortSystem, firms: readonly Firm[]): HouseholdIncomeSnapshot` must make total employed cohort workers equal `min(total household workers, sum(activeFirm.filledJobs))`.

- [ ] **Step 1: RED quota/wage tests**

```ts
test('employment matches actual filled firm job quotas exactly', () => {
  const households = householdsWithTwentyWorkers();
  const firms = [firm('firm:a', 'retail_local', 7), firm('firm:b', 'assembly_manufacturing', 5)];
  new HouseholdIncomeSystem().reconcile(households, firms);
  assert.equal(households.list().reduce((s, h) => s + h.employedWorkers * h.weight, 0), 12);
});
```

Also assert equal employment at `assembly_manufacturing` produces higher income than `retail_local`.

- [ ] **Step 2: RED run**

```bash
node --experimental-strip-types --test tests/household-income.test.ts
```

- [ ] **Step 3: Implement deterministic worker-slot allocation**

Sort active firms by descending cash health then ID. Each firm's current `filledJobs` is a hard quota. Sort cohorts by ID and allocate worker positions in passes. When remaining quota covers only part of a cohort, split it exactly and continue with the accepted branch.

Per-worker wage:

```ts
const healthModifier = clamp(0.85 + firm.cashHealth * 0.30, 0.85, 1.15);
const productivityModifier = clamp(0.90 + (firm.productivity - 1) * 0.20, 0.85, 1.20);
const wage = HOUSEHOLD_WAGE_BY_ARCHETYPE[firm.archetype] * healthModifier * productivityModifier;
```

Unemployed worker income uses `HOUSING_CONFIG.unemployedWorkerFallbackIncome`. Set disposable housing income to `grossIncome * disposableIncomeRatio`; employment stability is mean employer cash health, or `0.25` if fully unemployed.

- [ ] **Step 4: Determinism test + GREEN + commit**

```bash
node --experimental-strip-types --test tests/household-income.test.ts tests/household-cohorts.test.ts
npm run typecheck
git add src/simulation/housing/HouseholdIncomeSystem.ts src/simulation/housing/HouseholdCohortSystem.ts tests/household-income.test.ts
git commit -m "feat: connect households to firm employment"
```

---

### Task 4: Persistent housing supply ledgers

**Files:** Create `HousingSupplySystem.ts`, `tests/housing-supply.test.ts`; modify `HousingTypes.ts`, `BuildingSystem.ts`.

**Ledger fields:** building ID/coordinates/definition, physical units, resident capacity, overcrowding ceiling, housing product, rental/for-sale product units, occupied/vacant counts by tenure, unavailable units, resident load, asking/effective/prior rent, asking/estimated sale price, vacancy duration, applicant/buyer pressure, turnover, resident-income/burden stats, quality/accessibility/habitability, rent/price change, redevelopment metrics.

- [ ] **Step 1: RED unit-invariant tests**

```ts
test('every housing mutation preserves exclusive unit conservation', () => {
  const supply = new HousingSupplySystem();
  supply.syncBuildings([residentialRowhouse()], 0);
  const id = supply.list()[0]!.buildingId;
  supply.occupy(id, 'renter', 3);
  supply.occupy(id, 'owner', 2);
  const x = supply.get(id)!;
  assert.equal(x.rentalProductUnits, x.renterOccupiedUnits + x.vacantRentableUnits);
  assert.equal(x.forSaleProductUnits, x.ownerOccupiedUnits + x.vacantForSaleUnits);
  assert.equal(x.rentalProductUnits + x.forSaleProductUnits + x.unavailableUnits, x.housingUnits);
});
```

- [ ] **Step 2: RED run**

```bash
node --experimental-strip-types --test tests/housing-supply.test.ts
```

- [ ] **Step 3: Implement sync and market initialization**

Construction buildings expose no inventory. On first occupied sync use building award product metadata when present, else legacy allocation. Initialize `askingRent = effectiveRent = definition.baseRent`; `askingSalePrice = estimatedSalePrice = baseRent * salePriceToEffectiveRent`; quality/accessibility `0.70`; habitability `1`.

- [ ] **Step 4: Add optional product metadata and `removeById()` to buildings**

```ts
housingProduct?: HousingProduct;
rentalProductUnits?: number;
forSaleProductUnits?: number;
```

`removeById(id)` removes and returns one cloned building. Validate new residential project metadata sums to `definition.housingUnits`.

- [ ] **Step 5: Restore validation + GREEN + commit**

```bash
node --experimental-strip-types --test tests/housing-supply.test.ts
npm run typecheck
git add src/simulation/housing/HousingSupplySystem.ts src/simulation/housing/HousingTypes.ts src/simulation/buildings/BuildingSystem.ts tests/housing-supply.test.ts
git commit -m "feat: add housing supply ledgers"
```

---

### Task 5: Affordability, utility, and ownership qualification

**Files:** Create `HousingChoiceSystem.ts`, `tests/housing-choice.test.ts`; modify `HousingTypes.ts`.

**Interfaces:** `quoteMortgage()`, `evaluateCandidate()`, `rankCandidates()` returning explicit component scores and rejection reasons.

- [ ] **Step 1: RED affordability/rate/access tests**

```ts
test('severe rent burden is rejected even with superior location utility', () => {
  const r = new HousingChoiceSystem().evaluateCandidate(lowIncomeHousehold(), expensiveExcellentRental(), choiceContext());
  assert.equal(r.eligible, false);
  assert.ok(r.rejectionReasons.includes('housing-burden'));
});

test('higher mortgage rates reduce maximum affordable purchase price', () => {
  const s = new HousingChoiceSystem();
  assert.ok(s.quoteMortgage(qualifiedBuyer(), 0.09, 100_000).maximumAffordablePrice < s.quoteMortgage(qualifiedBuyer(), 0.04, 100_000).maximumAffordablePrice);
});
```

Add a carless-household test choosing higher person accessibility when otherwise equal.

- [ ] **Step 2: RED run**

```bash
node --experimental-strip-types --test tests/housing-choice.test.ts
```

- [ ] **Step 3: Implement standard amortizing payment and three purchase constraints**

```ts
const payment = annualRate === 0
  ? principal / (years * 12)
  : principal * ((annualRate / 12) * Math.pow(1 + annualRate / 12, years * 12)) / (Math.pow(1 + annualRate / 12, years * 12) - 1);
```

Require cash for down payment + transaction reserve, payment burden `<= maxDebtServiceRatio`, and remaining savings `>= emergencyReserveMonths * grossIncome`.

- [ ] **Step 4: Implement inspectable utility**

Return named components: affordability, space fit, commute access, services, neighborhood, tenure fit, vehicle fit, density fit, stability, moving cost, overcrowding penalty, displacement risk. Apply household preference weights. Equal total utility breaks by building ID. Severe burden is a hard rejection for a new voluntary move.

- [ ] **Step 5: GREEN + commit**

```bash
node --experimental-strip-types --test tests/housing-choice.test.ts
npm run typecheck
git add src/simulation/housing/HousingChoiceSystem.ts src/simulation/housing/HousingTypes.ts tests/housing-choice.test.ts
git commit -m "feat: add household housing choice"
```

---

### Task 6: Housing market scheduler, prices, matching, migration, displacement

**Files:** Create `HousingMarketSystem.ts`, `tests/housing-market.test.ts`; modify `HousingTypes.ts`.

**Input:**

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

**Public outputs:** `snapshot()`, `snapshotState()`, `restoreState()`, `bootstrapLegacyPopulation()`, `population()`, `travelDemand()`, `displaceBuilding()`, `removeSupplyBuilding()`, `marketSignalForParcel()`, `redevelopmentSignal()`.

- [ ] **Step 1: RED rent-inertia tests**

Assert persistent high vacancy lowers rent, qualified excess demand raises it, and normal upward movement never exceeds 3% per market cycle.

- [ ] **Step 2: Implement exact rent pressure**

```ts
const occupancyRate = rentalProductUnits === 0 ? 0 : renterOccupiedUnits / rentalProductUnits;
const occupancyPressure = clamp((occupancyRate - 0.94) / 0.10, -1, 1);
const applicantPressure = clamp(qualifiedRentalApplicants / Math.max(1, vacantRentableUnits) - 1, -1, 1);
const incomeSupport = clamp(medianQualifiedIncome / Math.max(1, askingRent * 3) - 1, -0.5, 0.5);
const raw = 0.012 * occupancyPressure + 0.010 * applicantPressure + 0.004 * incomeSupport
  + 0.003 * (quality - 0.70) + 0.003 * (accessibility - 0.70) - 0.020 * (1 - habitability);
let rentChange = clamp(raw, -0.03, 0.03);
if (1 - occupancyRate >= 0.25) rentChange = Math.min(rentChange, -0.06);
```

`effectiveRent = askingRent * (1 - clamp((vacancyRate - 0.08) * 0.30, 0, 0.12))`.

Sale price is anchored to `effectiveRent * salePriceToEffectiveRent`, modified by quality/accessibility/qualified buyer pressure and mortgage-rate purchasing power, then limited to ±4% per market cycle.

- [ ] **Step 3: RED partial-cohort matching test**

Create a cohort weight 10 and only 3 eligible units. Assert deterministic split 3/7, accepted branch moves, remainder stays searching, and supply invariants hold.

- [ ] **Step 4: Implement bounded candidate search/matching**

Candidate set order: tenure-compatible available inventory -> affordable -> space-compatible -> nearby by Manhattan distance -> high-access -> ownership candidates if qualified -> lexical citywide fallback. Deduplicate and cap at 16 buildings. Searcher priority: displaced/unhoused -> severe burden -> other searchers -> household ID.

Voluntary move requires `newUtility - currentUtility > moveFriction`; involuntary displacement bypasses it.

- [ ] **Step 5: RED migration persistence tests**

Prove: no viable housing => no in-migration; viable housing + job vacancies => bounded in-migration; unhoused household leaves only after 3 full market cycles; severe-burden out-migration requires 4 consecutive cycles.

- [ ] **Step 6: Implement deterministic migration archetype cycling**

Use `MIGRANT_ARCHETYPES[nextMigrantArchetype % MIGRANT_ARCHETYPES.length]` and persist the sequence counter. No PRNG. Migration is additionally bounded by viable vacant units and `employmentVacancies`.

- [ ] **Step 7: Implement 50-tick household economics**

Reconcile employment/income; amortize mortgage principal; recompute burden; add savings `max(0, disposableHousingIncome - housingCost) * savingsRate`, capped at `savingsCapMonths * grossIncome`; update severe-burden/unhoused counters.

- [ ] **Step 8: Snapshot/restore twin-run test + GREEN + commit**

```bash
node --experimental-strip-types --test tests/housing-market.test.ts tests/housing-choice.test.ts tests/housing-supply.test.ts tests/household-income.test.ts
npm run typecheck
git add src/simulation/housing/HousingMarketSystem.ts src/simulation/housing/HousingTypes.ts tests/housing-market.test.ts
git commit -m "feat: add deterministic housing market"
```

---

### Task 7: Population authority and household-origin mobility

**Files:** Modify `PopulationSystem.ts`, `TripGenerationSystem.ts`, `PersonTripSystem.ts`, `SimulationCore.ts`; create `tests/housing-integration.test.ts`; adapt `core-city-loop.test.ts` and `city-foundation.test.ts` only where behavior intentionally changes.

- [ ] **Step 1: RED no-housing population test**

```ts
test('positive demand cannot create residents without viable housing', () => {
  const core = buildServicedJobsButNoHousingCity();
  core.step(500);
  assert.ok(core.demandSnapshot.residential > 0);
  assert.equal(core.housing.population(), 0);
  assert.equal(core.population.population, 0);
});
```

- [ ] **Step 2: Add compatibility sync API**

```ts
sync(population: number): void {
  if (!Number.isFinite(population) || population < 0) throw new Error('population sync must be non-negative and finite');
  this.population = Math.floor(population);
}
```

`SimulationCore` stops calling `population.update()` after housing activation.

- [ ] **Step 3: Integrate cadence after current service conditions**

At each 10-tick boundary: service loop -> housing tick -> population sync -> development market. The 50-tick core city loop runs afterward. `conditionsByBuilding` must use real power/water availability, service access, neighborhood quality, and mobility accessibility.

- [ ] **Step 4: RED household-origin trip test**

With two homes containing 80%/20% of housed residents, shopping origin weights must follow 80/20 rather than equal building shares. A cohort linked to a firm must commute to that firm's actual building.

- [ ] **Step 5: Implement explicit travel demand path**

```ts
export type HouseholdTravelDemand = Readonly<{
  originBuildingId: string;
  destinationBuildingId?: string;
  commuterWeight: number;
  shoppingWeight: number;
}>;
```

`PersonTripSystem` uses explicit commute destinations when provided and deterministic commercial destination selection for shopping. Unhoused households emit no normal residential-origin trips. Keep the old aggregate generator as a fallback for direct legacy tests.

- [ ] **Step 6: GREEN regression run + commit**

```bash
node --experimental-strip-types --test tests/housing-integration.test.ts tests/core-city-loop.test.ts tests/city-foundation.test.ts
npm test
npm run typecheck
git add src/simulation/population/PopulationSystem.ts src/simulation/traffic/TripGenerationSystem.ts src/simulation/mobility/PersonTripSystem.ts src/simulation/core/SimulationCore.ts tests/housing-integration.test.ts tests/core-city-loop.test.ts tests/city-foundation.test.ts
git commit -m "feat: make housing authoritative for population"
```

---

### Task 8: Tenure-aware residential developer underwriting

**Files:** Modify development types/feasibility/market, `BuildingSystem.ts`, `SimulationCore.ts`; create `tests/housing-development.test.ts`; extend existing development tests.

**New context:**

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

`DevelopmentParcelContext` gains optional `residentialMarket`. Feasibility/bid/award/commitment gain optional `housingProduct`, `rentalProductUnits`, `forSaleProductUnits`, and replacement economics.

- [ ] **Step 1: RED distinct rental/for-sale economics test**

Create one residential lot with both product signals and assert rental and for-sale results have distinct stabilized values and IDs.

- [ ] **Step 2: Implement residential product expansion**

For each residential physical definition, evaluate every allowed product. Rental value:

```ts
const grossPotentialRent = effectiveRentPerUnit * definition.housingUnits;
const vacancyRate = clamp(rentalVacancyRate, 0.02, 0.40);
const effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate);
const netOperatingIncome = effectiveGrossIncome * (1 - definition.operatingExpenseRatio) - propertyTaxes;
const stabilizedValue = netOperatingIncome / capRate;
```

For-sale value:

```ts
const grossSales = salePricePerUnit * definition.housingUnits;
const absorptionDiscount = clamp(1 - 0.08 * Math.max(0, 1 - qualifiedBuyerPressure), 0.85, 1);
const stabilizedValue = grossSales * absorptionDiscount * (1 - HOUSING_CONFIG.sellingCostRatio);
```

Mixed value is the exact persisted rental-unit stabilized value plus net sale proceeds for its deterministic unit split. Non-residential formulas remain unchanged.

- [ ] **Step 3: Make developer market product-aware**

Include product in bid/award IDs and tie-breakers. Add optional developer housing preferences, defaulting to zero when absent from old saves:

```ts
local_builder: { rental: 0.000, for_sale: 0.035, mixed: 0.005 }
urban_developer: { rental: 0.020, for_sale: 0.010, mixed: 0.030 }
institutional_developer: { rental: 0.040, for_sale: 0.000, mixed: 0.020 }
industrial_specialist: { rental: -0.020, for_sale: -0.020, mixed: -0.020 }
```

- [ ] **Step 4: Persist award product on construction building**

Validate rental + for-sale units equal physical housing units and copy product fields into `Building`.

- [ ] **Step 5: RED/ GREEN integration proving generic demand is insufficient**

Positive residential demand with weak housing economics must produce no residential award; stronger effective rent/sale value must make at least one candidate feasible.

- [ ] **Step 6: Development regression + commit**

```bash
node --experimental-strip-types --test tests/housing-development.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts
npm run typecheck
git add src/simulation/development src/simulation/buildings/BuildingSystem.ts src/simulation/core/SimulationCore.ts tests/housing-development.test.ts tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts
git commit -m "feat: connect housing economics to developers"
```

---

### Task 9: Occupied-parcel redevelopment and filtering

**Files:** Modify `HousingMarketSystem.ts`, `HousingTypes.ts`, `DevelopmentFeasibilitySystem.ts`, `SimulationCore.ts`; create `tests/housing-redevelopment.test.ts`.

- [ ] **Step 1: RED redevelopment hurdle tests**

Low replacement value must fail after existing-use + demolition + displacement costs; strong replacement value must clear.

- [ ] **Step 2: Implement exact replacement economics**

```ts
const demolitionCost = currentDefinition.baseConstructionCost * HOUSING_CONFIG.demolitionCostRatio;
const displacementCost = representedHouseholdsInBuilding * HOUSING_CONFIG.displacementCostPerHousehold;
const redevelopmentGain = replacementStabilizedValue - existingUseValue - demolitionCost - displacementCost;
```

Only higher-intensity replacement definitions are eligible. Require `redevelopmentGain > preFinanceDevelopmentCost * 0.05` in addition to normal developer feasibility/hurdle checks.

- [ ] **Step 3: Enumerate occupied residential opportunities only every 250 ticks**

Vacant-lot evaluation remains every 10 ticks. Commercial/industrial occupied redevelopment remains out of scope.

- [ ] **Step 4: Implement transactional replacement execution**

Before displacement/removal, snapshot `buildings.list()` and `housing.snapshotState()`. On success: displace households -> remove old building -> remove old supply ledger -> start awarded construction. If start fails: restore full building snapshot + housing snapshot, cancel developer commitment at 100% recovery, then rethrow.

- [ ] **Step 5: RED multi-step filtering-chain test**

Add new high-end supply and prove at least three deterministic moves propagate vacancies down-market, ending with a lower-income household gaining an existing-stock option previously unavailable. Assert unit conservation after every step.

- [ ] **Step 6: GREEN + commit**

```bash
node --experimental-strip-types --test tests/housing-redevelopment.test.ts tests/housing-market.test.ts tests/housing-development.test.ts
npm run typecheck
git add src/simulation/housing src/simulation/development/DevelopmentFeasibilitySystem.ts src/simulation/core/SimulationCore.ts tests/housing-redevelopment.test.ts
git commit -m "feat: add endogenous residential redevelopment"
```

---

### Task 10: Save V7 housing persistence and old-V7 migration

**Files:** Modify `src/save/saveV7.ts`, `tests/save-v7.test.ts`, then `docs/SAVE_FORMAT.md` after GREEN.

- [ ] **Step 1: RED exact round-trip/continuation test**

```ts
test('Save V7 round-trips housing state and future deterministically', () => {
  const core = buildHousingCity();
  core.step(800);
  const save = serializeCore(core);
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(serializeCore(loaded), save);
  core.step(500); loaded.step(500);
  assert.deepEqual(serializeCore(loaded), serializeCore(core));
});
```

- [ ] **Step 2: RED prior-V7 bootstrap test**

Delete `housingMarket` from a mutable clone of a valid V7 save. Hydrate and assert developer commitments unchanged, all occupied residential buildings have ledgers, represented residents equal old aggregate population, no historical move events are invented, and legacy owners have `mortgage: null` rather than fabricated debt.

- [ ] **Step 3: Implement extension without version bump**

`SaveV7` now serializes `housingMarket: HousingMarketStateSnapshot`. Hydrator accepts the field as optional at runtime only for old V7 compatibility. If present: validate references then restore. If absent: `bootstrapLegacyPopulation(oldPopulation, occupiedBuildings, tick)`. Finally `population.sync(housing.population())`.

- [ ] **Step 4: Corruption tests**

Reject missing/non-residential household building references, missing ledger building, duplicate household IDs, product-unit mismatch, resident load above practical overcrowding ceiling, invalid mortgage/economic values, and inconsistent derived population before mutating housing state.

- [ ] **Step 5: Historical save regression + docs + commit**

```bash
node --experimental-strip-types --test tests/save-v7.test.ts tests/save-v6.test.ts tests/save-v5.test.ts tests/save-v4.test.ts tests/save-v3.test.ts
npm run typecheck
git add src/save/saveV7.ts tests/save-v7.test.ts docs/SAVE_FORMAT.md
git commit -m "feat: persist V7 housing market state"
```

---

### Task 11: Housing diagnostics and compact UI

**Files:** Create `src/ui/HousingPanel.ts`, `tests/housing-presentation.test.ts`; modify `Inspector.ts`, `GameApp.ts`, `styles.css`.

**Snapshot must expose:** population, represented households, renter/owner households, rental/for-sale vacancy, median/effective rent, median sale price, burden buckets, overcrowding, displaced/unhoused/searching households, in/out migration, turnover, ownership-qualified searchers, redevelopment pressure.

- [ ] **Step 1: RED panel test**

```ts
test('housing panel renders authoritative vacancy affordability tenure and displacement', () => {
  const html = new HousingPanel().render(sampleHousingSnapshot());
  assert.match(html, /Vacancy/i);
  assert.match(html, /Rent/i);
  assert.match(html, /Owners/i);
  assert.match(html, /Severe burden/i);
  assert.match(html, /Displaced/i);
});
```

- [ ] **Step 2: Implement pure `HousingPanel.render(snapshot)`**

Follow `EconomyPanel`: no DOM queries, no invented values, only formatting.

- [ ] **Step 3: Add residential inspector causes**

Show unit/product split, asking/effective rent, sale value, applicant/buyer pressure, resident income/burden, quality/access/habitability, rent-change drivers, existing-use value, redevelopment pressure, and displacement-risk households.

- [ ] **Step 4: Minimal app integration**

`GameApp` only mounts/updates the panel. Keep all housing formatting in `HousingPanel` and inspector code.

- [ ] **Step 5: GREEN + build + commit**

```bash
node --experimental-strip-types --test tests/housing-presentation.test.ts tests/economy-presentation.test.ts
npm run typecheck
npm run build
git add src/ui/HousingPanel.ts src/ui/Inspector.ts src/app/GameApp.ts src/styles.css tests/housing-presentation.test.ts
git commit -m "feat: expose housing market diagnostics"
```

---

### Task 12: 250k scale, full acceptance matrix, docs, final verification

**Files:** Create `tests/housing-scale.test.ts`; modify `README.md` and final `docs/SAVE_FORMAT.md` wording if needed.

- [ ] **Step 1: Add 250k-equivalent scale test**

Build supply/cohorts representing at least 250,000 residents with initial entity count under 5,000; run 20 housing market cycles; assert population retained, household entities remain below 8,000, and all unit invariants hold. Wall-clock time may be logged but is not an authoritative assertion.

- [ ] **Step 2: Add deterministic twin-run scale test**

Run two identical 250k systems for the same 20 cycles and `deepEqual` their authoritative snapshots.

- [ ] **Step 3: Verify acceptance matrix in named tests**

Coverage must prove: deterministic replay; vacancy rent cuts; qualified-demand rent growth; affordability rejection; mortgage-rate purchasing-power decline; carless access preference; overcrowding move pressure; job-loss burden; displacement state preservation; unhoused out-migration; real filtering chain; generic demand insufficient for construction; housing economics feeding developers; occupied-parcel hurdle economics; old-V7 bootstrap; V7 exact round-trip; commercial/industrial compatibility; physical-utility gating; unit conservation; bounded 250k entity count.

- [ ] **Step 4: Update README**

Document adaptive cohorts, rental/ownership markets, mortgage/equity proxies, explicit assignments, migration/displacement/filtering, and housing-driven development/redevelopment as canonical V7 Phase 7 behavior.

- [ ] **Step 5: Fresh full verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
git status --short
```

Do not claim completion from any earlier run.

- [ ] **Step 6: Commit scale/docs**

```bash
git add tests/housing-scale.test.ts README.md docs/SAVE_FORMAT.md
git commit -m "test: verify Phase 7 housing market at scale"
```

- [ ] **Step 7: Fresh verification after final commit**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```

Record final test count and exact commit SHA in the completion report.

---

## Dependency Order

`1 contracts -> 2 cohorts -> 3 income -> 4 supply -> 5 choice -> 6 market -> 7 population/mobility -> 8 development -> 9 redevelopment -> 10 persistence -> 11 UI -> 12 scale/verification`

Task 11 may only begin after Task 6's snapshot interface is stable. Task 9 must follow Task 8 because redevelopment requires tenure-aware project economics.

## Review Gates

After every task: run the focused tests, run typecheck, inspect for unrelated changes, commit independently, then obtain a fresh spec-compliance/code-quality review. Any unexpected failure uses `superpowers:systematic-debugging` before a fix. Completion requires `superpowers:verification-before-completion` with fresh final command output.
