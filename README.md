# Civic Foundry

Civic Foundry is an original browser-based city-management and urban-development simulator built as deterministic vertical slices.

## Current playable milestone

This branch implements the fresh, reverified rebuild through **Phase 4 — Public Services**. The Phase 1–3 source was reimplemented after the original temporary Phase 3 workspace expired; it is not a byte-for-byte recovery of historical commit `f0bb3d6`. GitHub is the canonical source of truth for all current code, tests, configuration, and documentation.

Implemented through Phase 4:

- deterministic terrain, simulation clock, treasury, construction costs, save/load
- local, collector, and arterial roads with intersections and graph revisions
- R/C/I zoning, road-frontage lots, construction, population, employment and taxes
- road-connected power/water plus recurring city finance
- deterministic transportation graph, A* routing and revision-aware route cache
- weighted commute/shopping traffic, moving vehicles, queues and real congestion
- fire, police, healthcare, education, routed garbage collection and public-service budgets
- explicit fire engines, patrol cars, ambulances and garbage trucks using the road graph
- seeded fire/police/medical incidents, response times, fire intensity/damage and bounded spread
- network-based service accessibility, school capacity/overcrowding and detailed building waste
- neighborhood service quality feeding residential/commercial attractiveness
- Canvas 2D rendering, build tools, HUD, inspectors, traffic/service overlays and transition-based alerts
- Save V4 with deterministic continuation and V2/V3 migration

## Toolchain

The project intentionally uses an offline-capable dependency-light stack:

- TypeScript 5.x ES modules
- Node 22 built-in test runner with TypeScript strip-types
- browser-native Canvas 2D
- global `tsc`
- Python Playwright + system Chromium for browser smoke testing

No Vite/PixiJS/Vitest dependency is claimed in this rebuild.

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

`SimulationCore` and focused simulation modules own authoritative state. Rendering/UI only read snapshots and submit typed mutations through public APIs. Employment, utilities, demand, congestion, accessibility, service response, garbage, education, and neighborhood quality derive from actual simulated state rather than fabricated display values.

## Persistence

Current save envelope: `saveVersion: 4`, game version `0.4.0-rebuild`. Transportation graphs, route caches, accessibility maps, overlays, render state and other rebuildable data are reconstructed after hydration.

## Roadmap

1. Phase 1 — Playable Foundation ✅
2. Phase 2 — Core City Loop ✅
3. Phase 3 — Traffic ✅ (fresh reimplementation)
4. Phase 4 — Public Services ✅
5. Phase 5 — Public Transport
6. Phase 6 — Economic Depth
7. Phase 7 — Urban Depth
8. Phase 8 — Metropolitan Infrastructure
9. Phase 9 — Environment and Events
10. Phase 10 — Polish

See `docs/` and `docs/superpowers/` for architecture, balancing, testing, save-format, design, and implementation-plan details.
