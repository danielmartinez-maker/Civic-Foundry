# Phase 7 Residential Redevelopment Execution Design

## Goal

Turn the existing deterministic residential redevelopment-pressure diagnostic into a real development path without adding individual household agents or a second developer/economic model.

## Design constraints

- Residential-only in this slice.
- Reuse the existing `DevelopmentFeasibilitySystem`, `DeveloperMarketSystem`, `BuildingSystem`, housing-choice snapshot, parcel market signals, and building definitions.
- Redevelopment must compete for the same developer capital and concurrent-project capacity as vacant-lot development.
- Deterministic only: no new random or wall-clock inputs.
- No new save schema. Execution state must remain representable by the existing building and developer-market persistence.
- Do not import the obsolete Phase 7 branch wholesale. Its useful household concepts remain future work; current aggregate lower/middle/upper affordability bands stay authoritative for this slice.

## Eligibility

An occupied residential parcel becomes an executable redevelopment opportunity only when all conditions are true:

1. The existing `RedevelopmentPressureSystem` reports pressure >= 0.25.
2. A strictly higher-intensity feasible residential replacement exists.
3. The parcel's best replacement definition matches a current feasibility result.
4. Removing the existing building would not reduce post-demolition physical residential capacity below current population.
5. Removing the existing building would not reduce post-demolition effective affordable capacity below 85% of current population.
6. The current housing snapshot has no already-unplaced residents.

The physical-capacity guard prevents redevelopment from causing an immediate citywide housing-capacity shortfall. The affordability guard prevents redevelopment from consuming nearly all lower-cost slack while still allowing some market transition.

When more than one parcel qualifies in the same 10-tick market cycle, safeguards are reserved cumulatively in deterministic redevelopment-pressure order. After an opportunity is admitted, its existing physical and effective-affordable capacity is removed from the remaining slack used to test later opportunities. This guarantees that even if every admitted redevelopment opportunity receives an award, their combined demolition cannot violate the relocation floor.

## Redevelopment economics

The pressure system already calculates:

- current-use value,
- demolition cost = 8% of existing base construction cost,
- displacement/relocation cost = assigned residents * 250,
- net redevelopment value.

For actual developer bidding, the replacement feasibility result is adjusted so the developer underwrites the occupied-parcel friction rather than treating the parcel like vacant land:

- `redevelopmentFrictionCost = demolitionCost + displacementCost`
- `preFinanceDevelopmentCost += redevelopmentFrictionCost`
- neutral market financing cost is recomputed on the adjusted pre-finance basis
- `totalDevelopmentCost`, `returnOnCost`, `yieldOnCost`, and `residualLandValue` are recomputed from the adjusted cost basis.

`DeveloperMarketSystem.allocate()` then applies its normal leverage, financing spread, hurdle-rate, risk-tolerance, capital, and project-slot rules. This preserves one competitive capital market for both vacant development and redevelopment.

## Development-market integration

Every 10-tick development evaluation:

1. Refresh land/housing market signals.
2. Refresh aggregate housing choice.
3. Refresh redevelopment pressure.
4. Build vacant-lot opportunities as before.
5. Build safeguarded redevelopment opportunities from occupied residential parcels, reserving relocation slack cumulatively.
6. Send both opportunity sets to one `DeveloperMarketSystem.allocate()` call.
7. For each award:
   - vacant lot -> existing `BuildingSystem.startDevelopment()`;
   - occupied residential lot -> new `BuildingSystem.replaceDevelopment()`.

`replaceDevelopment()` keeps the deterministic building ID (`building:<lotId>`), replaces the old occupied definition with the awarded higher-intensity definition, and enters normal construction state. The old building immediately stops contributing occupied capacity/services/trips until construction completes.

## Aggregate relocation safeguard

This slice does not model household move events. Instead, it enforces enough existing slack before demolition so the aggregate population remains supportable elsewhere in the city.

For a target building:

- `postPhysicalCapacity = remainingPhysicalCapacity - targetResidentCapacity`
- `postAffordableCapacity = remainingAffordableCapacity - targetResidentCapacity * targetAffordabilityScore`

Execution requires:

- `postPhysicalCapacity >= population`
- `postAffordableCapacity >= population * 0.85`
- `unplacedResidents === 0`

Eligible parcels are processed in the stable order already emitted by `RedevelopmentPressureSystem` (pressure descending, then lot ID). Once a parcel passes, its post-demolition capacities become the remaining capacities used for the next parcel.

This is intentionally conservative. Detailed household search, tenure, leases, mortgages, displacement queues, and temporary housing remain deferred.

## Building-system contract

Add `BuildingSystem.replaceDevelopment(tick, lot, award)`:

- require an existing occupied residential building on the lot;
- require award/lot/zone/building ID consistency;
- require replacement intensity strictly greater than current intensity;
- create the replacement as `construction` with the existing deterministic building ID and normal award metadata;
- return both the removed building and the replacement for core-level integration/testing.

The method must reject vacant lots, construction-stage buildings, non-residential buildings, same/lower-intensity replacements, mismatched awards, or unknown definitions.

## Population and housing behavior

No direct population mutation occurs at demolition time. The existing 50-tick city loop remains authoritative. Because execution is guarded by post-demolition capacity, the normal `PopulationSystem.update()` hard-cap logic should not force an immediate population loss solely because of an approved redevelopment.

Housing choice is refreshed after redevelopment through the normal scheduled loops, so the under-construction parcel disappears from occupied housing options until completion.

## Persistence

No Save V7 schema change is required:

- the building already persists definition/status/start/completion/developer/project metadata;
- the developer market already persists active commitments and capital;
- pressure, affordability, relocation safeguards, and opportunity construction are derived.

Existing save/load determinism tests must remain green.

## Explicitly deferred

- individual household/person agents;
- household cohort persistence;
- renter/owner tenure and leases;
- mortgages and ownership transfers;
- household search duration and move friction;
- temporary housing, eviction, homelessness, or explicit relocation queues;
- commercial/industrial redevelopment;
- mixed-use redevelopment;
- demolition permits/player confirmation UI;
- inclusionary zoning, rent stabilization, relocation subsidies, or anti-displacement policy tools;
- player-facing redevelopment heatmap/UI.
