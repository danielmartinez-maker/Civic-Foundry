# Civic Foundry

Civic Foundry is an original city-management, urban-development, transportation, economic-simulation, and municipal-management game built around deterministic simulation and inspectable causal systems. The validated Electron/PixiJS desktop stack remains the current compatibility runtime while Civic Foundry migrates toward the native Windows Prism Engine destination.

## Canonical runtime

**Civic Foundry 2.0 Phase 2R — Urban Fabric 2.0 is the current land/development/persistence layer.** The default save envelope is **Save V9** with `saveVersion: 9` and `gameVersion: '0.9.0-urban-fabric'`.

Phase 2R extends the accepted Phase 1R world foundation instead of replacing it. `WorldFoundation` remains the sole physical/geographic authority; `CadastralGraph` is the canonical legal-land authority. Existing V7/V8 gameplay systems remain behind explicit compatibility seams until later replacement phases assume ownership.

Current authoritative compatibility runtime:

```text
Electron → TypeScript SimulationCore → PixiJS/WebGL
```

Destination runtime under active migration:

```text
CivicFoundry.exe → Prism Engine (Rust) → native game domains → D3D12
```

The current compatibility path expands to:

```text
Electron desktop host
  → GameApp
    → SimulationCore facade
      → SimulationKernel + WorldFoundation + CadastralGraph
      → parcel zoning/building/property systems
      → legacy gameplay compatibility domains
    → GpuWorldRenderer → PixiJS/WebGL
```

`SimulationCore.world` remains authoritative for terrain, geography, hydrology, and physical-world state. `SimulationCore.cadastre` owns legal parcels/topology. `LotSystem` is rebuilt from cadastral state and survives only as a derived compatibility facade for inherited cell-based consumers. `GpuWorldRenderer` reads those systems for presentation and does not own simulation or save state.

Prism P0 establishes only the native foundation under `engine/prism/`: generational entity identity, aligned memory primitives, deterministic job-DAG compilation, deterministic diagnostics/bootstrap probing, release-mode invariant coverage, and a native executable shell. P0 does not transfer gameplay authority, introduce Save V10, or add D3D12 rendering. That boundary is recorded in `docs/adr/0003-native-prism-bootstrap.md`.

## Transitional desktop GPU runtime

The current compatibility `GameApp` world-rendering path uses PixiJS 8 with WebGL explicitly selected for broad Windows GPU compatibility. The existing `IsometricCamera` remains the projection and interaction contract for panning, anchored zoom, rotation, cell picking, and world/canvas conversion.

Electron provides the transitional desktop window around the same local `dist/` build used by browser development. The desktop host loads only local application content with Node integration disabled, context isolation enabled, sandboxing enabled, and unexpected navigation/window creation denied. The current desktop tranche exposes no generic IPC bridge.

The static TypeScript build remains in place. PixiJS's pinned browser ESM module is copied to `dist/vendor/pixi.mjs` and resolved through the local import map in `index.html`; no CDN runtime dependency or TypeScript `paths` alias is required. This transitional boundary is recorded historically in `docs/adr/0002-desktop-gpu-runtime.md`, which is superseded as the destination architecture by ADR 0003.

Legacy Canvas2D renderer/pass sources remain temporarily as migration references for specialized visual parity, but the compatibility `GameApp` path no longer instantiates them. Electron/PixiJS/WebGL is not a Prism architectural constraint and is not the final native production host.

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
- deterministic isometric GPU presentation with terrain, zoning, roads, structures, active vehicle markers, analytical overlays, selection, and tool previews.

These domains continue through the deterministic TypeScript compatibility architecture while later Civic Foundry 2.0 / Prism tranches progressively replace ownership behind parity gates.

## Compatibility boundaries

Phase 2R establishes land/building authority without claiming later systems:

- `WorldFoundation` remains the sole physical/geographic authority;
- `CadastralGraph` owns legal parcels and topology;
- `LotSystem` is a derived legacy addressing facade, never a competing land source of truth;
- legacy building records remain available to inherited systems while canonical `BuildingV2` state is stored separately;
- existing V7/V8 identifiers and historical behavior are preserved through explicit compatibility projections;
- lane-level road authority, turn movements, signals, explicit parking, crashes, and the final transportation replacement belong to **3R — Transportation Engine 2.0**;
- presentation code reads snapshots and emits presentation commands; it cannot manufacture simulation outcomes or canonical save state;
- Prism P0 owns no gameplay domain and does not create dual authority with the TypeScript runtime.

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

Prism P0 does not change persistence. Save V10 and native persistence migration remain excluded until a later reviewed tranche establishes ownership and migration contracts.

## Toolchain

Civic Foundry uses the Engineering Baseline v1 pinned local toolchain with the native Prism P0 extension:

- Node.js 22;
- TypeScript 5.8.3 ES modules with strict compiler settings;
- Node 22 built-in test runner with TypeScript strip-types;
- ESLint 10 plus TypeScript ESLint for static analysis;
- Prettier 3 for deterministic repository/tooling/test/document formatting;
- `clipper2-ts` for deterministic polygon clipping/offsetting behind the cadastral geometry wrapper;
- PixiJS 8.20.1 with WebGL for the transitional compatibility renderer;
- Electron 44 for the transitional local Windows desktop host;
- Python Playwright + Chromium for compiled browser smoke tests;
- deterministic procedural isometric atlas generation/validation;
- Rust 1.98.0 / Rust 2024 for Prism Engine P0;
- Cargo resolver 3 with committed `engine/prism/Cargo.lock`;
- no third-party Rust crates in P0.

Install JavaScript dependencies from the committed lockfile:

```bash
npm ci
```

The committed `rust-toolchain.toml` pins the native Rust toolchain used by Prism.

## Commands

```bash
npm run verify
npm run prism:verify
npm run verify:all
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
cargo run --manifest-path engine/prism/Cargo.toml -p prism-host --release --locked
```

`npm run verify` remains the canonical legacy authoritative-runtime gate: formatting, static analysis, repository/architecture policy, strict typechecking, tests, asset policy/validation, and the compatibility production build. `npm run prism:verify` is the native Prism gate. `npm run verify:all` runs both and is the full local gate during dual-stack migration. CI then runs the inherited browser/visual smoke suites plus the Windows-native Prism host smoke.

`npm run build` compiles the compatibility application into `dist/`, copies the pinned local browser runtime dependencies, and generates the deterministic atlases. `npm run dev` serves that compiled browser build on port 5173. `npm run desktop` performs a compatibility production build and launches it inside the hardened Electron host; it is transitional and is not the final Prism production host.

Engineering and contribution policy is documented in [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/adr/](docs/adr/).

## Acceptance evidence

Phase 1R acceptance established deterministic world generation, hydrology, spatial queries, World Foundation Save V8 round-trips, and compatibility continuation.

Urban Fabric 2.0 adds repository-wide verification for cadastral geometry/topology, parcel mutation, dimensional zoning, envelopes/compliance, mixed-use massing, lifecycle/renovation, HBU/property/site assembly, runtime cadastral authority, Save V9 migration/round-trip/reference validation, deterministic mutation fuzzing, and compiled Urban Fabric browser behavior.

The accepted desktop GPU tranche proved the production-presentation boundary with WebGL, local PixiJS resolution, and a hardened Electron host while retaining the inherited browser and visual smoke gates. ADR 0003 now supersedes that tranche as the destination architecture.

Prism P0 adds exact-toolchain Rust verification, 128-bit generational entity identity, safe 64-byte aligned memory, deterministic job-DAG compilation, deterministic diagnostics/bootstrap output, release-mode structural invariant tests, and Windows-native executable smoke coverage without transferring gameplay authority.

## Roadmap

0. Civic Foundry 2.0 Phase 0A — Kernel Skeleton & Deterministic Scheduling ✅
1. **1R — World Foundation 2.0 ✅** — geography hierarchy, irregular geometry, terrain/soils, hydrology/flooding, deterministic world generation, spatial index, world-aware costs, Save V8, compatibility facade
2. **2R — Urban Fabric 2.0 ✅** — true cadastral parcels, dimensional zoning, mixed-use `BuildingV2`, deterioration/renovation, HBU/redevelopment, parcel splitting/assembly, Save V9, cadastral diagnostics
3. **Desktop GPU Runtime ✅ (transitional)** — PixiJS/WebGL renderer and hardened Windows Electron host while preserving simulation/save authority
4. **Prism Engine P0 — native bootstrap** — Rust workspace, entity identity, aligned memory, deterministic job graph, diagnostics, native host, verification and Windows smoke; no gameplay authority transfer
5. **3R — Transportation Engine 2.0** — lane/turn/signal/parking/crash authority and dynamic routing replacement
6. Later Civic Foundry 2.0 / Prism systems continue under progressive replacement and parity gates.

See `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, `docs/adr/0003-native-prism-bootstrap.md`, and `docs/superpowers/` for architecture, persistence, design specifications, and implementation plans.
