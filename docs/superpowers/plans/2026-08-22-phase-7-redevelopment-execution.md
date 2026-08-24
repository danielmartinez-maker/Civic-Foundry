# Phase 7 Residential Redevelopment Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for completed work.

**Goal:** Make high-pressure occupied residential parcels eligible for real higher-intensity redevelopment when citywide relocation safeguards and existing developer economics permit it.

**Architecture:** Extend `BuildingSystem` with a strict in-place replacement operation. Keep relocation safeguards and redevelopment-cost adjustment in a pure `RedevelopmentExecutionSystem`. In `SimulationCore`, refresh redevelopment diagnostics before the 10-tick developer market, convert safeguarded high-pressure parcels into cost-adjusted feasibility opportunities, combine them with vacant-lot opportunities, and submit everything to the existing `DeveloperMarketSystem` so redevelopment uses the same capital market. No new persisted subsystem is added.

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
- An occupied building with an active developer commitment blocks redevelopment until the commitment releases.
- `DeveloperMarketSystem` must independently reject any second award targeting a deterministic building ID with an active commitment.
- Relocation slack is reserved cumulatively across same-cycle candidates.
- Redevelopment uses the existing developer market and competes with vacant-lot development.

---

### Task 1: In-place building replacement

**Files:**
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Test: `tests/redevelopment-execution.test.ts`

**Interfaces:**
- Produces: `BuildingSystem.replaceDevelopment(tick: number, lot: Lot, award: DevelopmentAward): { removed: Building; replacement: Building }`

- [x] **Step 1: Write failing tests** covering successful occupied-residential low→medium/high replacement and rejection of vacant lots, construction buildings, non-residential buildings, same/lower intensity, and mismatched award/building IDs.
- [x] **Step 2: Verify RED:** 240 existing tests passed; only the 3 new tests failed because `replaceDevelopment` was absent.
- [x] **Step 3: Implement replacement method** using building-definition intensity ranking, deterministic building identity and normal construction metadata.
- [x] **Step 4: Verify GREEN:** 243/243 tests plus typecheck, lint and build passed.

### Task 2: Redevelopment execution planner and relocation safeguards

**Files:**
- Create: `src/simulation/development/RedevelopmentExecutionSystem.ts`
- Test: `tests/redevelopment-execution-planner.test.ts`

**Interfaces:**
- Produces pure `RedevelopmentExecutionSystem.evaluate(context, inputs)` and immutable snapshot/decisions.

- [x] **Step 1: Write failing tests** for physical-capacity blocking, existing unplaced residents, cumulative relocation-slack reservation, demolition/displacement underwriting friction, low pressure and replacement mismatch.
- [x] **Step 2: Verify RED:** all prior 243 tests passed; the planner test file failed only because the new module was absent.
- [x] **Step 3: Implement safeguards** against current population, physical capacity, effective affordable capacity and current per-building affordability.
- [x] **Step 4: Implement cumulative reservation** in stable redevelopment-pressure order.
- [x] **Step 5: Implement cost-adjusted feasibility** with friction added to pre-finance cost and recomputed financing/total cost, yield-on-cost, return-on-cost and residual land value.
- [x] **Step 6: Add active-commitment planner blocking** so an occupied building cannot be admitted while prior developer capital remains locked to its deterministic ID.
- [x] **Step 7: Verify GREEN** before core integration.

### Task 3: One competitive developer market for vacant and occupied parcels

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/development/DeveloperMarketSystem.ts`
- Test: `tests/redevelopment-core-integration.test.ts`
- Test: `tests/developer-market.test.ts`

**Interfaces:**
- `evaluateDevelopmentMarket()` refreshes property/housing/redevelopment state, then combines vacant and admitted redevelopment opportunities before one `DeveloperMarketSystem.allocate()` call.

- [x] **Step 1: Write failing integration tests** for a capacity-blocked occupied home and an eligible multi-building city where at least one higher-intensity replacement should enter construction.
- [x] **Step 2: Verify RED:** 249/250 tests passed; only the eligible occupied parcel failed to receive redevelopment.
- [x] **Step 3: Refresh housing choice, redevelopment pressure and execution planning before opportunity collection.**
- [x] **Step 4: Combine vacant and redevelopment opportunities in one developer allocation.**
- [x] **Step 5: Branch award execution:** redevelopment lots use `replaceDevelopment`; vacant lots use `startDevelopment`; failed execution cancels the project at full recovery.
- [x] **Step 6: Remove the old occupied building from the economy domain on redevelopment and refresh all derived market/housing/redevelopment snapshots after awards.**
- [x] **Step 7: Keep population unchanged at demolition time and verify remaining occupied stock can support current population.**
- [x] **Step 8: Correct the test observation** to inspect persistent developer commitments rather than `lastAwards()`, which is intentionally overwritten by later auctions.
- [x] **Step 9: Add developer-market RED regression** proving a second award for `building:<lotId>` cannot overwrite an unreleased commitment; add both opportunity filtering and an award-loop backstop.
- [x] **Step 10: Add core diagnostic RED regression** with a seeded live commitment; wire `SimulationCore` to pass live committed-building state so the planner reports `active-commitment`.
- [x] **Step 11: Verify GREEN:** GitHub Actions run #144 passed 253/253 tests, typecheck, lint and build on the commitment-wired code head.

### Task 4: Regression, persistence and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_LOG.md`
- Test: existing full suite

- [x] **Step 1: Update docs** to distinguish redevelopment pressure (derived diagnostic), execution planning (derived safeguard/economic gate) and redevelopment execution (developer-backed building state transition).
- [x] **Step 2: Preserve Save V7 schema:** executed redevelopment reuses existing building construction state plus existing developer commitment; no new authoritative envelope is needed.
- [x] **Step 3: Document the active-commitment invariant and defense-in-depth developer-market duplicate guard.**
- [x] **Step 4: Run `npm test` on the commitment-wired code head.** GitHub Actions run #144: 253/253 passed.
- [x] **Step 5: Run `npm run typecheck`.** Passed in run #144.
- [x] **Step 6: Run `npm run lint`.** Passed in run #144.
- [x] **Step 7: Run `npm run build`.** Passed in run #144.
- [ ] **Step 8: Verify the final documentation head with GitHub Actions, review the final diff, merge PR #10 to `main`, and retire the obsolete conflicting Phase 7 PR under the user's consolidation instruction.**

## Self-review

- Eligibility, cost adjustment, cumulative relocation safeguards, active-commitment gating, developer competition, building replacement, population behavior and persistence are implemented as separate causal responsibilities.
- Planner diagnostics and the authoritative developer market deliberately duplicate the active-building-commitment check: the first provides accurate causal diagnostics, the second protects capital-ledger integrity even if callers bypass the planner.
- No individual household, lease, mortgage, homelessness, commercial/industrial redevelopment or UI state was smuggled into the slice.
- `RedevelopmentExecutionSystem` remains pure/derived; authoritative effects continue to live in existing `BuildingSystem` and `DeveloperMarketSystem` state.
- No random or wall-clock source was added and no Save V7 production schema file was changed.