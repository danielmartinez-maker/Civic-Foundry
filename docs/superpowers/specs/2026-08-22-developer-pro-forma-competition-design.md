# Civic Foundry — Deterministic Developer Pro Forma & Lightweight Competition Design

Date: 2026-08-22
Target branch: `metropolitan-era`
Baseline commit: `a4fdcbc43c1512a3fd28e3b475f836c63a007dc7`
Status: Approved design, pending implementation plan

## 1. Objective

Replace automatic demand-triggered construction with a deterministic development feasibility pipeline. Every vacant or otherwise eligible parcel must be evaluated as an investment opportunity before construction begins.

The system combines parcel economics with a deliberately limited competitive developer layer. It adds differentiated capital allocation, risk tolerance, financing terms, and project selection while deferring full corporate finance, land auctions, debt markets, insolvency, and speculative land ownership.

Required behavior:

1. Enumerate legally feasible projects for each eligible parcel.
2. Estimate parcel and project economics from current city conditions.
3. Reject candidates that fail zoning, utility, access, service, or basic market constraints.
4. Let a small deterministic set of developer archetypes underwrite surviving candidates using different hurdles, financing terms, risk tolerances, preferences, and available capital.
5. Select at most one winning project per parcel and update developer capital commitments sequentially.
6. Hand the awarded project to `BuildingSystem`, which owns construction and occupancy lifecycle only.
7. Preserve deterministic replay for identical seed and saved state.

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

`BUILDING_DEFINITIONS` currently contains one building definition per broad zone. The simulation therefore cannot choose between multiple legal intensities or project types on the same zone.

## 3. Architectural Boundaries

### 3.1 New `DevelopmentFeasibilitySystem`

Location: `src/simulation/development/DevelopmentFeasibilitySystem.ts`

Responsibility: pure, deterministic parcel/project economics.

The system exposes two conceptually separate operations:

1. `evaluateMarketCandidate(...)` — evaluates legal/physical/market feasibility independent of any specific developer.
2. `underwriteForDeveloper(...)` — applies a developer's financing terms, hurdle rate, leverage, and risk tolerance to a market candidate.

This separation prevents developer-specific hurdle rates from leaking into the parcel's base market evaluation.

Inputs to market evaluation:

- lot geometry and zone,
- candidate project definition,
- zone demand,
- tax rates,
- utility service ratio,
- neighborhood/service quality,
- road/freight accessibility,
- person accessibility,
- local economy/demand indicators,
- citywide construction-cost index,
- current market occupancy/vacancy estimate.

A `DevelopmentMarketCandidate` contains at minimum:

- `lotId`,
- `definitionId`,
- `zone`,
- `legal`,
- `marketFeasible`,
- `estimatedLandValue`,
- `achievableRent`,
- `grossPotentialRent`,
- `vacancyRate`,
- `effectiveGrossIncome`,
- `operatingExpenses`,
- `propertyTaxes`,
- `netOperatingIncome`,
- `hardConstructionCost`,
- `softCosts`,
- `sitePreparationCost`,
- `preFinanceNonLandCost`,
- `baseCapRate`,
- `stabilizedValue`,
- `riskScore`,
- `rejectionReasons`.

A developer-specific underwriting result contains at minimum:

- `developerId`,
- `lotId`,
- `definitionId`,
- `eligible`,
- `leverage`,
- `effectiveInterestRate`,
- `financingCost`,
- `landAcquisitionCost`,
- `nonLandDevelopmentCost`,
- `totalDevelopmentCost`,
- `requiredEquity`,
- `yieldOnCost`,
- `returnOnCost`,
- `expectedReturn`,
- `requiredDeveloperProfit`,
- `residualLandValue`,
- `returnMargin`,
- `rejectionReasons`.

Neither operation mutates city or developer state.

### 3.2 New `DeveloperMarketSystem`

Location: `src/simulation/development/DeveloperMarketSystem.ts`

Responsibility: deterministic developer competition, project ranking, and capital allocation.

Initial fixed developer archetypes:

- `local_builder`: lower capital, modest leverage, lower complexity tolerance, residential preference;
- `urban_developer`: medium capital, medium hurdle, residential/commercial flexibility;
- `industrial_specialist`: industrial preference and lower industrial risk penalty;
- `institutional_developer`: higher capital, lower financing spread, higher minimum project scale.

Each developer state contains:

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

The market system receives market candidates, calls developer-specific underwriting, filters ineligible bids, ranks bids, awards projects sequentially, and mutates developer capital only when an award is committed.

A bid contains:

- developer id,
- lot id,
- definition id,
- expected return,
- return margin,
- required equity,
- residual land value,
- risk-adjusted score,
- final rank score.

### 3.3 `BuildingSystem`

`BuildingSystem` stops deciding whether projects are financially viable.

Its responsibilities become:

- accept an approved development award,
- create construction state,
- track construction start/completion,
- transition completed projects to occupied state,
- retain developer/project economics metadata needed for save/load and capital recycling,
- expose ownership metadata to diagnostics and future UI.

`evaluateDevelopment()` should be removed. `SimulationCore` will own the orchestration call into the development subsystem.

### 3.4 `SimulationCore`

`SimulationCore.step()` invokes the development market at the current development cadence of every 10 ticks unless profiling or regression tests justify a slower cadence.

Integration flow:

1. Refresh existing service/accessibility/economic snapshots.
2. Build a `DevelopmentMarketContext` from current city state.
3. Enumerate unoccupied eligible lots in stable order.
4. Generate all legal candidate project definitions for each lot.
5. Evaluate market candidates with `DevelopmentFeasibilitySystem`.
6. Pass surviving candidates to `DeveloperMarketSystem`.
7. Process awards in deterministic global order while updating developer capital and project slots after each award.
8. Start awarded projects through `BuildingSystem`.
9. Persist project ownership, commitments, and stabilization timers.

## 4. Building Definition Migration and Zoning Envelope

`src/data/buildings.ts` must migrate from one `Record<ZoneType, BuildingDefinition>` to structures that support multiple definitions per zone without forcing consumers to guess which definition represents a zone.

Preferred data shape:

- `BUILDING_DEFINITIONS_BY_ID: Readonly<Record<string, BuildingDefinition>>`
- `BUILDING_VARIANTS_BY_ZONE: Readonly<Record<ZoneType, readonly BuildingDefinition[]>>`

All existing consumers that currently do `BUILDING_DEFINITIONS[building.zone]` must instead resolve by `building.definitionId` when they need the actual built form. Capacity, utility, garbage, tax, rendering, and save/restore behavior must therefore remain definition-specific.

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
- site-preparation baseline,
- base achievable rent/revenue proxy,
- operating-expense ratio,
- base vacancy,
- base cap rate,
- minimum access requirement,
- minimum utility requirement,
- minimum service-quality requirement,
- deterministic zoning/intensity constraints.

Initial variants:

### Residential
- cottage / low density,
- rowhouse / medium density,
- apartment / higher density.

### Commercial
- neighborhood shop,
- mid-intensity retail/commercial block,
- office/retail building.

### Industrial
- workshop,
- warehouse/light industrial,
- larger industrial plant.

Broad zoning categories remain unchanged in this phase. Intensity legality is derived from deterministic project/parcel constraints, avoiding a new player-facing density-zoning UI.

## 5. Economic Model

The formulas must remain explicit, bounded, deterministic, and tuneable.

### 5.1 Achievable Rent / Revenue

For each candidate:

`achievableRent = baseRent * demandFactor * accessFactor * serviceFactor * utilityFactor * neighborhoodFactor`

Recommended first-pass bounds:

- demand factor: `0.65 .. 1.50`,
- access factor: `0.70 .. 1.30`,
- service factor: `0.75 .. 1.20`,
- utility factor: `0.50 .. 1.00`,
- neighborhood factor: `0.75 .. 1.25`.

Industrial projects weight freight/road access more heavily than person accessibility. Residential and commercial projects weight person accessibility and neighborhood quality more heavily.

### 5.2 Vacancy

`vacancyRate = clamp(baseVacancy + weakDemandPenalty + poorAccessPenalty + servicePenalty - strongDemandReduction)`

Recommended clamp: `0.03 .. 0.35`.

### 5.3 Effective Income

`grossPotentialRent = achievableRent * rentableCapacity`

`effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate)`

`operatingExpenses = effectiveGrossIncome * operatingExpenseRatio`

`propertyTaxes = calibratedTaxBase * applicableTaxRate`

The tax formula must use the existing tax system's current zone rate and be calibrated so existing tax-rate gameplay remains meaningful.

`NOI = effectiveGrossIncome - operatingExpenses - propertyTaxes`

### 5.4 Land Value

Parcel land value is endogenous:

`estimatedLandValue = zoneBaseLandValue * demandFactor * accessFactor * serviceFactor * neighborhoodFactor`

The result is clamped to a calibrated range.

Industrial land weights freight accessibility more heavily. Residential/commercial land weights person accessibility and neighborhood quality more heavily.

This creates a useful feedback loop: infrastructure and services can raise rents and feasibility while simultaneously raising land prices enough to suppress marginal projects.

### 5.5 Construction and Site Costs

`hardCost = baseConstructionCost * constructionCostIndex * complexityFactor`

`softCosts = hardCost * softCostRatio`

`sitePreparationCost = baseSitePreparationCost * deficiencyFactor`

Service or utility deficiencies may increase deterministic site-preparation cost, but no random cost overruns are introduced.

`preFinanceNonLandCost = hardCost + softCosts + sitePreparationCost`

### 5.6 Financing and Total Development Cost

Developer-specific financing uses:

`landAcquisitionCost = estimatedLandValue`

`preFinanceTotalCost = landAcquisitionCost + preFinanceNonLandCost`

`debt = preFinanceTotalCost * leverage`

`baseEquity = preFinanceTotalCost - debt`

`effectiveInterestRate = baseMarketRate + developerFinancingSpread + riskPremium`

`financingCost = debt * effectiveInterestRate * constructionDurationYears`

`nonLandDevelopmentCost = preFinanceNonLandCost + financingCost`

`totalDevelopmentCost = landAcquisitionCost + nonLandDevelopmentCost`

`requiredEquity = baseEquity + financingCost`

This phase uses a normalized tick-to-year conversion constant and no amortization schedule.

### 5.7 Stabilized Value and Return Metrics

`stabilizedValue = NOI / capRate`

Cap rate is bounded and derived from project class plus market risk. Developer financing terms affect cost and return, not the base market NOI.

`yieldOnCost = NOI / totalDevelopmentCost`

`returnOnCost = (stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost`

`requiredDeveloperProfit = totalDevelopmentCost * developer.hurdleRate`

`residualLandValue = stabilizedValue - nonLandDevelopmentCost - requiredDeveloperProfit`

`expectedReturn = returnOnCost`

`returnMargin = expectedReturn - developer.hurdleRate`

A developer-specific underwriting is eligible only if:

- the market candidate is legal and market-feasible,
- minimum access/service/utility requirements are satisfied,
- `residualLandValue >= estimatedLandValue`,
- `expectedReturn >= hurdleRate`,
- `requiredEquity <= availableCapital`,
- developer risk tolerance is not exceeded,
- concurrent-project capacity is available.

This makes hurdle-rate feasibility explicitly developer-specific.

## 6. Market Feasibility Before Developer Underwriting

A market candidate is `marketFeasible` when:

- the candidate is legal for the parcel,
- hard/soft/site costs are finite and positive,
- access/service/utility thresholds are met,
- NOI is positive,
- stabilized value is positive,
- all derived financial values are finite.

Market feasibility does not include developer capital, leverage, financing spread, hurdle rate, or project-slot limits.

## 7. Developer Competition

### 7.1 Bid Eligibility

For every market-feasible candidate, each developer checks:

- zone/project preference,
- minimum project size,
- required equity,
- available capital,
- concurrent-project capacity,
- risk score vs risk tolerance,
- expected return vs hurdle rate,
- residual land value vs estimated land value.

### 7.2 Bid Ranking

Recommended normalized deterministic score:

`rankScore = returnMargin + preferenceBonus + capitalEfficiencyBonus + residualValueBonus - riskPenalty`

Where:

`returnMargin = expectedReturn - hurdleRate`

All components are clamped to documented ranges in code so no single unbounded metric dominates.

### 7.3 Winner Selection Per Parcel

Eligible bids are sorted by:

1. descending rank score,
2. descending residual land value,
3. ascending required equity,
4. stable developer id.

Stable IDs are the final tie-breaker. No random tie-breaking is needed.

### 7.4 Global Capital Allocation

A preliminary winning bid is determined for each parcel, then parcel awards are globally sorted by:

1. descending winning bid score,
2. descending return margin,
3. descending residual land value,
4. stable lot id.

Awards are committed sequentially. After each award:

- developer available capital is reduced,
- committed capital increases,
- concurrent-project count increases,
- later awards are revalidated against the developer's updated state.

If a preliminary winner becomes invalid because of an earlier award, the parcel is offered to the next ranked still-eligible bidder before being left undeveloped.

This revalidation rule prevents stale bids from oversubscribing developer capital.

## 8. Construction and Capital Commitments

When a project starts:

- developer equity moves from `availableCapital` to `committedCapital`,
- the building stores `developerId`, `projectCost`, `requiredEquity`, and award metadata,
- the lot is immediately reserved through the building/construction record,
- construction completes on the existing tick lifecycle.

At completion, capital remains committed through a fixed stabilization delay. After stabilization:

- 100% of committed equity is released,
- a bounded realized-return proxy is added to developer available capital,
- the commitment is removed,
- no asset-sale counterparty is modeled.

The realized-return proxy is a simulation abstraction for capital recycling, not a modeled property transaction.

## 9. Determinism

For identical simulation seed, saved state, tick, parcel ordering, economic inputs, and developer state, the same candidates, bids, and awards must result.

Requirements:

- stable sorted iteration over lots, definitions, developers, bids, and awards;
- no `Math.random()`;
- no wall-clock/time-dependent values;
- stable string IDs as deterministic final tie-breakers;
- all mutable developer state serialized.

## 10. Save / Restore

Save state must include:

- developer state,
- available capital,
- committed capital,
- active commitments,
- concurrent-project counts or derivable commitment state,
- building `developerId`, project cost, and required equity,
- stabilization/recycling timers,
- any market configuration values that are not immutable code constants.

Loading a save must reproduce the same subsequent development awards as uninterrupted execution.

Backward compatibility with saves created before this feature must be explicitly handled. Missing developer state should initialize from deterministic default archetypes; existing buildings without developer metadata remain valid legacy buildings and must not create synthetic commitments.

## 11. Observability

Expose bounded read-only diagnostics suitable for tests and future UI:

- `listDevelopers()`;
- `getDeveloperState(id)`;
- `lastMarketEvaluations()`;
- `lastBids()`;
- `lastAwards()`;
- `getParcelFeasibility(lotId)` where practical.

Diagnostics must include rejection reasons so a parcel can be explained as blocked by zoning, services, utilities, land price, return hurdle, risk, capital, or project slots.

## 12. Error Handling and Invariants

Reject invalid or non-finite financial inputs.

Invariants:

- no negative construction, land, site, financing, or total project cost;
- vacancy within `[0, 1)`;
- leverage within `[0, 1)`;
- hurdle rates, cap rates, and interest rates positive;
- no developer available or committed capital below zero;
- no more than one active building/project per lot;
- no illegal project can be awarded;
- no project below a developer's hurdle can be awarded;
- no award may exceed developer capital or project-slot limits;
- save restoration cannot create duplicate commitments for the same project;
- every occupied building resolves its definition by `definitionId`.

## 13. TDD Acceptance Tests

Implementation is test-driven. Required tests:

1. A parcel does not develop when every developer underwriting is below hurdle.
2. Increasing achievable rent can make the same project viable.
3. Higher vacancy reduces return and can block development.
4. Higher taxes reduce return and can block development.
5. Higher financing cost reduces return and can block development.
6. Higher construction cost reduces return and can block development.
7. Better relevant access improves project feasibility.
8. Utility/service failure can make a candidate market-infeasible.
9. Zoning/intensity constraints eliminate illegal variants.
10. Multiple building variants in one zone are enumerated and resolved by `definitionId`.
11. Developers with different hurdle rates/preferences produce different bid rankings.
12. A developer without sufficient available capital cannot win.
13. Concurrent-project limits prevent unlimited awards.
14. Two developers competing for the same parcel produce exactly one deterministic winner.
15. Global sequential allocation cannot oversubscribe developer capital.
16. If the preliminary winner becomes capital-constrained, the next eligible bidder can win.
17. Same seed/state produces identical candidates, bids, and awards.
18. Save/restore preserves developer capital, commitments, timers, and future deterministic awards.
19. Legacy saves without developer metadata initialize safely and deterministically.
20. Existing `BuildingSystem` construction/occupancy behavior remains correct.
21. Existing capacity, utilities, tax, garbage, rendering, and other definition lookups still use the built `definitionId` correctly.
22. Existing city-loop, Phase 6 economy, mobility, traffic, services, and save tests remain green.

## 14. Performance Constraints

Do not recompute the full development market every tick.

Initial cadence: every 10 ticks, matching the existing development evaluation interval.

Optimization rules:

- skip occupied or under-construction lots;
- skip zones with negligible demand;
- pre-index project definitions by zone;
- reuse existing accessibility snapshots rather than pathfinding per candidate;
- cap diagnostic history;
- keep formulas allocation-light;
- use deterministic ordering once per evaluation cycle rather than repeated ad-hoc sorts where practical.

If profiling shows the market loop is material, move evaluation to a slower cadence or a deterministic parcel queue without changing outcomes for a given configured cadence.

## 15. Deferred Scope

Excluded from this phase:

- land ownership entities,
- negotiated land transactions,
- developer-vs-developer land auctions,
- banks and lender agents,
- amortization and debt maturities,
- bond issuance,
- equity markets,
- bankruptcy/insolvency,
- developer mergers/acquisitions,
- speculative land banking,
- complex corporate overhead,
- macro credit cycles,
- player-facing density rezoning UI.

The interfaces intentionally preserve developer identity, ownership, capital, underwriting, and project metadata so those systems can be layered later.

## 16. Success Criteria

The feature is complete when:

- positive demand alone no longer guarantees construction;
- parcels develop only when a legal project pencils for at least one developer;
- city taxes, access, services, utilities, market demand, vacancy, construction cost, land value, and financing materially affect feasibility;
- multiple project intensities can compete within one broad zone;
- developer capital, hurdle rates, financing terms, preferences, and risk tolerances influence what gets built and when;
- competition produces at most one winner per parcel;
- sequential allocation never oversubscribes developer capital;
- identical saved state produces identical future awards;
- legacy saves load safely;
- all new tests and pre-existing regression tests pass.
