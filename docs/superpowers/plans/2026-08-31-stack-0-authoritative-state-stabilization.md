# Stack 0 Authoritative State Stabilization Implementation Plan

> **Execution contract:** `STACK_0_AUTHORITATIVE_STATE_STABILIZATION.md`. Work test-first from current `main`; preserve Save V9 semantics, deterministic simulation, and existing authority boundaries.

**Goal:** Close the P0 authoritative-state, conservation, transaction, transit-recovery, and hydration defects that block Transportation 3R.

**Architecture:** Keep each domain authoritative in its current owner. Legacy land edits stage a generated cadastre, reconcile geometry-stable canonical parcel identities/history, reject protected topology changes, and roll back legacy/canonical state on rejection. Economy and trip fixes remain inside their existing inventory/trip generators. Compound development, bulldoze, and kernel ticks use snapshots/restores from the domains they already mutate. Transit failures return onboard cohorts to the existing passenger queue authority. Save hardening extends the validators at the V4/V5/V6/V9 ownership seams rather than introducing a parallel validator.

## Task A — Cadastral integrity (CF-006..009)

1. Add regressions for unrelated road/zoning edits preserving canonical parcel IDs, lineage, easements, BuildingV2 lifecycle, zoning assignments, holdings, and property history.
2. Add regressions proving a protected parcel topology change rejects the complete road/zoning edit and restores roads/zoning/treasury/canonical state exactly.
3. Add `LegacyCadastreRebuildService` that:
   - fingerprints parcel polygons deterministically;
   - maps exact-geometry candidate survivors back to canonical parcel IDs;
   - rewrites candidate edge/block parcel references;
   - carries forward canonical owner/history, lineage, and easements;
   - rejects retirement of parcels protected by parcel zoning, property holdings, BuildingV2, or easements;
   - records one deterministic `boundary-adjustment` lineage row for allowed unprotected topology changes;
   - validates the staged snapshot before commit.
4. Wrap `SimulationCore.buildRoad`, `paintZone`, and road/zone `bulldozeAt` in legacy-land snapshots and restore on reconciliation rejection/exception.

## Task B — Freight conservation (SIM-016/SIM-017)

1. Forward-port PR #109 regressions.
2. Restore cargo bypassing storage-capacity admission only when returning already-conserved in-transit goods.
3. Add end-to-end failure assertions where useful so vehicle/order/cargo state does not duplicate or destroy goods.

## Task C — Trip-demand conservation (SIM-001/SIM-002)

1. Forward-port PR #110 regressions.
2. Replace rounded/minimum-one cohort weighting with exact proportional weights so aggregate commute and shopping demand equals the requested pools.

## Task D — Transaction boundaries (SIM-013/SIM-014/SIM-015)

1. Add forced-failure regressions after partial development-award mutation, after partial building bulldoze mutation, and after a kernel system mutates state then throws.
2. Development award transaction snapshots/restores BuildingSystem, EconomyScheduler, DeveloperMarketSystem, and HousingRelocationSystem state.
3. Building bulldoze transaction snapshots/restores the same authoritative domains plus affected service state when the removal path mutates it.
4. Kernel adds registered transaction participants. For each tick it snapshots clock, commands, events, random streams, and registered authoritative domain participants; on any command/system/invariant exception it restores the exact pre-tick state before entering fail-stop mode.
5. Register the live city-domain transaction participant from `LegacySimulationCore` using existing domain snapshots/restores.

## Task E — Transit passenger recovery (SIM-007)

1. Add a regression with onboard passengers followed by an invalidated/disabled line or route failure.
2. On failure, deterministically requeue each onboard cohort at the vehicle's last serviced stop, preserving id/weight/destination/transfers and updating only boarding stop/direction/enqueued tick for the recovery point.
3. Delete the failed vehicle only after every cohort has been accepted by `PassengerQueueSystem`; otherwise throw so the enclosing tick transaction rolls back.

## Task F — Save V9 hydration hardening

1. Add adversarial Save V9 tests for duplicate, dangling, stale, malformed, and non-finite state across:
   - cadastre + canonical buildings + property references;
   - services/utilities/traffic/intersection state;
   - transit network/queues/vehicles/operations;
   - firms/freight/orders/inventory.
2. Strengthen validation at the existing ownership seams:
   - V4/legacy: utilities, services, traffic/intersections;
   - V5: transit network/mobility state;
   - V6: firms/orders/freight/inventory;
   - V9: cadastral structure, canonical building fields, zoning/property cross-references.
3. Reject invalid state deterministically before mutating the corresponding live domain. Do not change serialized Save V9 fields or game version.

## Verification and documentation

1. Run/observe `npm run verify`.
2. Run/observe `npm run test:smoke`, `npm run test:smoke:phase7`, `npm run test:smoke:urban-fabric`, `npm run test:smoke:isometric`, and `python tests/smoke/isometric_visual_smoke.py` through PR CI.
3. Confirm deterministic save/load/continuation, conservation, and rollback regressions.
4. Update `docs/wiki/Known-Issues-and-Technical-Debt.md` to mark fixed Stack 0 findings separately from remaining debt.
5. Review the diff for Save V9 schema stability and absence of new simulation authority.
6. Keep the PR draft until the full gate is green; do not merge without separate authorization.
