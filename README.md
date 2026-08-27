# Civic Foundry

Civic Foundry is an original browser-based city-management, urban-development, transportation, economic-simulation, and municipal-management game built around deterministic simulation and inspectable causal systems.

## Canonical runtime

**Civic Foundry 2.0 Phase 1R — World Foundation 2.0 is now the current world/persistence layer.** The default save envelope is **Save V8** with `saveVersion: 8` and `gameVersion: '0.8.0-world-foundation'`.

The existing V7 city, mobility, services, economy, land, housing, and development systems remain the gameplay compatibility baseline beneath the new world foundation. Phase 1R deliberately replaces the physical-world substrate without pretending that later 2R parcel geometry or 3R transportation ownership is already complete.

Current runtime path:

`GameApp → SimulationCore facade → WorldFoundation + SimulationKernel → legacy-v7-city compatibility orchestration → existing gameplay domains`

`SimulationCore.world` is the authoritative Phase 1R world. `SimulationCore.terrain` remains the compatibility projection consumed by existing V7 roads, zoning, lots, buildings, and rendering until their reviewed replacement tranches take ownership.

## Phase 1R — World Foundation 2.0

Implemented and verified:

- deterministic geometry primitives, polygon/segment math, canonical tolerances, and spatial indexing;
- stable geography hierarchy: `Region → Municipality → District → Neighborhood → Block`;
- irregular deterministic administrative boundaries with validated parent/containment relationships;
- physical `TerrainField` with elevation, slope, aspect, soils, soil depth, bearing capacity, bedrock depth, groundwater depth, vegetation, contamination, and surface water;
- eight locked engineering soil classes: `rock`, `gravel`, `sand`, `loam`, `clay`, `alluvium`, `peat`, and `fill_disturbed`;
- six deterministic world presets: `plain`, `river_valley`, `basin`, `rolling_uplands`, `ridge_edge`, and `coastal_lowland`;
- namespaced deterministic RNG streams so topography, soils, groundwater, and vegetation do not perturb one another accidentally;
- priority-flood terrain conditioning plus deterministic D8 drainage with fixed clockwise tie breaking;
- watershed assignment, flow accumulation, generated drainage channels, flood susceptibility, and spatial channel queries;
- deterministic design-storm flooding with infiltration, storage, outlet export, nonnegative flood depth, and explicit water-balance accounting;
- scenario-authored generation and physical overrides without hidden generated contamination;
- terrain preparation multipliers that feed existing road construction and development underwriting for generated 1R worlds;
- exact neutral terrain economics (`1.0`) for direct/legacy worlds;
- `LegacyTerrainAdapter` preserving existing `TerrainGrid` behavior for V7 systems and Canvas rendering;
- typed diagnostic events: `WorldGenerated`, `WorldMigratedTo1R`, `FloodEventStarted`, and `FloodEventResolved`;
- `SimulationCore.runDesignStorm()` as the authoritative storm entry point;
- Save V8 persistence for the complete authoritative `WorldFoundation`, including the latest flood result;
- deterministic V3–V7 current-load migration into a neutral `legacy-flat` world without fabricating gameplay history;
- corruption rejection for invalid world terrain, compatibility divergence, and geography hierarchy references;
- static-world protection: ordinary simulation ticking does not mutate authoritative terrain, hydrology, geography, or prior flood state.

## Existing gameplay compatibility baseline

The preserved gameplay layer includes:

- treasury, road construction, R/C/I zoning, road-frontage lots, buildings, population, employment, taxation, utilities, and recurring municipal finance;
- deterministic road graphs, pathfinding, weighted trips, moving vehicles, intersections, queues, congestion, and accessibility;
- fire, police, healthcare, education, waste collection, routed service vehicles, incidents, budgets, and neighborhood quality;
- bus, BRT, tram, and metro topology, multimodal journey planning, passenger queues, transit vehicles, operations, fares, crowding, reliability, and accessibility;
- establishment-based firms, labor allocation, inventories, production, imports/exports, freight orders, explicit freight trucks, formation, distress, recovery, and closure;
- derived R/C/I property markets, housing affordability, renter/owner tenure economics, persistent aggregate housing relocation, redevelopment safeguards, development policy, parcel underwriting, and competing developer capital allocation;
- deterministic isometric Canvas presentation with authoritative overlays and explicit vehicle rendering.

These domains continue through the Phase 0A deterministic kernel compatibility system while later 2.0 tranches progressively replace ownership behind parity gates.

## Compatibility boundaries

Phase 1R does **not** claim ownership of later systems simply because they can consume world data:

- legal parcels, FAR, setbacks, height/coverage zoning, parcel splitting/assembly, mixed use, deterioration, renovation, and redevelopment geometry belong to **2R — Urban Fabric 2.0**;
- lane-level road authority, signals, turn movements, explicit parking, crashes, and the final transportation replacement belong to **3R — Transportation Engine 2.0**;
- current V7 `LotSystem` remains cell/frontage based;
- current rendering remains presentation-only and derives map size/ground art from `core.terrain`;
- presentation code cannot run storms, mutate world authority, or manufacture save state.

This boundary is intentional: Phase 1R supplies a richer authoritative substrate while preserving the existing playable city until each downstream replacement passes its own determinism, persistence, performance, and compatibility gates.

## Persistence

Current default save envelope:

- `saveVersion: 8`
- `gameVersion: '0.8.0-world-foundation'`
- complete V7 gameplay state;
- authoritative `world: WorldFoundationSnapshot`.

V8 hydration restores the world **before** terrain-dependent legacy systems are constructed. The inherited V7 compatibility terrain is validated against `world.legacyTerrain()` before a live core is returned.

Explicit older serializers/hydrators remain available for migration and parity tests. Loading V3–V7 through the current API constructs a deterministic neutral `legacy-flat` world so historical cities keep their prior terrain/buildability/cost semantics. Existing gameplay history is not invented during migration.

## Toolchain

Civic Foundry remains browser-native while using a pinned local engineering toolchain:

- Node.js 22;
- TypeScript 5.8.3 ES modules with strict compiler settings;
- Node 22 built-in test runner with TypeScript strip-types;
- ESLint 10 plus TypeScript ESLint for static analysis;
- Prettier 3 for deterministic repository/tooling/test/document formatting;
- browser-native Canvas 2D;
- Python Playwright + Chromium for compiled browser smoke tests;
- deterministic procedural isometric atlas generation/validation.

Install JavaScript dependencies from the committed lockfile:

```bash
npm ci
```

## Commands

```bash
npm run verify
npm test
npm run typecheck
npm run lint
npm run policy:check
npm run architecture:check
npm run format:check
npm run assets:policy
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
npm run dev
```

`npm run verify` is the canonical core gate used by contributors and CI: formatting, static analysis, repository/architecture policy, strict typechecking, tests, asset policy/validation, and the production build. CI then runs the established browser and visual smoke suites.

`npm run build` produces `dist/` using cross-platform Node orchestration. `npm run dev` serves the compiled build on port 5173 where local navigation is permitted.

Engineering and contribution policy is documented in [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/adr/](docs/adr/).

## Phase 1R acceptance evidence

The verified Phase 1R acceptance head passed **483/483 Node tests**, strict TypeScript typecheck, lint, asset validation, production build, Phase 6 browser smoke, Phase 7 browser smoke, Isometric Pass A functional smoke, and eight-scene isometric visual smoke.

The 96×64 `rolling_uplands` spatial benchmark resolved **10,000 deterministic query points across block, neighborhood, and district membership (30,000 indexed kind lookups) in ~35.72 ms** on the GitHub Actions runner, against a 2,500 ms acceptance budget. All six 96×64 presets generated finite valid worlds; observed generation diagnostics ranged from ~87.75 ms to ~160.17 ms on that runner and are diagnostic rather than cross-hardware guarantees.

The final 48×32 `river_valley` headless acceptance scenario built real road/zoning/utility state, advanced the live simulation, ran an 80 mm / 2 h design storm, flooded 60 cells with water-balance error about `-5.24e-10`, round-tripped Save V8 exactly, and produced identical continuation through tick 550.

## Roadmap

0. Civic Foundry 2.0 Phase 0A — Kernel Skeleton & Deterministic Scheduling ✅
1. **1R — World Foundation 2.0 ✅** — geography hierarchy, irregular geometry, terrain/soils, hydrology/flooding, deterministic world generation, spatial index, world-aware costs, Save V8, compatibility facade
2. **2R — Urban Fabric 2.0** — true parcels, FAR/setbacks/height/coverage, mixed use, deterioration, renovation, redevelopment, parcel splitting/assembly
3. **3R — Transportation Engine 2.0** — lane/turn/signal/parking/crash authority and dynamic routing replacement
4. Later Civic Foundry 2.0 systems continue under the progressive replacement architecture in `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`.

See `docs/` and `docs/superpowers/` for architecture, testing, design specifications, and implementation plans.
