# Civic Foundry

Civic Foundry is an original browser-based city-management and urban-development simulator built as deterministic vertical slices.

## Canonical baseline

**V7 (`0.7.0-metropolitan`) is the canonical development baseline on `main` moving forward.** Older V5/V6 serializers and hydrators remain supported for compatibility and migration testing, but new development should target the V7 simulation/save contract unless a later version explicitly supersedes it.

The V7 baseline contains the reverified rebuild through **Phase 6 — Firms, Production & Freight** plus the deterministic Phase 7 developer pro-forma/competition, derived property-market, aggregate housing-affordability/choice and residential redevelopment-pressure slices.

Implemented in the V7 baseline:

- deterministic terrain, simulation clock, treasury, construction costs and save/load
- local, collector and arterial roads with intersections and graph revisions
- R/C/I zoning, road-frontage lots, construction, population, employment and taxes
- road-connected power/water plus recurring city finance
- deterministic transportation graph, A* routing and revision-aware route cache
- weighted commute/shopping traffic, moving vehicles, queues and real congestion
- fire, police, healthcare, education, routed garbage collection and public-service budgets
- explicit fire engines, patrol cars, ambulances and garbage trucks using the road graph
- seeded fire/police/medical incidents, network-based service accessibility, school capacity and detailed building waste
- bus, BRT, tram and metro transit topology with ordered stops, headways, fares, enablement and fleet limits
- deterministic multimodal journey planning and weighted car/transit mode choice
- FIFO passenger queues, partial boarding, transfers, capacity constraints and left-behind passengers
- explicit transit vehicles, scheduled dispatch, dwell, road-sensitive surface service and insulated metro timing
- transit operating cost, fare revenue, reliability, crowding, mode share and person accessibility feeding city outcomes
- Phase V transit build/configuration tools, HUD metrics, inspectors, vehicles and numeric overlays
- establishment-based commercial/industrial firms with deterministic formation, labor allocation, operating health, distress and closure
- conservation-safe inventories and the explicit `industrial_inputs → manufactured_goods → consumer_goods` production chain
- boundary-derived freight gateways, imports/exports, generalized-cost supplier matching, queued freight orders and explicit weighted trucks
- freight congestion/logistics feedback into shortages, output, firm economics, employment and city demand
- Phase VI economy/freight HUD metrics, firm inspection, nine diagnostic overlays and authoritative freight-agent rendering
- multiple deterministic building variants by zone and intensity
- explicit derived residential/commercial/industrial property markets with bounded pressure, rent, vacancy and land-value indexes
- parcel market signals that combine zone conditions with local person/freight access, services, neighborhood quality, utilities and frontage
- deterministic aggregate lower/middle/upper income-band housing choice across occupied residential buildings
- physical housing capacity separated from effective affordable capacity, with affordability, rent burden, cost-burdened residents and unplaced-resident diagnostics
- effective affordable capacity feeding the existing residential-demand channel while affordability applies only a bounded migration-attractiveness modifier and raw physical capacity remains the population hard cap
- occupied residential redevelopment-pressure diagnostics comparing current use value with feasible higher-intensity replacements, demolition cost and resident displacement burden without automatic demolition
- parcel underwriting using market rent/vacancy/land value, taxes, service/utility/accessibility, construction cost, financing, stabilized value, return and residual land value
- deterministic competing developers with distinct hurdle rates, leverage, capital, risk tolerances and zone preferences
- explicit development awards, owner/finance metadata, capital commitments, cancellation recovery and post-stabilization capital recycling
- infrastructure, market economics and developer-hurdle gating that prevents automatic uneconomic development
- Save V7 with exact developer-capital/commitment continuation and Save V6 economy/freight continuation; property markets, housing choice and redevelopment pressure remain derived and require no save-schema expansion

## Toolchain

The project intentionally uses an offline-capable dependency-light stack:

- TypeScript 5.x ES modules
- Node 22 built-in test runner with TypeScript strip-types
- browser-native Canvas 2D
- global `tsc`
- Python Playwright + system Chromium for browser smoke testing

No runtime npm dependency is required.

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run dev
```

`npm run build` produces `dist/`. `npm run dev` serves the compiled build on port 5173 when local navigation is permitted.

## Architecture rule

`SimulationCore` composes focused authoritative systems. `MobilityScheduler` owns multimodal update order, `EconomyScheduler` owns Phase 6 firms/inventories/production/freight/trade/business lifecycle state, and the Phase 7 development/housing domain owns derived property-market signals, aggregate housing allocation, redevelopment diagnostics, parcel feasibility and deterministic developer allocation. Rendering/UI reads snapshots and submits typed mutations through public APIs; it does not manufacture simulation outcomes.

Road traffic, transit attractiveness, service access, demand, finance, property-market conditions, affordability and development economics are coupled through measured travel/capacity/accessibility results. A transit line only helps when its geometry, frequency, capacity, fare and destination access make it competitive; residential demand now distinguishes physical stock from economically usable stock; a parcel only develops when infrastructure, market conditions, project economics and a developer's capital/hurdle constraints permit it.

## Persistence

Current default save envelope: `saveVersion: 7`, game version `0.7.0-metropolitan`. V7 retains the complete V6 authoritative economy/transit/city state and adds the developer market state required for exact continuation: developer capital, committed capital and active development commitments. Derived transportation/multimodal graphs, route caches, accessibility maps, property-market snapshots, aggregate housing allocations, redevelopment-pressure snapshots, overlays and render state are rebuilt from authoritative state rather than persisted.

Explicit V5 and V6 serializers/hydrators remain available for compatibility, migration tests and historical fixtures. Loading V6 into the V7 runtime starts the default developer roster with no fabricated historical commitments.

## Roadmap

1. Phase 1 — Playable Foundation ✅
2. Phase 2 — Core City Loop ✅
3. Phase 3 — Traffic ✅
4. Phase 4 — Public Services ✅
5. Phase 5 — Transit Revolution ✅
6. Phase 6 — Firms, Production & Freight ✅
7. Phase 7 — Land, Housing & Development — in progress; developer competition, property markets, aggregate affordability/housing choice and residential redevelopment pressure are implemented; destructive redevelopment, tenure and individual household dynamics remain future work
8. Phase 8 — Metropolitan Infrastructure
9. Phase 9 — Demographic City
10. Phase 10 — Environment & Resilience
11. Phase 11 — Municipal Government & Finance
12. Phase 12 — Politics & Public Opinion
13. Phase 13 — Construction & Megaprojects
14. Phase 14 — Regional Simulation
15. Phase 15 — Specialized Economies & City Identity
16. Phase 16 — Endgame, Scenarios & Modding

See `docs/` and `docs/superpowers/` for architecture, balancing, testing, save-format, design and implementation-plan details.