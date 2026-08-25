# Civic Foundry — Development Log

This log records durable phase-level checkpoints. Detailed task-by-task implementation history remains available in Git commits, design specifications, implementation plans, and CI runs.

## 2026-08-21 — Phase 1–3 fresh reimplementation

The earlier temporary execution workspace reached a verified Phase 3 checkpoint but expired before source upload. Phase 1–3 were therefore reimplemented from preserved specifications and reverified in `danielmartinez-maker/Civic-Foundry`, establishing GitHub as the durable canonical source of truth.

The rebuilt baseline restored:

- deterministic terrain, treasury, zoning, road-frontage lots, buildings, population, employment, taxes, utilities, garbage, and demand;
- explicit road hierarchy, derived transportation graph, deterministic A* routing, weighted trip generation, moving traffic, intersection queues, congestion, and accessibility;
- deterministic save/load and headless parity fixtures.

## 2026-08-21 — Phase 4 Public Services

Implemented the public-services vertical slice:

- fire, police, clinics, schools, landfill/recycling infrastructure;
- department funding, staffing, capacity, fleets, and operating cost;
- road-network accessibility rather than circular coverage;
- explicit routed emergency/service/garbage vehicles;
- incidents, fire growth/spread, routed waste, education, and neighborhood service quality;
- V4 persistence/migration and browser smoke coverage.

Acceptance work corrected a routed-garbage migration deadlock, restored the inherited waste-generation cadence, and persisted active waste reservations needed for deterministic continuation.

## 2026-08-21 — Phase 5 Transit Revolution

Implemented bus, BRT, tram, and metro topology with:

- deterministic stops/lines/routes;
- multimodal generalized-cost journey planning and route caching;
- weighted person-trip cohorts and mode choice;
- passenger queues, transfers, partial boarding, and explicit transit vehicles;
- road-sensitive surface transit, congestion-reduced BRT, and road-insulated metro;
- headways, fleet limits, operating cost, fares, accessibility, crowding, wait, and reliability;
- V5 authoritative continuation and V4 migration.

Acceptance work fixed legacy save-continuation drift, added capacity feedback into experienced wait/mode choice, and retained the compiled-browser smoke harness through Playwright request routing.

## 2026-08-22 — Phase 6 Firms, Production & Freight

Implemented the establishment/freight economy:

- deterministic firms and labor allocation;
- conservation-safe inventories and a compact production chain;
- stable external freight gateways;
- generalized-cost supplier matching;
- imports/exports and explicit weighted freight trucks;
- freight congestion/logistics costs feeding shortages, production, firm health, and employment;
- sustained firm formation, distress, recovery, and closure;
- authoritative dispatch capacity and queue aging;
- V6 continuation and V5 migration;
- economy/freight UI diagnostics and browser smoke coverage.

Acceptance work corrected gateway fixtures, made freight dispatch capacity causal, prevented late cargo delivery to demolished firms, rebuilt derived freight access after hydration, and retained revision-stable path caching for acceptable long-horizon performance.

## 2026-08-22 — Phase 7 Land, Housing & Development

Phase 7 progressively added the property/development layer above the existing cell-lot model:

- derived R/C/I property markets with rent, vacancy, land value, and parcel-local signals;
- explicit developer pro-forma underwriting using market rent/vacancy, taxes, construction cost, financing, NOI, value, return, and residual land value;
- deterministic competing developers with differentiated hurdles, financing, capital, preferences, bids, awards, commitments, and capital recycling;
- aggregate housing affordability/choice followed by persistent renter/owner tenure and relocation state;
- redevelopment pressure plus safeguarded occupied-residential execution;
- development-policy controls for density bonus, affordability, fees, permitting, redevelopment affordability, and lower-income relocation protection;
- V7 persistence for authoritative developer/housing state and deterministic migration from V6;
- land/housing panels, overlays, building diagnostics, and compiled Phase 7 browser smoke.

Acceptance work found and fixed duplicate developer commitments, relocation-floor edge cases, stale derived diagnostics, and save-continuation requirements without introducing a second hidden property market or household simulation.

## 2026-08-24 — Civic Foundry 2.0 Phase 0A Kernel

Inserted the deterministic simulation kernel beneath the existing V7 city model without rewriting gameplay ownership.

The kernel provides:

- one shared authoritative simulation clock;
- deterministic system scheduling and dependency validation;
- queued command sequencing;
- diagnostic domain-event journaling;
- isolated named RNG streams;
- cadence-aware invariants;
- ordered diagnostic snapshot providers;
- fail-stop behavior on fatal tick errors.

The existing V7 city loop remains the compatibility system while later 2.0 tranches progressively replace subsystems behind parity gates.

## 2026-08-24 — Isometric Presentation Pass A

Reworked the visual layer into a deterministic 2:1 isometric presentation system while keeping simulation authority independent from rendering.

The pass established:

- 64×32 tile projection and quarter-turn camera rotation;
- deterministic sprite identity and road autotiling;
- generated/validated atlas contracts;
- explicit object/vehicle/overlay/selection render order;
- viewport culling and coordinate-correct interaction;
- compiled functional and visual Chromium smoke coverage.

## 2026-08-25 — Phase 1R World Foundation 2.0

Implemented the first major Civic Foundry 2.0 replacement tranche beneath the V7 gameplay compatibility layer.

### Architecture delivered

- added an authoritative `WorldFoundation` composed of physical terrain, engineering soils, hydrology, geography hierarchy, spatial index, world generation, scenario overrides, flood state, and the legacy terrain adapter;
- added canonical polygon/segment geometry suitable for later irregular parcel and transportation work;
- added stable geography hierarchy `Region → Municipality → District → Neighborhood → Block` with deterministic irregular boundaries and validated references/containment;
- replaced simplistic generated terrain with physical elevation, slope/aspect, soil/bearing, soil depth, bedrock, groundwater, vegetation, contamination, and surface-water fields;
- locked eight soil classes and six world-form presets;
- isolated world-generation randomness into named deterministic streams;
- added priority-flood terrain conditioning and fixed-precedence D8 routing;
- derived watersheds, accumulation, drainage channels, and flood susceptibility;
- added deterministic design-storm flooding with explicit rainfall/infiltration/storage/outlet water accounting;
- added scenario-authored generation/physical overrides while keeping generated contamination zero by default;
- added spatial indexing for geography/channel lookup;
- retained `core.terrain` as a compatibility projection so existing roads, zoning, lots, buildings, and rendering continue functioning without a simultaneous 2R/3R rewrite.

### Economic integration

Generated 1R terrain now affects real municipal/developer economics rather than remaining decorative:

- road construction cost uses per-cell terrain preparation multipliers;
- development feasibility multiplies the existing service/utility construction-cost index by local terrain preparation before the existing clamp;
- legacy/direct worlds return exactly `1.0`, preserving historical road and development costs.

### Save V8 and migration

Introduced default **Save V8**:

- `saveVersion: 8`;
- `gameVersion: '0.8.0-world-foundation'`;
- complete inherited V7 gameplay state plus authoritative `WorldFoundationSnapshot`;
- latest design-storm result persists exactly;
- restored V8 worlds are injected before terrain-dependent legacy domains are constructed;
- world/compatibility terrain divergence and corrupt geography are rejected;
- V3–V7 current-load migration creates a deterministic neutral `legacy-flat` world without fabricating prior 1R/flood history.

### Diagnostics and presentation boundary

Added typed diagnostic events:

- `WorldGenerated`;
- `WorldMigratedTo1R`;
- `FloodEventStarted`;
- `FloodEventResolved`.

`SimulationCore.runDesignStorm()` is the authoritative storm entry point. Direct `TerrainGrid` construction emits no fabricated lifecycle event and V8 restoration emits no fake generation/migration event.

A presentation contract test locks `WorldRenderer` and `GroundRenderPass` to read-only use of the compatibility terrain. Rendering cannot run storms or mutate world/save authority.

### Acceptance evidence

The final pre-documentation Phase 1R acceptance head passed **483/483 Node tests**, strict typecheck, lint, asset validation, production build, Phase 6 browser smoke, Phase 7 browser smoke, Isometric Pass A functional smoke, and the eight-scene isometric visual smoke.

Spatial acceptance on the latest GitHub Actions run:

- 96×64 `rolling_uplands` world;
- 10,000 deterministic query points;
- block + neighborhood + district membership for each point = 30,000 indexed kind lookups;
- indexed phase completed in approximately **35.72 ms** against the **2,500 ms** acceptance budget;
- the first 500 points were cross-checked against direct hierarchy lookup.

All six 96×64 presets generated finite valid worlds. Observed diagnostic generation times ranged from approximately **87.75 ms** to **160.17 ms** on that CI runner; no cross-hardware generation-time threshold is asserted.

The 5,000-tick static-world gate proved ordinary simulation stepping leaves the authoritative generated world unchanged.

The locked 48×32 `river_valley` headless fixture (`seed: 20260825`) then executed the complete acceptance chain:

`generate → real road/zoning/utilities → 250 ticks → 80 mm / 2 h storm → Save V8 → hydrate → 300-tick matched continuation`

Its verified diagnostic output included:

- 60 flooded cells;
- water-balance error approximately `-5.24e-10`;
- exact Save V8 round-trip;
- identical continuation through tick 550.

### Compatibility boundary

Phase 1R intentionally does not claim later tranche ownership:

- true legal parcels, FAR/setbacks/height/coverage, mixed-use geometry, deterioration/renovation, and parcel split/assembly remain 2R work;
- the final lane/signal/turn/parking/crash transportation replacement remains a separate 3R responsibility;
- existing V7 lot and rendering semantics remain available through the Phase 1R compatibility facade until those downstream systems pass their own review and acceptance gates.

Draft PR #79 carries the Phase 1R work for review; it is not merged automatically.