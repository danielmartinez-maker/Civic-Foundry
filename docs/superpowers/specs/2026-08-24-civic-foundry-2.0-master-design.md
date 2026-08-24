# Civic Foundry 2.0 — Master Simulation Architecture

## Status

Approved direction in chat on 2026-08-24. This specification supersedes the 2026-08-21 Metropolitan Era master design as the strategic architecture for future development.

This document authorizes a progressive engine replacement program, not a clean-slate rewrite. Existing V7 behavior remains the compatibility baseline until an individual replacement subsystem passes its parity, determinism, persistence, performance and simulation-quality gates.

Each implementation tranche remains independently specified, planned, tested and reviewed before merging. This master design defines the target architecture, phase boundaries, invariants and migration strategy.

## Product Goal

Civic Foundry 2.0 is an original systems-heavy city, metropolitan and regional simulation in which important outcomes are produced by interacting physical, demographic, economic, institutional and political mechanisms rather than by disconnected scores.

The core causal chain is:

terrain and geography
→ infrastructure
→ accessibility
→ land economics
→ development
→ households and firms
→ employment and production
→ consumption and freight
→ travel and congestion
→ pollution and service demand
→ municipal finance
→ politics and policy
→ future infrastructure and development.

The player must be able to inspect both the current state and the causes that produced it.

## Scale Goal

Civic Foundry 2.0 targets roughly 120,000–180,000 lines of first-party TypeScript, tests and simulation tooling if the full program is completed. The line count is not itself an acceptance criterion; no phase may add inert code solely to increase repository size.

The target codebase should be larger in simulation complexity than the current Civic Foundry V7 baseline while remaining substantially more modular than a monolithic game runtime.

Normal source-file target: under 500 LOC.
Architecture warning: 750 LOC.
Review required: 1,000 LOC.
Exceptions are allowed for generated data or mechanically repetitive declarations, but not for orchestration logic.

## Non-Negotiable Invariants

1. **Determinism.** Same seed + same authoritative state + same ordered commands must produce the same authoritative future.
2. **One authoritative owner per domain.** Derived views may duplicate read models, never ownership.
3. **Presentation cannot manufacture simulation outcomes.** UI reads snapshots and emits typed commands.
4. **Explicit conservation.** Population, money, inventory, occupancy, cargo and other conserved quantities must reconcile.
5. **Inspectable causality.** Important metrics and state transitions expose their main causes.
6. **No teleporting network effects.** Mobility, utilities, freight and service outcomes require actual connectivity/capacity.
7. **Tiered fidelity.** Microscopic agents are used only when sequence and individual choice materially affect outcomes.
8. **Save compatibility is deliberate.** New versions migrate old authoritative state; derived state is rebuilt.
9. **No fabricated history.** Newly introduced historical series start at migration time unless the history is reconstructable exactly.
10. **Performance is a feature.** Every phase ships with scale and long-run performance gates.
11. **Simulation time is explicit.** Every subsystem declares cadence and may not silently depend on browser frame rate.
12. **No giant coordinator.** SimulationKernel coordinates ownership and scheduling; domain schedulers coordinate domain-local work.
13. **No domain-global random stream.** Randomness is namespaced and reproducible.
14. **Economic state is ledger-backed where money conservation matters.** Material value transfers must be traceable.
15. **Every replacement is reversible until proven.** Old implementations remain behind compatibility boundaries until the replacement is accepted.

## Simulation Fidelity Tiers

### Tier A — Explicit agents

Use when routing, sequence, capacity or individual state changes outcomes:

- active road vehicles;
- transit vehicles;
- emergency/service vehicles;
- active incidents;
- construction projects;
- selected freight vehicles;
- buildings and parcels;
- explicit market listings where required;
- megaprojects.

### Tier B — Weighted agents and cohorts

Use where heterogeneity matters but fully microscopic populations are unnecessary:

- households;
- workers;
- students;
- travelers;
- demographic groups;
- customer demand;
- labor pools;
- market-search cohorts.

Each cohort carries weight and explicit attributes. Splitting/merging must conserve weight and preserve deterministic aggregate state.

### Tier C — Regional aggregates

Use outside the detailed simulation map:

- external migration pools;
- neighboring municipalities;
- regional labor markets;
- regional housing supply;
- intercity freight demand;
- macroeconomic conditions;
- external finance and capital markets.

Tier C can promote flows into Tier A/B when they enter the detailed city.

# PHASE 0 — FOUNDRY KERNEL

Phase 0 creates the platform required for all later replacement phases.

## 0.1 SimulationKernel

Introduce `SimulationKernel` as the top-level authoritative orchestrator.

It owns no normal city-domain state. It owns:

- simulation clock;
- command ordering;
- system registration;
- scheduler graph;
- deterministic random-stream registry;
- domain-event journal;
- snapshot coordination;
- invariant execution;
- performance telemetry;
- replay checkpoints.

`SimulationCore` becomes a compatibility facade during migration. Existing callers may continue to use it while commands and snapshots are progressively delegated through the kernel.

## 0.2 Declarative scheduler

Each simulation system declares:

- read domains;
- write domains;
- cadence;
- prerequisites;
- invalidations;
- emitted events;
- deterministic ordering key.

The scheduler derives a stable execution order and rejects illegal write conflicts at registration time.

Example:

`HousingMarketClearingSystem`
reads households, housing inventory, jobs, accessibility and financing;
writes listings/leases/transactions;
runs daily;
emits `LeaseSigned`, `HomeSold`, `HouseholdUnhoused`.

## 0.3 CommandBus

Player and simulation mutations become typed commands.

Examples:

- BuildRoadCommand
- ZoneParcelCommand
- SetTaxRateCommand
- ApproveTransitLineCommand
- IssueBondCommand
- AdoptDevelopmentPolicyCommand

Commands carry deterministic sequence numbers. Domain owners validate and apply them.

## 0.4 DomainEventBus and event journal

Important transitions emit typed immutable events.

Examples:

- HouseholdMoved
- PersonHired
- FirmOpened
- BuildingCompleted
- CrashOccurred
- PropertySold
- BondIssued
- ParcelRezoned
- UtilityFailure
- ElectionResolved

The journal is diagnostic/replay infrastructure. It does not automatically become authoritative history for every domain.

## 0.5 Deterministic RNG registry

Randomness is split into stable named streams:

- demographics;
- firms;
- incidents;
- traffic;
- development;
- finance;
- weather;
- politics;
- environment;
- regional flows.

Adding a traffic random draw must not alter demographic outcomes.

## 0.6 EntityRegistry

Create stable typed entity identifiers and cross-domain reference validation.

Entity classes include:

- person/cohort;
- household;
- parcel;
- building;
- unit;
- firm;
- vehicle;
- facility;
- project;
- contract;
- network node/edge;
- government body.

Deletion and replacement rules must prevent orphan references.

## 0.7 SpatialIndex

Create a deterministic spatial query layer supporting:

- point-in-parcel;
- nearby facilities;
- buildings intersecting buffers;
- network attachment;
- neighborhood membership;
- flood/noise/pollution sampling;
- parcel frontage;
- corridor analysis.

The spatial index is derived and rebuildable.

## 0.8 EconomicLedger

Create a double-entry or equivalent conservation ledger for material money flows that must reconcile.

Accounts include:

- households;
- firms;
- developers;
- lenders;
- municipal funds;
- utilities;
- transit agencies;
- external region.

Not every informational value needs a ledger entry. Actual transfers do.

## 0.9 StatisticsEngine and HistoryStore

Provide typed time-series registration with explicit cadence and retention policy.

No UI panel maintains its own authoritative history.

Support:

- citywide metrics;
- district metrics;
- cohort metrics;
- firm/industry metrics;
- financial statements;
- network statistics;
- event-derived analytics.

## 0.10 Causality tracing

Systems may attach structured contribution vectors to derived outcomes.

Examples:

Residential demand 82:
+18 population growth;
+11 household formation;
+16 low vacancy;
+24 employment/accessibility;
+9 wage growth;
+7 local quality;
−3 financing.

The trace is diagnostic and must be computed from actual model inputs.

## Phase 0 acceptance

- Existing V7 deterministic regression suite remains green through the compatibility facade.
- Kernel scheduling is frame-rate independent.
- Stable RNG streams prove domain isolation.
- Event journal is deterministic across save/load.
- Economic ledger reconciles all migrated money-flow tests.
- Scheduler detects illegal write conflicts.
- Headless replay produces byte-equivalent authoritative snapshots after fixed commands.

# PHASE 1R — WORLD FOUNDATION 2.0

Replace the simple world foundation with a geographic simulation platform.

## 1R.1 Hierarchical geography

Authoritative hierarchy:

region
→ municipality
→ district
→ neighborhood
→ block
→ parcel
→ building
→ occupancy/unit.

Every lower entity has a stable parent reference. Boundaries may be edited only through explicit topology-changing commands.

## 1R.2 Terrain

Terrain samples include:

- elevation;
- slope;
- soil class;
- bearing/bedrock conditions;
- vegetation;
- groundwater;
- watershed;
- flood susceptibility;
- contamination;
- land-preparation cost.

Terrain affects road/building/infrastructure construction cost.

## 1R.3 Hydrology

Create a deterministic runoff model:

rainfall
→ infiltration/impervious runoff
→ drainage catchments
→ channels/river capacity
→ flood depth/exposure.

This phase establishes mechanics; advanced climate forcing arrives later.

## 1R.4 Geometry model

Roads, parcels and infrastructure corridors move toward explicit geometry rather than assuming all meaningful state is tile-aligned.

The renderer may remain Canvas 2D, but authoritative geometry must support:

- irregular parcels;
- curved/segmented roads;
- frontage length;
- parcel access points;
- bridge/tunnel segments;
- polygonal districts.

## 1R.5 World generation

Seeded generation creates topography, water, soil and initial administrative boundaries. Scenario files may override generation with authored data.

## Phase 1R acceptance

- Same seed produces identical geography.
- Hydrology conserves water within model tolerances.
- Spatial hierarchy validates references.
- Existing V7 maps migrate into a flat/default terrain representation with no gameplay loss.
- 10k+ parcel-equivalent spatial queries remain inside performance budget.

# PHASE 2R — URBAN FABRIC 2.0

Phase 2R replaces simplified zoning/lot/building assumptions with a durable parcel-and-building model.

## 2R.1 Parcels

Each parcel owns:

- geometry;
- frontage;
- access points;
- legal ownership;
- zoning envelope;
- assessed value;
- market value;
- improvement value;
- utility connections;
- easements;
- development history.

Parcels may split, merge, subdivide and assemble.

## 2R.2 Zoning envelope

Zoning becomes constraints rather than direct building recipes:

- allowed uses;
- FAR;
- lot coverage;
- maximum height;
- setbacks;
- minimum frontage;
- parking rules;
- mixed-use permissions;
- density bonuses;
- overlays/historic/environmental restrictions.

## 2R.3 Buildings

Buildings contain:

- structure;
- footprint;
- floors;
- gross/usable area;
- use components;
- units/suites;
- condition;
- age;
- quality;
- parking;
- utility connections;
- owner;
- occupants/tenants.

Mixed use is first class.

## 2R.4 Building lifecycle

vacant parcel
→ proposal
→ approval
→ construction
→ lease-up
→ stabilized occupancy
→ renovation/maintenance
→ deterioration
→ conversion/redevelopment
→ demolition.

Condition declines when maintenance is underfunded. Severe deterioration can create vacancy, code violations or abandonment.

## 2R.5 Land assembly

Development may require multiple parcels. Acquisition and holdout logic are represented explicitly.

The system must be deterministic and bounded; it does not need negotiation dialogue.

## Phase 2R acceptance

- All V7 buildings and lots migrate into valid parcel/building entities.
- Mixed-use occupancy conserves floor area and capacity.
- Parcel split/merge preserves geometry and ownership value within tolerance.
- No building may occupy nonexistent parcel area.
- Construction state survives save/load exactly.

# PHASE 3R — TRANSPORTATION ENGINE 2.0

Replace aggregate road assumptions with a lane-aware multimodal street engine while preserving deterministic pathfinding principles.

## 3R.1 Road hierarchy

Support local streets, collectors, arterials, avenues, expressways and highways.

Each segment contains:

- lanes;
- direction;
- speed;
- vehicle permissions;
- turn restrictions;
- parking;
- bike facilities;
- transit priority;
- tolls;
- condition;
- incident state.

## 3R.2 Lane model

Represent through, turn, bus, bike, parking, reversible and shoulder lanes where applicable.

Lane-changing may remain behaviorally aggregated where microscopic simulation adds no gameplay value, but intersection queueing and capacity must reflect lane configuration.

## 3R.3 Intersections

Intersections own movement groups and conflict matrices.

Signals support:

- phases;
- cycle length;
- protected turns;
- offsets;
- pedestrian timing;
- adaptive timing policies.

## 3R.4 Dynamic route choice

Generalized route cost includes:

- predicted travel time;
- current/experienced congestion;
- toll;
- incident delay;
- parking access;
- traveler-specific preferences where applicable.

Vehicles may reroute at bounded decision points rather than every tick.

## 3R.5 Trip causality

Trips are generated by actual activities and economic/service relationships:

home→work;
home→school;
home→shopping;
firm→supplier;
warehouse→customer;
incident→facility;
construction→supplier.

## 3R.6 Parking

Parking inventory becomes explicit:

- curb spaces;
- private spaces;
- lots;
- garages;
- prices;
- occupancy;
- cruising penalty.

## 3R.7 Crashes and disruption

Crash probability responds to speed, volume, geometry, weather and control type. Crashes can block capacity and create service incidents.

## Phase 3R acceptance

- Traffic volume is conserved across valid network movements.
- Destroyed/edited road topology invalidates routes deterministically.
- Congestion responds directionally to lane/signal/capacity changes.
- Parking scarcity creates measurable generalized-cost effects.
- Existing V7 road maps migrate to equivalent default lane configurations.

# PHASE 4R — CIVIC INSTITUTIONS 2.0

Replace coverage-oriented public services with operating institutions.

## 4R.1 Facility operations

Each facility owns:

- physical capacity;
- staffing requirements;
- current staffing;
- equipment/fleet;
- operating budget;
- service queue;
- service quality;
- catchment/accessibility;
- maintenance/condition.

## 4R.2 Healthcare

Hospitals and clinics model beds, staff, treatment capacity, ambulance intake and wait times.

## 4R.3 Education

Schools model teachers, classrooms, enrollment, capacity, class size, quality, graduation/attainment contribution and operating cost.

## 4R.4 Police/fire/EMS

Dispatch becomes an explicit chain:

incident creation
→ dispatch decision
→ unit assignment
→ route
→ scene service
→ transport/clearance
→ resource recovery.

## 4R.5 Waste

Waste generation, collection, transfer, recycling, landfill and treatment capacities become linked logistics operations.

## Phase 4R acceptance

- Facility capacity cannot exist without required staffing/equipment.
- Service outputs are route and queue dependent.
- Emergency resource assignment cannot double-book a unit.
- Staffing changes measurably affect service outcomes.
- V7 facility/service state migrates without losing placed assets.

# PHASE 5R — MOBILITY & TRANSIT 2.0

Expand existing multimodal transit into schedule-based operations and heterogeneous traveler choice.

## 5R.1 Modes

Support walking, cycling, private car, taxi/ride-hail, bus, trolleybus, BRT, tram, metro, commuter rail, regional rail and ferry where geography supports them.

## 5R.2 Traveler utility

Mode choice may depend on:

- in-vehicle time;
- waiting;
- transfer penalty;
- reliability;
- fare;
- fuel;
- toll;
- parking;
- comfort;
- accessibility;
- traveler income and preferences.

## 5R.3 Scheduled operations

Vehicles own runs and operating schedules. Delay propagates through runs and may create bunching or missed transfers.

## 5R.4 Depots and fleet

Fleet requires depots, storage and maintenance capacity. Unavailable vehicles reduce realized service.

## 5R.5 Passenger queues

Queues remain conservation-safe with weighted cohorts, partial boarding, transfers, left-behind passengers and accessibility requirements.

## Phase 5R acceptance

- Passenger weight is conserved.
- Timetable delay propagates deterministically.
- Fleet/depot constraints limit actual departures.
- Competitive transit measurably removes/redistributes car trips.
- V7 transit lines migrate to valid service plans.

# PHASE 6R — ECONOMY 2.0

Replace the compact three-commodity economy with a configurable urban/regional input-output economy.

## 6R.1 Sector system

Initial sectors should cover at minimum:

- agriculture/extractive external supply;
- food processing;
- construction materials;
- steel/metals;
- machinery;
- automotive/manufacturing;
- logistics/warehousing;
- wholesale;
- retail;
- hospitality;
- finance;
- professional services;
- software/technology;
- healthcare;
- education;
- culture/entertainment.

The exact sector list is data driven.

## 6R.2 Input-output production

Products/services have recipes linking intermediate inputs, labor, capital, energy and logistics.

Examples:

automotive assembly = metals + electronics + plastics + skilled labor + energy + logistics;
restaurant output = food + labor + utilities + commercial space;
construction = materials + machinery + labor + finance.

## 6R.3 Firm accounts

Firms track:

- revenue;
- cost of goods;
- payroll;
- rent;
- utility cost;
- logistics cost;
- taxes;
- interest;
- capital expenditure;
- cash;
- debt;
- profit/loss.

Material cash transfers post to the economic ledger.

## 6R.4 Labor markets

Labor clears by skill/occupation/location rather than one homogeneous pool.

Vacancies influence wages. Commute/accessibility influences matching.

## 6R.5 Entrepreneurship and business dynamics

Formation depends on opportunity, capital, workforce and local demand. Firms may expand, contract, relocate, automate, become distressed or close.

## 6R.6 Supply chains and freight

Supplier choice uses generalized delivered cost including production price, distance, congestion, reliability and inventory risk.

## Phase 6R acceptance

- Money and inventory conservation reconcile.
- Firms cannot consume inputs they do not possess.
- Labor allocated does not exceed worker supply or job demand.
- Congestion can measurably alter delivered cost and firm profitability.
- V7 firms/inventories map into transitional sectors without fabricated financial history.

# PHASE 7R — REAL ESTATE CAPITALISM 2.0

Phase 7R replaces aggregate housing/property signals with explicit ownership, listings, transactions and development finance while preserving the strongest current V7 redevelopment safeguards.

## 7R.1 Ownership

Properties may be owned by:

- households;
- landlords;
- developers;
- firms;
- institutional investors;
- government.

Ownership transfers are authoritative events.

## 7R.2 Housing inventory and units

Residential buildings contain explicit or weighted units by type/quality/tenure.

Units can be:

- owner occupied;
- rented;
- listed for rent;
- listed for sale;
- vacant;
- unavailable/under renovation.

## 7R.3 Rental market

Landlords post asking rents. Households search and rank available units. Vacancy and realized leases feed market repricing.

## 7R.4 For-sale market

Properties use asking prices, bids/offers, transactions and appraisal/market comparables.

Market indexes become derived from actual transactions plus bounded fallback appraisal models where transaction volume is thin.

## 7R.5 Mortgages and household finance

Home purchases consider:

- down payment;
- borrower income;
- debt service;
- interest rate;
- loan term;
- LTV;
- qualification constraints.

Monthly owner cost includes financing, taxes, insurance and maintenance.

## 7R.6 Developer finance

Projects model:

- land acquisition;
- demolition;
- hard costs;
- soft costs;
- fees;
- financing;
- interest carry;
- schedule;
- lease-up/sales;
- NOI;
- cap rate/value;
- debt/equity split;
- IRR/equity multiple;
- lender constraints.

## 7R.7 Developers, lenders and contractors

Developers own capital and pipelines.
Lenders underwrite loans.
Contractors supply construction capacity.

Construction booms can create labor/material scarcity, increasing project cost and delay risk.

## 7R.8 Planning and approval

Projects pass deterministic stages:

concept
→ zoning compliance/variance
→ planning review
→ permit
→ financing close
→ construction.

Public-hearing/political constraints are extended in later phases.

## 7R.9 Redevelopment and displacement

Current V7 strengths are preserved and generalized:

- occupied-parcel safeguards;
- relocation capacity checks;
- lower-income protection;
- developer commitment protection;
- demolition/displacement cost;
- conservation-safe relocation.

Replacement development must not bypass household occupancy state.

## Phase 7R acceptance

- Every occupied residential unit belongs to exactly one valid occupancy state.
- Every ownership transfer reconciles buyer/seller/ledger state.
- Mortgage balances amortize deterministically.
- Rental and sale markets clear without duplicate allocation.
- Construction projects cannot exceed developer/contractor/lender constraints.
- V7 aggregate housing cohorts migrate deterministically into weighted household/unit representations without inventing past transactions.

# PHASE 8 — HOUSEHOLDS & PEOPLE

End reliance on citywide aggregate population as the primary demographic state.

Represent people/weighted people with age, education, occupation, employment, income, health and household membership.

Households own income, savings/debt, vehicles, housing tenure, children/dependents, preferences and relocation constraints.

Life-cycle processes include:

- birth;
- schooling;
- graduation;
- household formation;
- partnership/separation;
- employment/unemployment;
- migration;
- retirement;
- death.

Demographics drive housing, labor, service and travel demand.

# PHASE 9 — METROPOLITAN INFRASTRUCTURE NETWORKS

Create explicit utility and major infrastructure graphs.

Electricity:
generation → transmission → substation → distribution → load.

Water:
source → treatment → storage → pumping → distribution.

Wastewater:
collection → pumping → treatment → discharge/reuse.

Drainage:
catchment → inlet → pipe/channel → detention/outfall.

Telecommunications:
backbone → exchange/node → local coverage.

Infrastructure owns capacity, condition, maintenance, failures and upgrade state.

# PHASE 10 — ENVIRONMENT & CLIMATE

Add air pollution, water quality, noise, urban heat, energy use, emissions, rainfall, drought, flooding, wildfire exposure, tree cover and resilience investments.

Environmental effects feed health, land value, migration, operating cost and political opinion.

# PHASE 11 — MUNICIPAL GOVERNMENT & FINANCE

Implement fund accounting, operating/capital budgets, assessments, taxes, fees, grants, bonds, debt service, credit quality, pensions/long-term liabilities, maintenance backlogs and capital planning.

A city may be cash-positive in the short run while accumulating unsustainable liabilities.

# PHASE 12 — POLITICS & PUBLIC OPINION

Residents form preferences from actual conditions.

Add mayoral elections, council districts, approval, neighborhood organizations, project support/opposition, ballot questions, policy coalitions and political feasibility.

Politics constrains choices but never replaces underlying physical/economic mechanics.

# PHASE 13 — PLANNING LAW

Expand land regulation into a policy system including zoning maps, FAR/height/setback rules, mixed use, parking rules, historic overlays, environmental review, impact fees, inclusionary rules, density bonuses and transferable development rights.

The player may reform the development code itself.

# PHASE 14 — CONSTRUCTION & MEGAPROJECTS

Major infrastructure uses design, engineering, land acquisition, procurement, contractor mobilization, construction stages, work zones, budget, schedule, delay and cost-overrun risk.

Megaprojects create temporary traffic, labor demand, material demand and fiscal exposure.

# PHASE 15 — REGIONAL SIMULATION

The detailed city exists inside a lower-fidelity region with neighboring municipalities, external housing/labor markets, regional transport, freight gateways, ports/airports, tourism and intermunicipal flows.

Cross-boundary commuting and business location decisions become endogenous.

# PHASE 16 — AGGLOMERATION & CITY IDENTITY

Economic specialization emerges from workforce, suppliers, infrastructure, institutions, land economics and policy.

Support endogenous clusters such as manufacturing, logistics, technology, finance, universities/research, tourism/culture and energy.

# PHASE 17 — SOCIAL OUTCOMES

Model inequality, poverty, housing burden, displacement, homelessness, segregation, educational attainment, health outcomes, social mobility and crime risk as emergent results of household/economic/service conditions.

# PHASE 18 — INSTITUTIONAL DECISION SYSTEMS

Major non-player actors use bounded deterministic decision models:

- households pursue utility under budget constraints;
- firms pursue survival/profit/growth;
- developers pursue risk-adjusted returns;
- lenders pursue credit constraints;
- transit agencies pursue service targets under budgets;
- departments pursue service targets;
- politicians pursue coalitions/reelection.

No conversational/LLM dependency is required.

# PHASE 19 — CITY ANALYTICS & EXPLAINABILITY

Build an urban observatory over the StatisticsEngine and causality traces.

Expose historical and spatial analytics for:

- population and migration;
- employment/wages;
- GDP/output;
- firms and sectors;
- housing prices/rents/vacancy;
- construction;
- traffic and OD flows;
- transit ridership/reliability;
- pollution/environment;
- taxes/budgets/debt;
- services;
- inequality/social outcomes.

The player can inspect `Why?` explanations for important changes.

# PHASE 20 — SCENARIOS, EDITOR, REPLAY & MODDING

Make static definitions data driven where safe:

- world/scenario setup;
- buildings;
- road types;
- industries/products;
- services;
- policies;
- transit vehicles;
- economic parameters.

Add scenario editor, deterministic replay, challenge definitions and safe content-first mod support.

Executable scripting remains deferred until sandbox/security constraints are explicit.

# CROSS-CUTTING ARCHITECTURE

## Domain layout target

```text
src/
  kernel/
  entities/
  spatial/
  geography/
  parcels/
  buildings/
  households/
  demographics/
  mobility/
  traffic/
  transit/
  infrastructure/
  firms/
  economy/
  freight/
  real-estate/
  construction/
  services/
  environment/
  finance/
  government/
  politics/
  region/
  analytics/
  scenarios/
  persistence/
  presentation/
  ui/
```

This is a target boundary map, not a requirement to create empty directories prematurely.

## Data flow

Player/UI command
→ CommandBus
→ authoritative domain mutation
→ invalidation/revision
→ scheduled simulation systems
→ domain events/ledger postings
→ authoritative state
→ derived indexes/statistics/causality
→ immutable snapshot
→ renderer/UI.

## Network registry

Road, transit, electricity, water, wastewater, drainage and telecom remain separate typed networks. A shared `NetworkRegistry` may provide common topology/version/query primitives without pretending all networks have the same semantics.

## Derived-state policy

Persist authoritative state only when reconstructing it would lose information.

Normally derived and rebuilt:

- route caches;
- spatial indexes;
- rendering geometry;
- accessibility surfaces;
- heatmaps;
- market indexes derived from transactions;
- statistical rollups that can be regenerated from retained history;
- planner diagnostics.

## Save-version strategy

V7 remains the historical compatibility baseline.

Civic Foundry 2.0 uses versioned migrations by accepted tranche rather than reserving one save version per aspirational phase.

Every migration must:

1. validate source state;
2. preserve existing authoritative facts;
3. initialize genuinely new state transparently;
4. avoid fabricated historical transactions/events;
5. rebuild derived state;
6. pass save→load→continue equivalence tests.

## Compatibility-facade strategy

`SimulationCore` and existing public APIs remain usable during progressive replacement.

For each domain:

1. freeze current V7 behavior as regression fixtures;
2. introduce new domain interfaces;
3. run legacy and replacement implementations against shared scenarios where possible;
4. compare invariants and player-visible outcomes;
5. migrate persistence;
6. switch authoritative ownership;
7. remove legacy implementation only after acceptance.

# TESTING PROGRAM

Testing is expected to account for approximately 30–40% of new first-party implementation where appropriate.

## Unit tests

Pure formulas, state transitions, ledgers, geometry, economic models, finance and deterministic decision logic.

## Integration tests

Cross-domain chains such as:

road closure → commute delay → worker matching decline → wage pressure → firm margin decline;

new transit → generalized-cost reduction → mode shift → accessibility gain → land-value change → development response;

construction boom → contractor scarcity → cost inflation → fewer feasible projects;

property-tax increase → household/firm cost → municipal revenue → development/relocation effects.

## Invariant tests

At minimum:

- population weight never becomes negative;
- housed + unhoused/unplaced population reconciles;
- occupancy never exceeds capacity;
- inventory cannot become negative;
- cargo is delivered/cancelled exactly once;
- cash transfers reconcile;
- firm jobs cannot exceed job capacity;
- labor allocated cannot exceed available labor;
- vehicles cannot occupy deleted networks;
- one service unit cannot be assigned to simultaneous incompatible incidents;
- one housing unit cannot have duplicate active occupancy;
- one property cannot have conflicting ownership;
- developer committed capital cannot be spent twice;
- loan principal cannot become negative;
- utility load cannot receive capacity from disconnected assets.

## Deterministic replay

Same save, seed and command journal must produce identical authoritative snapshots.

Cross-version migration fixtures must continue deterministically after upgrade.

## Long-run simulation

CI tiers should include deterministic runs equivalent to:

- 1 simulated day;
- 1 month;
- 1 year;
- 10 years;
- 50 years.

The longest runs may be scheduled rather than per-commit if CI cost requires it.

Failures include:

- NaN/Infinity;
- population explosions/collapse caused by numerical defects;
- phantom money;
- orphan references;
- impossible occupancy;
- stuck queues;
- route-cache corruption;
- save divergence;
- runaway memory growth;
- system-order dependence outside declared dependencies.

## Property-based/fuzz tests

Use bounded generated city configurations and command sequences to stress geometry, networks, saves, ownership, markets and ledgers.

# PERFORMANCE PROGRAM

Performance budgets are measured headlessly and, separately, in the browser.

Targets must be refined using baseline hardware, but every phase must report:

- simulation milliseconds per tick/cadence;
- entity/cohort counts;
- pathfinding volume/cache hit rate;
- memory use;
- save size and save/load time;
- UI/render frame time for representative cities.

The architecture must scale through tiered fidelity, bounded decision cadence, spatial indexes, revisioned caches and cohort aggregation rather than by skipping causal systems entirely.

# IMPLEMENTATION ORDER

The critical path is:

Phase 0
→ 1R
→ 2R
→ 3R
→ 4R
→ 5R
→ 6R
→ 7R
→ 8
→ 9
→ 10
→ 11
→ 12
→ 13–20 according to dependencies.

However, after Phase 0 stabilizes, independent replacement work may be parallelized when domains do not share authoritative state or unfinished interfaces.

Suggested internal parallelism examples:

- terrain/hydrology vs kernel telemetry after stable interfaces;
- road-lane data model vs signal-control algorithms;
- hospital operations vs education operations;
- firm accounting vs sector data definitions;
- rental market vs mortgage amortization;
- analytics UI vs simulation metrics after snapshot contracts stabilize.

Parallel work must not create competing owners for the same domain.

# PHASE COMPLETION GATE

A phase is complete only when all applicable conditions hold:

1. approved phase-specific design;
2. approved implementation plan;
3. tests written first for material behavior changes;
4. implementation complete;
5. typecheck/lint/build green;
6. unit/integration/invariant suites green;
7. deterministic save/load/replay green;
8. relevant migration fixtures green;
9. performance budget met;
10. browser smoke tests green where presentation changed;
11. documentation updated;
12. architecture file updated;
13. legacy path removed only if replacement has passed parity/acceptance;
14. verification evidence recorded before claiming completion.

# FIRST EXECUTION TRANCHE

The first implementation tranche is **Phase 0A — Kernel Skeleton & Deterministic Scheduling**.

Its phase-specific design must cover:

- SimulationKernel API;
- compatibility relationship with SimulationCore;
- system registration contract;
- deterministic scheduler ordering;
- typed domain declarations;
- RNG registry;
- command sequencing;
- domain-event journal skeleton;
- invariant runner;
- minimal snapshot hooks;
- migration strategy requiring no V7 save-schema change unless authoritative state is added.

Phase 0A must not yet migrate gameplay domains. Its purpose is to introduce the architecture under the existing V7 simulation and prove that the compatibility baseline remains exact.

# EXPLICITLY OUT OF SCOPE FOR THE FIRST TRANCHE

- household micro/weighted-agent conversion;
- new terrain generation;
- lane simulation;
- new transit modes;
- input-output economy;
- mortgage market;
- politics;
- environment;
- regional simulation;
- major UI redesign.

Those are subsequent reviewed tranches.

# DEFINITION OF CIVIC FOUNDRY 2.0 SUCCESS

Civic Foundry 2.0 succeeds when the city behaves as an interconnected system rather than a collection of independent meters.

A player should be able to follow chains such as:

zoning reform
→ more feasible floor area
→ developer bids
→ contractor demand
→ construction
→ housing supply
→ rent response
→ household relocation
→ commute pattern change
→ traffic/transit demand
→ fiscal/service implications
→ political response.

Or:

factory expansion
→ labor demand
→ wage pressure
→ migration
→ housing demand
→ rent increase
→ development
→ freight growth
→ road congestion
→ logistics cost
→ future firm profitability.

The simulator must make those chains deterministic, measurable, inspectable and testable.

That—not raw repository size—is the engineering objective of Civic Foundry 2.0.
