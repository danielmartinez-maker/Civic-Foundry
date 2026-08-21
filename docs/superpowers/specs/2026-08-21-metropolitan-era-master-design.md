# Civic Foundry: Metropolitan Era — Master Expansion Design

## Status
Approved direction in chat on 2026-08-21. This document decomposes the expansion into independently testable phases. It does not authorize implementation of later phases until each phase has its own reviewed spec and plan.

## Product Goal
Evolve Civic Foundry from a detailed city simulator into a metropolitan strategy simulator without losing street-level causality. The player should be able to trace important outcomes through real simulation chains: households create trips, trips create congestion, congestion changes access, access changes land use and business costs, those changes alter migration, finance, and future infrastructure demand.

## Non-Negotiable Design Invariants
1. **Authoritative simulation, derived presentation.** UI never invents gameplay values.
2. **Determinism.** Same seed + same commands + same save state produces the same authoritative future state.
3. **Inspectable causality.** Important outcomes expose their causes, not only scores.
4. **Tiered fidelity.** Explicit agents only where behavior matters; cohorts and regional aggregates handle scale.
5. **No teleporting infrastructure effects.** Accessibility, freight, services, transit, and regional links depend on actual network connectivity and capacity.
6. **Phase-safe persistence.** Every phase advances the save schema with deterministic migration from the previous supported version.
7. **One owner per authoritative state domain.** SimulationCore orchestrates but does not become the data store for every subsystem.
8. **Performance budgets are acceptance criteria.** Every phase must include deterministic headless scale tests before it can be called complete.
9. **GitHub is canonical.** Every green milestone is published before the next begins.

## Scale Architecture
Civic Foundry will use three simulation resolutions:

### Tier A — Explicit entities
Use for vehicles, service fleets, transit vehicles, active incidents, construction projects, and other behavior where sequence and routing matter.

### Tier B — Cohorts
Use for households, workers, students, travelers, firm labor pools, and demographic groups. A cohort carries weight but still has explicit attributes and choices.

### Tier C — Regional aggregates
Use outside the detailed map for external labor markets, migration pools, import/export demand, neighboring municipalities, and intercity flows.

The target architecture must support a detailed city equivalent of at least 250,000 residents without requiring 250,000 fully microscopic citizen agents.

## Cross-Phase Domain Model
The expansion introduces six durable cross-phase domains that later phases extend rather than replace:

1. **Mobility** — road traffic, transit, walking connectors, parking, freight, intercity movement.
2. **Households** — housing, income, demographics, labor, schooling, travel demand.
3. **Firms** — establishments, labor, inputs/outputs, revenue, logistics, location decisions.
4. **Land & Development** — parcels, land value, rent, zoning envelope, developer decisions, construction.
5. **Government** — taxes, operating budgets, capital budgets, bonds, policies, departments, political constraints.
6. **Region** — external markets, neighboring municipalities, regional infrastructure, migration, trade.

SimulationCore remains the deterministic scheduler/coordinator. As these domains grow, large orchestration responsibilities must be delegated to focused schedulers (for example MobilityScheduler, EconomyScheduler, GovernmentScheduler) rather than adding unbounded logic to SimulationCore.

## Phase Program

### Phase 5 — Transit Revolution
Add real multimodal travel: bus, BRT, tram, metro, and the interfaces required for commuter rail/ferry later. Introduce stops, lines, schedules, depots, passenger queues, boarding, dwell times, capacity, transfers, generalized-cost route planning, weighted person-trip cohorts, and mode choice. Transit must measurably reduce/redistribute car traffic when it is competitive.

### Phase 6 — Firms, Production & Freight
Replace abstract employment with establishments and production. Add firms, industries, inputs/outputs, inventories, warehouses, stores, freight demand, trucks, external trade, logistics terminals, and business failure/formation. Congestion and access must affect business costs and location decisions.

### Phase 7 — Land, Housing & Development
Introduce parcels, land value, rents, vacancy, affordability, developer pro formas, zoning envelopes, density, mixed use, redevelopment pressure, and household housing choice. Development becomes endogenous rather than direct player placement inside zoned land.

### Phase 8 — Metropolitan Infrastructure
Add highways, ramps, bridges, tunnels, freight/passenger rail infrastructure, airports, seaports, grid substations/transmission, water mains, sewage, drainage, and major capacity constraints/failure modes. Infrastructure must have operating and maintenance requirements.

### Phase 9 — Demographic City
Add household cohorts, age structure, household formation, births/deaths, migration, income, education attainment, workforce skills, and long-horizon demographic change. Education affects future labor quality; housing and access affect demographic sorting.

### Phase 10 — Environment & Resilience
Add air pollution, water contamination, noise, heat, rainfall, drainage, flooding, drought, wildfire exposure, tree cover, emissions, and resilience investments. Environmental effects must feed health, land value, migration, and operating costs.

### Phase 11 — Municipal Government & Finance
Add operating/capital budgets, bonds, debt service, credit rating, grants, dedicated funds, maintenance backlogs, capital plans, and long-term fiscal stress. Infrastructure construction and maintenance become financially sequenced rather than instant purchases.

### Phase 12 — Politics & Public Opinion
Add elections, approval, council/factions, neighborhood opinion, project support/opposition, policy legitimacy, and political feasibility. Politics constrains execution but does not replace the underlying economic/physical simulation.

### Phase 13 — Construction & Megaprojects
Add planning, permitting, procurement, contractors, construction phases, work zones, material/labor demand, delays, cost overruns, and major multi-year projects. Construction itself creates traffic, employment, fiscal exposure, and temporary service disruption.

### Phase 14 — Regional Simulation
Add neighboring municipalities, cross-border commuting, regional labor/housing markets, shared infrastructure, annexation, regional authorities, regional transit, and intercity trade. Outside-map entities use Tier C aggregates unless directly relevant to the detailed city.

### Phase 15 — Specialized Economies & City Identity
Add tourism, universities/research, technology clusters, manufacturing clusters, logistics hubs, finance, energy, culture, sports/venues, historic districts, and agglomeration effects. Specialization must emerge from workforce, infrastructure, land, firms, and policy rather than flat bonuses.

### Phase 16 — Endgame, Scenarios & Modding
Add scenario editor, deterministic replay, challenge cities, achievements, long-horizon objectives, content-pack schemas, and safe data-driven mod support. Mods may add data/content first; arbitrary executable scripting is deferred until sandbox/security requirements are explicit.

## Dependency Order
Phase 5 → 6 → 7 → 8 is the critical mechanical spine. Phase 9 depends on 7. Phase 10 depends on 8/9. Phase 11 can begin after 8 but is strongest with 7–10. Phase 12 depends on 11. Phase 13 depends on 6/8/11. Phase 14 depends on 5/6/8/9. Phase 15 depends on 6/7/9/14. Phase 16 depends on stable save/data schemas across prior phases.

## Architectural Refactoring Policy
Expansion work may refactor files only when the new subsystem requires it. Two proactive boundaries are mandatory:
- `SimulationCore` becomes a coordinator over domain schedulers before it exceeds manageable orchestration complexity.
- `GameApp` becomes a shell over panels/tools/render layers rather than accumulating phase-specific UI logic indefinitely.

No unrelated rewrite is allowed. The proven road graph, road traffic, services, saves, and city loop remain functional while new domains are layered on top.

## Save-Version Program
- V5: transit and multimodal travel state
- V6: firms/freight/inventories
- V7: parcels/housing/development
- V8: metropolitan infrastructure networks
- V9: demographics/households
- V10: environment/resilience
- V11: government finance
- V12: politics/public opinion
- V13: construction projects
- V14: regional state
- V15: specialization/tourism/cluster state
- V16: scenario/mod metadata and deterministic replay support

Each migration must preserve old authoritative state and initialize genuinely new state transparently. No fabricated historical statistics.

## Global Acceptance Targets
By the end of Phase 16 the game should support:
- a detailed metropolitan city with 250k+ resident-equivalent population through cohort simulation;
- multimodal transportation where road, transit, freight, and regional access interact;
- endogenous housing and firm location decisions;
- traceable municipal finance and infrastructure obligations;
- geography/environment that materially changes optimal planning;
- regional economic interaction and specialization;
- deterministic save/load/replay suitable for scenarios and regression testing.

## What This Program Explicitly Avoids
- one fully simulated AI citizen per resident;
- fake random congestion/service/land-value numbers disconnected from state;
- flat specialization bonuses as the primary economic system;
- instant megaproject construction;
- arbitrary political events that ignore city conditions;
- replacing the existing proven systems wholesale when extension is possible.
