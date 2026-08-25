# Civic Foundry Comprehensive Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair every confirmed correctness issue from the August 24, 2026 Civic Foundry audit and add regression coverage for each repaired behavior.

**Architecture:** Fix shared invariants before domain-specific calculations. Centralize intersection release ownership, canonicalize spatial occupancy and multi-frontage access, make dynamic routing caches epoch-aware, and ensure instantiated buildings always use `definitionId`-specific data. Preserve deterministic ordering and current save compatibility.

**Tech Stack:** TypeScript, Node test runner, Vite, GitHub Actions.

**Spec:** The comprehensive Civic Foundry bug audit in the immediately preceding review.

## Global Constraints

- Work only on `fix/comprehensive-audit-2026-08-24` until verification passes.
- Use test-first development: add failing regression tests before production changes.
- Preserve deterministic simulation ordering and save/restore compatibility.
- Do not rebuild systems that already work; make the smallest architectural change that closes each invariant gap.
- Run `npm test`, strict typecheck, lint, and build before completion.

---

### Task 1: Intersection queue ownership and weighted service

**Files:**
- Modify: `src/simulation/traffic/IntersectionSystem.ts`
- Modify: `src/simulation/traffic/TrafficSystem.ts`
- Modify: `src/simulation/services/ServiceVehicleSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/intersection-integration.test.ts`

**Interfaces:**
- Consumes: existing vehicle queue entries and `IntersectionSystem.enqueue()`.
- Produces: a single per-tick intersection release pass plus partial service for cohorts whose traveler weight exceeds one-tick capacity.

- [ ] **Step 1: Write failing tests**

```ts
test('traffic and service vehicles released from one shared intersection are each consumed exactly once', () => {
  // Queue one traffic vehicle and one service vehicle at the same node, resolve once,
  // and assert neither system remains queued after its release.
});

test('a vehicle cohort heavier than one-tick intersection capacity eventually traverses', () => {
  // Enqueue a cohort whose weight exceeds one-tick capacity and step multiple ticks;
  // assert residual weight is serviced and the vehicle is eventually released.
});
```

- [ ] **Step 2: Verify the new tests fail on the audit branch before production changes.**
- [ ] **Step 3: Implement a single resolver ownership path and residual queue weight accounting.**
- [ ] **Step 4: Verify intersection tests pass.**

### Task 2: Spatial occupancy, zoning, and lot/building referential integrity

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/utilities/UtilitySystem.ts`
- Modify: `src/world/lots/LotSystem.ts` if required by the invariant
- Test: `tests/spatial-invariants.test.ts`

**Interfaces:**
- Consumes: existing buildings, utilities, services, transit stops, roads, and zoning.
- Produces: one canonical occupancy check for construction and topology mutations.

- [ ] **Step 1: Write failing tests**

```ts
test('roads cannot be built through occupied cells', () => {});
test('utilities cannot overlap buildings services or transit stops', () => {});
test('rezoning an occupied building cell is rejected', () => {});
test('removing sole road frontage never leaves a building whose lot no longer exists', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Add core occupancy validation and protect developed-lot frontage invariants.**
- [ ] **Step 4: Verify tests pass.**

### Task 3: Shared multi-frontage access and routing cache epochs

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/services/ServiceAccessibilitySystem.ts`
- Modify: `src/simulation/services/ServiceDispatchSystem.ts`
- Modify: `src/simulation/services/ServiceVehicleSystem.ts`
- Modify: `src/simulation/services/EducationSystem.ts`
- Modify: `src/simulation/transit/TransitVehicleSystem.ts`
- Modify: `src/simulation/traffic/PathfindingSystem.ts` if API support is required
- Test: `tests/access-routing-regressions.test.ts`

**Interfaces:**
- Produces: evaluation over all adjacent access nodes and explicit congestion epoch in dynamic path cache keys.

- [ ] **Step 1: Write failing tests**

```ts
test('a property with two frontages uses the reachable road component', () => {});
test('service dispatch route changes when congestion epoch changes', () => {});
test('surface transit route changes when congestion epoch changes', () => {});
test('education access route changes when congestion epoch changes', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement all-frontage access and epoch-aware cache keys.**
- [ ] **Step 4: Verify tests pass.**

### Task 4: Transit correctness

**Files:**
- Modify: `src/simulation/transit/TransitOperationsSystem.ts`
- Modify: `src/simulation/mobility/MobilityScheduler.ts`
- Modify: `src/ui/TransitPanel.ts`
- Modify: `src/app/GameApp.ts`
- Test: `tests/transit-regressions.test.ts`

**Interfaces:**
- Produces: route-order-based passenger direction, current-time initialization when a line is enabled, and atomic service-setting updates.

- [ ] **Step 1: Write failing tests**

```ts
test('non-lexical stop ids still enqueue passengers in route direction', () => {});
test('enabling a line late does not replay historical departures', () => {});
test('transit config patch is atomic when one field is invalid', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement route-index direction, enable-time dispatch cursor, and atomic config validation/commit.**
- [ ] **Step 4: Verify tests pass.**

### Task 5: Density-aware services and education

**Files:**
- Modify: `src/simulation/services/ServiceDemandSystem.ts`
- Modify: `src/simulation/services/EducationSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/service-density-regressions.test.ts`

**Interfaces:**
- Consumes: `definitionForBuilding()`.
- Produces: correct medium/high-intensity demand allocation and capacity-aware school enrollment.

- [ ] **Step 1: Write failing tests**

```ts
test('service demand scales with actual apartment definition capacity', () => {});
test('student allocation uses actual residential definition capacity', () => {});
test('reachable secondary school capacity prevents false overcrowding', () => {});
test('one assigned service job does not imply 100 percent facility utilization', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Replace zone defaults with instantiated definitions, allocate school seats by reachable cost/capacity, and pass a real utilization ratio.**
- [ ] **Step 4: Verify tests pass.**

### Task 6: Garbage, incident, and demolition lifecycle accounting

**Files:**
- Modify: `src/simulation/services/WasteCollectionSystem.ts`
- Modify: `src/simulation/garbage/GarbageSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/services/ServiceDispatchSystem.ts` and/or `IncidentSystem.ts`
- Test: `tests/service-lifecycle-regressions.test.ts`

**Interfaces:**
- Produces: period-based garbage service ratios and deterministic cleanup/cancellation of demolished-target state.

- [ ] **Step 1: Write failing tests**

```ts
test('historical processed waste cannot mask a current backlog', () => {});
test('demolished building garbage backlog is removed', () => {});
test('demolished service-job target does not remain waiting forever', () => {});
test('collected garbage cargo still reaches processing when source building is demolished', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Track period processing deltas and clean or finalize demolition-linked state.**
- [ ] **Step 4: Verify tests pass.**

### Task 7: Freight, economy semantics, and zero-edge travel

**Files:**
- Modify: `src/simulation/economy/FreightVehicleSystem.ts`
- Modify: `src/simulation/economy/EconomyScheduler.ts`
- Modify: `src/simulation/economy/ProductionSystem.ts`
- Modify: `src/simulation/mobility/MobilityScheduler.ts`
- Modify: `src/simulation/traffic/TrafficSystem.ts`
- Test: `tests/economy-regressions.test.ts`

**Interfaces:**
- Produces: immediate same-node completion semantics, reachable/best gateway selection, and separate output-storage constraint accounting.

- [ ] **Step 1: Write failing tests**

```ts
test('same-node freight delivery completes without a road edge', () => {});
test('export shipment chooses a reachable gateway instead of first id', () => {});
test('same-node person trip is successful rather than unmet', () => {});
test('full output storage is not reported as input shortage', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement local-completion semantics, gateway routing selection, and corrected production loss categories.**
- [ ] **Step 4: Verify tests pass.**

### Task 8: Persistence, kernel atomicity, scheduler dependencies, UI hardening, and tooling

**Files:**
- Modify: `src/save/save.ts`
- Modify: `src/simulation/kernel/SystemScheduler.ts`
- Modify: `src/simulation/kernel/SimulationKernel.ts` and/or core snapshot integration
- Modify: `src/app/GameApp.ts`
- Modify: `src/ui/TransitPanel.ts`
- Modify: `package.json`
- Add/update lint configuration as needed
- Test: `tests/save-invariants.test.ts`, `tests/kernel-regressions.test.ts`

**Interfaces:**
- Produces: stronger referential validation, queued-vehicle equivalence checks, rollback or prevalidated tick atomicity, explicit read/write dependency validation, escaped user text, correct V7 labels, and a real lint command.

- [ ] **Step 1: Write failing tests**

```ts
test('hydrate rejects firm referencing a missing building', () => {});
test('hydrate rejects queued traffic vehicle missing its intersection queue entry', () => {});
test('kernel does not retain partial tick mutations after a system throws', () => {});
test('scheduler rejects unordered writer-reader conflicts', () => {});
```

- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement validation/atomicity/order rules, escape transit names, rename V6 UI storage labels to V7, and configure actual ESLint.**
- [ ] **Step 4: Run the complete verification suite.**

## Final Verification

- [ ] `npm test`
- [ ] strict TypeScript typecheck
- [ ] real lint command
- [ ] production build
- [ ] inspect GitHub Actions result on the repair branch
- [ ] review diff against `main` for unrelated changes
