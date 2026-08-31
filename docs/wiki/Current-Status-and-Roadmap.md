# Current Status & Roadmap

[← Wiki Home](Home.md)

## Accepted foundation

### Phase 0A — Kernel Skeleton & Deterministic Scheduling
**Implemented.** Establishes deterministic orchestration, ordering, clock infrastructure, RNG streams, events, invariants, snapshots, and compatibility scheduling.

### Phase 1R — World Foundation 2.0
**Implemented.** Adds the canonical physical world: irregular geography, terrain and engineering properties, groundwater, hydrology, flooding, deterministic generation, spatial indexes, terrain-aware costs, Save V8, and the legacy terrain compatibility adapter.

### Phase 2R — Urban Fabric 2.0
**Implemented.** Adds canonical cadastral parcels, dimensional zoning, buildable envelopes, `BuildingV2`, mixed-use massing, lifecycle, renovation/adaptive reuse, highest-and-best-use analysis, property market, site assembly, parcel mutation, cross-domain mutation coordination, and Save V9.

### Desktop GPU Runtime
**Implemented.** PixiJS 8/WebGL is the production world-rendering path, hosted locally by Electron for Windows desktop. Browser remains a development and smoke-test target.

## Transitional gameplay domains

The current playable baseline still includes road graphs, traffic, transit, taxation, treasury, utilities, firms, production, inventories, freight, housing affordability, relocation, service facilities, emergency/service vehicles, incidents, budgets, and neighborhood quality.

These systems are real and playable but several remain **Transitional** because later 2.0 phases will deepen or replace their authority.

## Next major phase

### 3R — Transportation Engine 2.0
**Target / next major authority replacement.** Planned scope includes road hierarchy, lane authority, turns, intersection movement groups, signal phases, parking, incidents/crashes, dynamic routing, generalized travel cost, trip causality, and migration of current road state.

Existing transportation remains available until 3R passes acceptance gates.

## Long-range sequence

```text
0A  Kernel
1R  World Foundation
2R  Urban Fabric
3R  Transportation Engine
4R  Civic Institutions
5R  Mobility & Transit
6R  Economy
7R  Real Estate Capitalism
8   Households & People
9   Metropolitan Infrastructure Networks
10  Environment & Climate
11  Municipal Government & Finance
12  Politics & Public Opinion
13  Planning Law
14  Construction & Megaprojects
15  Regional Simulation
16  Agglomeration & City Identity
17  Social Outcomes
18  Institutional Decision Systems
19  City Analytics & Explainability
20  Scenarios, Editor, Replay & Modding
```

Later phases may be refined or decomposed before implementation. The sequence is architectural direction, not an implementation claim.

## Phase completion gate

A phase is complete only when applicable design, implementation plan, tests, typecheck/lint/build, invariants, save/load/replay, migration fixtures, performance budget, smoke tests, documentation updates, and verification evidence are complete. Legacy authority is removed only after the replacement is accepted.