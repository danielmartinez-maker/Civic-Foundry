# Civic Foundry — Current State

## Snapshot

This document answers one question: **what is accepted as current Civic Foundry runtime truth?**

For implementation-level detail, use root `README.md`, [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../SAVE_FORMAT.md`](../SAVE_FORMAT.md) and accepted ADRs.

## Current production direction

Civic Foundry is a deterministic city-management and urban simulation whose production presentation path targets GPU-rendered Windows desktop play. The browser build remains a development and smoke-test target.

Current high-level runtime:

```text
Electron desktop host (optional)
  → GameApp
    → SimulationCore compatibility facade
      → SimulationKernel
      → WorldFoundation
      → CadastralGraph
      → Urban Fabric systems
      → inherited gameplay compatibility domains
    → GpuWorldRenderer
      → PixiJS / WebGL
```

## Implemented — deterministic kernel foundation

The Civic Foundry 2.0 replacement program has an accepted kernel skeleton that provides deterministic scheduling infrastructure under the existing gameplay facade.

Current architectural expectations include:

- explicit simulation time and ordered execution;
- deterministic random streams;
- compatibility through `SimulationCore`;
- typed system/domain boundaries;
- invariant and replay-oriented architecture.

The kernel is infrastructure for progressive replacement rather than a complete replacement of every gameplay domain.

## Implemented — World Foundation 2.0 / Phase 1R

`WorldFoundation` is the sole physical and geographic authority.

Accepted capabilities include:

- deterministic world geometry and spatial queries;
- `Region → Municipality → District → Neighborhood → Block` geography hierarchy;
- irregular deterministic boundaries;
- terrain elevation, slope/aspect and engineering properties;
- soil, bedrock, groundwater, vegetation, contamination and surface-water state;
- seeded world presets;
- deterministic hydrology, watersheds, flow accumulation and drainage channels;
- design-storm flooding with explicit water accounting;
- world-aware terrain preparation costs;
- legacy terrain compatibility;
- typed world/flood diagnostics;
- Save V8 historical persistence and deterministic migration from older saves;
- static-world protection during ordinary city ticking.

## Implemented — Urban Fabric 2.0 / Phase 2R

`CadastralGraph` is the legal-land authority.

Accepted capabilities include:

- centimeter-normalized parcel geometry and topology;
- canonical blocks, parcels, frontage/access, easements, ownership and lineage;
- deterministic parcel generation from inherited roads/zoning;
- dimensional parcel zoning including uses, FAR, height, coverage, setbacks and frontage constraints;
- buildable envelopes and zoning compliance;
- canonical `BuildingV2` physical records;
- mixed-use massing and capacity;
- lifecycle, condition, maintenance, renovation and adaptive reuse;
- highest-and-best-use and property-market mechanics;
- site assembly and redevelopment execution;
- transactional parcel split/assembly/right-of-way/easement mutation;
- cross-domain cadastral mutation coordination;
- cadastral/zoning overlays, parcel picking and inspection;
- Save V9 persistence for accepted Urban Fabric authority.

`LotSystem` remains available only as a derived legacy compatibility facade.

## Implemented — desktop GPU runtime

The production world-rendering path uses `GpuWorldRenderer` with PixiJS 8 and WebGL.

Accepted presentation/runtime properties include:

- deterministic isometric projection through the existing camera contract;
- panning, anchored zoom, rotation and cell/parcel picking;
- terrain, zoning, roads, structures and active vehicle presentation;
- analytical overlays and tool previews;
- local pinned PixiJS browser ESM dependency in the built app;
- hardened Electron host with Node integration disabled, context isolation and sandboxing;
- browser and desktop targets executing the same authoritative simulation.

Legacy Canvas2D render sources are transitional migration references and are not the production `GameApp` world path.

## Current persistence

**Default format:** Save V9

```text
saveVersion: 9
gameVersion: 0.9.0-urban-fabric
```

V9 extends the complete V8 World Foundation envelope with cadastral, parcel-zoning, canonical-building and property-market state.

Older saves migrate through explicit compatibility paths. Derived state is rebuilt where possible. Migration must not fabricate legal/economic history.

## Transitional gameplay domains

The following domains remain playable and meaningful but are not yet the final Civic Foundry 2.0 authority models:

### Roads, traffic and accessibility

Current systems include deterministic road graphs, pathfinding, weighted trips, moving vehicles, intersections, queues, congestion and accessibility.

**Transitional because:** final lane, movement, signal, parking and crash authority belongs to 3R Transportation Engine 2.0.

### Transit

Current systems include bus, BRT, tram and metro topology, journey planning, passenger queues, transit vehicles, operations, fares, crowding, reliability and accessibility.

**Transitional because:** later mobility/transit replacement deepens schedules, fleets/depots and heterogeneous traveler choice.

### Firms and economy

Current systems include establishment-based firms, labor allocation, inventories, production, imports/exports, freight orders, explicit freight trucks, formation, distress, recovery and closure.

**Transitional because:** later Economy 2.0 introduces deeper input-output production, firm accounts, sector structure, ledger-backed transfers and supply-chain choice.

### Housing and population

Current systems include population/employment, housing affordability, tenure economics, persistent relocation and redevelopment safeguards.

**Transitional because:** later phases introduce explicit/weighted household and person state, richer property markets, mortgages and demographic life cycles.

### Public services

Current systems include fire, police, healthcare, education, waste, routed service vehicles, incidents, budgets and neighborhood quality.

**Transitional because:** Civic Institutions 2.0 will make facility operations depend more explicitly on staffing, equipment, queues and operating capacity.

### Utilities and municipal finance

Current gameplay includes utilities, taxation, treasury and recurring municipal finance.

**Transitional because:** future infrastructure and government-finance phases introduce explicit network assets, condition/failures, fund accounting, capital plans, bonds and long-term liabilities.

## Next major replacement

**Target / next major tranche:** Phase 3R — Transportation Engine 2.0.

Its authority scope includes lane configuration, turn movements, movement conflicts, signals, explicit parking, crashes/disruption and dynamic routing replacement.

Do not describe those capabilities as current 3R authority until the phase is accepted and merged.

## Things that are not yet current authority

Detailed specifications exist for many future systems. As of this snapshot, do not claim the following are fully implemented Civic Foundry 2.0 authority merely because they appear in the master design:

- final lane-aware Transportation 2.0;
- Civic Institutions 2.0;
- schedule/depot-based Mobility & Transit 2.0;
- full input-output Economy 2.0;
- explicit Real Estate Capitalism 2.0 and mortgage/developer-finance stack;
- household/person life-cycle replacement;
- explicit metropolitan utility networks;
- full environment/climate layer;
- mature municipal fund accounting and debt;
- politics/public opinion;
- planning-law reform system;
- construction megaproject execution stack;
- regional simulation and agglomeration systems;
- social-outcome model;
- institutional decision systems;
- complete urban observatory/causality UI;
- scenario editor and general modding framework.

## Verification rule

When this file and code appear to disagree, inspect the current accepted code and verification evidence. Update this document when a tranche changes accepted runtime truth.