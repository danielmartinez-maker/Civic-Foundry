# Civic Foundry — Phase 7 Tenure, Housing Search & Relocation Design

Date: 2026-08-24
Target branch: `phase7-tenure-relocation`
Baseline: `main` at `18e9cad4084307bea204dfdbdbc51211b1b652b9`
Canonical runtime/save baseline: Save V7 / `0.7.0-metropolitan`

## Objective

Complete the two remaining major Phase 7 mechanical slices as one integrated package:

1. add aggregate rental-versus-ownership tenure economics; and
2. replace stateless whole-city housing reallocation with persistent deterministic cohort placement, search, displacement, and rehousing.

The implementation must preserve Civic Foundry's aggregate deterministic architecture. It must not introduce individual household/person agents, deed-level ownership, banks, leases, mortgages as contracts, or a second parallel housing-market simulation.

The architectural change is that residential occupancy becomes authoritative persistent cohort state. Market rents, local quality, development economics, and population remain sourced from the existing Phase 7 systems.

## Why tenure and relocation ship together

Tenure and relocation are causally coupled. Renters and owners face different monthly housing costs; financing conditions change ownership affordability; redevelopment must displace actual occupants; and anti-displacement safeguards need the band/tenure composition of the building being removed. Vacancy and turnover therefore need persistent occupancy rather than decorative derived statistics.

Both slices share one authoritative cohort ledger and one optional Save V7 state extension.

## Existing systems to preserve

The implementation builds on, rather than replaces:

- `LandHousingMarketSystem` for market pressure, rent, vacancy, and parcel price signals;
- `DevelopmentFeasibilitySystem` for project underwriting;
- `DevelopmentPolicySystem` for player housing/development policy;
- `HousingChoiceSystem` for affordability/quality reporting;
- `RedevelopmentPressureSystem` for occupied-parcel redevelopment pressure;
- `RedevelopmentExecutionSystem` for redevelopment admission;
- `DeveloperMarketSystem` for deterministic developer capital allocation;
- `SimulationCore` as orchestration boundary; and
- Save V7 as the canonical save envelope.

No new subsystem may independently recalculate market rent, project returns, population, or redevelopment eligibility.

## Scope

### In scope

- aggregate cohorts by income band, tenure, and residential building;
- `renter` and `owner` tenure modes;
- deterministic rental/ownership capacity split by residential intensity;
- asking rent, implied purchase price, mortgage-equivalent monthly owner cost;
- owner/renter affordability and tenure preference by income band;
- persistent occupancy, vacancy, and turnover;
- deterministic search for displaced, previously unplaced, new, severely cost-burdened, and limited voluntary movers;
- explicit unplaced/displaced cohorts;
- redevelopment displacement from actual current allocations;
- targeted lower-income rehousing protection;
- citywide and building-level tenure/relocation diagnostics;
- optional Save V7 `housingState` persistence;
- Land/Housing panel and inspector expansion;
- `tenure` and `relocation-pressure` overlays;
- deterministic unit/integration/save/invariant/browser acceptance tests.

### Explicitly deferred

- individual households or persons;
- family size, age, children, births/deaths, education mobility, or other Phase 9 demographics;
- landlords, banks, deed transactions, mortgage balances, foreclosures, leases, evictions, or rent control;
- speculative property trading;
- mixed-use tenure allocation;
- subsidized-housing waiting lists;
- homelessness/shelter services;
- commercial/industrial tenant relocation;
- multi-city migration.

## Core domain model

Continue using:

```ts
export type HousingIncomeBand = 'lower' | 'middle' | 'upper';
```

Existing game-economy assumptions remain:

| Band | Population share | Monthly income | Preferred max burden |
| --- | ---: | ---: | ---: |
| lower | 45% | 1,500 | 35% |
| middle | 40% | 2,600 | 32% |
| upper | 15% | 4,500 | 28% |

Add:

```ts
export type HousingTenure = 'renter' | 'owner';

export type HousingCohortAllocation = Readonly<{
  buildingId: string;
  band: HousingIncomeBand;
  tenure: HousingTenure;
  residents: number;
}>;
```

Cohorts with the same `(buildingId, band, tenure)` are merged. Fractional residents remain allowed because the existing population/housing model is aggregate.

## `HousingTenureSystem`

Create `src/simulation/housing/HousingTenureSystem.ts`.

This system is deterministic and derived. It owns no occupancy history. It turns current occupied residential buildings plus existing market/financing signals into tenure-specific options.

### Public shape

```ts
export type HousingTenureOption = Readonly<{
  buildingId: string;
  tenure: HousingTenure;
  capacity: number;
  monthlyCost: number;
  monthlyRent?: number;
  impliedPurchasePrice?: number;
  personAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
}>;

export type BuildingTenureEconomics = Readonly<{
  buildingId: string;
  totalCapacity: number;
  rentalCapacity: number;
  ownershipCapacity: number;
  askingRent: number;
  impliedPurchasePrice: number;
  monthlyOwnerCost: number;
}>;

export type HousingTenureSnapshot = Readonly<{
  marketInterestRate: number;
  byBuilding: Readonly<Record<string, BuildingTenureEconomics>>;
  options: readonly HousingTenureOption[];
}>;
```

### Capacity split

| Intensity | Owner share | Renter share |
| --- | ---: | ---: |
| low | 60% | 40% |
| medium | 40% | 60% |
| high | 25% | 75% |

For physical resident capacity `C`:

```text
ownershipCapacity = C * ownerShare
rentalCapacity = C - ownershipCapacity
```

The two capacities must sum exactly to `C`.

### Rental cost

There is one residential rent channel:

```text
askingRent =
  definition.baseRent
  * LandHousingMarketSystem.parcelSignal(...).marketRentMultiplier
  * DevelopmentPolicySystem.residentialRentFactor()
```

`HousingTenureSystem` must consume this signal, not create another rent model.

### Implied purchase price

```text
annualMarketRent = askingRent * 12
capitalizationRate = clamp(0.045 + 0.40 * marketInterestRate, 0.05, 0.09)
impliedPurchasePrice = annualMarketRent / capitalizationRate
```

### Monthly ownership cost

Constants:

```text
loanToValue = 0.80
mortgageTermMonths = 360
annualCarryingCostRate = 0.015
```

```text
principal = impliedPurchasePrice * loanToValue
monthlyRate = marketInterestRate / 12
mortgagePayment = monthlyRate === 0
  ? principal / mortgageTermMonths
  : principal * monthlyRate * (1 + monthlyRate)^mortgageTermMonths
    / ((1 + monthlyRate)^mortgageTermMonths - 1)
monthlyCarryingCost = impliedPurchasePrice * annualCarryingCostRate / 12
monthlyOwnerCost = mortgagePayment + monthlyCarryingCost
```

The 20% equity portion is not a cash transaction in Phase 7.

### Desired tenure shares

| Band | Desired owner share | Desired renter share |
| --- | ---: | ---: |
| lower | 20% | 80% |
| middle | 50% | 50% |
| upper | 70% | 30% |

They are preferences, not quotas.

## `HousingRelocationSystem`

Create `src/simulation/housing/HousingRelocationSystem.ts`.

This is the authoritative owner of aggregate residential placement history.

### Authoritative state

```ts
export type UnplacedHousingCohort = Readonly<{
  band: HousingIncomeBand;
  tenurePreference: HousingTenure;
  residents: number;
  displaced: boolean;
  displacedFromBuildingId?: string;
}>;

export type HousingRelocationTotals = Readonly<{
  movedResidents: number;
  displacedResidents: number;
  rehousedDisplacedResidents: number;
  failedSearchResidents: number;
}>;

export type HousingRelocationState = Readonly<{
  allocations: readonly HousingCohortAllocation[];
  unplaced: readonly UnplacedHousingCohort[];
  totals: HousingRelocationTotals;
}>;
```

`totals` are cumulative persisted diagnostics. Per-cycle diagnostics are part of the latest derived snapshot.

### Snapshot requirements

The latest snapshot must expose at least:

- population, housed, and unplaced residents;
- renter/owner resident totals and shares;
- rental and ownership vacancy rates;
- moved/displaced/rehoused/failed-search residents this cycle;
- cumulative totals;
- cost-burdened residents;
- by-band housed/unplaced/renter/owner/cost-burdened residents;
- by-building total/renter/owner occupancy, cost burden, moves in/out, and displacement this cycle.

### Conservation invariants

After every reconcile:

```text
sum(allocations.residents) + sum(unplaced.residents) = population
```

For every building/tenure:

```text
allocated <= tenure option capacity
```

For every building:

```text
renter + owner <= physical residential capacity
```

Counts must be finite and non-negative. Search and displacement may move resident mass but may never create or destroy it.

## Shared scoring

`HousingChoiceSystem` and `HousingRelocationSystem` must use shared exported helpers/constants rather than duplicate affordability logic.

For a band/option:

```text
burden = monthlyCost / monthlyIncome
affordabilityScore = clamp(
  (2 * maxPreferredBurden - burden) / maxPreferredBurden,
  0,
  1
)
qualityScore =
  0.30 * neighborhoodQuality
  + 0.25 * serviceQuality
  + 0.25 * personAccessibility
  + 0.20 * utilityRatio
```

### Exact tenure preference score

For band `b`, let `desiredOwnerShare[b]` and `desiredRenterShare[b]` be the table above.

```text
tenurePreferenceScore(optionTenure) =
  optionTenure === cohort.tenurePreference
    ? 1
    : desiredShare[b][optionTenure]
```

Thus cross-tenure search is always possible, but preserving the preferred tenure receives the strongest preference contribution.

### Candidate score and stable ordering

```text
candidateScore =
  0.55 * affordabilityScore
  + 0.30 * qualityScore
  + 0.15 * tenurePreferenceScore
```

Candidates order by:

1. descending `candidateScore`;
2. lower `monthlyCost`;
3. stable `buildingId` ascending;
4. tenure order `renter` before `owner`.

## Reconciliation lifecycle

The regular housing reconcile runs once per 50-tick city loop. Forced displacement also triggers immediate targeted reconciliation after residential removal/redevelopment.

Priority is strict:

1. displaced cohorts;
2. previously unplaced cohorts;
3. new population entrants;
4. severely cost-burdened cohorts;
5. limited voluntary movers.

### Displaced cohorts

When a residential building disappears, `displaceBuilding(buildingId)` removes its actual allocations and converts them to unplaced cohorts with `displaced = true` and `displacedFromBuildingId` set.

Their original band and tenure are preserved as search preference. Cross-tenure rehousing is allowed.

### Previously unplaced cohorts

They search before new population so repeated failure is not starved by growth.

### New population entrants

If authoritative population is above represented resident mass, split the delta by existing income shares, then by desired tenure shares. These entrants are not counted as displacement or historical moves.

If authoritative population falls, remove resident mass deterministically in reverse priority: unplaced first, then lowest-scoring housed allocations, with stable tie-breaking. Population contraction is not counted as relocation or displacement.

### Severe cost burden

A housed cohort is severely burdened when:

```text
burden > 2 * preferredMaxBurden
```

Such residents become mandatory searchers, but they are **not evicted into unplaced state merely because search fails**. The algorithm first evaluates alternatives while reserving their current slot. A severe-burden move occurs only for the portion that can obtain an alternative with `candidateScore > currentScore`. Any unmatched portion remains in its current allocation and remains cost-burdened.

This prevents the housing-search system itself from manufacturing homelessness.

### Voluntary turnover

```text
maximumVoluntaryTurnoverPerCycle = 0.02
minimumMoveScoreImprovement = 0.10
```

At most 2% of residents housed at the start of the regular 50-tick reconcile may voluntarily move. A voluntary move requires:

```text
bestAlternativeScore >= currentScore + 0.10
```

Severely burdened mandatory movers are not charged against the 2% voluntary cap.

### Partial moves

Cohorts may split to fit available capacity. Identical `(buildingId, band, tenure)` allocations are merged after each reconciliation.

## Initialization and backward compatibility

For a new city or V7 save without `housingState`:

1. derive current tenure options;
2. split population by income shares;
3. split each income band by desired tenure shares;
4. perform deterministic initial placement;
5. put unmatched cohorts in `unplaced`;
6. set cumulative movement/displacement/failed-search totals to zero.

Initialization is not counted as movement or displacement.

V6 and older saves continue through the existing migration path; once hydrated as V7, missing housing state initializes by the same rule.

## `HousingChoiceSystem` refactor

`HousingChoiceSystem` remains the public affordability/quality reporting layer but stops owning authoritative placement.

It must accept the current tenure options plus the authoritative relocation snapshot/state and compute:

- physical capacity;
- effective affordable capacity;
- affordability index;
- housed/unplaced residents;
- cost-burden share;
- by-band diagnostics; and
- by-building diagnostics.

`assignedResidents` and occupancy must come from `HousingRelocationSystem`, not a fresh allocation pass.

Existing public fields should be preserved where practical to avoid unnecessary UI/test churn.

## Redevelopment integration

### Actual occupants

`RedevelopmentPressureSystem` and `RedevelopmentExecutionSystem` must receive the actual current occupants of each residential building from relocation state.

Before approving redevelopment of occupied residential stock, execution must continue existing physical/effective-affordable capacity protections and additionally evaluate whether the displaced lower-income cohort can be rehoused.

### Lower-income protection

Add one policy field to `DevelopmentPolicyState`:

```ts
lowerIncomeRelocationProtection: number
```

Bounds: `[0.50, 1.00]`.
Default: `0.90`.

For a candidate redevelopment, calculate:

```text
displacedLower = lower-income residents currently allocated to the building
lowerAffordableSlack =
  sum over all remaining renter+owner tenure option vacancies where
  affordabilityScore('lower', option) > 0
```

Exclude the building being redeveloped from the slack calculation.

If `displacedLower === 0`, this safeguard passes.
Otherwise require:

```text
lowerAffordableSlack >= displacedLower * lowerIncomeRelocationProtection
```

This is a targeted admission safeguard. It does not guarantee every individual move because Phase 7 uses aggregate cohorts.

### Execution order

When a redevelopment award replaces an occupied residential building:

1. call `housingRelocation.displaceBuilding(existingBuildingId)` before the building disappears;
2. execute `buildings.replaceDevelopment(...)`;
3. remove the old building from the economy domain;
4. refresh tenure options without the removed stock;
5. immediately reconcile displaced/unplaced cohorts against remaining stock;
6. continue normal developer commitment handling.

If replacement throws, displacement state must be restored together with the failed replacement path so occupants are not lost. The implementation should capture relocation state before displacement and restore it on failure.

Manual bulldozing of an occupied residential building uses the same displacement hook before removal and immediate reconciliation afterward.

## `SimulationCore` orchestration

Add authoritative/derived members for:

```ts
readonly housingTenure: HousingTenureSystem;
readonly housingRelocation: HousingRelocationSystem;
housingTenureSnapshot: HousingTenureSnapshot;
housingRelocationSnapshot: HousingRelocationSnapshot;
```

Refactor current `refreshHousingChoice()` into a three-stage housing pipeline:

1. `refreshHousingTenure()` — derives current tenure options from occupied residential buildings, parcel market signals, local context, policy, and current development interest rate;
2. `reconcileHousing()` — mutates authoritative cohort placement only at initialization, regular 50-tick reconciliation, explicit displacement, load restoration, or explicit policy refresh that requires reconciliation;
3. `refreshHousingChoice()` — reports affordability/occupancy from current tenure + relocation state.

### Regular 50-tick city-loop ordering

1. refresh utilities/employment/taxes and existing city snapshots;
2. refresh land/housing market from current population/capacity;
3. refresh housing tenure economics;
4. reconcile existing cohorts and unplaced residents;
5. refresh housing choice diagnostics;
6. evaluate demand using `effectiveAffordableCapacity`;
7. settle finance and compute attractiveness;
8. apply existing bounded affordability modifier;
9. update population using raw physical residential capacity;
10. reconcile the resulting population delta;
11. refresh market, tenure, housing choice, redevelopment pressure, and redevelopment execution snapshots.

Development remains on the 10-tick cadence. It may refresh derived housing/market snapshots, but regular voluntary relocation remains a 50-tick event.

## Save V7

Keep:

```ts
saveVersion: 7
gameVersion: '0.7.0-metropolitan'
```

Extend `SaveV7` with:

```ts
housingState?: HousingRelocationState
```

Serialization always writes `core.housingRelocation.snapshotState()`.

Hydration rules:

- if `housingState` is present, validate references and restore it;
- if absent, initialize deterministically with zero historical counters;
- reject duplicate allocation keys, negative/non-finite residents, missing building references, allocations to non-residential buildings, invalid tenure/band values, and capacity violations;
- after restore, reconcile only the population delta caused by older save semantics; do not re-sort valid persisted occupants.

## UI and overlays

Extend the existing Land/Housing UI rather than add a separate root panel.

### Panel metrics

Show at minimum:

- renter share;
- owner share;
- rental vacancy;
- ownership vacancy;
- average asking rent;
- average monthly ownership cost;
- moved this cycle;
- displaced this cycle;
- rehoused displaced this cycle;
- failed search/unplaced residents;
- lower-income rehousing slack ratio.

Extend residential inspector diagnostics with building renter/owner mix, tenure occupancy, cost burden, moves in/out, and displacement.

### New overlay modes

Add two mutually exclusive Land/Housing overlay modes alongside existing affordability/occupancy/redevelopment modes:

`tenure`
- building value = `ownerResidents / assignedResidents`;
- no assigned residents = 0;
- displayed as owner-share intensity.

`relocation-pressure`
- building value = clamp01((movedOutThisCycle + displacedThisCycle + costBurdenedResidents) / max(1, assignedResidents + movedOutThisCycle));
- empty/no-history building = 0.

Overlay mode switching must preserve the existing mutual-exclusion rule and must not mutate simulation state.

### Lower-income rehousing slack ratio

Citywide panel metric:

```text
lowerAffordableVacancy =
  sum tenure-option vacancy where affordabilityScore('lower', option) > 0
lowerIncomeResidents = housingRelocation.byBand.lower.housedResidents
lowerIncomeRehousingSlackRatio = lowerIncomeResidents === 0
  ? 1
  : lowerAffordableVacancy / lowerIncomeResidents
```

This metric may exceed 1; display may cap for percentage visualization but authoritative diagnostics should retain the uncapped finite ratio.

## Policy UI

Add `lowerIncomeRelocationProtection` to the existing Development Policy panel as a percent control, default 90%, bounded 50–100%.

Applying policy must update authoritative policy state, refresh tenure/choice/redevelopment diagnostics, and preserve current cohort allocations unless a capacity/policy validity change requires reconciliation.

## Testing and acceptance

### RED/GREEN requirements

Implementation follows TDD. Add failing tests before each production subsystem or behavior.

### Unit behavior

Tests must prove:

- tenure capacities sum to physical capacity;
- rent uses the existing market/policy rent signal;
- higher interest rates raise monthly owner financing cost under otherwise identical conditions;
- implied purchase price and owner cost remain finite/bounded;
- deterministic candidate ordering including exact cross-tenure preference behavior;
- cheaper/otherwise equal rental stock attracts renter cohorts;
- ownership becomes less attractive as owner monthly burden rises;
- allocations conserve population and never exceed tenure/building capacity;
- identical inputs/state produce identical relocation results;
- voluntary turnover cannot exceed 2% of start-of-cycle housed residents;
- severe cost burden does not evict residents merely because no better slot exists;
- displaced residents search before old unplaced and new entrants;
- failed displaced search leaves explicit displaced unplaced state;
- partial cohort moves preserve mass;
- population contraction is deterministic and not counted as displacement;
- redevelopment displacement targets actual cohorts in the removed building;
- lower-income protection can block an otherwise feasible redevelopment;
- spare but unaffordable capacity does not satisfy lower-income protection;
- successful rehousing increments displacement and rehousing diagnostics correctly.

### Save compatibility

Tests must prove:

- V7 round-trip preserves allocations, unplaced cohorts, tenure, and cumulative totals;
- old V7 without `housingState` initializes deterministically with zero historical counters;
- V6 migration still works;
- malformed housing-state references/capacity are rejected.

### Long-run invariants

Run a deterministic multi-cycle test with development and population changes and assert after each housing cycle:

- resident conservation;
- no capacity violations;
- no NaN/Infinity;
- no negative vacancy;
- deterministic repeatability from the same seed/state.

### Browser acceptance

Extend the Phase 7 Playwright smoke to verify:

- tenure and relocation metrics render;
- new overlay modes exist and remain mutually exclusive;
- a deterministic test city shows renter and owner occupancy;
- changing development interest conditions changes owner-cost diagnostics;
- applying lower-income relocation protection changes authoritative policy state;
- redevelopment/manual removal updates displacement diagnostics without browser errors;
- save/load restores housing state and UI.

### Final verification gate

Before merge, exact branch head must pass:

```text
Tests
Typecheck
Lint
Build
Phase 7 Chromium smoke
```

Also review PR diff, submitted reviews, and inline review threads before merge.

## Documentation and Phase 7 completion

Update README/roadmap to state that Phase 7 now includes:

- deterministic developer pro formas and competing developers;
- land/property markets;
- aggregate affordability and housing choice;
- redevelopment pressure/execution;
- housing/development policy controls;
- renter/owner tenure economics;
- persistent aggregate housing search, relocation, displacement, and rehousing;
- Land/Housing intelligence and overlays.

After this package and the final verification/balance cleanup pass, Phase 7 — Land, Housing & Development is mechanically complete and the roadmap may advance to Phase 8 — Metropolitan Infrastructure.
