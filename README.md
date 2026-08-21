# Civic Foundry

Civic Foundry is an original browser-based city-management and urban-development simulator built as deterministic vertical slices.

## Current playable milestone

This branch implements the reverified rebuild through **Phase 5 — Transit Revolution**, the first Metropolitan Era slice. GitHub is the canonical source of truth for current code, tests, configuration, and documentation.

Implemented through Phase 5:

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
- Save V5 with exact active-transit continuation and V2/V3/V4 migration

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

`SimulationCore` composes focused authoritative systems. `MobilityScheduler` owns multimodal update order, while transit topology, passenger queues, vehicles and operations retain their own state boundaries. Rendering/UI reads snapshots and submits typed mutations through public APIs; it does not manufacture simulation outcomes.

Road traffic, transit attractiveness, service access, demand and finance are coupled through measured travel/capacity/accessibility results. A transit line only helps when its geometry, frequency, capacity, fare and destination access make it competitive.

## Persistence

Current save envelope: `saveVersion: 5`, game version `0.5.0-metropolitan`. V5 persists authoritative transit topology, passenger queues, active transit vehicles and operations state needed for deterministic continuation. Derived transportation/multimodal graphs, route caches, accessibility maps, overlays and render state are rebuilt after hydration.

## Roadmap

1. Phase 1 — Playable Foundation ✅
2. Phase 2 — Core City Loop ✅
3. Phase 3 — Traffic ✅
4. Phase 4 — Public Services ✅
5. Phase 5 — Transit Revolution ✅
6. Phase 6 — Economic Depth
7. Phase 7 — Urban Depth
8. Phase 8 — Metropolitan Infrastructure
9. Phase 9 — Environment and Events
10. Phase 10 — Polish

See `docs/` and `docs/superpowers/` for architecture, balancing, testing, save-format, design and implementation-plan details.
