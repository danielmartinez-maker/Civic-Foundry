# Civic Foundry

Civic Foundry is an original city-management, urban-development, transportation, economic-simulation, and municipal-management game built around deterministic simulation and inspectable causal systems. The production presentation path now targets GPU-rendered Windows desktop play while retaining the browser build as a development and smoke-test target.

## Wiki

Start with the **[Civic Foundry Wiki](docs/wiki/Home.md)** for a structured guide to the product vision, current roadmap, runtime architecture, simulation domains, rendering, persistence, contribution workflow, known technical debt, and project glossary. The wiki is an orientation layer; canonical technical authority remains current code, fresh verification evidence, this README, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, and accepted ADRs.

## Canonical runtime

**Civic Foundry 2.0 Phase 2R — Urban Fabric 2.0 is the current land/development/persistence layer.** The default save envelope is **Save V9** with `saveVersion: 9` and `gameVersion: '0.9.0-urban-fabric'`.

Phase 2R extends the accepted Phase 1R world foundation instead of replacing it. `WorldFoundation` remains the sole physical/geographic authority; `CadastralGraph` is the canonical legal-land authority. Existing V7/V8 gameplay systems remain behind explicit compatibility seams until later replacement phases assume ownership.

Current runtime path:

```text
Electron desktop host (optional)
  → GameApp
    → SimulationCore facade
      → SimulationKernel + WorldFoundation + CadastralGraph
      → parcel zoning/building/property systems
      → legacy gameplay compatibility domains
    → GpuWorldRenderer → PixiJS/WebGL
```

`SimulationCore.world` remains authoritative for terrain, geography, hydrology, and physical-world state. `SimulationCore.cadastre` owns legal parcels/topology. `LotSystem` is rebuilt from cadastral state and survives only as a derived compatibility facade for inherited cell-based consumers. `GpuWorldRenderer` reads those systems for presentation and does not own simulation or save state.

## Desktop GPU runtime

The production `GameApp` world-rendering path uses PixiJS 8 with WebGL explicitly selected for broad Windows GPU compatibility. The existing `IsometricCamera` remains the projection and interaction contract for panning, anchored zoom, rotation, cell picking, and world/canvas conversion.

Electron provides the native desktop window around the same local `dist/` build used by browser development. The desktop host loads only local application content with Node integration disabled, context isolation enabled, sandboxing enabled, and unexpected navigation/window creation denied. The current desktop tranche exposes no generic IPC bridge.

The static TypeScript build remains in place. PixiJS's pinned browser ESM module is copied to `dist/vendor/pixi.mjs` and resolved through the local import map in `index.html`; no CDN runtime dependency or TypeScript `paths` alias is required. This boundary is recorded in `docs/adr/0002-desktop-gpu-runtime.md`.

The current GPU presentation branch uses the deterministic Pass A atlas manifest as the production base-scene asset identity authority. Terrain, roads, buildings, construction, civic facilities, utilities, vegetation, and surface vehicles are translated into deterministic sprite commands. Static Pixi sprites are retained by stable presentation key and updated in place; moving private, service, transit, and freight sprites use bounded pools. `debugSceneStats()` exposes presentation-only allocation diagnostics so browser smoke tests can prove unchanged redraws and camera movement do not recreate static display objects.

Zoning, selection/tool previews, and the generic analytical-overlay seam remain vector presentation layers until the specialized GPU overlay parity tranche. Legacy Canvas2D renderer/pass sources remain temporarily as migration references, but the production `GameApp` path no longer instantiates them.

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
- `LegacyTerrainAdapter` preserving existing `TerrainGrid` behavior for inherited gameplay systems;
- typed diagnostic events: `WorldGenerated`, `WorldMigratedTo1R`, `FloodEventStarted`, and `FloodEventResolved`;
- `SimulationCore.runDesignStorm()` as the authoritative storm entry point;
- Save V8 persistence for the complete authoritative `WorldFoundation`, including the latest flood result;
- deterministic V3–V7 migration into a neutral `legacy-flat` world without fabricating gameplay history;
- corruption rejection for invalid world terrain, compatibility divergence, and geography hierarchy references;
- static-world protection: ordinary simulation ticking does not mutate authoritative terrain, hydrology, geography, or prior flood state.

## Phase 2R — Urban Fabric 2.0

Implemented and integrated on the current baseline:

- deterministic centimeter-normalized cadastral geometry and topology validation;
- canonical blocks, parcels, frontage/access edges, easements, ownership, and lineage in `CadastralGraph`;
- deterministic parcel generation from inherited roads/zoning with stable legacy-lot compatibility projection;
- dimensional parcel zoning with allowed uses, FAR, height, coverage, setbacks, frontage constraints, mixed-use permissions, and overlays;
- buildable-envelope calculation and realized-massing compliance checks;
- physical mixed-use `BuildingV2` records with footprints, floors, use components, area-derived capacity, lifecycle, condition, quality, and project state;
- finite deterministic building massing candidates tied to parcel identity;
- physical development underwriting, highest-and-best-use analysis, property-market state, site assembly, and redevelopment execution;
- deterministic maintenance, deterioration, renovation, adaptive reuse, distress, demolition, and grandfathered/nonconforming-building behavior;
- deterministic low-level parcel split/assembly/right-of-way/easement mutation with whole-graph validation before commit;
- simulation-layer cadastral transaction coordination across zoning, canonical buildings, property references, and derived legacy lots;
- cadastral and zoning-envelope overlays, canonical parcel picking, parcel inspection, and Urban Fabric tool controls;
- fixed-seed cadastral mutation fuzz coverage and a compiled Urban Fabric browser smoke gate;
- Save V9 persistence for cadastral topology, parcel zoning assignments, canonical buildings, and property-market state.

## Existing gameplay compatibility baseline

The preserved gameplay layer still includes:

- treasury, road construction, inherited R/C/I zoning entrypoints, population, employment, taxation, utilities, and recurring municipal finance;
- deterministic road graphs, pathfinding, weighted trips, moving vehicles, intersections, queues, congestion, and accessibility;
- fire, police, healthcare, education, waste collection, routed service vehicles, incidents, budgets, and neighborhood quality;
- bus, BRT, tram, and metro topology, multimodal journey planning, passenger queues, transit vehicles, operations, fares, crowding, reliability, and accessibility;
- establishment-based firms, labor allocation, inventories, production, imports/exports, freight orders, explicit freight trucks, formation, distress, recovery, and closure;
- housing affordability, renter/owner tenure economics, persistent relocation, development policy, developer capital allocation, and inherited redevelopment safeguards;
- deterministic isometric GPU presentation with retained Pass A atlas sprites for the base scene and surface vehicles, vector zoning/selection/tool previews, and the existing analytical-overlay compatibility seam.

These domains continue through the deterministic kernel compatibility architecture while later Civic Foundry 2.0 tranches progressively replace ownership behind parity gates.

## Compatibility boundaries

Phase 2R establishes land/building authority without claiming later systems:

- `WorldFoundation` remains the sole physical/geographic authority;
- `CadastralGraph` owns legal parcels and topology;
- `LotSystem` is a derived legacy addressing facade, never a competing land source of truth;
- legacy building records remain available to inherited systems while canonical `BuildingV2` state is stored separately;
- existing V7/V8 identifiers and historical behavior are preserved through explicit compatibility projections;
- lane-level road authority, turn movements, signals, explicit parking, crashes, and the final transportation replacement belong to **3R — Transportation Engine 2.0**;
- presentation code reads snapshots and emits presentation commands; it cannot manufacture simulation outcomes or canonical save state.

## Persistence

Current default save envelope:

- `saveVersion: 9`
- `gameVersion: '0.9.0-urban-fabric'`
- the complete inherited V8 World Foundation envelope;
- `urbanFabric: CadastralSnapshot`;
- `zoningV2.parcelAssignments`;
- `buildingsV2`;
- `propertyMarket`.

V9 hydration restores the inherited V8 candidate first so `WorldFoundation` exists before terrain-dependent legacy systems are created. It then replaces the runtime cadastral snapshot, rebuilds the legacy lot facade from the cadastre, validates every Urban Fabric parcel reference, and restores parcel zoning, canonical buildings, and property-market state.

Save V8 remains the explicit Phase 1R format with `saveVersion: 8` and `gameVersion: '0.8.0-world-foundation'`. Loading V8 through the current API deterministically constructs the V9 Urban Fabric state without rewriting or repurposing the V8 schema. Older migration continues through the progressive compatibility chain.

## Toolchain

Civic Foundry uses the Engineering Baseline v1 pinned local toolchain with the ADR 0002 desktop/GPU extension:

- Node.js 22;
- TypeScript 5.8.3 ES modules with strict compiler settings;
- Node 22 built-in test runner with TypeScript strip-types;
- ESLint 10 plus TypeScript ESLint for static analysis;
- Prettier 3 for deterministic repository/tooling/test/document formatting;
- `clipper2-ts` for deterministic polygon clipping/offsetting behind the cadastral geometry wrapper;
- PixiJS 8.20.1 with WebGL for production world rendering;
- Electron 44 for the local Windows desktop host;
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
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
npm run dev
npm run desktop
```

`npm run verify` is the canonical core gate used by contributors and CI: formatting, static analysis, repository/architecture policy, strict typechecking, tests, asset policy/validation, and the production build. CI then runs the browser and visual smoke suites.

`npm run build` compiles the application into `dist/`, copies the pinned local browser runtime dependencies, and generates the deterministic atlases. `npm run dev` serves the compiled browser build on port 5173. `npm run desktop` performs a production build and launches that local build inside the hardened Electron desktop host.

Engineering and contribution policy is documented in [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/adr/](docs/adr/).

## Acceptance evidence

Phase 1R acceptance established deterministic world generation, hydrology, spatial queries, World Foundation Save V8 round-trips, and compatibility continuation.

Urban Fabric 2.0 adds repository-wide verification for cadastral geometry/topology, parcel mutation, dimensional zoning, envelopes/compliance, mixed-use massing, lifecycle/renovation, HBU/property/site assembly, runtime cadastral authority, Save V9 migration/round-trip/reference validation, deterministic mutation fuzzing, and compiled Urban Fabric browser behavior.

The desktop GPU runtime feature head `725c9cec539f1df32386c4c35e95c81a7fe134ab` passed GitHub Actions run `33137152536` with the complete then-current core/browser/visual stack and was merged through PR #98 into `main` as `c2e7befd9174b65dadc90e1e381d892accf780c6` on 2026-08-27 (America/Monterrey). The production `GameApp` path on `main` therefore uses `GpuWorldRenderer`; legacy Canvas2D sources remain migration references only.

GPU Presentation Phase 2 adds deterministic Pass A atlas reuse, retained static sprite identity, bounded moving-vehicle pools, initialization/asset diagnostics, and compiled browser proof that unchanged redraws and camera motion do not recreate static display objects. The Phase 2 branch changes presentation/tests/docs only; authoritative simulation, world, and save domains are unchanged. Specialized analytical-overlay parity remains the next presentation tranche. PR #99 remains a draft integration boundary until explicit approval.

## Roadmap

0. Civic Foundry 2.0 Phase 0A — Kernel Skeleton & Deterministic Scheduling ✅
1. **1R — World Foundation 2.0 ✅** — geography hierarchy, irregular geometry, terrain/soils, hydrology/flooding, deterministic world generation, spatial index, world-aware costs, Save V8, compatibility facade
2. **2R — Urban Fabric 2.0 ✅** — true cadastral parcels, dimensional zoning, mixed-use `BuildingV2`, deterioration/renovation, HBU/redevelopment, parcel splitting/assembly, Save V9, cadastral diagnostics
3. **Desktop GPU Runtime — PR #98 ✅** — PixiJS/WebGL production renderer and hardened Windows Electron host while preserving simulation/save authority
4. **GPU Presentation Phase 2 — PR #99** — deterministic Pass A atlas sprites, retained base scene, bounded vehicle pools, and retained-scene browser diagnostics
5. **GPU Presentation Phase 3** — specialized retained traffic/service/transit/economy/cadastral/zoning-envelope overlays and explicit legacy Canvas removal gate
6. **3R — Transportation Engine 2.0** — lane/turn/signal/parking/crash authority and dynamic routing replacement
7. Later Civic Foundry 2.0 systems continue under the progressive replacement architecture in `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`.

See `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, and `docs/superpowers/` for architecture, persistence, design specifications, and implementation plans.
