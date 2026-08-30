# Civic Foundry 2.0 — Roadmap

## Roadmap rule

A phase is **Target** until its implementation passes the required design, verification, persistence, determinism, performance and documentation gates. A detailed spec does not make a phase implemented.

## Completed / accepted foundation

### Phase 0A — Kernel Skeleton & Deterministic Scheduling — Implemented

Purpose: introduce deterministic orchestration beneath the compatibility runtime without forcing a clean-slate rewrite.

Strategic outcome: later systems can replace authority progressively while preserving accepted gameplay behavior.

### Phase 1R — World Foundation 2.0 — Implemented

Major scope:

- geographic hierarchy;
- irregular geometry;
- deterministic terrain and engineering properties;
- hydrology and flooding;
- seeded world generation;
- spatial indexing;
- terrain-aware costs;
- persistence through Save V8 baseline.

Authority established: `WorldFoundation` owns physical/geographic state.

### Phase 2R — Urban Fabric 2.0 — Implemented

Major scope:

- true cadastral parcels and topology;
- dimensional zoning;
- buildable envelopes;
- mixed-use `BuildingV2`;
- lifecycle/maintenance/renovation;
- property and highest-and-best-use mechanics;
- assembly/redevelopment;
- cadastral mutation;
- Save V9.

Authority established: `CadastralGraph` owns legal land.

### Desktop GPU Runtime — Implemented

Major scope:

- production `GpuWorldRenderer`;
- PixiJS/WebGL rendering;
- hardened Electron Windows host;
- retained browser development/smoke path;
- simulation/save authority remains outside presentation.

## Next major phase

### Phase 3R — Transportation Engine 2.0 — Target / next replacement

Goal: replace simplified/legacy road traffic authority with a lane-aware, movement-aware multimodal street engine.

Target scope:

- road hierarchy and explicit lane configuration;
- permitted movements and turn restrictions;
- movement/conflict-aware intersections;
- signal phases and timing;
- dynamic route choice;
- explicit parking inventory/pricing/occupancy;
- crashes and disruption;
- trip causality tied to real activities/economic relationships.

Key acceptance ideas:

- movement conservation;
- deterministic route invalidation after topology edits;
- congestion responds to lane/signal/capacity changes;
- parking scarcity affects generalized cost;
- inherited roads migrate into valid default lane configurations.

## Progressive replacement sequence

### Phase 4R — Civic Institutions 2.0 — Target

Turn public services into operating institutions with staffing, equipment, queues, catchments, budgets and condition.

Core domains: healthcare, education, police, fire/EMS and waste.

### Phase 5R — Mobility & Transit 2.0 — Target

Expand multimodal travel and transit into schedule-based operations with heterogeneous traveler utility, fleet/depot constraints, passenger queues and delay propagation.

### Phase 6R — Economy 2.0 — Target

Replace the compact inherited economy with a data-driven urban/regional input-output economy.

Core scope: sectors, production recipes, firm accounts, labor markets, entrepreneurship, supplier choice, supply chains and freight.

### Phase 7R — Real Estate Capitalism 2.0 — Target

Introduce explicit ownership, rental/sale markets, mortgages, developer finance, lenders, contractors, planning/approval and conservation-safe redevelopment/displacement mechanics.

### Phase 8 — Households & People — Target

Make weighted/explicit households and people the primary demographic state, including age, education, occupation, income, household membership, migration and life-cycle processes.

### Phase 9 — Metropolitan Infrastructure Networks — Target

Create explicit networks for electricity, water, wastewater, drainage and telecommunications with capacity, condition, maintenance and failures.

### Phase 10 — Environment & Climate — Target

Add air/water quality, noise, urban heat, energy/emissions, weather/climate hazards, vegetation and resilience mechanics that feed health, costs, land value and migration.

### Phase 11 — Municipal Government & Finance — Target

Expand finance into fund accounting, capital/operating budgets, taxes/fees, grants, bonds, debt service, credit quality, pensions/long-term liabilities and maintenance backlogs.

### Phase 12 — Politics & Public Opinion — Target

Add resident preferences, mayor/council politics, approval, neighborhood organizations, project coalitions/opposition, elections and political feasibility.

### Phase 13 — Planning Law — Target

Make the regulatory code itself a player-controlled policy system: zoning maps, dimensional rules, overlays, parking requirements, impact fees, inclusionary policy, density bonuses and related planning tools.

### Phase 14 — Construction & Megaprojects — Target

Represent large projects through design, land acquisition, procurement, contractors, stages, work zones, budgets, schedule and overrun/delay risk.

### Phase 15 — Regional Simulation — Target

Place the detailed city inside a lower-fidelity region with neighboring municipalities, regional labor/housing, gateways, tourism, intercity freight and cross-boundary commuting.

### Phase 16 — Agglomeration & City Identity — Target

Allow specialization and clusters to emerge from workforce, suppliers, institutions, infrastructure, land economics and policy.

### Phase 17 — Social Outcomes — Target

Model inequality, poverty, housing burden, displacement, homelessness, segregation, attainment, health, social mobility and crime risk as consequences of underlying systems.

### Phase 18 — Institutional Decision Systems — Target

Give major non-player actors bounded deterministic decision models: households, firms, developers, lenders, agencies, departments and politicians.

### Phase 19 — City Analytics & Explainability — Target

Build the full urban observatory over statistics and causality tracing, with historical/spatial analysis and player-facing “Why?” explanations.

### Phase 20 — Scenarios, Editor, Replay & Modding — Target

Make safe static definitions data driven, add scenario authoring/editor tooling, deterministic replay/challenges and content-first mod support.

## Critical dependency chain

The strategic sequence remains:

```text
Kernel
→ World Foundation
→ Urban Fabric
→ Transportation
→ Civic Institutions
→ Mobility/Transit
→ Economy
→ Real Estate
→ Households
→ Infrastructure
→ Environment
→ Government/Politics
→ later metropolitan systems
```

Parallel implementation is allowed only when stable interfaces exist and two efforts do not create competing authority over the same domain.

## Phase completion gate

A phase should not be marked Implemented until applicable conditions are satisfied:

1. approved phase design;
2. implementation plan;
3. material behavior covered by tests;
4. implementation complete;
5. typecheck/lint/build green;
6. relevant unit/integration/invariant suites green;
7. deterministic save/load/replay behavior green;
8. migration fixtures green where applicable;
9. performance budget met;
10. presentation smoke tests green where applicable;
11. documentation updated;
12. architecture/source-of-truth docs updated;
13. old authority removed only after replacement parity/acceptance;
14. verification evidence recorded.

The approved strategic master design remains at `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`.