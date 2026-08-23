# Civic Foundry Phase 7 — Housing Market & Household Simulation Design

## Status
Approved in chat on 2026-08-22. This specification defines the next Phase 7 implementation slice on top of the canonical V7 (`0.7.0-metropolitan`) baseline on `main`.

This document authorizes implementation planning only after explicit user review. It does not supersede the Metropolitan Era master design; it refines the Phase 7 Land, Housing & Development program.

## Product Goal
Turn Civic Foundry's residential simulation from aggregate population growth plus static building capacity into a deterministic, endogenous housing market where households face real affordability, tenure, location, mobility, and displacement tradeoffs.

The system must create a causal chain that can be inspected from jobs and income through household housing decisions, rents and prices, vacancy, land value, redevelopment, new supply, filtering, displacement, and migration.

The intended primary loop is:

**firm employment -> household income -> housing affordability and choice -> building vacancy/rent/price -> residential market pressure -> developer achievable revenue and residual land value -> construction/redevelopment -> new housing supply -> household moves and migration**

## Scope Boundary
Phase 7 will use a hybrid household model that combines weighted household cohorts with selective explicit household-level state.

Phase 7 includes:
- household cohorts with explicit residential assignments;
- income, household size, worker count, dependent count, tenure preference, vehicle access, savings proxy, affordability, move friction, and displacement state;
- renter and owner-occupier housing;
- persistent building-level rents, effective rents, sale values, vacancy, occupancy mix, turnover, and market pressure;
- deterministic housing search, matching, moves, cohort splitting, and cohort recombination;
- employment-linked household income using a small wage bridge from Phase 6 firm archetypes;
- mortgage/down-payment affordability proxies;
- migration driven by jobs, housing availability, affordability, and residential utility;
- temporary displaced/unhoused household state;
- overcrowding;
- housing filtering through real vacancy chains;
- redevelopment pressure and occupied-parcel redevelopment economics;
- integration with the existing developer pro forma and competition systems;
- authoritative diagnostics and a compact housing-market UI/overlay after the simulation layer is green;
- V7 persistence extension and deterministic migration from older V7 saves;
- deterministic and scale acceptance tests.

Phase 7 explicitly defers:
- births, deaths, aging, retirement, household formation/dissolution, and full demographic lifecycle;
- education attainment and occupation/skill progression;
- detailed careers, promotions, layoffs by named worker, and long-term earnings histories;
- explicit banks, credit scores, mortgage servicing businesses, defaults/foreclosures, securitization, and household debt portfolios;
- welfare programs, rent control, housing vouchers, relocation mandates, and other detailed housing policy systems;
- detailed homelessness services;
- full household tax accounting and household consumption balance sheets.

Those systems belong primarily to later demographic, government, and finance phases.

## Design Principles
1. **Deterministic outcomes.** Same save state, commands, and seed must produce the same housing future.
2. **Explicit causality.** Housing outcomes must be explainable through economic and physical inputs rather than opaque scores.
3. **Adaptive fidelity.** Weighted cohorts are the default; the simulation splits them only when economically meaningful outcomes diverge.
4. **Bounded complexity.** Candidate search is bounded; cohorts merge after stabilization; the system must not degenerate into one object per real household.
5. **Real assignments.** Housing demand is represented by households assigned to real residential buildings, not only citywide occupancy percentages.
6. **Persistent market state.** Rents, prices, vacancy, mortgage proxies, tenure, and move state evolve over time instead of being recomputed statelessly each tick.
7. **Endogenous residential development.** Residential developer underwriting must increasingly depend on real achievable housing-market economics rather than generic demand alone.
8. **Phase-safe integration.** Existing Phase 5/6 mobility, firms, services, developer competition, and V7 saves remain functional during transition.

## Architecture

### HousingMarketSystem
`HousingMarketSystem` is the authoritative Phase 7 housing-domain scheduler and state owner. `SimulationCore` coordinates it but does not absorb its internal state.

Responsibilities:
- synchronize eligible residential supply;
- coordinate household economic updates;
- identify voluntary and involuntary movers;
- update rental and ownership market prices;
- perform deterministic candidate generation and matching;
- process moves, displacement, temporary unhoused states, and migration;
- compute citywide and building-level housing diagnostics;
- publish stabilized housing revenue and redevelopment signals to the developer market;
- snapshot and restore authoritative housing state.

### HouseholdCohortSystem
Owns weighted household entities and adaptive fidelity.

A household entity represents one or more statistically equivalent households. It may be a weighted cohort or a single explicit household when its weight reaches one.

Required authoritative fields include:
- `id`;
- `weight`;
- `householdSize`;
- `workers`;
- `dependents`;
- `grossIncome`;
- `disposableHousingIncome`;
- `employmentState` and employment stability proxy;
- optional employer/firm linkage where required for causality;
- `tenure` (`renter`, `owner`, `seeking`);
- `buildingId` when housed;
- `unitRequirement`;
- `vehicleAccess`;
- `liquidSavings` proxy;
- `downPaymentCapacity`;
- mortgage proxy for owners;
- current housing cost;
- rent/mortgage burden;
- affordability stress state;
- accessibility score;
- preference weights for affordability, commute/access, services, neighborhood quality, space, density, tenure, and stability;
- move friction;
- residence tenure duration;
- displacement risk/state;
- arrears/distress state;
- search state;
- last move reason;
- deterministic creation/split metadata as needed for stable IDs.

### HousingSupplySystem
Owns one persistent housing-market ledger for each eligible occupied residential building.

Required state includes:
- `buildingId`;
- nominal household units;
- nominal resident capacity;
- practical overcrowding ceiling;
- occupied household units;
- resident load;
- vacant units;
- renter occupancy;
- owner occupancy;
- asking rent;
- effective rent;
- prior rent;
- estimated sale price or per-unit value;
- vacancy duration;
- qualified applicant/search pressure;
- turnover;
- average/median resident income proxy;
- average housing-cost burden;
- quality score;
- accessibility score;
- habitability/distress modifier;
- realized rent growth;
- redevelopment pressure inputs and outputs.

### HousingChoiceSystem
Pure or near-pure deterministic housing-choice engine.

Responsibilities:
- filter hard-ineligible candidate units;
- calculate household-specific housing utility;
- calculate rental affordability;
- calculate ownership affordability and mortgage qualification;
- rank candidate housing using stable deterministic tie-breaking;
- determine whether an option clears move-friction thresholds;
- return explicit rejection reasons and dominant utility drivers for diagnostics.

### Income Bridge
Phase 6 labor allocation currently exposes filled jobs by firm but not wages. Phase 7 will add the minimum wage bridge needed to ground housing income in real economic state.

Firm archetypes receive deterministic wage schedules or wage indices. Household worker income is derived from:
- employment availability;
- linked firm archetype/sector when applicable;
- firm operating health/productivity as a bounded modifier;
- number of employed workers represented by the household/cohort.

The bridge must not introduce the full Phase 9 career/skill system.

## Adaptive Fidelity: Splitting and Recombination

### Split Triggers
A cohort splits when members represented by the same entity should experience meaningfully different outcomes. Valid triggers include:
- only a subset can afford a candidate unit;
- only a subset qualifies for ownership;
- capacity constraints allow only part of the cohort to move;
- employment changes affect a subset;
- redevelopment/displacement creates divergent rehousing outcomes;
- household-size or unit-fit thresholds divide the cohort;
- mortgage/down-payment thresholds divide the cohort;
- deterministic internal distribution boundaries imply different outcomes.

Splits must be derived from deterministic thresholds or deterministic proportions. No random sampling is permitted.

### Recombination
Compatible stabilized household entities may merge when they match on bounded dimensions such as:
- income band;
- household size;
- tenure;
- building assignment;
- employment state;
- vehicle access;
- affordability stress state;
- search state.

The merge policy must preserve aggregate population, household count, income, savings, and other conserved quantities within explicit tolerances.

### Scale Target
The system should represent a 250,000-resident-equivalent city with only a few thousand normal stabilized household entities, not hundreds of thousands of objects.

## Employment and Income
Household income must be connected to actual labor-market conditions.

Initial wage schedules may use archetype-relative bands such as:
- local retail/service: lower wage;
- wholesale/logistics: lower-middle wage;
- light manufacturing: middle wage;
- assembly/advanced manufacturing: middle-high wage.

Exact values belong in data/config rather than scattered literals.

Household income should respond to:
- number of employed workers;
- current labor allocation;
- firm archetype wage schedule;
- firm operating health/productivity within bounded limits;
- unemployment state.

Unemployed households may receive a bounded fallback-income proxy strictly to avoid pathological zero-income transitions before later government systems exist. This proxy must be explicit and configurable.

## Rental Market
Each residential building carries persistent asking and effective rents.

### Rent Pressure
Conceptually:

`rentPressure = vacancyPressure + qualifiedSearchPressure + incomeSupport + qualityPremium + accessibilityPremium - distressPenalty`

Inputs:
- occupancy relative to target occupancy;
- qualified applicants per available unit;
- incomes of households actually capable of renting the unit;
- neighborhood/service quality;
- person/job/transit accessibility;
- utilities and habitability;
- unresolved incidents, garbage, and severe service failures.

### Rent Adjustment
Rent changes are inertial:

`newAskingRent = oldAskingRent * (1 + boundedAdjustment)`

The initial design target is approximately +/-3% normal movement per 100-tick market-clearing cycle, with stronger downward movement allowed under severe vacancy or habitability failure. Exact coefficients must be centralized in housing-market configuration.

### Effective Rent
Effective rent differs from asking rent.

High vacancy and prolonged vacancy may produce concessions so:

`effectiveRent < askingRent`

Tight, high-demand buildings may realize approximately full asking rent.

Residential developer underwriting must use stabilized achievable effective rent, not merely posted asking rent.

## Ownership Market
Owner-occupied housing uses a stylized but consequential financing model.

### Sale Value
Estimated per-unit sale value is driven by:
- capitalized equivalent effective rent;
- neighborhood quality;
- accessibility;
- building quality;
- citywide ownership demand;
- market mortgage/development interest rate;
- vacancy and market liquidity.

Higher interest rates must reduce purchasing power even when rents remain high.

### Buyer Qualification
A buyer must satisfy:

**Cash constraint**

`downPayment + transactionReserve <= liquidSavings`

**Payment constraint**

`mortgagePayment / grossIncome <= maxDebtServiceRatio`

**Safety constraint**

`remainingSavings >= emergencyReserve`

Mortgage payments use the standard amortizing-loan payment equation with a configurable stylized term.

### Mortgage Proxy
Owner households store:
- original principal;
- remaining principal;
- interest rate;
- scheduled payment;
- purchase tick.

Principal amortizes at each household-economic cycle. The proxy exists to support affordability, equity, and move friction, not to model banking.

Owner equity proxy:

`equity = estimatedUnitValue - remainingMortgagePrincipal`

Equity may increase purchasing capacity for a later move.

## Housing Choice
Housing choice is household-specific.

Conceptual utility:

`U = affordability + spaceFit + commuteAccess + services + neighborhood + tenureFit + vehicleFit + densityFit + stability - movingCost - overcrowdingPenalty - displacementRisk`

Weights vary by cohort characteristics.

Examples:
- lower-income households weight affordability more heavily;
- households with more workers weight job accessibility more heavily;
- carless households strongly weight transit/walk/person accessibility;
- larger households penalize insufficient space;
- owners have higher move friction;
- density preference trades space against access.

### Housing-Cost Burden
Initial configurable bands:
- comfortable: under 25%;
- manageable: 25-35%;
- stressed: 35-50%;
- severely burdened: above 50%.

The utility penalty must be nonlinear. Severe burden may become a hard rejection for new moves even when the location scores highly on other dimensions.

## Search and Matching
Not every household evaluates every residence.

### Search Triggers
Households enter search because of events including:
- migration into the city;
- rent shock;
- job loss or material income change;
- overcrowding;
- ownership opportunity;
- poor commute/access;
- service or neighborhood deterioration;
- displacement;
- sustained affordability stress;
- sustained low residential utility.

### Candidate Generation
Candidate generation is deterministic and bounded. It should include, in order or weighted mixture:
1. affordable units;
2. units meeting minimum space requirements;
3. nearby/current-neighborhood alternatives;
4. high-access alternatives;
5. eligible ownership opportunities;
6. a bounded citywide fallback sample.

Stable IDs and deterministic ranking break ties.

### Move Threshold
A household moves voluntarily only when:

`newUtility - currentUtility > moveThreshold`

Move threshold increases with residence tenure and ownership to create realistic inertia.

Involuntary displacement bypasses this threshold.

## Migration and Population Authority
The housing market becomes authoritative for resident population.

`PopulationSystem.population` remains available to legacy consumers but is synchronized from household/housing state. `PopulationSystem.update()` must no longer independently create or remove residents once the housing market is active.

### In-Migration
Potential migrants are represented as deterministic external household cohorts. Their propensity to enter depends on:
- available housing;
- affordability;
- employment opportunities;
- wage conditions;
- accessibility;
- services;
- neighborhood quality.

A positive residential demand score cannot create population when there is no viable housing.

### Out-Migration
Households may leave after sustained:
- unemployment;
- severe housing burden;
- inability to find housing;
- displacement;
- poor service/habitability;
- low overall residential utility.

Migration must have persistence thresholds so a single bad cycle does not cause mass churn.

## Displacement and Temporary Unhoused State
When a residential building is removed or redeveloped, its occupants retain their economic and preference state and become involuntary searchers.

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
Residential supply distinguishes:
- nominal household units;
- nominal resident capacity;
- practical overcrowding ceiling.

Households may temporarily exceed ideal resident capacity within a bounded ceiling. Overcrowding increases:
- residential dissatisfaction;
- service demand pressure;
- search probability.

Overcrowding is not unlimited and cannot substitute permanently for housing supply.

## Housing Filtering
New supply must influence affordability through real vacancy chains rather than a flat global bonus.

When higher-income households move into new housing, their previous units become available to other households. Older or lower-quality stock should tend to become relatively cheaper unless location demand overwhelms depreciation/filtering effects.

Tests must demonstrate at least one deterministic multi-step vacancy chain where new supply indirectly creates an affordable opportunity in existing stock.

## Market Cadence
Housing processes operate at multiple deterministic cadences.

### Every 10 ticks — Building Conditions
- sync residential supply;
- refresh utility/service/accessibility inputs;
- update quality/habitability;
- detect demolition/removal and severe failures;
- flag involuntary movers.

### Every 50 ticks — Household Economics
- update employment-linked income;
- update housing cost burden;
- update mortgage amortization and savings proxy;
- update arrears/stress;
- identify search triggers.

### Every 100 ticks — Housing Market Clearing
- update asking rents and estimated sale prices;
- generate deterministic candidate sets;
- run renter and buyer matching;
- process moves;
- process temporary unhoused households;
- process bounded in/out migration;
- update vacancy, turnover, unmet demand, burden, and displacement diagnostics;
- run cohort merge-back.

### Every 250 ticks — Land and Redevelopment
- compute stabilized residential income;
- update building/land value signals;
- identify underbuilt parcels;
- evaluate replacement variants;
- publish economically viable redevelopment opportunities to the existing developer market.

This intentional lag allows shortages, price response, migration, and construction to unfold rather than clearing instantly.

## Redevelopment Economics
Redevelopment must compare the existing use with a replacement project.

Conceptually:

`existingUseValue = stabilizedNOI / marketCapRate`

`redevelopmentGain = newResidualLandValue - existingUseValue - demolitionCost - displacementCost`

A replacement project may proceed only when:
- zoning permits it;
- replacement feasibility clears physical/infrastructure constraints;
- redevelopment gain clears a minimum profit buffer;
- the developer's return clears its hurdle;
- the developer has sufficient capital and project slots under the existing `DeveloperMarketSystem`.

High-density zoning permits redevelopment; it does not force it.

### Displacement Cost Proxy
The economic displacement/acquisition friction may depend on:
- occupied household count;
- renter/owner mix;
- tenure duration;
- housing scarcity;
- relocation difficulty.

This proxy represents aggregate acquisition, vacancy, relocation, transaction, and delay costs until later policy systems distinguish them explicitly.

## Developer-Market Integration
For residential opportunities, `DevelopmentFeasibilitySystem` should increasingly consume authoritative housing-market outputs:
- stabilized achievable effective rent;
- comparable sale value;
- vacancy;
- qualified search demand;
- rent growth;
- ownership demand;
- affordability pressure;
- land value;
- redevelopment cost;
- displacement cost.

Generic `DemandSnapshot.residential` may remain as a compatibility/UI summary but must no longer be the primary proof of residential project viability.

Commercial and industrial development behavior should remain unchanged except where shared interfaces are generalized safely.

## Mobility and Service Integration
Household building assignments should eventually become the authoritative origins for person-trip generation. During this slice, integration may be staged so legacy trip generation remains functional while household-origin inputs are introduced behind a compatible interface.

Housing utility consumes authoritative accessibility/service outputs from existing systems. It must not invent independent network-distance or service-quality scores when authoritative values already exist.

## Persistence: V7 Extension
This work remains Phase 7, so the save version stays V7.

`SaveV7` gains an optional-to-read, required-to-write `housingMarket` snapshot after migration support lands.

The snapshot contains at least:
- household/cohort entities;
- residential building market ledgers;
- mortgage proxies;
- search/displacement state;
- citywide aggregate housing statistics that are authoritative rather than cheaply derivable;
- deterministic next-ID counters;
- housing-specific scheduler/random state if any deterministic generator requires it;
- migration state needed to reproduce future outcomes.

No housing randomness should be introduced unless it is seeded, explicitly persisted, and necessary. Stable deterministic allocation is preferred.

### Older V7 Migration
A V7 save without `housingMarket` must hydrate deterministically.

Migration may defensibly reconstruct:
- housing supply from existing occupied residential buildings;
- current aggregate population from existing V7 population state;
- deterministic starter household cohorts sufficient to represent that population;
- initial household assignments constrained by existing residential capacity;
- initial rent/price levels from building definitions plus observable current city conditions.

Migration must not fabricate:
- historical mortgages;
- historical displacement events;
- move histories;
- historical rent series;
- historical ownership equity.

New fields without defensible history initialize transparently to neutral current-state values.

### Save Validation
Reject corrupt state including:
- duplicate household/cohort IDs;
- orphaned residential building assignments;
- assignments to non-residential or non-occupied buildings unless explicitly represented as temporary displacement state;
- non-positive or non-finite cohort weights;
- invalid household-size/worker/dependent relationships;
- negative/non-finite income, savings, housing costs, mortgage balances, or prices where invalid;
- impossible mortgage terms/rates;
- unit allocation above the configured overcrowding ceiling;
- mismatched renter/owner occupancy totals;
- population totals inconsistent with household weights and household sizes beyond explicit migration transitional state;
- invalid next-ID counters.

V7 housing state must round-trip deterministically.

## Diagnostics and Inspectability

### Citywide Housing Snapshot
Expose at least:
- resident population from housing authority;
- household count represented;
- household entity count;
- renter share;
- owner share;
- vacancy rate;
- median/weighted asking rent;
- median/weighted effective rent;
- median estimated sale price;
- rent/mortgage burden distribution;
- severely burdened households;
- overcrowded households;
- temporarily unhoused households;
- displaced households;
- active searchers;
- recent in-migration;
- recent out-migration;
- turnover;
- ownership qualification rate;
- citywide qualified search pressure;
- aggregate redevelopment pressure.

### Per-Building Diagnostics
Expose:
- asking/effective rent and change;
- sale-value estimate;
- units, occupancy, vacancy, renter/owner mix;
- applicant pressure;
- resident-income distribution proxy;
- average housing burden;
- quality/accessibility/habitability inputs;
- dominant rent-change factors;
- redevelopment value comparison and blockers.

### Per-Household/Cohort Diagnostics
Expose:
- current building or unhoused status;
- tenure;
- income and housing cost;
- burden state;
- utility score and dominant positive/negative drivers;
- search status;
- top candidate/rejection reasons when searching;
- move reason;
- displacement/out-migration reason where applicable.

Diagnostics are authoritative simulation outputs and must be usable by tests and future UI.

## UI Scope
UI work follows simulation correctness.

Initial UI scope:
- compact housing-market panel with the core citywide KPIs;
- building inspector section for housing ledger and redevelopment pressure;
- optional housing overlay for vacancy/affordability/market pressure if existing rendering architecture supports it cleanly.

Do not add decorative charts or demographic dashboards that are not backed by authoritative state. Detailed demographic UI belongs to Phase 9.

## Performance Requirements
The housing market must support the Metropolitan Era scale architecture.

Acceptance target:
- at least 250,000 resident-equivalent population in a synthetic/headless housing stress scenario;
- normal stabilized household entity count remains in the low thousands rather than approaching one object per household;
- candidate matching is bounded and never performs an all-households x all-housing scan;
- cohort splitting has explicit anti-explosion safeguards;
- deterministic merge-back reduces fragmentation after shocks stabilize;
- repeated identical stress runs produce identical state hashes/snapshots.

Implementation planning must define a measurable entity-count ceiling or growth invariant for the stress test based on actual benchmark behavior.

## Acceptance Test Matrix
The implementation is not complete until tests demonstrate all of the following.

### Determinism
1. Same seed, save state, city state, and commands produce identical household assignments, rents, prices, migration, and redevelopment outcomes.
2. Save/load at a market-boundary tick produces the same future state as uninterrupted simulation.

### Rental Market
3. Sustained high vacancy lowers effective/asking rents gradually.
4. Sustained qualified demand raises rents gradually within configured per-cycle bounds.
5. Posted asking rent cannot support developer revenue if effective realized rent is materially lower.

### Affordability and Choice
6. A household rejects housing that violates hard affordability limits even if neighborhood utility is otherwise superior.
7. A moderately burdened household may rationally accept higher cost when total utility improves and the move threshold is cleared.
8. Carless households prefer materially better person/transit accessibility when otherwise comparable.
9. Larger households penalize undersized units and overcrowding.
10. Ownership creates greater move friction than renting, all else equal.

### Ownership
11. Higher mortgage rates reduce maximum qualified purchase price.
12. Insufficient down payment or reserve prevents purchase even when payment-to-income qualifies.
13. Mortgage principal amortizes deterministically and owner equity updates consistently.

### Employment and Income
14. Job loss or material income decline can increase housing burden and trigger search.
15. Better labor-market outcomes support higher qualified housing demand through actual household income rather than a free global bonus.

### Cohorts
16. Capacity/affordability divergence can split a weighted cohort deterministically.
17. Compatible stabilized household entities merge without changing conserved aggregate quantities.
18. Entity growth remains bounded under repeated move/displacement shocks.

### Migration and Displacement
19. Positive residential demand without viable housing does not create population.
20. Displacement preserves household economic/preference state while forcing search.
21. Temporarily unhoused households remain in population for the configured grace period and either rehouse or out-migrate deterministically.
22. Sustained inability to secure viable housing can cause out-migration.

### Filtering
23. New supply can create a deterministic multi-step vacancy chain that opens an existing unit to a lower-income household.

### Development and Redevelopment
24. Residential generic demand alone no longer guarantees construction.
25. Stabilized achievable effective rents feed residential developer underwriting.
26. An occupied low-intensity parcel redevelops only when replacement economics clear existing-use value, demolition/displacement costs, developer hurdle, capital, and slot constraints.
27. Higher zoning capacity without sufficient economics does not force redevelopment.
28. Strong access/rent pressure can increase residual land value and redevelopment pressure through traceable inputs.

### Persistence
29. Existing V7 saves without housing state hydrate deterministically.
30. Migrated saves do not fabricate historical mortgage/displacement/move history.
31. New housing-enabled V7 saves round-trip exactly.
32. Corrupt housing references and impossible allocation/mortgage state are rejected.

### Regression and Scale
33. All pre-existing V7 tests remain green or are updated only where the documented authority transition intentionally changes behavior.
34. Tests, typecheck, lint, build, and smoke verification pass.
35. A 250,000-resident-equivalent headless stress test meets the bounded entity/search invariants and is deterministic across repeated runs.

## Expected Implementation Boundaries
Likely new or expanded files include, subject to implementation-plan refinement:
- `src/simulation/housing/HousingTypes.ts`
- `src/simulation/housing/HouseholdCohortSystem.ts`
- `src/simulation/housing/HousingSupplySystem.ts`
- `src/simulation/housing/HousingChoiceSystem.ts`
- `src/simulation/housing/HousingMarketSystem.ts`
- housing configuration/data module;
- a small Phase 6 wage/archetype extension;
- `SimulationCore` orchestration hooks;
- residential `DevelopmentFeasibilitySystem` market-input extension;
- V7 save/hydration validation updates;
- diagnostics/UI integration;
- focused unit/integration/save/scale tests.

Large unrelated refactors are out of scope.

## Completion Definition
This slice is complete when Civic Foundry no longer treats residential population and housing as a superficial capacity score. Residents must exist as adaptive-fidelity household entities assigned to real housing; income and affordability must constrain their choices; rental and ownership markets must evolve persistently; displacement and migration must have real consequences; housing-market outputs must drive residential development and redevelopment economics; and the entire system must remain deterministic, inspectable, save-safe, and scalable.