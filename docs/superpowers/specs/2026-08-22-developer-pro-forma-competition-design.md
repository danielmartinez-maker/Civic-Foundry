# Civic Foundry — Deterministic Developer Pro Forma & Lightweight Competition Design

Date: 2026-08-22
Target branch: `metropolitan-era`
Baseline commit: `a4fdcbc43c1512a3fd28e3b475f836c63a007dc7`
Status: Approved design, pending implementation plan

## 1. Objective

Replace automatic demand-triggered construction with a deterministic development feasibility pipeline. Every vacant or eligible parcel must be evaluated as an investment opportunity before construction begins.

The system must combine parcel economics with a deliberately limited competitive developer layer. This provides differentiated capital allocation, risk tolerance, and project selection without adding full corporate finance, land auctions, debt markets, or bankruptcy systems.

The intended simulation behavior is:

1. Enumerate legally feasible projects for each eligible parcel.
2. Estimate parcel and project economics from current city conditions.
3. Reject projects that fail zoning, utility, access, financing, or return constraints.
4. Let a small set of deterministic developer archetypes evaluate surviving projects using differentiated hurdle rates and capital constraints.
5. Select at most one winning project per parcel and deduct committed developer capital.
6. Hand the winning project to `BuildingSystem`, which owns construction and occupancy lifecycle only.
7. Preserve deterministic replay for identical seed and world state.

## 2. Current-State Problem

`BuildingSystem.evaluateDevelopment()` currently starts the single building definition associated with a lot's zone whenever zone demand exceeds a small threshold. This produces immediate buildout and does not model:

- land value,
- construction cost,
- market rent,
- vacancy,
- taxes,
- access,
- service quality,
- utility readiness,
- financing conditions,
- zoning intensity,
- developer hurdle rates,
- capital scarcity,
- or competition among project sponsors.

`BUILDING_DEFINITIONS` currently contains one low-detail building definition per zone, which means the simulation cannot choose between competing intensity or quality variants.

## 3. Architectural Boundaries

### 3.1 New `DevelopmentFeasibilitySystem`

Location: `src/simulation/development/DevelopmentFeasibilitySystem.ts`

Responsibility: pure, deterministic project underwriting.

Inputs:

- lot geometry and zone,
- available building/project definitions,
- zone demand,
- tax rates,
- utility service ratio,
- neighborhood/service quality,
- road/traffic accessibility,
- person accessibility,
- local economy/demand indicators,
- financing assumptions,
- citywide construction-cost index,
- current occupancy/vacancy estimates,
- optional redevelopment context in later phases.

Outputs a `DevelopmentFeasibilityResult` for each candidate project containing at minimum:

- `lotId`,
- `definitionId`,
- `legal`,
- `feasible`,
- `landValue`,
- `grossPotentialRent`,
- `vacancyRate`,
- `effectiveGrossIncome`,
- `operatingExpenses`,
- `propertyTaxes`,
- `netOperatingIncome`,
- `constructionCost`,
- `softCosts`,
- `financingCost`,
- `totalDevelopmentCost`,
- `stabilizedValue`,
- `yieldOnCost`,
- `returnOnCost`,
- `residualLandValue`,
- `riskScore`,
- `rejectionReasons`.

The system must not mutate city state.

### 3.2 New `DeveloperMarketSystem`

Location: `src/simulation/development/DeveloperMarketSystem.ts`

Responsibility: deterministic developer competition and capital allocation.

The system owns a small fixed roster of developer archetypes, for example:

- `local_builder`: lower capital, modest leverage, lower complexity tolerance, residential preference;
- `urban_developer`: medium capital, medium hurdle, commercial/residential flexibility;
- `industrial_specialist`: industrial preference, lower industrial risk premium;
- `institutional_developer`: high capital, lower financing spread, higher absolute project-size threshold.

Each developer has state:

- `id`,
- `availableCapital`,
- `committedCapital`,
- `hurdleRate`,
- `maxLeverage`,
- `financingSpread`,
- `riskTolerance`,
- preferred zones/project classes,
- maximum concurrent projects,
- optional minimum project size.

The market system evaluates feasible projects against each developer's underwriting policy and returns bids. A bid contains:

- developer id,
- project/definition id,
- parcel id,
- expected return,
- required equity,
- risk-adjusted score,
- residual land value / bid capacity,
- rank score.

The winner is selected deterministically.

### 3.3 `BuildingSystem`

`BuildingSystem` must stop deciding whether projects are financially viable.

Its responsibilities become:

- accept an approved development project,
- create construction state,
- track construction start/completion,
- transition completed projects to occupied state,
- expose owner/developer metadata,
- notify/release developer commitments when appropriate.

`evaluateDevelopment()` should either be removed or reduced to an adapter that delegates to the new development subsystem. The preferred implementation is to move decision logic out of `BuildingSystem` entirely and call the development system from `SimulationCore`.

### 3.4 `SimulationCore`

`SimulationCore.step()` will invoke the development market at the existing development cadence (currently every 10 ticks) unless testing shows that a slower cadence is necessary for stability.

The integration flow is:

1. Refresh service/accessibility/economic snapshots.
2. Build a `DevelopmentMarketContext` from current city state.
3. Ask `DevelopmentFeasibilitySystem` to enumerate parcel/project opportunities.
4. Ask `DeveloperMarketSystem` to rank and allocate feasible opportunities.
5. Start awarded projects through `BuildingSystem`.
6. Persist project ownership and developer commitments.

## 4. Project Definitions and Zoning Envelope

`src/data/buildings.ts` will be expanded from one definition per zone to multiple project variants. Definitions should remain data-driven.

Each project definition must include:

- `id`,
- `zone`,
- `intensity` or `tier`,
- `constructionTicks`,
- resident/job capacity,
- power/water/garbage demand,
- tax base,
- base hard construction cost,
- soft-cost ratio,
- base achievable rent or revenue proxy,
- operating-expense ratio,
- base vacancy,
- minimum access requirement,
- minimum utility requirement,
- minimum service-quality requirement,
- maximum or required zoning envelope fields.

Initial variants should be limited enough to keep tuning tractable. Recommended first set:

### Residential
- cottage / low-density,
- rowhouse / medium-density,
- apartment / higher-density.

### Commercial
- neighborhood shop,
- mixed retail block / mid-intensity commercial,
- office/retail building.

### Industrial
- workshop,
- warehouse/light industrial,
- larger industrial plant.

The zoning model may continue using the existing broad zone categories. Intensity legality can initially come from deterministic parcel/context constraints rather than introducing a separate player-facing zoning-density UI in this phase.

## 5. Economic Model

The model must be simple enough to reason about and tune, but complete enough that city conditions visibly influence development.

### 5.1 Achievable Rent / Revenue

For each project:

`achievableRent = baseRent * demandFactor * accessFactor * serviceFactor * utilityFactor * neighborhoodFactor`

Factors must be bounded to prevent runaway values.

Recommended first-pass bounds:

- demand factor: `0.65 .. 1.50`,
- access factor: `0.70 .. 1.30`,
- service factor: `0.75 .. 1.20`,
- utility factor: `0.50 .. 1.00`,
- neighborhood factor: `0.75 .. 1.25`.

Industrial projects should weight freight/road access more heavily than person accessibility. Residential and commercial projects should weight person accessibility and neighborhood quality more heavily.

### 5.2 Vacancy

`vacancyRate = clamp(baseVacancy + weakDemandPenalty + poorAccessPenalty + servicePenalty - strongDemandReduction)`

Recommended clamp: `0.03 .. 0.35`.

### 5.3 Effective Income

`grossPotentialRent = achievableRent * rentableCapacity`

`effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate)`

`operatingExpenses = effectiveGrossIncome * operatingExpenseRatio`

`propertyTaxes = taxBase * applicableTaxRate` or a calibrated value-based equivalent, provided the formula remains deterministic and uses the existing tax system's current rates.

`NOI = effectiveGrossIncome - operatingExpenses - propertyTaxes`

### 5.4 Construction and Soft Costs

`hardCost = baseConstructionCost * constructionCostIndex * complexityFactor`

`softCosts = hardCost * softCostRatio`

Infrastructure/service deficiencies may add deterministic site-preparation premiums rather than generating random overruns.

### 5.5 Financing

Each developer supplies financing assumptions.

`debt = totalPreFinanceCost * leverage`

`equity = totalPreFinanceCost - debt`

`financingCost = debt * effectiveInterestRate * constructionDurationYears`

The first implementation may use a normalized tick-to-year conversion constant rather than a full loan amortization model.

### 5.6 Stabilized Value and Return Metrics

Use a deterministic capitalization proxy:

`stabilizedValue = NOI / capRate`

Cap rate should reflect project class, market risk, and optionally developer risk premium, but must remain bounded.

Primary feasibility metrics:

`yieldOnCost = NOI / totalDevelopmentCost`

`returnOnCost = (stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost`

`residualLandValue = stabilizedValue - nonLandDevelopmentCost - requiredDeveloperProfit`

Land value is estimated from current market/context conditions and cannot exceed residual land value for a project to remain feasible.

A project is economically feasible only if:

- it is legal,
- minimum access/service/utility requirements are satisfied,
- residual land value >= estimated land value,
- expected return clears the evaluating developer's hurdle,
- required equity fits available developer capital,
- project count does not exceed the developer's concurrent-project constraint.

## 6. Land Value

Parcel land value should be endogenous to city conditions rather than a fixed price.

First-pass model:

`landValue = zoneBaseLandValue * demandFactor * accessFactor * serviceFactor * neighborhoodFactor`

Clamp the result to a calibrated range.

For industrial land, freight accessibility carries more weight. For residential and commercial land, person accessibility and neighborhood quality carry more weight.

This creates the intended feedback: improved roads/services can raise achievable rent and feasibility, while also raising land prices enough that some marginal projects cease to pencil.

## 7. Developer Competition

The competitive layer should create meaningful differences without simulating full corporations.

### 7.1 Bid Eligibility

For each feasible opportunity, each developer checks:

- zone/project preference,
- required equity,
- available capital,
- concurrent-project capacity,
- risk score vs risk tolerance,
- expected return vs developer hurdle.

### 7.2 Bid Ranking

Recommended deterministic rank:

`rankScore = expectedReturnMargin + preferenceBonus + capitalEfficiencyBonus + residualValueBonus - riskPenalty`

Where:

`expectedReturnMargin = expectedReturn - hurdleRate`

All components must be normalized and bounded.

### 7.3 Winner Selection

For each parcel:

1. sort eligible bids by descending rank score;
2. tie-break by higher residual land value;
3. then lower required equity;
4. then stable developer id;
5. only if all deterministic values are exactly equal may seeded random tie-breaking be used.

The recommended implementation avoids random tie-breaking entirely by using stable IDs as the final comparator.

### 7.4 Capital Allocation Across Parcels

To prevent every feasible parcel building at once, opportunities are globally sorted before awards.

Recommended ordering:

1. highest winning bid score,
2. highest return margin,
3. highest residual value,
4. lot id.

Awards are processed in that order, with capital and project-slot constraints updated after every award. This means early awards can make later projects unavailable to the same developer.

## 8. Construction and Capital Commitments

When a project starts:

- developer equity is moved from `availableCapital` to `committedCapital`,
- building stores `developerId`, `projectCost`, and `requiredEquity`,
- project occupies the parcel immediately for conflict prevention,
- construction completes on the existing tick lifecycle.

At completion, committed capital should remain economically tied to the project until a simple capital-recycling rule releases it. To avoid introducing asset-sale markets in this phase, use a deterministic recycling schedule such as returning a configured fraction of project equity after stabilization/completion.

Recommended first implementation:

- release 100% of committed equity after a fixed stabilization delay following completion;
- developer profit is represented through capital growth equal to a bounded realized return proxy;
- no project sale counterparties are modeled.

This provides capital scarcity during construction while avoiding indefinite capital lockup.

## 9. Determinism

For identical:

- simulation seed,
- save state,
- tick,
- parcel ordering,
- economic inputs,
- developer state,

the same projects and winners must be produced.

Requirements:

- stable sorted iteration over lots, candidates, developers, and bids;
- no use of `Math.random()`;
- no time-dependent values;
- seeded random only where explicitly allowed, though stable tie-breakers are preferred;
- all mutable developer state serialized in saves.

## 10. Save / Restore

Save state must include:

- developer archetype/state,
- available capital,
- committed capital,
- active commitments,
- project ownership/developer id on buildings,
- any stabilization/recycling timer state required to reproduce future behavior.

Loading a save must reproduce the same subsequent development awards as an uninterrupted run.

## 11. Observability

Expose enough diagnostics for testing and future UI without requiring a player-facing development panel in this phase.

Recommended read-only APIs:

- `listDevelopers()`;
- `getDeveloperState(id)`;
- `lastEvaluations()` or a bounded recent-evaluation snapshot;
- `lastAwards()`;
- `getParcelFeasibility(lotId)` where practical.

These diagnostics should make it possible to explain why a parcel did or did not develop.

## 12. Error Handling and Invariants

The subsystem must reject invalid/non-finite financial inputs.

Invariants:

- no negative construction cost;
- vacancy within `[0, 1)`;
- leverage within `[0, 1)`;
- hurdle rates and cap rates positive;
- no developer capital below zero after an award;
- no more than one active building/project per lot;
- no illegal project can be awarded;
- no project below a developer's hurdle can be awarded;
- restoration cannot create duplicate commitments for the same project.

## 13. TDD Acceptance Tests

Implementation must be test-driven.

Required tests:

1. A parcel does not develop when every candidate is below the hurdle rate.
2. Increasing achievable rent can make the same project feasible.
3. Higher vacancy reduces return and can block development.
4. Higher taxes reduce return and can block development.
5. Higher financing cost reduces return and can block development.
6. Higher construction cost reduces return and can block development.
7. Better access improves relevant project feasibility.
8. Utility/service failure can make a candidate ineligible.
9. Zoning/intensity constraints eliminate illegal variants.
10. Developers with different hurdle rates/preferences produce different bid rankings.
11. A developer without sufficient available capital cannot win a project.
12. Concurrent-project limits prevent unlimited awards.
13. Two developers competing for the same parcel produce one deterministic winner.
14. Global allocation prevents a single developer from exceeding capital after sequential awards.
15. Same seed/state produces identical awards.
16. Save/restore preserves developer capital, commitments, and future deterministic awards.
17. Existing `BuildingSystem` construction/occupancy behavior remains correct.
18. Existing city-loop, economy, mobility, traffic, services, and save tests remain green.

## 14. Performance Constraints

The city should not perform expensive full-market recomputation every tick.

Initial cadence: reuse the current 10-tick development evaluation interval.

Optimization rules:

- skip occupied/under-construction lots;
- skip zones with negligible demand;
- precompute project definitions by zone;
- avoid pathfinding per candidate if an existing accessibility snapshot can be reused;
- cap diagnostic history;
- keep formulas allocation-light.

If profiling shows the market loop is material, move evaluation to a slower cadence or evaluate a deterministic subset/queue of parcels per cycle without changing aggregate determinism.

## 15. Deferred Scope

Explicitly excluded from this phase:

- land ownership entities,
- negotiated land transactions,
- developer-vs-developer land auctions,
- banks and lender agents,
- debt maturities/amortization schedules,
- bond issuance,
- equity markets,
- bankruptcy/insolvency,
- developer mergers/acquisitions,
- speculative land banking,
- complex corporate overhead,
- macro credit cycles,
- player-facing density rezoning UI.

These can be layered later because the proposed interfaces preserve developer identity, project ownership, capital, and underwriting outputs.

## 16. Success Criteria

The feature is complete when:

- positive demand alone no longer guarantees construction;
- parcels develop only when a legal project pencils economically;
- city policy and infrastructure materially affect feasibility through taxes, access, services, utilities, and market demand;
- multiple project intensities can compete on the same broad zone;
- developer capital and hurdle differences influence which projects happen and when;
- competition never produces more than one winner per parcel;
- identical state produces identical outcomes;
- save/load preserves future development behavior;
- all new tests and pre-existing regression tests pass.
