# Civic Foundry Phase 5 — Transit Revolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic multimodal public transit that changes actual person-trip mode choice, road traffic, accessibility, and city outcomes.

**Architecture:** Preserve the proven road `TransportationGraph` and road traffic engine. Add a separate authoritative transit topology, a derived multimodal routing graph, weighted person-trip cohorts, deterministic journey planning/mode choice, explicit transit vehicles/passenger queues, and a focused mobility scheduler wired through `SimulationCore` without turning it into a god object.

**Tech Stack:** TypeScript ES modules, browser-native Canvas 2D, Node built-in test runner, global `tsc`, Python Playwright + system Chromium, dependency-free deterministic simulation.

**Spec:** `docs/superpowers/specs/2026-08-21-city-simulator-phase-5-transit-design.md`

## Global Constraints

- Preserve Phase 4 gameplay and deterministic behavior.
- `TransportationGraph` remains the road graph; transit gets its own topology.
- Same seed + same commands + same save state must produce the same authoritative continuation.
- Transit effects must derive from connectivity, frequency, capacity, transfers, fares, congestion, and traveler demand.
- Passenger/vehicle capacity is weighted; no one-agent-per-resident model.
- V5 persistence stores authoritative transit state but not derived multimodal graphs or caches.
- Every task must add focused tests first and publish a green GitHub checkpoint before the next task begins.
- No new npm/runtime dependencies.

---

### Task 1: Transit Data Model and Topology

**Files:**
- Create: `src/data/transit.ts`
- Create: `src/simulation/transit/TransitNetworkSystem.ts`
- Test: `tests/transit-network.test.ts`

**Interfaces:**
- Produces `TransitMode = 'bus' | 'brt' | 'tram' | 'metro'`.
- Produces `TransitStop`, `TransitLine`, `TransitNetworkSnapshot`.
- Produces `TransitNetworkSystem.placeStop(...)`, `createLine(...)`, `setLineStops(...)`, `setHeadway(...)`, `setFare(...)`, `setEnabled(...)`, `snapshot()`, `restore(...)`, and `revision`.

- [ ] Write failing tests proving deterministic stop/line IDs, ordered stop validation, topology revision changes, line headway/fare bounds, stop deletion invalidation, and restore round-trip.
- [ ] Run `node --experimental-strip-types --test tests/transit-network.test.ts` and verify RED only because transit modules do not exist.
- [ ] Implement immutable transit definitions and authoritative topology ownership with deterministic validation and snapshots.
- [ ] Run focused test, then `npm test` and `npm run typecheck`.
- [ ] Commit `feat: add deterministic transit topology`.

### Task 2: Multimodal Graph and Journey Planning

**Files:**
- Create: `src/simulation/transit/MultimodalRoutingGraph.ts`
- Create: `src/simulation/transit/JourneyPlanner.ts`
- Test: `tests/transit-routing.test.ts`

**Interfaces:**
- `MultimodalRoutingGraph.rebuild(roadGraph, transitNetwork, lineTravelTimeProvider)` derives walking, boarding/waiting, transit ride, transfer, and car alternative edges.
- `JourneyPlanner.plan(originRoadNodeId, destinationRoadNodeId, options)` returns deterministic `JourneyPlan` with total generalized cost, legs, transfers, expected wait, fare, and in-vehicle/walk time.

- [ ] Write RED tests for direct transit, transfers, disconnected stops, deterministic tie-breaking, cache invalidation on road/transit revision, and generalized-cost preference.
- [ ] Implement bounded deterministic stop walking connectors and derived transit ride/transfer edges without persisting them.
- [ ] Implement deterministic shortest generalized-cost journey planning with revision-keyed cache statistics.
- [ ] Run focused tests, full tests, typecheck.
- [ ] Commit `feat: add multimodal journey planning`.

### Task 3: Person-Trip Cohorts and Mode Choice

**Files:**
- Create: `src/simulation/mobility/PersonTripSystem.ts`
- Create: `src/simulation/mobility/ModeChoiceSystem.ts`
- Modify: `src/simulation/traffic/TripGenerationSystem.ts`
- Test: `tests/transit-mode-choice.test.ts`

**Interfaces:**
- Produces weighted `PersonTripCohort` with purpose, origin/destination building IDs, road access nodes, departure tick, and traveler weight.
- `ModeChoiceSystem.choose(carAlternative, transitAlternative, context)` returns `car | transit | unmet` plus deterministic costs.

- [ ] Write RED tests proving equivalent trips generate stable cohorts, frequent direct transit can beat congested car travel, slow/circuitous/transferring transit loses, fares/crowding alter mode choice, and no route returns unmet demand.
- [ ] Implement weighted person-trip generation adapters while retaining Phase 3 car-trip compatibility.
- [ ] Implement deterministic mode choice based on generalized cost with no RNG dependence for equal inputs.
- [ ] Run focused/full tests and typecheck.
- [ ] Commit `feat: add person trips and transit mode choice`.

### Task 4: Passenger Queues and Capacity

**Files:**
- Create: `src/simulation/transit/PassengerQueueSystem.ts`
- Test: `tests/transit-passengers.test.ts`

**Interfaces:**
- `enqueue(stopId, lineId, directionKey, cohort)`.
- `board(stopId, lineId, directionKey, capacity)` returns boarded weighted cohorts and left-behind weight.
- `alight(...)`, `snapshot()`, `restore(...)` preserve deterministic FIFO ordering and partial weighted cohorts.

- [ ] Write RED tests for FIFO weighted boarding, partial boarding, left-behind passengers, transfer queues, deterministic queue snapshots, and deletion/replan handling.
- [ ] Implement queue ownership with stable ordering and partial-cohort splitting.
- [ ] Run focused/full tests and typecheck.
- [ ] Commit `feat: add capacity-constrained passenger queues`.

### Task 5: Transit Vehicles and Operations

**Files:**
- Create: `src/simulation/transit/TransitVehicleSystem.ts`
- Create: `src/simulation/transit/TransitOperationsSystem.ts`
- Modify: `src/simulation/traffic/TrafficSystem.ts`
- Test: `tests/transit-vehicles.test.ts`

**Interfaces:**
- Transit vehicles own mode, line, stop index, progress, capacity, onboard weighted passengers, dwell state, delay, and service status.
- Bus/street tram submits real road load to `TrafficSystem`; BRT uses reduced-congestion abstraction; metro uses dedicated transit segment timing.
- Operations dispatches by headway/fleet availability and reports ridership, vehicle-hours, reliability, operating cost, fare revenue, and cost recovery.

- [ ] Write RED tests for scheduled dispatch, stop progression, dwell, boarding/alighting, capacity, bus congestion sensitivity, metro congestion insulation, fleet shortages, and road-segment deletion safety.
- [ ] Implement explicit transit vehicle lifecycle and operations counters.
- [ ] Integrate road-running transit weight into authoritative road congestion without mutating commuter semantics.
- [ ] Run focused/full tests and typecheck.
- [ ] Commit `feat: add explicit transit operations`.

### Task 6: Mobility Scheduler and City Feedback

**Files:**
- Create: `src/simulation/mobility/MobilityScheduler.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/demand/DemandSystem.ts`
- Modify: `src/simulation/economy/EconomySystem.ts`
- Test: `tests/transit-integration.test.ts`

**Interfaces:**
- `MobilityScheduler.tick(coreContext)` owns the Phase 5 scheduling order from the spec.
- Exposes authoritative mobility snapshot: car mode share, transit mode share, unmet share, weighted person accessibility, ridership, mean wait, reliability, and crowding.

- [ ] Write RED integration tests proving competitive transit reduces car traffic, bad transit remains low-share, congestion worsens bus service, and improved person accessibility feeds bounded city demand/economy rather than flat bonuses.
- [ ] Move mobility-specific orchestration out of `SimulationCore` into `MobilityScheduler` while preserving existing public APIs.
- [ ] Wire person accessibility into demand/economy using bounded deterministic modifiers.
- [ ] Run focused/full tests and typecheck.
- [ ] Commit `feat: integrate multimodal mobility into city simulation`.

### Task 7: Save V5

**Files:**
- Modify: `src/save/save.ts`
- Test: `tests/save-v5.test.ts`
- Modify: `tests/save-v3.test.ts` only where terminal version assertions become V5-aware.
- Modify: `tests/save-v4.test.ts` only where terminal version assertions become V5-aware.

**Interfaces:**
- V5 persists transit topology/config, vehicle state, passenger queues, committed person/transit journeys, operations counters required for continuation, next IDs, and relevant RNG/cadence state.
- V4→V5 initializes honest empty transit state.

- [ ] Write RED tests for V5 exact round-trip, deterministic continuation with active transit vehicles/passenger queues, corrupt transit reference rejection, and V4→V5 migration.
- [ ] Add restore hooks only at authoritative state owners; do not reach through private state from save code.
- [ ] Implement V5 validation/migration and derived graph/cache rebuild after hydration.
- [ ] Run focused/full tests and typecheck.
- [ ] Commit `feat: add deterministic Save V5 transit persistence`.

### Task 8: Transit Player Tools and Presentation

**Files:**
- Create: `src/rendering/TransitOverlayLayer.ts`
- Create: `src/rendering/TransitVehicleRenderer.ts`
- Create: `src/ui/TransitPanel.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/ui/Hud.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/ui/ToolController.ts`
- Modify: `src/styles.css`
- Test: `tests/transit-presentation.test.ts`

**Interfaces:**
- Build stop/station, create/edit line, ordered stop editing, headway/fare controls, enable/disable line, transit budget/fleet controls.
- Overlays expose routes/modes, access, ridership, crowding, wait, reliability, mode share, person accessibility with numeric legends.

- [ ] Write RED presentation-contract tests for authoritative HUD values, stop/line/vehicle inspector output, overlay legends, and command wiring.
- [ ] Implement pure transit overlay/renderer/panel contracts first.
- [ ] Wire into Phase V browser shell without embedding simulation logic in DOM code.
- [ ] Run focused/full tests, typecheck, lint, and build.
- [ ] Commit `feat: add Phase V transit tools and overlays`.

### Task 9: Headless Acceptance and Performance

**Files:**
- Create: `tests/phase5-headless.test.ts`
- Modify: `docs/TESTING.md`
- Modify: `docs/BALANCING.md`
- Modify: `docs/SIMULATION.md`

**Interfaces:**
- Acceptance diagnostics compare car-only, strong-transit, and poor-transit corridors.

- [ ] Add deterministic scenario builder for equivalent corridors.
- [ ] Assert strong transit lowers weighted car traffic and improves person accessibility while poor transit does not falsely win.
- [ ] Assert capacity reduction raises queues/wait and lowers transit attractiveness.
- [ ] Benchmark 10,000 mixed-mode journey plans and 5,000 active-transit ticks; assert finite diagnostics and cache hit ratio >95% on stable topology.
- [ ] Run full test/typecheck/lint/build matrix.
- [ ] Commit `test: verify Phase 5 multimodal acceptance and performance`.

### Task 10: Chromium Smoke, Documentation, and GitHub Durability Audit

**Files:**
- Create: `tests/smoke/phase5_smoke.py`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_LOG.md`
- Modify: `docs/SAVE_FORMAT.md`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Browser smoke must build a city, create a transit line, observe ridership/vehicles/overlay, change headway/fare, save V5, destructively edit transit/roads, reload, and verify exact restoration.

- [ ] Write real Chromium Phase V smoke harness and make it fail against missing browser behavior before final wiring fixes.
- [ ] Fix any browser-only defects with focused regression tests first.
- [ ] Update architecture/save/balancing/testing/development docs with implemented formulas and known constraints.
- [ ] Run final matrix: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `python tests/smoke/phase5_smoke.py`, placeholder scan.
- [ ] Generate local Git blob manifest for canonical source/tests/config/docs; compare every changed/missing file to GitHub branch and publish exact-byte blobs/tree.
- [ ] Create final `feat: complete verified Phase 5 transit` commit, move `metropolitan-era` to it, fetch recursive tree, confirm no temporary files, and re-run completion verification.
