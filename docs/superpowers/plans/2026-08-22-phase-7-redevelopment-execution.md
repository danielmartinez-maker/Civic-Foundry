# Phase 7 Residential Redevelopment Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make high-pressure occupied residential parcels eligible for real higher-intensity redevelopment when citywide relocation safeguards and existing developer economics permit it.

**Architecture:** Extend `BuildingSystem` with a strict in-place replacement operation. In `SimulationCore`, refresh redevelopment diagnostics before the 10-tick developer market, convert safeguarded high-pressure parcels into cost-adjusted feasibility opportunities, combine them with vacant-lot opportunities, and submit everything to the existing `DeveloperMarketSystem` so redevelopment uses the same capital market. No new persisted subsystem is added.

**Tech Stack:** TypeScript, Node test runner, existing Civic Foundry simulation systems.

**Spec:** `docs/superpowers/specs/2026-08-22-phase-7-redevelopment-execution-design.md`

## Global Constraints

- Residential redevelopment only.
- No random or wall-clock inputs.
- No Save V7 schema change.
- Pressure threshold is 0.25.
- Post-demolition physical capacity must be >= current population.
- Post-demolition effective affordable capacity must be >= 85% of current population.
- Existing unplaced residents block redevelopment.
- Redevelopment must use the existing developer market and compete with vacant-lot development.

---

### Task 1: In-place building replacement

**Files:**
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/building-system.test.ts`

**Interfaces:**
- Produces: `BuildingSystem.replaceDevelopment(tick: number, lot: Lot, award: DevelopmentAward): { removed: Building; replacement: Building }`

- [ ] **Step 1: Write failing tests** covering successful occupied-residential low->medium/high replacement and rejection of vacant lots, construction buildings, non-residential buildings, same/lower intensity, and mismatched award/building IDs.
- [ ] **Step 2: Run repository tests and verify RED** specifically because `replaceDevelopment` is absent.
- [ ] **Step 3: Implement minimal replacement method** using `BUILDING_DEFINITION_BY_ID` plus an intensity rank (`low < medium < high`), preserving deterministic `building:<lotId>` identity and normal construction metadata.
- [ ] **Step 4: Run tests and verify GREEN.**

### Task 2: Redevelopment opportunity construction and relocation safeguards

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/development-integration.test.ts`

**Interfaces:**
- Add private `redevelopmentOpportunities(): DevelopmentFeasibilityResult[]`.
- Add private `adjustRedevelopmentOpportunity(base, demolitionCost, displacementCost): DevelopmentFeasibilityResult`.

- [ ] **Step 1: Write failing integration tests** proving: high pressure alone is insufficient when post-demolition physical capacity is below population; unplaced residents block redevelopment; sufficient physical/affordable slack exposes a higher-intensity opportunity; demolition + displacement cost increase the developer-underwritten pre-finance cost.
- [ ] **Step 2: Run tests and verify RED** because the core does not yet produce executable redevelopment opportunities.
- [ ] **Step 3: Implement safeguard calculation** from `housingChoiceSnapshot`, target definition capacity, target allocation affordability score, and pressure snapshot.
- [ ] **Step 4: Implement cost-adjusted feasibility copy** with friction added to pre-finance/total cost and recomputed yield-on-cost, return-on-cost, and residual land value.
- [ ] **Step 5: Run tests and verify GREEN.**

### Task 3: One competitive developer market for vacant and occupied parcels

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Test: `tests/development-integration.test.ts`

**Interfaces:**
- `evaluateDevelopmentMarket()` combines vacant and redevelopment opportunities before one `DeveloperMarketSystem.allocate()` call.

- [ ] **Step 1: Write failing test** that creates an eligible occupied residential parcel, runs the 10-tick developer cycle, and expects a developer-backed replacement to enter construction while retaining the same building ID.
- [ ] **Step 2: Run tests and verify RED** because occupied awards are not yet executed.
- [ ] **Step 3: Refresh housing choice and redevelopment pressure before opportunity collection.**
- [ ] **Step 4: Combine both opportunity sets and branch award execution:** occupied residential lot -> `replaceDevelopment`; otherwise -> `startDevelopment`.
- [ ] **Step 5: On replacement, call `economyDomain.removeBuilding(removed.id, tick)` and keep the normal developer commitment; on execution failure cancel the project at full recovery and rethrow.
- [ ] **Step 6: Run tests and verify GREEN**, including that population is not directly changed at demolition time and replacement stays construction until its definition completion tick.

### Task 4: Regression, persistence, and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_LOG.md`
- Test: existing full suite

- [ ] **Step 1: Update docs** to distinguish redevelopment pressure (derived diagnostic) from redevelopment execution (developer-backed state transition) and document relocation safeguards.
- [ ] **Step 2: Run `npm test`.** Expected: all tests pass.
- [ ] **Step 3: Run `npm run typecheck`.** Expected: pass.
- [ ] **Step 4: Run `npm run lint`.** Expected: pass.
- [ ] **Step 5: Run `npm run build`.** Expected: pass.
- [ ] **Step 6: Review changed files for accidental Save V7/schema/UI/randomness changes.**
- [ ] **Step 7: Open/refresh PR, verify GitHub Actions on the exact head, then merge to `main` under the user's existing consolidation instruction.

## Self-review

- Spec coverage: eligibility, cost adjustment, developer competition, building replacement, population behavior, persistence, and deferred scope are all mapped to tasks.
- No placeholders remain in production behavior; tests are described by exact causal behavior rather than mocks.
- Type consistency: the new building API consumes existing `Lot` and `DevelopmentAward`; redevelopment opportunities remain `DevelopmentFeasibilityResult[]`; no new persisted type crosses the save boundary.
