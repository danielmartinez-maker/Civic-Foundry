# Urban Fabric 2.0 — Final Reconciliation Checkpoint

**Date:** 2026-08-26  
**Branch:** `feature/urban-fabric-2.0`  
**PR:** #63 — Urban Fabric 2.0  
**Status:** Implementation complete; exact-head CI green; draft pending explicit integration approval.

## Purpose

This checkpoint reconciles the approved 2026-08-25 Urban Fabric design/implementation plan with the Phase 1R World Foundation baseline that was integrated before the final 2R persistence tranche.

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

## Canonical authority boundaries

The final 2R authority model is:

```text
SimulationKernel
├─ WorldFoundation      physical/geographic authority
├─ CadastralGraph       legal-land/topology authority
├─ parcel zoning        legal development entitlement
├─ BuildingV2           canonical physical building state
└─ property systems     Urban Fabric ownership/transaction state
```

Compatibility boundaries remain explicit:

- `WorldFoundation` remains the sole physical/geographic authority.
- `CadastralGraph` is the canonical legal-land authority.
- `LotSystem` is a derived legacy facade rebuilt from cadastral state.
- inherited legacy buildings remain available for compatibility while `BuildingV2` stores canonical Urban Fabric physical state.
- V7/V8 identifiers and supported save behavior remain preserved through deterministic compatibility projections.
- presentation code is read-only with respect to simulation authority.
- 3R transportation ownership is outside PR #63.

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

PR #63 now covers the intended Urban Fabric replacement scope:

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
- atomic cadastral split/assembly/right-of-way/easement mutation;
- relocation-safe redevelopment execution;
- parcel-authoritative runtime development through `SimulationCore`;
- Save V9 migration, round-trip, corruption/reference validation, and deterministic continuation;
- cadastral/zoning presentation, parcel picking, inspection, and Urban Fabric controls;
- deterministic mutation fuzz coverage;
- compiled Urban Fabric browser smoke coverage.

## Verification checkpoint

Implementation checkpoint:

```text
8f029ea7edaacc509d8f65aa195f0b87131f65e7
```

passed Civic Foundry CI runs #955 and #956.

README reconciliation head:

```text
59ea99e7fc903289c223d765c301eef65106b775
```

passed exact-head Civic Foundry CI run #960, including:

- `npm test`;
- `npm run typecheck`;
- `npm run lint`;
- `npm run assets:check`;
- `npm run build`;
- Phase 6 browser smoke;
- Phase 7 browser smoke;
- Urban Fabric browser smoke;
- Isometric Pass A browser smoke;
- Isometric Pass A visual smoke.

Any commit after this checkpoint requires its own exact-head verification before PR #63 can be treated as integration-ready.

## Roadmap handoff

PR #63 remains the isolated **2R — Urban Fabric 2.0** tranche. It should not absorb lane authority, turn movements, signal control, explicit parking, crash simulation, or the final dynamic-routing replacement.

After PR #63 is explicitly approved and integrated, the next progressive replacement tranche is **3R — Transportation Engine 2.0**, starting from the accepted Urban Fabric authority boundaries rather than duplicating them.
