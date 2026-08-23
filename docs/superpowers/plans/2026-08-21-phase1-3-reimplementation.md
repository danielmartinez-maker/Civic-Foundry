# Civic Foundry Phase 1–3 Reimplementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Civic Foundry from an empty source tree through the verified Phase 3 feature scope, reverify every implemented system from scratch, and publish every tracked source/test/config/doc line to GitHub so no canonical code exists only in a transient runtime.

**Architecture:** A deterministic renderer-independent `SimulationCore` owns terrain, roads, zoning, buildings, population, economy/utilities, transportation graph, trips, vehicles, intersections, and traffic analytics. A browser Canvas 2D presentation reads snapshots and submits typed player commands; save/load persists authoritative state through V3 while rebuildable graph/cache/presentation state is reconstructed.

**Tech Stack:** TypeScript 5.x (strict), browser Canvas 2D, Node 22 built-in test runner with TypeScript strip-types, static HTML/CSS build via global `tsc`, Python Playwright/Chromium smoke when available.

**Spec:** `docs/superpowers/specs/2026-08-20-city-simulator-phase-3-design.md` plus the preserved Phase 1 design and master development prompt.

## Global Constraints

- This is a fresh reimplementation; do not claim byte/code continuity with lost checkpoint `f0bb3d6`.
- GitHub `danielmartinez-maker/Civic-Foundry` is the canonical durable source. Every stable milestone must be committed there.
- TypeScript strict mode stays enabled.
- Simulation modules do not import DOM/rendering code.
- Authoritative randomness uses seeded RNG only.
- Player mutations validate before changing authoritative state.
- Important metrics derive from actual simulation state; no fake traffic, unemployment, utilities, or demand.
- Save format at final Phase 3 state is `saveVersion: 3` with deterministic continuation.
- Phase 3 implements local/collector/arterial roads, transportation graph, routed trips, vehicles, intersections, congestion, traffic analytics, and overlays; public-service vehicles remain Phase 4.
- Every task uses red → green → refactor and ends with focused tests plus a GitHub checkpoint.

---

### Task 1: Repository Scaffold, Deterministic Core, Terrain, Treasury

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `src/styles.css`
- Create: `src/simulation/core/{types.ts,SeededRandom.ts,SimulationClock.ts,SimulationCore.ts}`
- Create: `src/world/terrain/TerrainGrid.ts`
- Create: `src/simulation/treasury/TreasurySystem.ts`
- Test: `tests/core-foundation.test.ts`

**Interfaces:**
- `SeededRandom.next(): number`, `getState(): number`, `setState(state:number): void`
- `SimulationClock.step(ticks?:number): void`, `tick:number`, `speed:0|1|2|4`
- `TerrainGrid.generate(width,height,seed)` and `isBuildable(x,y)`
- `TreasurySystem.tryDebit(amount,reason): boolean`, `credit(amount,reason): void`

- [ ] Write failing tests for same-seed RNG/terrain, finite terrain, treasury no-negative invariant, and clock stepping.
- [ ] Run focused tests and verify RED because modules are absent.
- [ ] Implement minimal deterministic core/terrain/treasury.
- [ ] Run focused tests, full tests, and typecheck until GREEN.
- [ ] Publish all Task 1 files to GitHub branch `rebuild-phase3` and record checkpoint.

### Task 2: Roads, Zoning, Lots, Buildings, Population

**Files:**
- Create: `src/data/roads.ts`, `src/data/buildings.ts`
- Create: `src/world/roads/RoadSystem.ts`
- Create: `src/simulation/zoning/ZoningSystem.ts`
- Create: `src/world/lots/LotSystem.ts`
- Create: `src/simulation/buildings/BuildingSystem.ts`
- Create: `src/simulation/population/PopulationSystem.ts`
- Test: `tests/city-foundation.test.ts`

**Interfaces:**
- `RoadSystem.placePath(cells,roadType)` validates terrain/overlap and charges treasury through `SimulationCore` command facade.
- `ZoningSystem.paint(cells, zone)` supports residential/commercial/industrial.
- `LotSystem.rebuild(roads,zoning)` derives road-frontage developable lots.
- `BuildingSystem.evaluateDevelopment(tick,demand)` and `tick(tick)` progress vacant → construction → occupied.
- `PopulationSystem.update(residentialCapacity, attractiveness)` stays bounded.

- [ ] Write failing tests for road placement/cost/revision, zoning eligibility, lot frontage, construction lifecycle, and bounded population.
- [ ] Verify RED.
- [ ] Implement minimal systems and SimulationCore command facade.
- [ ] Verify focused/full tests and typecheck GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 3: Core City Loop — Employment, Demand, Taxes, Utilities, Garbage

**Files:**
- Create: `src/simulation/employment/EmploymentSystem.ts`
- Create: `src/simulation/demand/DemandSystem.ts`
- Create: `src/simulation/tax/TaxSystem.ts`
- Create: `src/simulation/utilities/UtilitySystem.ts`
- Create: `src/simulation/garbage/GarbageSystem.ts`
- Create: `src/simulation/economy/EconomySystem.ts`
- Create: `src/data/utilities.ts`
- Test: `tests/core-city-loop.test.ts`

**Interfaces:**
- Employment derives workforce/jobs/unemployment from actual population/occupied job buildings.
- Demand returns R/C/I normalized `[-1,1]` from housing/jobs/services/taxes.
- Utilities own placed power/water/landfill facilities and road-component-limited capacity.
- Garbage accumulates per-building backlog and is constrained by connected processing.
- Economy settles recurring taxes and utility operating costs without negative treasury.

- [ ] Write failing tests for employment, demand sensitivity, taxes, utility shortages, garbage backlog, and fiscal settlement.
- [ ] Verify RED.
- [ ] Implement systems and deterministic Phase 2 evaluation order.
- [ ] Verify focused/full tests and typecheck GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 4: Road Hierarchy and Transportation Graph

**Files:**
- Modify: `src/data/roads.ts`, `src/world/roads/RoadSystem.ts`
- Create: `src/simulation/traffic/TransportationGraph.ts`
- Test: `tests/transport-graph.test.ts`

**Interfaces:**
- Road classes: `local`, `collector`, `arterial` with construction cost, free-flow speed, capacity, intersection service rate, render width.
- `TransportationGraph.rebuildIfNeeded(roads)` returns deterministic nodes/edges and revision.

- [ ] Write failing tests for road-class values, legal joins/intersections, graph nodes/edges, and revision invalidation.
- [ ] Verify RED.
- [ ] Implement road hierarchy/intersection geometry and graph derivation.
- [ ] Verify focused/full tests GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 5: A* Pathfinding, Trips, Intersection Queues

**Files:**
- Create: `src/simulation/traffic/PathfindingSystem.ts`
- Create: `src/simulation/traffic/TripGenerationSystem.ts`
- Create: `src/simulation/traffic/IntersectionSystem.ts`
- Test: `tests/traffic-routing.test.ts`

**Interfaces:**
- `PathfindingSystem.findRoute(graph,startNode,endNode,costProvider)` uses deterministic A* and revision-aware route cache.
- `TripGenerationSystem.generate(...)` creates weighted commute/shopping trips from actual occupied buildings.
- `IntersectionSystem.enqueue(...)`, `step(...)`, `removeVehicle(...)` maintains deterministic approach queues.

- [ ] Write failing tests for shortest/generalized-cost route, tie breaking, cache invalidation, deterministic trips, FIFO/service capacity.
- [ ] Verify RED.
- [ ] Implement modules.
- [ ] Verify focused/full tests GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 6: Vehicle Movement, Congestion, Traffic Analytics and Feedback

**Files:**
- Create: `src/simulation/traffic/TrafficSystem.ts`
- Create: `src/simulation/traffic/TrafficAnalytics.ts`
- Modify: `src/simulation/core/SimulationCore.ts`, `src/simulation/demand/DemandSystem.ts`
- Test: `tests/traffic-simulation.test.ts`

**Interfaces:**
- Active vehicles carry weighted trip cohort, route edges, progress, speed, delay, status.
- Edge metrics derive weighted occupancy/volume, capacity utilization, average speed, congestion, traversal time.
- Traffic analytics expose average commute, network speed, congestion index, job/commercial accessibility, delayed share, bottlenecks.
- Demand applies bounded traffic accessibility modifiers.

- [ ] Write failing tests for vehicle progression/completion, congestion from actual flow, overloaded corridor delay, analytics normalization, demand feedback, and stale-edge demolition safety.
- [ ] Verify RED.
- [ ] Implement traffic scheduler/analytics and deterministic topology-mutation cleanup.
- [ ] Verify focused/full tests GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 7: Save V3 and Deterministic Continuation

**Files:**
- Create: `src/save/save.ts`
- Test: `tests/save-v3.test.ts`

**Interfaces:**
- `serializeCore(core): SaveV3`
- `hydrateCore(save): SimulationCore`
- Persist authoritative terrain/roads/zoning/buildings/population/treasury/tax/utilities/garbage/economy/RNG/clock/active trips/vehicles/queues/rolling traffic outcomes.
- Rebuild graph, route cache, and analytics after load.

- [ ] Write failing tests for V3 round-trip, deterministic continuation, corrupt-reference rejection, and earlier-version safe defaults.
- [ ] Verify RED.
- [ ] Implement V3 schema/validation/migration/hydration.
- [ ] Verify focused/full tests GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 8: Browser Presentation, Tools, HUD, Inspectors, Traffic Overlays

**Files:**
- Create: `src/main.ts`, `src/app/GameApp.ts`
- Create: `src/rendering/WorldRenderer.ts`, `src/rendering/TrafficOverlayLayer.ts`, `src/rendering/VehicleRenderer.ts`
- Create: `src/ui/Hud.ts`, `src/ui/Inspector.ts`, `src/ui/ToolController.ts`
- Modify: `index.html`, `src/styles.css`
- Test: `tests/presentation-contract.test.ts`

**Interfaces:**
- Canvas renderer consumes immutable `SimulationCore` snapshots.
- Tool controller supports road types, R/C/I zoning, power/water/landfill, bulldoze, inspect.
- HUD exposes treasury/population/demand/jobs/services/taxes/traffic metrics/save/load/speed.
- Traffic overlays: congestion/speed/volume/bottlenecks with textual legend.

- [ ] Write failing pure presentation-contract tests for HUD metrics, inspection strings, overlay snapshot mapping.
- [ ] Verify RED.
- [ ] Implement browser presentation and interaction.
- [ ] Build and run tests/typecheck GREEN.
- [ ] Publish checkpoint to GitHub.

### Task 9: Headless Acceptance, Browser Smoke, Documentation, GitHub Integrity

**Files:**
- Create: `tests/phase3-headless.test.ts`, `tests/smoke/phase3_smoke.py`
- Create/update: `README.md`, `docs/ARCHITECTURE.md`, `docs/SIMULATION.md`, `docs/SAVE_FORMAT.md`, `docs/BALANCING.md`, `docs/TESTING.md`, `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- Headless acceptance compares otherwise-equivalent local-street vs arterial cities.
- Browser smoke drives real compiled modules in Chromium and verifies build/zone/utilities/traffic/overlay/save/destructive edit/load.

- [ ] Add acceptance test proving poorer road capacity creates higher congestion/longer commute/lower accessibility and weaker demand.
- [ ] Add deterministic same-seed final V3 hash test and pathfinding/traffic timing diagnostics.
- [ ] Build and run Chromium smoke; inspect screenshot.
- [ ] Run final matrix: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:smoke`.
- [ ] Publish every tracked source/test/config/doc file to GitHub; compare local manifest against GitHub manifest; ensure no canonical source exists only locally.
- [ ] Close recovery issue with provenance: fresh reimplementation, not recovered historical bytes.
- [ ] Create stable Phase 3 rebuild checkpoint and only then begin Phase 4.
