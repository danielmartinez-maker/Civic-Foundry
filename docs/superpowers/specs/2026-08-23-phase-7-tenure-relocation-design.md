# Civic Foundry — Phase 7 Tenure, Housing Search & Relocation Design

Date: 2026-08-23
Target branch: `phase7-tenure-relocation`
Baseline: `main` at `18e9cad4084307bea204dfdbdbc51211b1b652b9`
Canonical runtime/save baseline: V7 `0.7.0-metropolitan`

## Objective

Complete the two remaining major mechanical slices of Phase 7 as one integrated housing-market package:

1. add aggregate tenure depth so residential stock can distinguish rental and owner-occupied economics; and
2. replace stateless whole-city reallocation with a persistent deterministic cohort ledger that can represent staying, moving, displacement, rehousing, and failed housing searches.

The design must preserve Civic Foundry's deterministic simulation architecture, existing development/property-market systems, and aggregate demographic abstraction. It must not introduce thousands of individual household agents.

The key architectural change is that housing occupancy becomes persistent authoritative state at the aggregate cohort level. The existing housing-choice layer remains responsible for affordability and quality diagnostics, while a new relocation system owns where residents are actually placed over time.

## Why these slices are one package

Tenure and relocation are causally coupled rather than independent features.

- Renters and owners face different monthly housing costs.
- Financing conditions change ownership affordability and therefore search behavior.
- Redevelopment displaces actual occupants, not a freshly recomputed citywide allocation.
- Anti-displacement protections require knowing which income bands and tenure cohorts occupy a building before demolition.
- Vacancy and turnover are outcomes of persistent occupancy, not independent decorative statistics.

Implementing tenure without persistent relocation would make renter/owner data cosmetic. Implementing relocation without tenure would immediately require a second redesign once ownership economics arrive. Therefore both slices share one authoritative cohort ledger and one save-state extension.

## Scope

### In scope

1. Aggregate housing cohorts by income band, tenure, and building.
2. Two tenure types: `renter` and `owner`.
3. Rental capacity and owner-occupied capacity for each occupied residential building.
4. Market-derived asking rent and implied purchase price.
5. Mortgage-equivalent monthly ownership cost based on current development interest conditions.
6. Taxes/maintenance as bounded ownership carrying costs.
7. Tenure affordability and attractiveness by income band.
8. Persistent building occupancy rather than whole-city reallocation on every housing refresh.
9. Deterministic search and relocation for displaced, unplaced, new, cost-burdened, and limited voluntary movers.
10. Explicit unplaced and displaced cohort state.
11. Redevelopment displacement uses the actual cohorts occupying the building.
12. Lower-income relocation protection as an additional redevelopment safeguard.
13. Citywide tenure share, vacancy, turnover, movement, displacement, rehousing, and failed-search diagnostics.
14. Building-level tenure and relocation diagnostics.
15. Save V7 persistence using an optional `housingState` field for backward compatibility.
16. Land/Housing UI expansion for tenure and relocation metrics.
17. Tenure and relocation-pressure overlays.
18. Deterministic tests, save compatibility tests, long-run invariants, and browser acceptance.

### Explicitly deferred

- individual household/person agents;
- family size, age, marital status, children, detailed demographics, births, deaths, or Phase 9 population simulation;
- deed-level ownership, landlords, banks, mortgage contracts, amortization schedules, foreclosure, lease contracts, or eviction court processes;
- speculative property trading;
- mixed-use tenure allocation;
- subsidized-housing waiting lists;
- neighborhood attachment by named household;
- commute-origin household micro-simulation;
- homelessness services or shelter systems;
- commercial/industrial tenant relocation;
- regional migration between multiple cities;
- property tax assessment reform beyond the bounded owner carrying-cost abstraction;
- rent control as a new policy instrument in this slice.

## Existing architecture to preserve

The implementation must build on the current Phase 7 systems rather than replace them:

- `LandHousingMarketSystem` remains the authoritative derived property-market signal producer.
- `DevelopmentFeasibilitySystem` remains the authoritative project underwriting system.
- `DevelopmentPolicySystem` remains the authoritative player housing/development policy state.
- `HousingChoiceSystem` remains the affordability/quality reporting layer but no longer fabricates authoritative occupancy from scratch.
- `RedevelopmentPressureSystem` remains the diagnostic source of occupied-parcel redevelopment pressure.
- `RedevelopmentExecutionSystem` remains the admission layer for residential redevelopment.
- `DeveloperMarketSystem` remains the shared deterministic development-capital allocation mechanism.
- `SimulationCore` remains the orchestration boundary.
- Save V7 remains the canonical save envelope.

No parallel simulation may independently calculate market rents, development economics, housing occupancy, or redevelopment eligibility.

## Core domain model

### Income bands

Continue using the existing Phase 7 bands:

```ts
export type HousingIncomeBand = 'lower' | 'middle' | 'upper';
```

Existing income assumptions remain game-economy constants:

| Band | Population share | Monthly income | Preferred max housing burden |
| --- | ---: | ---: | ---: |
| lower | 45% | 1,500 | 35% |
| middle | 40% | 2,600 | 32% |
| upper | 15% | 4,500 | 28% |

These are simulation units, not real-world currency claims.

### Tenure

Add:

```ts
export type HousingTenure = 'renter' | 'owner';
```

Tenure is modeled at cohort level. A resident belongs to one income band and one tenure mode while assigned to a building.

### Cohort identity

Authoritative occupancy is represented by aggregate cohorts:

```ts
export type HousingCohortAllocation = Readonly<{
  buildingId: string;
  band: HousingIncomeBand;
  tenure: HousingTenure;
  residents: number;
}>;
```

There is no durable random household identifier. Cohorts with identical `buildingId + band + tenure` are merged. Fractional weighted residents are permitted, matching the existing aggregate population model.

Unplaced/displaced cohorts omit `buildingId` and retain only band, tenure preference, residents, and displacement metadata where applicable.

## `HousingTenureSystem`

Create:

`src/simulation/housing/HousingTenureSystem.ts`

This system is deterministic and derived. It owns no occupancy history. It converts occupied residential buildings plus market/financing conditions into tenure-specific housing options consumed by relocation and diagnostics.

### Public types

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

Every occupied residential building exposes rental and ownership capacity using a deterministic intensity-based base tenure mix.

Initial simulation constants:

| Residential intensity | Owner share | Renter share |
| --- | ---: | ---: |
| low | 60% | 40% |
| medium | 40% | 60% |
| high | 25% | 75% |

For a building with resident capacity `C`:

```text
ownershipCapacity = C * ownerShare
rentalCapacity = C - ownershipCapacity
```

This does not imply every low-density building is a detached house or every high-density building is rented. It is a Phase 7 aggregate tenure-market abstraction.

The sum of both tenure capacities must equal the building's physical resident capacity exactly.

### Rental cost

Use the same existing residential market rent channel already used by housing choice:

```text
askingRent =
  definition.baseRent
  * parcelMarketSignal.marketRentMultiplier
  * developmentPolicy.residentialRentFactor()
```

No second rent model is allowed.

### Implied purchase price

Owner pricing is derived from the same rent/asset-value environment rather than an independent sale-price simulation.

Use a bounded gross-rent capitalization relationship:

```text
annualMarketRent = askingRent * 12
capitalizationRate = clamp(0.045 + 0.40 * marketInterestRate, 0.05, 0.09)
impliedPurchasePrice = annualMarketRent / capitalizationRate
```

The formula deliberately makes purchase prices respond to the same rent stream while higher financing rates raise the capitalization rate and moderate asset prices.

### Monthly ownership cost

Use a mortgage-equivalent annuity rather than a deed-level mortgage contract.

Simulation constants:

```text
loanToValue = 0.80
mortgageTermMonths = 360
annualCarryingCostRate = 0.015
```

Monthly financed principal:

```text
principal = impliedPurchasePrice * loanToValue
monthlyRate = marketInterestRate / 12
```

Monthly mortgage payment uses the standard fixed-payment annuity formula. If `monthlyRate` is zero, payment is `principal / mortgageTermMonths`.

Owner carrying cost:

```text
monthlyCarryingCost = impliedPurchasePrice * annualCarryingCostRate / 12
monthlyOwnerCost = mortgagePayment + monthlyCarryingCost
```

The unfinanced 20% equity portion is not modeled as a cash-balance transaction. Its economic effect is represented indirectly through lower ownership propensity among lower-income cohorts.

### Tenure propensity

Default desired owner shares by income band:

| Band | Desired owner share | Desired renter share |
| --- | ---: | ---: |
| lower | 20% | 80% |
| middle | 50% | 50% |
| upper | 70% | 30% |

These values are preferences used in search scoring, not hard quotas.

Higher ownership monthly burden reduces effective owner attractiveness. A cohort may rent even when its base preference favors ownership, and may own even when base preference favors renting if owner housing is sufficiently affordable and available.

## `HousingRelocationSystem`

Create:

`src/simulation/housing/HousingRelocationSystem.ts`

This is the new authoritative state owner for aggregate residential placement.

### Authoritative state

```ts
export type HousingRelocationState = Readonly<{
  allocations: readonly HousingCohortAllocation[];
  unplaced: readonly UnplacedHousingCohort[];
  totals: HousingRelocationTotals;
}>;
```

```ts
export type UnplacedHousingCohort = Readonly<{
  band: HousingIncomeBand;
  tenurePreference: HousingTenure;
  residents: number;
  displaced: boolean;
  displacedFromBuildingId?: string;
}>;
```

```ts
export type HousingRelocationTotals = Readonly<{
  movedResidents: number;
  displacedResidents: number;
  rehousedDisplacedResidents: number;
  failedSearchResidents: number;
}>;
```

`totals` are cumulative save-persisted counters used for diagnostics. Per-cycle movement metrics are derived separately in the latest snapshot.

### Snapshot

```ts
export type HousingRelocationSnapshot = Readonly<{
  population: number;
  housedResidents: number;
  unplacedResidents: number;
  renterResidents: number;
  ownerResidents: number;
  renterShare: number;
  ownerShare: number;
  rentalVacancyRate: number;
  ownershipVacancyRate: number;
  movedResidentsThisCycle: number;
  displacedResidentsThisCycle: number;
  rehousedDisplacedResidentsThisCycle: number;
  failedSearchResidentsThisCycle: number;
  costBurdenedResidents: number;
  byBand: Readonly<Record<HousingIncomeBand, HousingRelocationBandSnapshot>>;
  byBuilding: Readonly<Record<string, HousingBuildingRelocationSnapshot>>;
}>;
```

Building diagnostics include:

- total assigned residents;
- renter residents;
- owner residents;
- rental occupancy rate;
- ownership occupancy rate;
- cost-burdened residents;
- moved-in residents this cycle;
- moved-out residents this cycle;
- displaced residents this cycle.

### Invariants

At the end of every reconciliation:

```text
sum(allocated residents) + sum(unplaced residents) = population
```

For every building and tenure:

```text
allocated residents <= tenure capacity
```

For every building:

```text
renter residents + owner residents <= physical resident capacity
```

All resident counts remain finite and non-negative.

No resident mass may be created or destroyed by relocation.

## Search scoring

Relocation uses the same underlying affordability and quality concepts as current housing choice but adds tenure fit and move friction.

For a band/tenure option:

```text
housingBurden = monthlyCost / monthlyIncome
```

Affordability uses the existing Phase 7 linear rule:

```text
affordabilityScore = clamp(
  (2 * maxPreferredBurden - housingBurden) / maxPreferredBurden,
  0,
  1
)
```

Quality remains:

```text
qualityScore =
  0.30 * neighborhoodQuality
  + 0.25 * serviceQuality
  + 0.25 * personAccessibility
  + 0.20 * utilityRatio
```

Tenure preference score is `1` for the cohort's preferred tenure and the complementary desired-share weight for the other tenure. The exact implementation must remain bounded `[0,1]`.

Candidate score:

```text
candidateScore =
  0.55 * affordabilityScore
  + 0.30 * qualityScore
  + 0.15 * tenurePreferenceScore
```

Candidates sort by:

1. descending candidate score;
2. lower monthly cost;
3. stable `buildingId`;
4. stable tenure order `renter` before `owner`.

This total ordering guarantees deterministic placement.

## Reconciliation lifecycle

The relocation system performs one deterministic reconciliation cycle on the 50-tick core-city cadence and on immediate displacement events.

### Priority 1: forced displacement

Residents whose building has been removed/redeveloped are removed from allocation state and become displaced unplaced cohorts.

They search first.

Their original band is preserved. Their original tenure becomes their initial tenure preference, but cross-tenure rehousing is allowed if the preferred tenure cannot house them affordably.

### Priority 2: previously unplaced residents

Existing unplaced cohorts search before newly added population. This prevents indefinite starvation behind population growth.

### Priority 3: new population entrants

If authoritative city population exceeds the total residents represented in relocation state, the delta is split across income bands using the existing Phase 7 population shares.

Each band's initial tenure preference is split using the default desired tenure shares. These are aggregate cohorts rather than individual entrants.

### Priority 4: cost-burdened movers

Residents whose housing burden exceeds twice their preferred burden threshold become mandatory searchers.

Residents above the preferred burden but at or below twice the threshold are eligible for limited voluntary cost-relief turnover rather than forced moves.

### Priority 5: voluntary movers

To prevent the simulation from instantly re-sorting every resident whenever rents shift, voluntary mobility is bounded.

Initial constant:

```text
maximumVoluntaryTurnoverPerCycle = 0.02
```

At most 2% of currently housed residents may voluntarily move in one 50-tick housing cycle.

A voluntary move is permitted only when the best alternative score exceeds the current option score by at least:

```text
minimumMoveScoreImprovement = 0.10
```

This creates meaningful stickiness while still allowing filtering between price tiers over time.

### Partial cohort moves

Cohorts may split. If only part of a cohort can fit in the highest-ranked option, that portion moves and the remainder continues searching.

After processing, identical allocations are merged by `(buildingId, band, tenure)`.

## Initialization and backward compatibility

### New-game initialization

The first time relocation state is needed for a city with no persisted housing state:

1. derive current tenure options;
2. split current population into income bands;
3. split each band by desired tenure shares;
4. run one deterministic placement pass with no historical movement counters;
5. place any unmatched residents into `unplaced`;
6. set cumulative movement/displacement totals to zero.

Initialization is not counted as migration, turnover, or displacement.

### Older V7 saves

When loading an existing V7 save without `housingState`, run the same deterministic initialization after the rest of the save has hydrated.

Do not fabricate historical moves, displacement, or failed-search totals.

### V6 and older saves

Existing save migration continues through the current V6/V7 loader path. Once the core reaches V7 state, missing `housingState` initializes deterministically as above.

## `HousingChoiceSystem` refactor

`HousingChoiceSystem` remains, but its responsibility changes.

It must no longer independently allocate the entire city population from scratch once relocation state exists.

Instead it consumes:

- tenure options;
- current authoritative relocation allocation;
- unplaced cohorts;

and produces the existing affordability-oriented `HousingChoiceSnapshot` plus compatible building and band diagnostics.

Existing public fields used by demand, redevelopment, UI, and tests must be preserved whenever semantically valid:

- `population`;
- `physicalCapacity`;
- `effectiveAffordableCapacity`;
- `housedResidents`;
- `unplacedResidents`;
- `affordabilityIndex`;
- `costBurdenedResidents`;
- `costBurdenShare`;
- `byBand`;
- `byBuilding`.

`byBuilding.assignedResidents` must now reflect authoritative relocation allocation rather than a synthetic reallocation.

Effective affordable capacity remains a derived market metric and must not become a hard physical population cap.

## Population synchronization

The authoritative city population remains `PopulationSystem.population`.

`HousingRelocationSystem` does not independently decide citywide population growth or decline.

After `PopulationSystem.update()` changes population:

- if population increased, relocation creates new entrant cohorts for the positive delta;
- if population decreased, the system removes resident mass deterministically from unplaced cohorts first, then the most cost-burdened housed cohorts, with stable tie breaking.

Population synchronization must preserve the invariant that relocation-state resident mass equals authoritative population after reconciliation.

## Redevelopment integration

### Pre-demolition occupant capture

Before `BuildingSystem.replaceDevelopment()` removes an occupied residential building, `SimulationCore` must capture the authoritative cohort allocations for that building.

The replacement operation then:

1. removes the old building;
2. removes its allocation entries from relocation state;
3. converts those residents into displaced cohorts carrying original band and tenure preference;
4. records displacement counters;
5. starts the replacement development through the existing developer-market path;
6. triggers immediate rehousing against remaining occupied residential stock.

The under-construction replacement provides zero housing capacity until it becomes occupied under existing building lifecycle rules.

### Bulldozing

Manual bulldozing of an occupied residential building follows the same displacement path.

It must not silently delete residents from housing state.

### Redevelopment admission safeguards

Current physical-capacity and effective-affordable-capacity safeguards remain.

Add band-specific lower-income rehousing protection.

For each redevelopment candidate, estimate the immediately available affordable replacement capacity for the actual lower-income residents currently assigned to the building.

A redevelopment candidate is ineligible when:

```text
affordableLowerIncomeReplacementCapacity
< displacedLowerIncomeResidents * lowerIncomeProtectionFloor
```

The new policy field is:

```ts
lowerIncomeRelocationProtection: number
```

Bounds:

```text
0.50 to 1.00
```

Default:

```text
0.90
```

Interpretation:

- `0.50`: permissive; only half of affected lower-income residents need an immediately affordable replacement path;
- `0.90`: default strong protection;
- `1.00`: all affected lower-income residents must have affordable replacement capacity before redevelopment can proceed.

This is in addition to, not a replacement for, the existing aggregate redevelopment affordability floor.

## Development policy integration

Extend `DevelopmentPolicyState` with:

```ts
lowerIncomeRelocationProtection: number;
```

`DevelopmentPolicySystem` must validate and clamp it to `[0.50, 1.00]`.

The Land/Housing policy UI gains one control:

- Lower-income relocation protection

Existing V7 saves with `developmentPolicy` but without this newer field must receive the default `0.90` during restoration. Restoration must normalize partial legacy policy objects safely rather than assuming every current field exists.

## Financing signal

`HousingTenureSystem` must consume the same market interest-rate source used for development underwriting:

```ts
SimulationCore.currentDevelopmentInterestRate()
```

The implementation may expose/refactor a shared helper if necessary, but it may not create a second independent interest-rate formula.

This ensures tighter municipal/development financing conditions also make ownership financing more expensive.

## Core-city loop ordering

The 50-tick core-city loop becomes:

1. refresh utilities, services, employment, taxes, and other existing city snapshots;
2. refresh land/housing market from current population/demand context;
3. build tenure economics/options from current occupied residential stock;
4. reconcile existing relocation state against removed/changed housing options and current population;
5. produce housing-choice diagnostics from authoritative relocation state;
6. evaluate demand using effective affordable capacity;
7. settle municipal finance;
8. calculate attractiveness including affordability;
9. call `PopulationSystem.update()` using raw physical residential capacity as the hard cap;
10. synchronize relocation state to any population delta and run entrant/outflow reconciliation;
11. refresh land/housing market using the updated population;
12. refresh tenure options and relocation diagnostics once more;
13. refresh housing-choice diagnostics;
14. refresh redevelopment pressure and execution eligibility.

The goal is a final public snapshot that reflects the latest population, rent, tenure, and allocation state rather than one-cycle-stale values.

## Development-loop ordering

The existing 10-tick development cadence remains.

Before evaluating redevelopment opportunities:

1. refresh land/housing market;
2. refresh tenure economics;
3. refresh housing-choice diagnostics;
4. refresh redevelopment pressure;
5. refresh redevelopment execution using actual cohort occupancy and lower-income safeguards.

When a redevelopment award executes, displacement reconciliation happens immediately before the next ordinary 50-tick housing cycle.

## Vacancy

Vacancy is measured from authoritative occupied capacity rather than the purely market-derived vacancy estimate.

Citywide rental vacancy:

```text
1 - renterResidents / totalRentalCapacity
```

Citywide ownership vacancy:

```text
1 - ownerResidents / totalOwnershipCapacity
```

Both are clamped to `[0,1]` and return `0` when the relevant tenure capacity is zero.

`LandHousingMarketSystem.housingVacancyRate` remains the market-derived pricing signal. The new relocation snapshot's rental/ownership vacancy rates are realized occupancy outcomes. The UI must label them distinctly to avoid conflating them.

## Filtering between price tiers

Persistent relocation creates gradual filtering.

When new higher-quality or higher-cost stock opens:

- higher-income cohorts may move into it if the score improvement exceeds the move threshold;
- vacated older stock becomes available to lower-income cohorts in later priority processing;
- the 2% voluntary-turnover cap prevents instantaneous citywide reshuffling.

This is the intended Phase 7 representation of filtering. No explicit building-age depreciation model is required in this slice.

## UI and overlays

Extend the existing Land/Housing intelligence surfaces rather than creating a separate top-level housing application.

### Land/Housing panel additions

Citywide metrics:

- Owner share
- Renter share
- Rental vacancy
- Ownership vacancy
- Moved residents this cycle
- Displaced residents this cycle
- Rehoused displaced residents this cycle
- Failed housing searches this cycle
- Unplaced residents
- Cost-burdened residents

Policy control:

- Lower-income relocation protection

### Residential building inspector additions

For an occupied residential building show:

- assigned residents;
- renter residents;
- owner residents;
- rental occupancy;
- ownership occupancy;
- asking rent;
- implied purchase price;
- monthly owner cost;
- cost-burdened residents;
- moved in this cycle;
- moved out this cycle;
- displaced this cycle when relevant.

### Overlays

Add two mutually exclusive Land/Housing overlay modes:

1. `tenure`
   - scalar should represent owner share per occupied residential building;
   - no-data buildings render as no-data rather than zero.

2. `relocation-pressure`
   - scalar combines recent moved-out/displaced residents and current cost burden;
   - intended to identify neighborhoods under churn/displacement stress;
   - bounded `[0,1]`.

These join the existing Land/Housing overlay selector and must preserve the existing rule that only one overlay canvas/layer is active at once.

## Save V7 persistence

Do not introduce Save V8.

Extend `SaveV7` with:

```ts
housingState?: HousingRelocationState;
```

Serialization writes the current relocation state.

Hydration behavior:

- when `housingState` exists, validate and restore it after buildings/population have been hydrated;
- reject references to missing/non-residential buildings;
- reject negative/non-finite resident counts;
- reject tenure allocations that exceed building tenure capacity after economics are reconstructed;
- verify total resident mass equals authoritative population within a small floating-point tolerance;
- when absent, initialize deterministically with zero historical counters.

Save V7 remains backward compatible with saves produced before this feature.

## State restoration and normalization

Restoration must not trust serialized derived metrics.

Persist only authoritative relocation allocations, unplaced cohorts, and cumulative counters.

Do not persist:

- asking rents;
- purchase prices;
- owner monthly costs;
- vacancy rates;
- affordability scores;
- overlay values;
- per-cycle movement snapshots.

All of these are recomputed from authoritative buildings, policies, markets, and housing state after load.

## Determinism

All relocation logic must be order-stable.

Rules:

- sort buildings by `buildingId` before generating options;
- use explicit band ordering;
- use explicit tenure ordering;
- use total-order candidate comparisons with deterministic tie breakers;
- never rely on object property iteration for allocation priority;
- no `Math.random()`;
- no wall-clock time;
- no async race-sensitive housing mutation.

Two identical cores given identical commands and ticks must produce identical housing allocations and relocation counters.

## Performance constraints

The system must remain aggregate and scale with buildings/cohorts rather than residents.

Expected state complexity:

```text
O(residential buildings * income bands * tenure modes)
```

At most six allocation cohorts per residential building are required before merging.

Search may rank housing options per mover cohort, but implementation should avoid per-resident loops.

No implementation step may create arrays proportional to raw population count.

## Error handling

Fail fast on corrupted authoritative housing state during save hydration.

Runtime reconciliation should self-heal expected simulation changes:

- missing building because of demolition -> convert affected allocation to displaced cohort;
- changed tenure capacities -> move only overflow into search queues;
- population increase -> create entrant cohorts;
- population decrease -> deterministically remove resident mass;
- completed new housing -> expose new capacity on next option refresh.

Unexpected negative capacities, NaN costs, duplicate invalid state, or unknown tenure/band values are programmer/save errors and should throw.

## Testing strategy

Implementation follows TDD. Each subsystem starts with failing tests that demonstrate the missing behavior before production code is added.

### Tenure economics tests

Verify:

1. rental + ownership capacity equals physical capacity;
2. low-density stock has a higher owner share than high-density stock;
3. higher market rent raises asking rent and implied purchase price;
4. higher interest rates raise monthly owner financing cost under otherwise identical conditions;
5. tenure options are deterministic and finite;
6. policy affordable-rent factor continues to affect residential asking rent consistently.

### Relocation tests

Verify:

1. initialization conserves population;
2. no building/tenure exceeds capacity;
3. cheaper comparable rental housing attracts renter cohorts over time;
4. higher owner financing cost suppresses owner placement when rental alternatives exist;
5. voluntary turnover is capped at 2% per cycle;
6. small score differences below 0.10 do not trigger voluntary moves;
7. displaced residents search before ordinary voluntary movers;
8. unaffordable spare housing does not count as successful rehousing for lower-income cohorts;
9. failed searches remain explicitly unplaced;
10. identical inputs produce identical allocations;
11. population growth creates entrant cohorts without fabricating movement history;
12. population decline conserves mass and removes unplaced/cost-burdened residents first.

### Redevelopment tests

Verify:

1. redevelopment captures the actual current occupant cohorts;
2. execution records displacement before replacement construction;
3. displaced residents are not left assigned to a removed building;
4. immediate rehousing uses remaining occupied stock only;
5. lower-income protection can block an otherwise economically feasible redevelopment;
6. raising protection from 0.90 to 1.00 cannot make a previously blocked lower-income case eligible;
7. manual residential bulldozing uses the same displacement path;
8. developer commitments/capital behavior remains unchanged apart from redevelopment eligibility.

### Save tests

Verify:

1. current V7 saves round-trip housing allocations and cumulative relocation counters;
2. legacy V7 without `housingState` initializes deterministically;
3. legacy V7 partial development-policy state receives `lowerIncomeRelocationProtection = 0.90`;
4. corrupted building references fail load;
5. over-capacity housing allocations fail load;
6. resident-mass mismatch fails load;
7. derived tenure economics are recomputed rather than trusted from save data.

### Long-run invariant tests

Run deterministic multi-cycle scenarios covering rent changes, development, population growth, and redevelopment, asserting after every cycle:

- population conservation;
- no tenure-capacity overflow;
- no building-capacity overflow;
- finite metrics;
- no orphan building references;
- deterministic repeated-run equality.

### Presentation tests

Verify:

- Land/Housing panel includes all new tenure/relocation metrics;
- policy panel includes lower-income relocation protection;
- residential inspector exposes tenure economics/allocation diagnostics;
- `tenure` and `relocation-pressure` overlays appear;
- overlay mutual exclusion remains intact;
- core replacement after save/load resynchronizes UI from the new authoritative housing state.

### Browser acceptance

Extend the existing Phase 7 Chromium smoke flow to:

1. build a deterministic test city;
2. confirm owner/renter metrics render;
3. create a rent/tenure condition that produces a measurable cohort move;
4. execute or simulate an eligible residential redevelopment;
5. confirm displacement/rehousing counters change in authoritative `window.__civicApp.core` state;
6. change lower-income relocation protection through the UI and verify authoritative policy state;
7. select tenure overlay;
8. select relocation-pressure overlay;
9. verify only one Land/Housing overlay is active;
10. save/load and verify housing state survives core replacement.

## Compatibility requirements

- Save version stays `7`.
- Game version stays `0.7.0-metropolitan`.
- Existing V7 saves remain loadable.
- Existing physical residential capacity remains the hard population cap.
- `DemandSystem` continues using effective affordable capacity.
- Developer underwriting and capital-market logic remain authoritative and are not duplicated.
- Existing policy controls retain their semantics.
- Existing Land/Housing overlays and inspector diagnostics remain available.

## README / roadmap update

After implementation, README should describe Phase 7 as including:

- deterministic developer underwriting;
- developer competition/capital allocation;
- property-market rent/vacancy/land values;
- aggregate affordability;
- rental vs ownership economics;
- persistent cohort housing allocation;
- household search/relocation at aggregate cohort level;
- redevelopment displacement and rehousing;
- targeted lower-income relocation protection;
- Land/Housing intelligence and policy controls.

At that point the two previously remaining mechanical slices — tenure depth and relocation/displacement — are complete.

Phase 7 closure still requires only the final stabilization pass: balance, long-run stress tests, performance, save compatibility, UI polish, and cleanup of stale labels/copy. That closure work is not a new simulation subsystem.

## Acceptance criteria

This design is complete when all of the following are true:

1. Residential stock exposes deterministic rental and owner-occupied economics.
2. Housing occupancy persists across simulation cycles instead of being fully regenerated.
3. Population is represented by aggregate band/tenure/building cohorts, not individual agents.
4. Residents can stay, move, be displaced, be rehoused, or remain unplaced.
5. Move decisions react to affordability, quality, tenure preference, financing cost, vacancy, and bounded turnover.
6. Redevelopment displaces the actual cohorts in the demolished building.
7. Lower-income redevelopment protection uses actual affected lower-income residents and available affordable replacement capacity.
8. Population mass and building capacities remain invariant-correct.
9. Housing state survives Save V7 round trips.
10. Legacy V7 saves initialize housing state deterministically without fabricated history.
11. Player UI exposes tenure, vacancy, relocation, displacement, and protection policy consequences.
12. Tests, typecheck, lint, build, and Chromium Phase 7 smoke all pass on the exact final branch head.
