# Urban Fabric 2.0 — Final Reconciliation Checkpoint

**Date:** 2026-08-27  
**Branch:** `feature/urban-fabric-2.0`  
**PR:** #63 — Urban Fabric 2.0  
**Status:** Task 13 runtime mutation implementation verified; final documentation head pending exact-head CI.

## Purpose

This checkpoint reconciles the approved 2026-08-25 Urban Fabric design/implementation plan with the Phase 1R World Foundation baseline that was integrated before the final 2R persistence tranche and records the final Task 13 runtime-mutation closure.

The original Urban Fabric documents were written while the prior default save format was V7 and therefore reserved Save V8 for Urban Fabric. Phase 1R subsequently and deliberately consumed Save V8 for World Foundation. Urban Fabric therefore extends persistence through **Save V9** rather than repurposing the accepted V8 contract.

Where the original 2R design or implementation plan refers to Urban Fabric as Save V8, this checkpoint supersedes that persistence-version detail only. The cadastral, zoning, building, lifecycle, redevelopment, presentation, determinism, compatibility, and verification architecture remains the approved 2R direction.

## Canonical persistence contract

Current public persistence is:

```ts
saveVersion: 9
gameVersion: '0.9.0-urban-fabric'
```

Save V9 extends the complete Phase 1R Save V8 envelope with:

```ts
urbanFabric: CadastralSnapshot
zoningV2: {
  parcelAssignments: readonly ParcelZoningAssignment[]
}
buildingsV2: readonly BuildingV2[]
propertyMarket: PropertyMarketSnapshot
```

Save V8 remains:

```ts
saveVersion: 8
gameVersion: '0.8.0-world-foundation'
```

The supported current-load chain is therefore:

```text
V3/V4/V5/V6 → V7 → V8 World Foundation → V9 Urban Fabric
```

V8 migration into the current API deterministically constructs cadastral parcels, parcel zoning compatibility, canonical building projections, and property state without rewriting V8 or fabricating legal history.

Task 13 runtime mutation does not introduce Save V10. Historical property transactions preserve the retired parcel IDs that were valid when those transactions occurred; V9 validation/hydration accepts those historical IDs only when persisted cadastral lineage recognizes them. Current holdings, buildings, and parcel zoning remain restricted to live parcels.

## Canonical authority boundaries

The final 2R authority model is:

```text
SimulationKernel
├─ WorldFoundation                 physical/geographic authority
├─ CadastralGraph                  legal-land/topology authority
├─ CadastralRuntimeMutationService cross-domain parcel transaction boundary
├─ parcel zoning                   legal development entitlement
├─ BuildingV2                      canonical physical building state
└─ property systems                Urban Fabric ownership/transaction state
```

Compatibility boundaries remain explicit:

- `WorldFoundation` remains the sole physical/geographic authority.
- `CadastralGraph` is the canonical legal-land authority.
- `CadastralRuntimeMutationService` coordinates parcel-ID changes across domain owners but does not absorb those owners' authority.
- `LotSystem` is a derived legacy facade rebuilt from cadastral state.
- inherited legacy buildings remain available for compatibility while `BuildingV2` stores canonical Urban Fabric physical state.
- V7/V8 identifiers and supported save behavior remain preserved through deterministic compatibility projections.
- presentation code is read-only with respect to simulation authority.
- 3R transportation ownership is outside PR #63.

## Task 13 runtime mutation closure

The prior roadmap audit gap is now implemented through `SimulationCore.cadastralMutations`, a readonly `CadastralRuntimeMutationService`.

The service exposes safe runtime:

- parcel split;
- parcel assembly;
- right-of-way dedication;
- easement creation/removal.

`CadastralMutationSystem` remains the low-level graph/geometry engine. Runtime mutation stages that low-level operation on a cloned `CadastralGraph`, then stages and validates dependent canonical state before any live owner is changed.

For parcel-ID-changing operations, the coordinator captures the original cadastre, V2 zoning assignments, canonical `BuildingV2` state, and property-market snapshot. It then deterministically resolves dependent references, validates building containment and property/zoning consistency, validates historical property transaction IDs through staged lineage, and proves the legacy lot facade can be rebuilt.

The fixed live commit order is:

```text
cadastre → zoning → canonical buildings → property market → derived lots
```

If any live commit stage throws, the coordinator restores the original authoritative snapshots and rebuilds `LotSystem` from the restored cadastre before returning `runtime-commit-rollback`. The narrow optional `commitFaultInjector` exists solely to prove this failure path and is not a general event framework or simulation mechanic.

Surviving canonical buildings retain their stable IDs, lifecycle state, year built, entitlement timing, and project metadata through parcel rewrites and later `core.step()` continuation.

Twin-core coverage proves identical split → assembly sequences produce deep-equal results and canonical snapshots. Forced property-stage failure coverage proves byte-for-byte restoration across every participating domain after real live writes have already occurred.

## Task 16 reconciliation

The original Task 16 smoke-test wording is superseded as follows.

The Urban Fabric browser smoke must verify:

1. the app boots without browser or console errors;
2. road/zoning setup produces canonical cadastral parcels and the legacy lot facade;
3. runtime development materializes at least one canonical `BuildingV2`;
4. cadastral and zoning-envelope presentation paths are interactive;
5. the parcel inspector resolves canonical parcel identity;
6. `serializeCore()` reports `saveVersion: 9` and `gameVersion: '0.9.0-urban-fabric'`;
7. save/load preserves sorted canonical parcel and `BuildingV2` IDs.

The checked-in `tests/smoke/urban_fabric_smoke.py` implements this V9 contract.

## 2R acceptance state

PR #63 covers the intended Urban Fabric replacement scope:

- deterministic centimeter-normalized cadastral geometry;
- graph/topology validation and immutable snapshots;
- parcel generation and derived lot compatibility;
- dimensional parcel zoning;
- buildable envelopes and compliance;
- physical mixed-use massing and floor-area-derived metrics;
- parcel-scoped physical development feasibility;
- canonical `BuildingV2` storage and legacy projection;
- lifecycle, maintenance, vacancy, distress, renovation, adaptive reuse, and demolition state;
- highest-and-best-use evaluation and explainable redevelopment pressure;
- property holdings/transactions and deterministic site assembly;
- public cross-domain runtime cadastral split/assembly/right-of-way/easement transactions;
- deterministic dependent-reference rewriting and rollback;
- historical property transaction preservation through cadastral lineage;
- relocation-safe redevelopment execution;
- parcel-authoritative runtime development through `SimulationCore`;
- Save V9 migration, round-trip, corruption/reference validation, mutation-history hydration, and deterministic continuation;
- cadastral/zoning presentation, parcel picking, inspection, and Urban Fabric controls;
- deterministic low-level mutation fuzz coverage;
- runtime twin-core determinism and injected rollback coverage;
- compiled Urban Fabric browser smoke coverage.

## Verification checkpoint

Earlier implementation checkpoint:

```text
8f029ea7edaacc509d8f65aa195f0b87131f65e7
```

passed Civic Foundry CI runs #955 and #956.

README reconciliation head:

```text
59ea99e7fc903289c223d765c301eef65106b775
```

passed exact-head Civic Foundry CI run #960.

Task 13 Save V9/history and runtime-mutation implementation progressed through focused RED/GREEN checkpoints. The final Task 6 RED head had **594/595** Node tests passing, with only the intentionally new forced rollback contract failing because the commit failpoint did not yet exist.

Task 13 implementation head:

```text
fa23d77bdaba7f8d260b10ca2d75507f38ed81a6
```

passed exact-head Civic Foundry CI run **#992**, including:

- **595/595 Node tests**;
- strict TypeScript typecheck;
- lint with zero errors plus repository/architecture policy checks;
- asset source validation;
- production build/atlas generation;
- Phase 6 browser smoke;
- Phase 7 browser smoke;
- Urban Fabric browser smoke;
- Isometric Pass A browser smoke;
- Isometric Pass A visual smoke.

The documentation/reconciliation commit that records this closure requires its own exact-head verification. PR #63 must not be treated as integration-ready until that final head is green.

## Roadmap handoff

Task 13's prior “safe runtime cadastral transaction boundary” audit item is resolved by the verified implementation above. No remaining 2R roadmap gap is currently identified by this reconciliation checkpoint, subject to the final documentation-head CI gate and scope review.

PR #63 remains the isolated **2R — Urban Fabric 2.0** tranche. It does not absorb lane authority, turn movements, signal control, explicit parking, crash simulation, or the final dynamic-routing replacement.

After PR #63 is explicitly approved and integrated, the next progressive replacement tranche is **3R — Transportation Engine 2.0**, starting from the accepted Urban Fabric authority boundaries rather than duplicating them.
