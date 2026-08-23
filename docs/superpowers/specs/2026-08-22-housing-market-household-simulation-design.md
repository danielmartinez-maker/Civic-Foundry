# Civic Foundry Phase 7 — Housing Market & Household Simulation Design

## Status
Approved in chat on 2026-08-22. This specification defines the next Phase 7 implementation slice on top of the canonical V7 (`0.7.0-metropolitan`) baseline on `main`.

This document authorizes implementation planning only after explicit user review. It refines the Phase 7 Land, Housing & Development program in the Metropolitan Era master design.

## Product Goal
Replace aggregate residential capacity/population behavior with a deterministic, endogenous housing market in which households face real affordability, tenure, location, mobility, and displacement tradeoffs.

The core causal loop is:

**firm employment -> household income -> housing affordability and choice -> building occupancy/vacancy/rent/price -> land value and residential market pressure -> developer underwriting -> construction/redevelopment -> new supply -> household moves, filtering, displacement, and migration**

The player must be able to inspect why a household moved, why a building's rent changed, why a neighborhood became unaffordable, and why a developer did or did not build.

## Scope Boundary
Phase 7 uses adaptive-fidelity households: weighted household cohorts by default, selectively split into smaller cohorts or explicit weight-1 households when materially different outcomes require it.

Phase 7 includes:
- explicit residential building assignments for household cohorts;
- household size, workers, dependents, income, employment stability, vehicle access, savings proxy, tenure, housing burden, preferences, move friction, and displacement state;
- both rental and owner-occupier housing;
- explicit rental vs for-sale supply so the same unit cannot exist in both markets simultaneously;
- persistent building-level asking/effective rent, sale value, vacancy, occupancy mix, turnover, quality, and market pressure;
- deterministic search, matching, moves, cohort splitting, and recombination;
- a small wage bridge from Phase 6 firm employment to household income;
- stylized mortgage/down-payment qualification and owner equity;
- migration constrained by jobs, housing availability, affordability, and residential utility;
- temporary displaced/unhoused household state;
- overcrowding;
- filtering through real vacancy chains;
- occupied-parcel redevelopment economics;
- integration with existing developer pro formas and competing developers;
- authoritative diagnostics and a compact housing-market UI after simulation correctness;
- V7 save extension with deterministic migration from prior V7 saves;
- determinism, regression, and scale acceptance tests.

Phase 7 explicitly defers:
- births, deaths, aging, retirement, household formation/dissolution, and full demographic lifecycle;
- education attainment, occupations, skills, promotions, and detailed careers;
- named-worker microsimulation;
- explicit banks, credit scores, foreclosures, mortgage servicing businesses, securitization, and household debt portfolios;
- rent control, vouchers, welfare, relocation mandates, and detailed housing-policy systems;
- detailed homelessness services;
- full household taxation and consumption balance sheets.

Those belong primarily to later demographic, government, and finance phases.

## Design Principles
1. **Deterministic outcomes.** Same state, commands, and seed produce the same housing future.
2. **Inspectable causality.** Important outcomes expose their drivers and rejection/blocking reasons.
3. **Adaptive fidelity.** Cohorts split only when economically meaningful outcomes diverge and merge when they reconverge.
4. **Bounded complexity.** No all-households x all-units matching and no uncontrolled entity explosion.
5. **Real assignments.** Housing demand is represented by households assigned to real residential buildings.
6. **Persistent markets.** Rents, prices, tenure, vacancy, mortgage proxies, and move state evolve over time.
7. **Exclusive tenure supply.** A physical housing unit is either vacant-rental, vacant-for-sale, renter-occupied, owner-occupied, or temporarily unavailable; it cannot be double-counted.
8. **Endogenous development.** Residential projects increasingly rely on real achievable market economics rather than generic demand alone.
9. **Phase-safe integration.** Existing mobility, firms, services, development, and V7 saves remain functional during transition.

## Architecture

### HousingMarketSystem
`HousingMarketSystem` is the authoritative Phase 7 housing-domain scheduler and state owner. `SimulationCore` coordinates it but does not absorb its internal state.

Responsibilities:
- synchronize residential supply;
- coordinate household economics;
- identify voluntary and involuntary movers;
- update rental and ownership pricing;
- perform deterministic candidate generation and matching;
- process moves, displacement, temporary unhoused states, and migration;
- compute citywide/building/household diagnostics;
- publish stabilized housing revenue, sale-value, land-value, and redevelopment signals to the developer market;
- snapshot and restore authoritative housing state.

### HouseholdCohortSystem
Owns adaptive-fidelity household entities.

A household entity represents one or more statistically equivalent households. Required authoritative state includes:
- `id`;
- `weight`;
- `householdSize`;
- `workers`;
- `dependents`;
- `grossIncome`;
- `disposableHousingIncome`;
- employment state and stability proxy;
- optional firm/employer linkage where required for causality;
- `tenure`: `renter | owner | seeking`;
- `buildingId` when housed;
- `unitRequirement`;
- `vehicleAccess`;
- liquid-savings proxy;
- down-payment capacity;
- mortgage proxy for owners;
- current housing cost;
- housing-cost burden;
- affordability stress;
- household-specific utility preference weights;
- move friction;
- residence tenure duration;
- displacement state/risk;
- arrears/distress state;
- search state;
- last move reason;
- stable split/creation metadata needed for deterministic IDs.

### HousingSupplySystem
Owns one persistent market ledger per eligible occupied residential building.

Physical residential definitions must gain explicit housing-unit metadata rather than inferring households directly from `residentCapacity`. At minimum each residential definition must expose:
- `housingUnits`;
- nominal `residentCapacity`;
- optional practical overcrowding multiplier/capacity;
- product suitability inputs needed to price/score the building.

The building ledger contains:
- `buildingId`;
- physical housing units;
- nominal resident capacity;
- practical overcrowding ceiling;
- `housingProduct`: `rental | for_sale | mixed`;
- `rentalProductUnits`;
- `forSaleProductUnits`;
- renter-occupied units;
- owner-occupied units;
- vacant rentable units;
- vacant for-sale units;
- temporarily unavailable units;
- resident load;
- asking rent and effective rent;
- prior rent;
- asking/estimated sale price;
- vacancy duration by product where material;
- qualified rental applicant pressure;
- qualified buyer pressure;
- turnover;
- resident-income statistics;
- average housing-cost burden;
- quality/accessibility/habitability scores;
- realized rent/price change;
- redevelopment-pressure inputs and result.

For every building, all physical units must reconcile exactly:

`rentalProductUnits = renterOccupiedUnits + vacantRentableUnits`

`forSaleProductUnits = ownerOccupiedUnits + vacantForSaleUnits`

`rentalProductUnits + forSaleProductUnits + unavailableUnits = housingUnits`

A rental-only project has `forSaleProductUnits = 0`; a for-sale project has `rentalProductUnits = 0`. Mixed projects persist a deterministic split. No unit may be counted twice.

### Tenure Product Assignment
Residential physical form and tenure product are separate concepts. A cottage, rowhouse, or apartment may be rental or owner product when economically plausible.

For **new development**, developer underwriting evaluates eligible tenure products:
- rental project: value from stabilized NOI/effective rents;
- for-sale project: value from achievable sale proceeds less selling/transaction friction;
- mixed product: allowed only for definitions/configurations explicitly marked as mixed-compatible and must have a deterministic unit split.

The selected project award persists its `housingProduct` and any mixed-unit allocation. This prevents a completed project from freely switching between rental and for-sale economics every clearing cycle.

For **existing pre-housing V7 buildings**, migration assigns a deterministic initial product from centralized compatibility rules by building definition, with no claim of historical accuracy. Example policy may favor owner product for cottages, mixed product for rowhouses, and rental product for apartments, but exact mapping belongs in configuration and tests.

Later conversion between rental and for-sale product is out of scope unless explicitly introduced with transaction/conversion costs; Phase 7 should not allow frictionless tenure flipping.

### HousingChoiceSystem
A pure or near-pure deterministic choice engine that:
- rejects hard-ineligible candidates;
- calculates rental affordability;
- calculates ownership qualification;
- calculates household-specific utility;
- ranks candidates with stable tie-breaking;
- applies move-friction thresholds;
- returns dominant positive/negative drivers and explicit rejection reasons.

### Income Bridge
Phase 6 labor allocation exposes filled jobs by firm but not wages. Phase 7 adds only the wage bridge required for housing.

Firm archetypes receive centralized wage schedules/indices. Household worker income derives from:
- actual employment availability;
- firm archetype/sector where linked;
- firm operating health/productivity as bounded modifiers;
- employed worker count represented by the household entity.

This bridge must not become a hidden Phase 9 career system.

## Adaptive Fidelity

### Cohort Splitting
Split a cohort only when represented households should receive different outcomes. Valid triggers include:
- only part can afford an available unit;
- only part can qualify for ownership;
- limited unit capacity admits only part;
- employment outcomes divide the cohort;
- displacement/rehousing outcomes diverge;
- household-size or space-fit boundaries diverge;
- savings/down-payment thresholds diverge;
- a deterministic internal distribution boundary implies different results.

Splits use deterministic thresholds/proportions, never random sampling.

### Cohort Recombination
Compatible stabilized entities may merge when they match on bounded dimensions such as:
- income band;
- household size;
- tenure;
- building assignment;
- employment state;
- vehicle access;
- affordability stress;
- search state.

Merge operations must preserve population, represented household count, income, savings, mortgage principal/equity where applicable, and other conserved quantities within explicit numerical tolerances.

### Scale Target
A 250,000-resident-equivalent city should stabilize with only a few thousand household entities rather than hundreds of thousands.

## Employment and Income
Initial wage schedules may use relative archetype bands such as:
- local retail/service: lower wage;
- wholesale/logistics: lower-middle wage;
- light manufacturing: middle wage;
- assembly/advanced manufacturing: middle-high wage.

Exact values belong in data/config.

Household income responds to:
- number of employed workers;
- current labor allocation;
- firm archetype wage schedule;
- bounded firm productivity/health modifier;
- unemployment.

A bounded configurable fallback-income proxy may exist for unemployed households to avoid pathological instant-zero-income behavior before later government systems exist. It must be explicit and must not masquerade as a modeled welfare program.

## Rental Market
Each rental-capable building carries persistent asking and effective rents.

Conceptual pressure:

`rentPressure = vacancyPressure + qualifiedSearchPressure + incomeSupport + qualityPremium + accessibilityPremium - distressPenalty`

Inputs include:
- occupancy vs target occupancy;
- qualified applicants per vacant rentable unit;
- incomes of households actually capable of renting there;
- neighborhood/service quality;
- person/job/transit accessibility;
- utilities/habitability;
- unresolved incidents, garbage, and severe service failures.

Rent adjusts inertially:

`newAskingRent = oldAskingRent * (1 + boundedAdjustment)`

Initial target: normal movement around +/-3% per 100-tick market-clearing cycle, with stronger downward movement permitted under severe vacancy or habitability failure. Coefficients live in centralized housing configuration.

### Effective Rent
High vacancy/prolonged vacancy can create concessions:

`effectiveRent <= askingRent`

Tight buildings may realize approximately full asking rent.

Developer underwriting uses stabilized achievable effective rent, never unsupported posted asking rent.

## Ownership Market
For-sale supply uses a stylized but consequential financing model.

### Sale Value
Estimated per-unit sale value depends on:
- capitalized equivalent market rent/value anchor;
- neighborhood quality;
- accessibility;
- physical/building quality;
- qualified buyer pressure;
- market mortgage/development interest rate;
- inventory/vacancy duration and liquidity.

Higher mortgage rates must reduce household purchasing power even if rental values remain high.

### Buyer Qualification
A buyer must satisfy all three:

`downPayment + transactionReserve <= liquidSavings`

`mortgagePayment / grossIncome <= maxDebtServiceRatio`

`remainingSavings >= emergencyReserve`

Mortgage payment uses the standard amortizing-loan equation with configurable term/rate assumptions.

### Mortgage Proxy
Owner households store:
- original principal;
- remaining principal;
- interest rate;
- scheduled payment;
- purchase tick.

Principal amortizes deterministically every household-economic cycle.

Owner equity proxy:

`equity = estimatedUnitValue - remainingMortgagePrincipal`

Equity affects later move/purchase capacity, but full household balance-sheet simulation is deferred.

## Housing Choice
Conceptual household utility:

`U = affordability + spaceFit + commuteAccess + services + neighborhood + tenureFit + vehicleFit + densityFit + stability - movingCost - overcrowdingPenalty - displacementRisk`

Weights vary by household characteristics:
- lower-income households weight affordability more strongly;
- households with more workers weight job accessibility more strongly;
- carless households strongly weight transit/person accessibility;
- larger households penalize inadequate space;
- owners have greater move friction;
- density preference trades space against access.

### Housing-Cost Burden
Initial configurable bands:
- comfortable: <25%;
- manageable: 25-35%;
- stressed: 35-50%;
- severely burdened: >50%.

Penalty is nonlinear. Severe burden can be a hard rejection for new voluntary moves even if other attributes are attractive.

## Search and Matching
Households do not evaluate every dwelling.

### Search Triggers
Search may begin after:
- in-migration attempt;
- rent shock;
- job loss/material income change;
- overcrowding;
- ownership opportunity;
- poor commute/access;
- service/neighborhood deterioration;
- displacement;
- sustained affordability stress;
- sustained low residential utility.

### Candidate Generation
Candidate generation is deterministic and bounded. It draws from:
1. tenure-compatible available units;
2. affordable units;
3. units meeting minimum space requirements;
4. nearby/current-neighborhood alternatives;
5. high-access alternatives;
6. ownership opportunities for qualified households;
7. a bounded citywide fallback sample.

Stable household/building/unit-group IDs break ties.

### Matching and Capacity
Matching is sequential but deterministic. Candidate ranking must account for remaining supply so accepted household weight cannot exceed available units or permitted overcrowding.

If only part of a cohort can be housed, the cohort splits deterministically and only the accepted weight moves.

### Move Threshold
A voluntary move occurs only when:

`newUtility - currentUtility > moveThreshold`

The threshold rises with residence tenure and ownership. Involuntary displacement bypasses it.

## Population and Migration Authority
Once housing is active, `HousingMarketSystem` is authoritative for resident population.

`PopulationSystem.population` remains for compatibility but is synchronized from housing state. Its legacy `update()` logic must not independently create/remove residents after activation.

### In-Migration
Potential migrants exist as deterministic external household cohorts. Entry depends on:
- viable available housing;
- affordability;
- employment opportunities/wages;
- accessibility;
- services;
- neighborhood quality.

Positive residential demand without viable housing cannot create population.

### Out-Migration
Households can leave after sustained:
- unemployment;
- severe housing burden;
- inability to find housing;
- displacement;
- poor habitability/services;
- low overall residential utility.

Persistence thresholds prevent one bad cycle from causing mass churn.

## Displacement and Temporary Unhoused State
When an occupied residential building is removed or redeveloped, its households retain economic/preference state and become involuntary searchers.

State path:

`housed -> displaced/searching -> temporarily unhoused -> rehoused OR out-migrated`

Temporarily unhoused households:
- remain in city population for a bounded grace period;
- search aggressively;
- receive severe residential utility penalties;
- generate reduced normal trip behavior;
- increase housing-crisis diagnostics.

Detailed homelessness services are deferred.

## Overcrowding
Housing supply distinguishes:
- physical housing units;
- nominal resident capacity;
- practical overcrowding ceiling.

Households may temporarily exceed ideal resident capacity within configured bounds. Overcrowding increases dissatisfaction, service pressure, and move propensity. It cannot provide infinite de facto capacity.

## Housing Filtering
New supply affects affordability through real move/vacancy chains rather than a flat global bonus.

Example causal chain:
1. a higher-income renter moves into newly completed housing;
2. their prior unit becomes vacant;
3. that unit's effective rent responds to vacancy and applicant conditions;
4. another household moves into it;
5. further vacancies may propagate down-market.

Tests must prove at least one deterministic multi-step filtering chain that creates an opportunity for a lower-income household in existing stock.

## Market Cadence
Different processes intentionally operate at different deterministic cadences.

### Every 10 ticks — Building Conditions
- synchronize residential supply;
- refresh utilities/services/accessibility;
- update quality/habitability;
- detect building removal/severe failure;
- flag involuntary movers.

### Every 50 ticks — Household Economics
- update employment-linked income;
- update housing-cost burden;
- amortize mortgage proxies;
- update savings proxy and arrears/stress;
- identify search triggers.

### Every 100 ticks — Housing Market Clearing
- update rents and sale prices;
- build bounded candidate sets;
- run rental/buyer matching;
- process moves;
- process temporary unhoused households;
- process bounded migration;
- update vacancy, turnover, unmet demand, burden, and displacement metrics;
- merge compatible cohorts.

### Every 250 ticks — Land and Redevelopment
- compute stabilized residential income/sale economics;
- update building and land-value signals;
- identify underbuilt parcels;
- evaluate replacement physical variants and tenure products;
- publish viable redevelopment opportunities to the existing developer market.

This lag permits shortages, price response, migration, and construction cycles rather than instant market clearing.

## Redevelopment Economics
Redevelopment compares replacement economics against the existing occupied use.

For rental existing use:

`existingUseValue = stabilizedNOI / marketCapRate`

For owner/for-sale product, existing use value uses current sale-value/equity/acquisition economics rather than pretending it has rental NOI.

Replacement opportunity:

`redevelopmentGain = replacementResidualLandValue - existingUseValue - demolitionCost - displacementOrAcquisitionCost`

A replacement may proceed only when:
- zoning/intensity permits it;
- infrastructure/physical feasibility clears;
- redevelopment gain clears minimum profit buffer;
- return clears the developer hurdle;
- developer capital and project slots are available.

High-density zoning permits redevelopment; it never forces it.

### Displacement/Acquisition Cost Proxy
The cost proxy may depend on:
- occupied household count;
- renter/owner mix;
- residence tenure duration;
- housing scarcity;
- relocation difficulty;
- owner acquisition/equity value where relevant.

It represents aggregate acquisition, vacancy, relocation, transaction, and delay friction until later policy systems distinguish these explicitly.

## Developer-Market Integration
Residential development feasibility must consume authoritative housing-market signals including:
- stabilized achievable effective rent for rental product;
- achievable sale price and qualified buyer depth for for-sale product;
- product-specific vacancy/inventory;
- qualified search demand;
- rent/price growth;
- affordability pressure;
- land value;
- redevelopment/demolition cost;
- displacement/acquisition cost.

`DemandSnapshot.residential` may remain as a compatibility/UI summary but is not sufficient proof of project viability.

Commercial and industrial behavior remains unchanged except for safe shared-interface generalization.

## Mobility and Service Integration
Household assignments should become the authoritative residential origins for person-trip generation. Integration may be staged behind compatible interfaces so existing mobility remains functional during implementation.

Housing utility consumes existing authoritative network/service outputs. It must not invent parallel accessibility or service systems.

## Persistence: V7 Extension
This remains Phase 7, so save version stays V7.

`SaveV7` gains an optional-to-read, required-to-write `housingMarket` snapshot once migration support lands.

The snapshot contains at least:
- household/cohort entities;
- residential building market ledgers;
- physical/tenure unit allocations;
- mortgage proxies;
- search/displacement state;
- authoritative market aggregates that are not cheaply derived;
- deterministic next-ID counters;
- housing scheduler/random state if any is introduced;
- migration state required to reproduce future outcomes.

No randomness should be introduced unless seeded, persisted, and necessary; stable deterministic allocation is preferred.

### Prior V7 Migration
A V7 save without housing state hydrates deterministically.

Migration may reconstruct only defensible current state:
- housing supply from occupied residential buildings;
- explicit `housingUnits` from centralized compatibility mapping for legacy definitions until definitions themselves carry the new metadata;
- deterministic tenure product from centralized definition-based compatibility rules;
- existing aggregate population;
- deterministic starter household cohorts sufficient to represent that population;
- initial assignments constrained by unit/resident capacity;
- initial current rents/prices from building definitions and observable current city conditions.

Migration must not fabricate historical:
- mortgages;
- displacement events;
- move histories;
- rent/price series;
- ownership equity.

New historical fields initialize to explicit neutral/current-state values. Existing owner product created by migration may be represented as mortgage-free legacy ownership or another explicitly documented neutral compatibility state; it must not invent historical loan terms.

### Save Validation
Reject corrupt state including:
- duplicate household IDs;
- orphaned building assignments;
- assignment to invalid/non-residential/non-occupied buildings except explicit displaced state;
- non-positive/non-finite cohort weights;
- invalid household worker/dependent relationships;
- negative/non-finite income, savings, housing costs, mortgage balances, rents, or prices where invalid;
- impossible mortgage terms/rates;
- physical unit conservation violations;
- occupancy above configured overcrowding ceiling;
- inconsistent renter/owner/available unit totals;
- population totals inconsistent with household weight x household size outside explicit transition state;
- invalid deterministic ID counters.

Housing-enabled V7 state must round-trip deterministically.

## Diagnostics

### Citywide Housing Snapshot
Expose at least:
- authoritative resident population;
- represented household count;
- household entity count;
- rental/owner shares;
- rental vacancy rate;
- for-sale inventory rate;
- weighted asking/effective rent;
- weighted estimated sale price;
- burden distribution;
- severely burdened households;
- overcrowded households;
- displaced/temporarily unhoused households;
- active searchers;
- recent in/out migration;
- turnover;
- buyer qualification rate;
- qualified renter/buyer pressure;
- aggregate redevelopment pressure.

### Per-Building Diagnostics
Expose:
- housing product;
- physical unit conservation breakdown;
- asking/effective rent and change;
- sale value and change;
- vacancy/inventory;
- renter/owner occupancy;
- applicant/buyer pressure;
- resident-income proxy;
- housing burden;
- quality/accessibility/habitability inputs;
- dominant price/rent drivers;
- redevelopment value comparison and blockers.

### Per-Household/Cohort Diagnostics
Expose:
- current building or unhoused status;
- tenure;
- income and housing cost;
- burden state;
- utility and dominant drivers;
- search state;
- top candidate/rejection reasons;
- move reason;
- displacement/out-migration reason.

## UI Scope
UI follows simulation correctness.

Initial UI:
- compact housing-market KPI panel;
- building-inspector housing ledger and redevelopment section;
- optional vacancy/affordability/market-pressure overlay if it fits existing rendering architecture cleanly.

No decorative statistics disconnected from authoritative state. Detailed demographic dashboards remain Phase 9.

## Performance Requirements
Acceptance target:
- at least 250,000 resident-equivalent population in a synthetic/headless housing scenario;
- stabilized household entity count remains low-thousands scale rather than one entity per actual household;
- bounded candidate search, never full all-to-all matching;
- explicit anti-explosion rules for splitting;
- deterministic merge-back after shocks;
- repeated identical stress runs produce identical snapshots/state hashes.

The implementation plan must choose a measurable entity-growth invariant based on actual benchmark behavior.

## Acceptance Test Matrix

### Determinism
1. Same state/seed/commands produce identical household assignments, prices, migration, and redevelopment outcomes.
2. Save/load at a market boundary produces the same future as uninterrupted simulation.

### Supply and Tenure
3. Housing-unit conservation holds for every building using the explicit product/occupancy equations.
4. A unit cannot be simultaneously rental-available and for-sale, or occupied by both renter and owner.
5. New projects persist their awarded tenure product and cannot frictionlessly flip product.
6. Legacy V7 buildings receive deterministic compatibility unit counts and tenure products.

### Rental Market
7. Sustained high rental vacancy lowers rents gradually.
8. Sustained qualified rental demand raises rents gradually within configured bounds.
9. Unsupported asking rents do not inflate realized developer revenue when effective rents are lower.

### Ownership
10. Higher mortgage rates reduce maximum qualified purchase price.
11. Insufficient down payment/reserve blocks purchase even when payment-to-income qualifies.
12. Mortgage principal amortizes deterministically and owner equity updates consistently.
13. For-sale inventory and qualified buyer depth affect achievable sale economics.

### Affordability and Choice
14. Hard-unaffordable housing is rejected even with superior neighborhood utility.
15. Moderate burden can be accepted when total utility improves enough to clear move friction.
16. Carless households prefer materially superior person/transit accessibility when otherwise comparable.
17. Larger households penalize undersized units/overcrowding.
18. Owners have greater move friction than renters, all else equal.

### Employment and Income
19. Job loss/material income decline increases burden and may trigger search.
20. Better labor outcomes increase qualified housing demand through household income, not a free global bonus.

### Adaptive Fidelity
21. Capacity/affordability divergence splits a cohort deterministically.
22. Compatible stabilized entities merge without changing conserved aggregates.
23. Entity growth remains bounded under repeated displacement/move shocks.

### Migration and Displacement
24. Positive residential demand without viable housing does not create population.
25. Displacement preserves household economic/preference state while forcing search.
26. Temporary unhoused households remain during the configured grace period and deterministically rehouse or out-migrate.
27. Sustained inability to secure viable housing can cause out-migration.

### Filtering
28. New supply produces at least one deterministic multi-step vacancy chain that creates an opportunity for a lower-income household in existing stock.

### Development and Redevelopment
29. Generic residential demand alone does not guarantee construction.
30. Stabilized effective rental revenue feeds rental-project underwriting.
31. Achievable sale proceeds and buyer depth feed for-sale-project underwriting.
32. An occupied low-intensity parcel redevelops only when replacement economics clear existing-use value, demolition/displacement/acquisition costs, developer hurdle, capital, and slot constraints.
33. Higher zoning capacity without sufficient economics does not force redevelopment.
34. Strong access and real housing pressure can raise residual land value through traceable inputs.

### Persistence
35. Existing V7 saves without housing state hydrate deterministically.
36. Migration does not fabricate historical loan/displacement/move history.
37. Housing-enabled V7 saves round-trip exactly.
38. Corrupt housing references, unit conservation, occupancy, or mortgage state are rejected.

### Regression and Scale
39. Pre-existing V7 tests remain green or change only where the documented population/housing authority transition intentionally changes behavior.
40. Tests, typecheck, lint, build, and smoke verification pass.
41. A 250,000-resident-equivalent headless stress test meets bounded entity/search invariants and repeats deterministically.

## Expected Implementation Boundaries
Likely additions/changes, refined by the implementation plan:
- `src/simulation/housing/HousingTypes.ts`
- `src/simulation/housing/HouseholdCohortSystem.ts`
- `src/simulation/housing/HousingSupplySystem.ts`
- `src/simulation/housing/HousingChoiceSystem.ts`
- `src/simulation/housing/HousingMarketSystem.ts`
- centralized housing configuration/data;
- residential building definitions extended with explicit housing-unit metadata;
- development award/building metadata extended with housing product where residential;
- a minimal Phase 6 wage/archetype extension;
- `SimulationCore` orchestration hooks;
- residential `DevelopmentFeasibilitySystem` market-input extension;
- V7 save/hydration/validation updates;
- diagnostics/UI integration;
- focused unit, integration, save, regression, and scale tests.

No unrelated rewrite is allowed.

## Completion Definition
This slice is complete when Civic Foundry no longer treats population and housing as superficial capacity scores. Residents exist as adaptive-fidelity household entities assigned to real housing; income and affordability constrain choices; rental and ownership supply are physically conserved and economically distinct; rents and prices evolve persistently; displacement, filtering, overcrowding, and migration have real consequences; housing-market outputs drive residential development and redevelopment; and the entire system is deterministic, inspectable, save-safe, and scalable.