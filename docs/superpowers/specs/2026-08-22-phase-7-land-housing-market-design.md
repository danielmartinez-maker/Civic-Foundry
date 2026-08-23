# Civic Foundry — Phase 7 Land & Housing Market Signals Design

Date: 2026-08-22
Target branch: `phase7-land-housing-market`
Baseline: V7 `0.7.0-metropolitan` on `main`
Status: Continuation of the approved Metropolitan Era Phase 7 program

## Objective

Make development underwriting consume an explicit, inspectable land/housing market instead of synthesizing rent, vacancy and land value inside `DevelopmentFeasibilitySystem` from generic demand multipliers.

This slice remains deliberately derived and save-neutral. It does not introduce household cohorts, income, tenure, moving decisions, land ownership, or occupied-parcel redevelopment. Those require authoritative state and belong in later Phase 7 work (housing choice/redevelopment) and Phase 9 (demographics).

## Product behavior

1. Current city conditions produce deterministic market pressure for residential, commercial and industrial property.
2. Residential pressure responds strongly to housing utilization (`population / residentialCapacity`) as well as residential demand.
3. Commercial and industrial pressure respond to their zone demand and relevant accessibility.
4. Each zone exposes a bounded market rent index, vacancy rate and land-value index.
5. Each parcel receives a deterministic local adjustment from access, services, neighborhood quality, utilities and frontage quality.
6. Development underwriting uses those explicit parcel signals for achievable rent, vacancy and land value.
7. The same simulation state produces the same market snapshot and parcel signals.
8. Market state is derived from already persisted authoritative state, so Save V7 does not change in this slice.

## Architecture

### `LandHousingMarketSystem`

Create `src/simulation/development/LandHousingMarketSystem.ts`.

The system owns no long-lived authoritative economic history. It derives bounded market snapshots from current simulation snapshots and retains only the latest snapshot for diagnostics.

Public types:

```ts
export type ZonePropertyMarketSnapshot = Readonly<{
  zone: ZoneType;
  marketPressure: number;
  rentIndex: number;
  vacancyRate: number;
  landValueIndex: number;
}>;

export type LandHousingMarketSnapshot = Readonly<{
  zones: Readonly<Record<ZoneType, ZonePropertyMarketSnapshot>>;
  housingPressure: number;
  housingRentIndex: number;
  housingVacancyRate: number;
}>;

export type ParcelMarketSignal = Readonly<{
  marketPressure: number;
  marketRentMultiplier: number;
  marketVacancyRate: number;
  landValueMultiplier: number;
}>;
```

`evaluate(...)` consumes:

- zone demand;
- population;
- residential capacity;
- employment utilization (`employed / totalJobs`, bounded);
- person accessibility;
- job/freight accessibility;
- citywide service quality;
- utility ratio.

`parcelSignal(zone, localContext)` consumes the latest zone snapshot plus:

- parcel person accessibility;
- parcel freight accessibility;
- parcel service quality;
- neighborhood quality;
- utility ratio;
- frontage access bonus.

The formulas must be explicit, deterministic, finite and clamped. No random noise, historical smoothing, wall-clock values or hidden state.

### Zone market formulas

Normalize zone demand from `[-1, 1]` to `[0, 1]`.

Residential utilization:

```text
housingUtilization = clamp(population / residentialCapacity, 0, 1.25)
residentialPressure = clamp(
  0.55 * min(1, housingUtilization)
  + 0.30 * normalizedResidentialDemand
  + 0.10 * personAccessibility
  + 0.05 * serviceUtilityQuality,
  0,
  1.25
)
```

Commercial pressure emphasizes commercial demand, person access and employment utilization. Industrial pressure emphasizes industrial demand, freight/job access and utility quality.

For every zone:

```text
rentIndex = clamp(0.72 + pressure * 0.55 + accessAdjustment, 0.65, 1.60)
vacancyRate = clamp(baseMarketVacancy + (0.70 - pressure) * 0.18, 0.03, 0.35)
landValueIndex = clamp(0.65 + pressure * 0.70 + access/service adjustment, 0.55, 1.75)
```

Exact weights are code constants and covered by monotonicity tests. The requirements are directional rather than calibration-specific: tighter housing must increase residential rent/land indexes and reduce vacancy; weak demand must do the reverse.

### Parcel signal formulas

Parcel adjustments are bounded multipliers around the zone market:

- residential/commercial weight person accessibility more heavily;
- industrial weights freight accessibility more heavily;
- service, neighborhood and utility quality cannot make a parcel better than the zone market without bound;
- frontage bonus is small and bounded.

`marketVacancyRate` is the zone vacancy adjusted upward for local deficiencies and slightly downward for strong local conditions.

### `DevelopmentFeasibilitySystem`

Extend `DevelopmentParcelContext` with:

- `marketPressure`;
- `marketRentMultiplier`;
- `marketVacancyRate`;
- `landValueMultiplier`.

Underwriting changes:

```text
achievableRent = definition.baseRent * marketRentMultiplier
vacancyRate = clamp(
  marketVacancyRate + (definition.baseVacancy - 0.10),
  0.03,
  0.35
)
landValue = zoneBaseLandValue * landValueMultiplier
```

Project-specific access, service, utilities and intensity gates remain in `DevelopmentFeasibilitySystem`. Construction cost, financing, NOI, cap-rate and return calculations remain owned there.

This removes duplicate market-price formation from the feasibility system while preserving project-specific physical/legal underwriting.

### `SimulationCore`

Add:

- `readonly landHousingMarket: LandHousingMarketSystem`;
- `landHousingMarketSnapshot: LandHousingMarketSnapshot`.

Refresh the market snapshot in the 50-tick core-city loop after `DemandSystem` evaluates current demand and before the next development-market evaluation uses the snapshot.

`developmentContextForLot()` obtains a parcel signal and passes its four fields into `DevelopmentFeasibilitySystem`.

The development cadence remains every 10 ticks. Between 50-tick market refreshes it intentionally uses the most recent stable market snapshot, avoiding full-market recomputation every development cycle.

## Diagnostics

`LandHousingMarketSystem.snapshot()` returns the latest immutable snapshot.

`SimulationCore.landHousingMarketSnapshot` is public read-only simulation state suitable for future HUD/overlay work.

No UI changes are required in this slice.

## Persistence

No Save V7 schema change.

The market snapshot is derived from already persisted state: population, buildings/capacity, demand inputs, mobility/traffic accessibility, service quality and utilities. After hydration it is deterministically rebuilt by normal simulation evaluation.

No market-history statistics are fabricated during migration.

## Error handling and invariants

- reject non-finite inputs;
- population, capacity and employment counts must be non-negative;
- every market index is finite and positive;
- vacancy remains in `[0.03, 0.35]`;
- pressure remains in `[0, 1.25]`;
- parcel multipliers remain bounded and positive;
- no random or time-dependent behavior;
- no persistence mutation in this slice.

## TDD acceptance tests

1. Tight residential capacity produces higher housing pressure/rent and lower vacancy than abundant capacity under otherwise equal conditions.
2. Stronger commercial demand increases commercial rent and land indexes.
3. Better freight access improves industrial parcel rent/land signals more than equivalent person-access improvement.
4. Local service/utility deficiencies increase parcel vacancy and reduce rent/land multipliers.
5. Identical inputs return deeply equal market snapshots/signals.
6. Non-finite or negative count inputs are rejected.
7. `DevelopmentFeasibilitySystem` uses explicit market signals: higher `marketRentMultiplier` increases NOI/return; higher `marketVacancyRate` suppresses return; higher `landValueMultiplier` increases land cost and can suppress return.
8. `SimulationCore` refreshes the derived market and exposes residential metrics without changing Save V7.
9. Existing development, city-loop, economy, mobility, services, save, typecheck and build regressions remain green.

## Deferred from this slice

- household cohorts and income;
- affordability by income band;
- household housing search/moves;
- tenure (rent vs own);
- occupied-parcel redevelopment;
- demolition/replacement economics;
- mixed-use occupancy;
- player-facing density controls;
- land ownership and transactions;
- market history/smoothing;
- UI overlays/panels.

## Success criteria

The slice is complete when rent, vacancy and land value used by development underwriting come from an explicit deterministic market subsystem; housing scarcity measurably tightens the residential market; parcel quality changes local signals; Save V7 remains compatible; and the complete verification suite is green.