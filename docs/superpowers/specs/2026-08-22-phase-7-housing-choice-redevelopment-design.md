# Civic Foundry — Phase 7 Housing Choice & Redevelopment Pressure Design

Date: 2026-08-22
Target branch: `phase7-housing-choice-redevelopment`
Stacked baseline: `phase7-land-housing-market` at `d502b648c92fc5b2c3e9e494b75c54f1fd2f1818`
Canonical runtime/save baseline: V7 `0.7.0-metropolitan`

## Objective

Extend Phase 7 from property-market price formation into household affordability, aggregate housing choice, and residential redevelopment pressure without introducing per-person demographic agents or destructive redevelopment.

The slice must make housing affordability matter to residential demand and migration attractiveness, expose deterministic building-level occupancy/cost-burden diagnostics, and identify occupied residential parcels where a higher-intensity replacement is economically compelling.

## Scope

### In scope

1. Three aggregate income bands (`lower`, `middle`, `upper`) with fixed deterministic shares and income/rent-burden assumptions.
2. Building-level residential housing options derived from authoritative occupied residential buildings plus current parcel market rent/access/service/utility conditions.
3. Deterministic weighted housing allocation across residential buildings.
4. Citywide effective affordable housing capacity, affordability index, cost-burdened residents, unplaced residents, and per-building occupancy diagnostics.
5. Residential demand uses effective affordable capacity rather than treating every physical residential slot as equally usable.
6. Migration attractiveness receives a bounded affordability modifier while physical residential capacity remains the hard population cap.
7. Residential redevelopment pressure compares existing use value with feasible higher-intensity replacement economics, demolition cost, and displacement burden.
8. Public read-only `SimulationCore` snapshots for housing choice and redevelopment pressure.
9. Save V7 remains unchanged because all new state is derived from already-persisted authoritative state.

### Explicitly deferred

- individual households or persons;
- ages, family structures, education/income mobility, births/deaths, or other Phase 9 demographic state;
- tenure (rent vs own), mortgages, leases, landlord ownership, or property transactions;
- moving friction, search duration, neighborhood attachment, homelessness state, or eviction queues;
- mixed-use buildings;
- commercial/industrial redevelopment;
- automatic demolition/replacement of occupied parcels;
- resident relocation during redevelopment;
- UI panels/overlays beyond exposing simulation snapshots.

## Architecture

### `HousingChoiceSystem`

Create `src/simulation/housing/HousingChoiceSystem.ts`.

The system owns no authoritative history. `evaluate()` consumes current population plus a list of occupied residential housing options and returns one immutable snapshot.

Public types:

```ts
export type HousingIncomeBand = 'lower' | 'middle' | 'upper';

export type HousingOption = Readonly<{
  buildingId: string;
  capacity: number;
  monthlyRent: number;
  personAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
}>;

export type HousingBuildingAllocation = Readonly<{
  buildingId: string;
  assignedResidents: number;
  occupancyRate: number;
  affordabilityScore: number;
  averageRentBurden: number;
  costBurdenedResidents: number;
}>;

export type HousingBandSnapshot = Readonly<{
  band: HousingIncomeBand;
  targetResidents: number;
  assignedResidents: number;
  unplacedResidents: number;
  averageRentBurden: number;
  costBurdenedResidents: number;
}>;

export type HousingChoiceSnapshot = Readonly<{
  population: number;
  physicalCapacity: number;
  effectiveAffordableCapacity: number;
  housedResidents: number;
  unplacedResidents: number;
  affordabilityIndex: number;
  costBurdenedResidents: number;
  costBurdenShare: number;
  byBand: Readonly<Record<HousingIncomeBand, HousingBandSnapshot>>;
  byBuilding: Readonly<Record<string, HousingBuildingAllocation>>;
}>;
```

Default band assumptions are simulation constants:

| Band | Population share | Monthly income | Maximum preferred rent burden |
| --- | ---: | ---: | ---: |
| lower | 45% | 1,500 | 35% |
| middle | 40% | 2,600 | 32% |
| upper | 15% | 4,500 | 28% |

These are game-economy units rather than real-world currency claims.

### Affordability scoring

For each band/building pair:

```text
rentBurden = monthlyRent / monthlyIncome
fullyAffordableThreshold = maxRentBurden
affordabilityScore = clamp(
  (2 * fullyAffordableThreshold - rentBurden) / fullyAffordableThreshold,
  0,
  1
)
```

A unit at or below the preferred burden scores 1.0; affordability falls linearly to zero at twice the preferred burden.

Building quality is:

```text
qualityScore =
  0.30 * neighborhoodQuality
  + 0.25 * serviceQuality
  + 0.25 * personAccessibility
  + 0.20 * utilityRatio
```

Choice weight is bounded and positive so physically available housing remains allocatable even when cost-burdened:

```text
choiceWeight = 0.05 + 0.60 * affordabilityScore + 0.35 * qualityScore
```

### Aggregate allocation

The system allocates weighted residents, not person objects.

- Band target populations are `population * share` and sum exactly to the current population.
- Bands allocate in deterministic purchasing-power order `upper → middle → lower`.
- Within a band, options sort by descending choice weight and then stable `buildingId`.
- Each band fills the highest-scoring remaining capacity first.
- Fractional weighted residents are allowed; all outputs remain finite.
- No building may exceed physical capacity.
- `housedResidents <= min(population, physicalCapacity)`.
- `unplacedResidents = population - housedResidents`.

This is intentionally an aggregate market-clearing approximation, not a household-agent simulation.

### Effective affordable capacity

Physical capacity and effective affordable capacity are separate concepts.

For each building:

```text
weightedAffordability =
  0.45 * lowerAffordability
  + 0.40 * middleAffordability
  + 0.15 * upperAffordability

effectiveAffordableCapacity += capacity * weightedAffordability
```

The result is clamped to `[0, physicalCapacity]`.

`affordabilityIndex` is the physical-capacity-weighted mean affordability score when residential stock exists, otherwise 1.0 for an empty city. `costBurdenShare` is `costBurdenedResidents / housedResidents`, or zero when nobody is housed.

### `SimulationCore` housing integration

Add:

```ts
readonly housingChoice: HousingChoiceSystem;
housingChoiceSnapshot: HousingChoiceSnapshot;
```

`SimulationCore` builds each `HousingOption` from occupied residential buildings using:

- building definition resident capacity and base rent;
- current `LandHousingMarketSystem.parcelSignal()` for parcel rent multiplier;
- the same local accessibility/service/neighborhood/utility context used by development underwriting.

Refactor parcel-context derivation so development underwriting and housing choice share one deterministic local-context helper instead of duplicating road/service/utility calculations.

### City-loop ordering

On each 50-tick core-city evaluation:

1. refresh utilities/employment/taxes and other existing core snapshots;
2. evaluate housing choice using the latest derived land/housing market snapshot;
3. evaluate `DemandSystem` with `housingCapacity = housingChoiceSnapshot.effectiveAffordableCapacity`;
4. settle municipal finance;
5. compute existing attractiveness;
6. apply a bounded affordability factor:

```text
affordabilityFactor = 0.85 + 0.15 * affordabilityIndex
adjustedAttractiveness = existingAttractiveness * affordabilityFactor
```

7. call `PopulationSystem.update()` with **raw physical residential capacity** so affordability never creates an instantaneous hard eviction cap;
8. refresh land/housing market from the new demand/population state;
9. refresh housing choice again so the public snapshot reflects the latest market rent;
10. refresh redevelopment pressure.

Development still evaluates every 10 ticks. The housing choice and redevelopment layers remain on the 50-tick core-city cadence.

## `RedevelopmentPressureSystem`

Create `src/simulation/development/RedevelopmentPressureSystem.ts`.

The system is diagnostic/derived. It does not mutate buildings, developers, firms, population, zoning, or saves.

Public types:

```ts
export type ResidentialRedevelopmentInput = Readonly<{
  buildingId: string;
  lotId: string;
  existingDefinitionId: string;
  existingBaseConstructionCost: number;
  assignedResidents: number;
  existingEvaluation: DevelopmentFeasibilityResult;
  replacementEvaluations: readonly DevelopmentFeasibilityResult[];
}>;

export type ResidentialRedevelopmentPressure = Readonly<{
  buildingId: string;
  lotId: string;
  existingDefinitionId: string;
  bestReplacementDefinitionId?: string;
  currentUseValue: number;
  demolitionCost: number;
  displacementCost: number;
  netRedevelopmentValue: number;
  pressure: number;
}>;

export type RedevelopmentPressureSnapshot = Readonly<{
  parcels: readonly ResidentialRedevelopmentPressure[];
  highPressureCount: number;
  averagePressure: number;
}>;
```

Only occupied residential parcels participate in this slice.

### Pressure formula

The current building is valued at its market-condition stabilized value from `DevelopmentFeasibilitySystem` using its current definition.

Only same-zone, strictly higher-intensity, legally feasible replacement candidates are eligible.

For each eligible replacement:

```text
replacementCostExLand = totalDevelopmentCost - landValue
demolitionCost = existingBaseConstructionCost * 0.08
displacementCost = assignedResidents * 250
netRedevelopmentValue =
  replacementStabilizedValue
  - replacementCostExLand
  - currentUseValue
  - demolitionCost
  - displacementCost
pressure = clamp(netRedevelopmentValue / max(1, currentUseValue), 0, 1.25)
```

Select the replacement with highest pressure, then stable `definitionId` as tie-breaker.

`highPressureCount` counts parcels with `pressure >= 0.25`.

This signal is intentionally conservative: occupied housing must support the opportunity cost of buying the current improvement, demolition, and resident displacement before redevelopment pressure appears.

### Core integration

Add:

```ts
readonly redevelopmentPressure: RedevelopmentPressureSystem;
redevelopmentPressureSnapshot: RedevelopmentPressureSnapshot;
```

On the 50-tick core-city cadence, for each occupied residential building:

1. recover its lot and current building definition;
2. derive the same `DevelopmentParcelContext` used by vacant-parcel underwriting;
3. evaluate the current definition and all residential variants with a dedicated redevelopment feasibility evaluator so regular developer-market diagnostics are not overwritten;
4. feed current/replacement evaluations plus assigned residents from `housingChoiceSnapshot.byBuilding` into `RedevelopmentPressureSystem`.

No developer bid or building mutation occurs from this snapshot in this slice.

## Demand and migration consequences

### Residential demand

`DemandSystem` itself does not gain new fields. `SimulationCore` supplies `housingChoiceSnapshot.effectiveAffordableCapacity` as the existing `housingCapacity` input.

Therefore high rents/poor affordability make effective supply scarcer and increase residential development demand through the existing housing-pressure channel.

### Migration

The existing city attractiveness remains the primary migration signal. Housing affordability applies only the bounded multiplier `[0.85, 1.0]` above. Physical capacity remains the hard cap supplied to `PopulationSystem.update()`.

This prevents a rent spike from instantly deleting population while still making unaffordable cities less attractive over time.

## Persistence

No Save V7 schema change.

All new outputs derive from already persisted state:

- current population;
- occupied buildings and building definitions;
- lots/zoning/roads;
- market rent/vacancy/land signals;
- accessibility;
- services/neighborhood quality;
- utilities;
- current demand/economy snapshots.

After hydration the first core-city evaluation reconstructs housing allocation and redevelopment pressure deterministically. No historical households, moves, rent contracts, or redevelopment history are fabricated.

## Validation and invariants

- reject non-finite population, rent, capacity, quality, accessibility, utility, and redevelopment inputs;
- population/capacity/rent/assigned residents/base construction cost must be non-negative;
- quality/accessibility/utility inputs are clamped to `[0,1]` after finite validation;
- all allocations are stable-order deterministic;
- assigned residents per building never exceed capacity;
- total assigned residents never exceed population or physical capacity;
- effective affordable capacity remains within `[0, physicalCapacity]`;
- affordability and cost-burden shares remain within `[0,1]`;
- redevelopment pressure remains within `[0,1.25]`;
- no `Math.random()`, wall-clock input, or hidden smoothing/history;
- no save-format mutation;
- no automatic occupied-parcel demolition.

## Acceptance tests

1. Cheaper otherwise-equivalent housing receives lower-income residents before more expensive housing.
2. Better neighborhood/service/access/utility quality can win when rent differences are modest.
3. Raising rents lowers effective affordable capacity and affordability index while increasing cost burden.
4. Allocation respects capacity, total population, stable ordering, and deterministic deep equality.
5. Empty housing stock produces finite zero allocations and affordability index 1.
6. Invalid non-finite/negative inputs are rejected.
7. Residential demand is higher when the same physical stock has lower effective affordable capacity.
8. Population still uses raw physical capacity while low affordability only applies the bounded attractiveness penalty.
9. Redevelopment pressure is zero when no higher-intensity candidate is feasible.
10. A materially profitable higher-intensity replacement creates positive pressure.
11. Higher assigned-resident displacement burden lowers redevelopment pressure.
12. Identical redevelopment inputs produce identical ranked parcel snapshots.
13. `SimulationCore` exposes deterministic housing-choice and redevelopment-pressure snapshots.
14. Save V7 round-trip and future deterministic continuation remain green without schema changes.
15. Full test, typecheck, lint, and build verification remains green.

## Success criteria

The slice is complete when Civic Foundry distinguishes physical housing supply from economically affordable supply, aggregate residents sort deterministically across real residential buildings, affordability feeds residential development demand and migration attractiveness, occupied residential parcels expose economically grounded redevelopment pressure, no destructive redevelopment occurs automatically, Save V7 remains unchanged, and the full verification suite passes.