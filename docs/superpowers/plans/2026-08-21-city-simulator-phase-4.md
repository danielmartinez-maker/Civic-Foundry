# Civic Foundry Phase 4 Public Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fire, police, healthcare, education, routed garbage collection, service vehicles, department budgets, network-based service accessibility, neighborhood-quality feedback, V4 persistence, and complete player-facing service tooling.

**Architecture:** Phase 4 extends the deterministic Phase 3 `SimulationCore` with focused service modules. Long-horizon demand remains aggregate, while facilities, jobs, vehicles, routing, response time, waste, capacity, funding, and rolling outcomes are authoritative state. Existing transportation graph/pathfinding is reused; presentation consumes immutable snapshots only.

**Tech Stack:** TypeScript ES modules, browser-native Canvas 2D, Node built-in test runner, global TypeScript 5.8.3, Python Playwright + system Chromium. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-city-simulator-phase-4-design.md`

## Global Constraints

- Preserve all verified Phase 1–3 behavior and Save V3 migration.
- Service coverage must use road-network travel/accessibility, never circular-radius-only coverage.
- Department funding range is 50%..150%, default 100%.
- Funding effectiveness is `clamp(0.5, 1.25, 0.35 + 0.65 * fundingRatio)`.
- Education school-age share is 0.18.
- Neighborhood quality is `0.22*fire + 0.22*police + 0.22*healthcare + 0.20*education + 0.14*garbage`.
- Residential service modifier is `clamp(-0.25, 0.15, (combinedServiceQuality - 0.70) * 0.50)`.
- Emergency vehicles get priority but are not immune to congestion.
- Save schema advances to V4; graphs, route caches, overlays, and rebuildable accessibility caches are not persisted.
- Every production change follows RED → GREEN → regression verification before GitHub publication.
- Every green milestone is pushed to `phase4-public-services`; no completed source may exist only in the transient workspace.

---

### Task 1: Service Definitions, Facilities, and Department Budgets

**Files:**
- Create: `src/data/services.ts`
- Create: `src/simulation/services/ServiceFacilitySystem.ts`
- Test: `tests/service-facilities.test.ts`
- Modify: `src/simulation/core/SimulationCore.ts`

**Interfaces:**
- Produces `ServiceDepartment`, `ServiceFacilityType`, `ServiceVehicleType`, `SERVICE_DEFINITIONS`.
- Produces `ServiceFacilitySystem.placeFacility()`, `setFunding()`, `fundingEffectiveness()`, `effectiveCapacity()`, `operatingCost()` and deterministic snapshots.

- [ ] Write failing tests for immutable definitions, placement validation/costs, deterministic IDs, 50–150 funding clamp, effectiveness formula, active-vehicle/capacity effects, and operating cost.
- [ ] Run focused test and confirm failures are missing service APIs.
- [ ] Implement minimum definitions/facility ownership/budgets and expose placement through `SimulationCore`.
- [ ] Run focused + full regression + typecheck.
- [ ] Publish exact changed files to GitHub with commit `feat: add service facilities and budgets`.

### Task 2: Service Demand and Network Accessibility

**Files:**
- Create: `src/simulation/services/ServiceDemandSystem.ts`
- Create: `src/simulation/services/ServiceAccessibilitySystem.ts`
- Test: `tests/service-accessibility.test.ts`

**Interfaces:**
- Consumes occupied buildings, population/employment/utilities/waste and `TransportationGraph`/`PathfindingSystem`.
- Produces per-building fire/police/healthcare/education/garbage demand and deterministic facility candidates with travel-cost/access scores.

- [ ] Write failing tests for deterministic demand formulas, school-age share, reachable-vs-disconnected facility selection, travel-time-over-Euclidean selection, and zero accessibility when no route exists.
- [ ] Verify RED.
- [ ] Implement demand/accessibility with deterministic facility-ID tie break and current traffic generalized edge costs.
- [ ] Run focused/full/typecheck.
- [ ] Publish milestone.

### Task 3: Dispatch Jobs and Explicit Service Vehicles

**Files:**
- Create: `src/simulation/services/ServiceDispatchSystem.ts`
- Create: `src/simulation/services/ServiceVehicleSystem.ts`
- Modify: `src/simulation/traffic/IntersectionSystem.ts`
- Test: `tests/service-dispatch.test.ts`

**Interfaces:**
- Produces authoritative `ServiceJob` lifecycle and `ServiceVehicle` state.
- Reuses Phase 3 graph/pathfinding; emergency vehicles use priority intersection service and reduced congestion coefficient.

- [ ] Write failing tests for waiting→assigned→responding→servicing→returning→completed, minimum predicted response-cost assignment, no teleport on unreachable jobs, emergency priority, garbage ordinary priority, and road-demolition reroute/fail safety.
- [ ] Verify RED.
- [ ] Implement dispatch/vehicle systems and priority queue hooks.
- [ ] Run focused/full/typecheck.
- [ ] Publish milestone.

### Task 4: Fire, Police, and Healthcare Incidents

**Files:**
- Create: `src/simulation/services/IncidentSystem.ts`
- Modify: `src/simulation/services/ServiceDemandSystem.ts`
- Test: `tests/service-incidents.test.ts`

**Interfaces:**
- Produces deterministic seeded fire/police/medical incidents from real exposure state.
- Fire owns intensity/damage and bounded cardinal spread; police/medical own unresolved outcome load.

- [ ] Write failing tests for risk-driven seeded incident generation, fire intensity growth/response suppression, bounded adjacent spread, police safety improvement after response, ambulance saturation/waiting demand.
- [ ] Verify RED.
- [ ] Implement minimum incident state and service effects.
- [ ] Run focused/full/typecheck.
- [ ] Publish milestone.

### Task 5: Routed Garbage and Education Capacity

**Files:**
- Create: `src/simulation/services/WasteCollectionSystem.ts`
- Create: `src/simulation/services/EducationSystem.ts`
- Modify: `src/simulation/garbage/GarbageSystem.ts`
- Test: `tests/service-garbage-education.test.ts`

**Interfaces:**
- Building waste state: collectible waste, generation rate, last collection tick, missed count.
- Garbage jobs use service vehicles and compatible processing facilities.
- Education snapshot derives eligible/reachable/enrolled/effective seats/overcrowding/access ticks/ratio.

- [ ] Write failing tests for deterministic waste generation, routed truck collection/return/unload, processing saturation, missed collection pressure, reachable-school capacity and overcrowding.
- [ ] Verify RED.
- [ ] Implement one-stop collection baseline and education aggregation.
- [ ] Run focused/full/typecheck.
- [ ] Publish milestone.

### Task 6: Neighborhood Quality, Fiscal Integration, and Simulation Scheduler

**Files:**
- Create: `src/simulation/services/NeighborhoodQualitySystem.ts`
- Modify: `src/simulation/demand/DemandSystem.ts`
- Modify: `src/simulation/economy/EconomySystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/service-core-integration.test.ts`

**Interfaces:**
- Produces per-building/citywide service-quality snapshots and bounded demand modifiers.
- `SimulationCore` executes the Phase 4 deterministic update order and exposes service timings/diagnostics.

- [ ] Write failing tests for weighted quality formula, residential/commercial modifiers, service operating costs, funding-effectiveness under unpaid obligations, congestion affecting response, and full scheduler integration.
- [ ] Verify RED.
- [ ] Implement integration without presentation-owned state.
- [ ] Run focused/full/typecheck.
- [ ] Publish milestone.

### Task 7: Save V4 and Migration

**Files:**
- Modify: `src/save/save.ts`
- Test: `tests/save-v4.test.ts`

**Interfaces:**
- V4 persists facilities/budgets/jobs/incidents/service vehicles/building waste/processing/fire damage/rolling response outcomes.
- V3→V4 initializes 100% budgets and deterministic landfill conversion without inventing successful history.

- [ ] Write failing round-trip, deterministic continuation, V3 migration, corrupt reference, active topology-mutation persistence tests.
- [ ] Verify RED.
- [ ] Implement V4 schema/validation/hydration and retain V2/V3 migration compatibility.
- [ ] Run focused/full/typecheck.
- [ ] Publish milestone.

### Task 8: Service UI, Overlays, Inspection, Budgets, Alerts

**Files:**
- Create: `src/rendering/ServiceOverlayLayer.ts`
- Create: `src/rendering/ServiceVehicleRenderer.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/ui/Hud.ts`
- Modify: `src/ui/Inspector.ts`
- Modify: `src/ui/ToolController.ts`
- Modify: `src/app/GameApp.ts`
- Modify: `src/styles.css`
- Test: `tests/service-presentation.test.ts`

**Interfaces:**
- Build tools: fire/police/clinic/school/recycling + landfill.
- Service overlays: fire/police/healthcare/education/garbage with numeric legends.
- Budget controls write only through typed core APIs.

- [ ] Write failing presentation-contract tests for authoritative HUD, facilities/buildings/vehicles inspection, overlay mapping, budget controls, and build tools.
- [ ] Verify RED.
- [ ] Implement Canvas/service UI and transition-based alerts.
- [ ] Run focused/full/typecheck/build.
- [ ] Publish milestone.

### Task 9: Phase 4 Headless Acceptance and Performance

**Files:**
- Create: `tests/phase4-headless.test.ts`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Two equivalent neighborhoods with equal nominal service capacity but different transportation access must diverge in response, unresolved jobs, garbage reliability, service quality, and development outcome.

- [ ] Write acceptance test before tuning implementation.
- [ ] Run and confirm it exposes any missing causal path.
- [ ] Fix only demonstrated causal gaps with targeted regression tests.
- [ ] Record deterministic hash, service/traffic timing, pathfinding/cache, active service-agent and queue measurements.
- [ ] Publish milestone.

### Task 10: Real Browser Smoke, Documentation, and Final Audit

**Files:**
- Create: `tests/smoke/phase4_smoke.py`
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/SIMULATION.md`, `docs/SAVE_FORMAT.md`, `docs/BALANCING.md`, `docs/TESTING.md`, `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- Browser scenario places all Phase 4 facilities, observes service jobs/vehicles, changes budget, degrades/repairs road access, saves V4, destructively edits, reloads exact state.

- [ ] Implement smoke harness against compiled ES modules.
- [ ] Run full matrix: tests, typecheck, lint, build, browser smoke.
- [ ] Update exact implemented values/formulas/provenance docs.
- [ ] Run repository SHA audit so every canonical source/test/config/doc file is in GitHub.
- [ ] Commit stable Phase 4 checkpoint before Phase 5 begins.
