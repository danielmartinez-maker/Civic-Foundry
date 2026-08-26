# Civic Foundry

Civic Foundry is an original browser-based city-management, urban-development, transportation, economic-simulation, and municipal-management game built around deterministic simulation and inspectable causal systems.

## Canonical runtime

**Civic Foundry 2.0 Phase 2R — Urban Fabric 2.0 is now the current land/development/persistence layer on this branch.** The default save envelope is **Save V9** with `saveVersion: 9` and `gameVersion: '0.9.0-urban-fabric'`.

Phase 2R extends the accepted Phase 1R world foundation instead of replacing it. `WorldFoundation` remains the sole physical/geographic authority; `CadastralGraph` is the canonical legal-land authority. Existing V7/V8 gameplay systems remain behind explicit compatibility seams until later replacement phases assume ownership.

Current runtime path:

`GameApp → SimulationCore facade → SimulationKernel + WorldFoundation + CadastralGraph → parcel zoning/building/property systems → legacy gameplay compatibility domains`

`SimulationCore.world` remains authoritative for terrain, geography, hydrology, and physical-world state. `SimulationCore.cadastre` owns legal parcels/topology. `LotSystem` is rebuilt from cadastral state and survives only as a derived compatibility facade for inherited cell-based consumers.

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
- deterministic V3–V7 migration into a neutral `legacy-flat` world without fabricating gameplay history;
- corruption rejection for invalid world terrain, compatibility divergence, and geography hierarchy references;
- static-world protection: ordinary simulation ticking does not mutate authoritative terrain, hydrology, geography, or prior flood state.

## Phase 2R — Urban Fabric 2.0

Implemented on `feature/urban-fabric-2.0`:

- deterministic centimeter-normalized cadastral geometry and topology validation;
- canonical blocks, parcels, frontage/access edges, easements, ownership, and lineage in `CadastralGraph`;
- deterministic parcel generation from inherited roads/zoning with stable legacy-lot compatibility projection;
- dimensional parcel zoning with allowed uses, FAR, height, coverage, setbacks, frontage constraints, mixed-use permissions, and overlays;
- buildable-envelope calculation and realized-massing compliance checks;
- physical mixed-use `BuildingV2` records with footprints, floors, use components, area-derived capacity, lifecycle, condition, quality, and project state;
- finite deterministic building massing candidates tied to parcel identity;
- physical development underwriting, highest-and-best-use analysis, property-market state, site assembly, and redevelopment execution;
- deterministic maintenance, deterioration, renovation, adaptive reuse, distress, demolition, and grandfathered/nonconforming-building behavior;
- atomic parcel split/assembly/right-of-way/easement mutation with whole-graph validation before commit;
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
- deterministic isometric Canvas presentation with authoritative overlays and explicit vehicle rendering.

These domains continue through the deterministic kernel compatibility architecture while later Civic Foundry 2.0 tranches progressively replace ownership behind parity gates.

## Compatibility boundaries

Phase 2R establishes land/building authority without claiming later systems:

- `WorldFoundation` remains the sole physical/geographic authority;
- `CadastralGraph` owns legal parcels and topology;
- `LotSystem` is a derived legacy addressing facade, never a competing land source of truth;
- legacy building records remain available to inherited systems while canonical `BuildingV2` state is stored separately;
- existing V7/V8 identifiers and historical behavior are preserved through explicit compatibility projections;
- lane-level road authority, turn movements, signals, explicit parking, crashes, and the final transportation replacement belong to **3R — Transportation Engine 2.0**;
- presentation code reads snapshots and emits commands; it cannot manufacture simulation outcomes or canonical save state.

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

The project remains dependency-light and browser-native:

- TypeScript 5.x ES modules;
- Node 22 built-in test runner with TypeScript strip-types;
- browser-native Canvas 2D;
- `clipper2-ts` for deterministic polygon clipping/offsetting behind the cadastral geometry wrapper;
- Python Playwright + Chromium for compiled browser smoke tests;
- procedural isometric atlas generation/validation.

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
npm run dev
```

`npm run build` produces `dist/`. `npm run dev` serves the compiled build on port 5173 where local navigation is permitted.

## Acceptance evidence

Phase 1R acceptance established deterministic world generation, hydrology, spatial queries, World Foundation Save V8 round-trips, and compatibility continuation.

Urban Fabric 2.0 adds repository-wide verification for cadastral geometry/topology, parcel mutation, dimensional zoning, envelopes/compliance, mixed-use massing, lifecycle/renovation, HBU/property/site assembly, runtime cadastral authority, Save V9 migration/round-trip/reference validation, deterministic mutation fuzzing, and compiled Urban Fabric browser behavior.

The current PR #63 head is required to pass the inherited repository suite plus the Urban Fabric smoke gate before integration. GitHub remains the durable source of truth for the exact accepted head and CI evidence.

## Roadmap

0. Civic Foundry 2.0 Phase 0A — Kernel Skeleton & Deterministic Scheduling ✅
1. **1R — World Foundation 2.0 ✅** — geography hierarchy, irregular geometry, terrain/soils, hydrology/flooding, deterministic world generation, spatial index, world-aware costs, Save V8, compatibility facade
2. **2R — Urban Fabric 2.0 ✅ on PR #63** — true cadastral parcels, dimensional zoning, mixed-use `BuildingV2`, deterioration/renovation, HBU/redevelopment, parcel splitting/assembly, Save V9, cadastral diagnostics
3. **3R — Transportation Engine 2.0 — next replacement tranche** — lane/turn/signal/parking/crash authority and dynamic routing replacement
4. Later Civic Foundry 2.0 systems continue under the progressive replacement architecture in `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`.

See `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, and `docs/superpowers/` for architecture, persistence, design specifications, and implementation plans.
