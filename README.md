# Civic Foundry

Civic Foundry is an original browser-based city-management and urban-development simulator built as deterministic vertical slices.

## Current playable milestone

This branch is the **fresh Phase 1–3 reimplementation** created after the original temporary Phase 3 workspace expired. It is not a byte-for-byte recovery of the lost `f0bb3d6` checkpoint. The rebuilt implementation has been reverified from scratch and GitHub is now the canonical source of truth.

Implemented through Phase 3:

- deterministic terrain and simulation clock
- treasury and construction costs
- local, collector, and arterial roads
- R/C/I zoning, road-frontage lots, building construction, population
- employment, R/C/I demand, taxes, power, water, garbage, recurring economy
- transportation graph derived from roads
- deterministic A* routing with revision-aware route cache
- weighted commute and shopping trip cohorts
- moving vehicles and deterministic intersection queues
- congestion derived from actual weighted edge occupancy/capacity
- traffic analytics, commute/accessibility metrics, and demand feedback
- Canvas 2D rendering, build tools, HUD, inspector, traffic overlays
- Save V3 with deterministic continuation and V2 migration

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

`SimulationCore` and focused simulation modules own authoritative state. Rendering/UI only read snapshots and submit mutations through public APIs. Important metrics—employment, service ratios, demand, congestion, accessibility—derive from actual simulated state rather than fabricated display values.

## Persistence

Current save envelope: `saveVersion: 3`, game version `0.3.0-rebuild`. Transportation graphs, route caches, overlay buffers, and other rebuildable state are reconstructed after hydration.

## Roadmap

1. Phase 1 — Playable Foundation ✅
2. Phase 2 — Core City Loop ✅
3. Phase 3 — Traffic ✅ (fresh reimplementation)
4. Phase 4 — Public Services — approved design, next
5. Phase 5 — Public Transport
6. Phase 6 — Economic Depth
7. Phase 7 — Urban Depth
8. Phase 8 — Metropolitan Infrastructure
9. Phase 9 — Environment and Events
10. Phase 10 — Polish

See `docs/` and `docs/superpowers/` for architecture, balancing, testing, save-format, design, and implementation-plan details.
