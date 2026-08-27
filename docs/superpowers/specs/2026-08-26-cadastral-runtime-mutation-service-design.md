# Cadastral Runtime Mutation Service Design

**Date:** 2026-08-26  
**Branch:** `feature/urban-fabric-2.0`  
**Status:** Approved architecture, ready for implementation planning  
**Roadmap scope:** Phase 2R Urban Fabric 2.0 / Task 13 completion

## 1. Purpose

Urban Fabric 2.0 already makes `CadastralGraph` the canonical legal-land authority and includes deterministic low-level split, assembly, easement, and right-of-way mutation primitives. Those primitives are intentionally not exposed through `SimulationCore` because a successful graph mutation can retire parcel IDs that remain referenced by canonical buildings, parcel zoning assignments, property holdings, and legacy compatibility projections.

This design closes that Task 13 gap by introducing a runtime transaction boundary that coordinates cadastral mutation with all live dependent references. A mutation either produces a fully valid cross-domain state and commits all affected authorities, or leaves runtime state unchanged.

The feature does **not** transfer ownership of buildings, zoning, property-market data, or future project state into `CadastralGraph`. Each domain remains authoritative for its own state.

## 2. Non-negotiable invariants

- `WorldFoundation` remains the sole physical/geographic authority.
- `CadastralGraph` remains the sole legal-land/topology authority.
- `BuildingSystem` remains the sole canonical `BuildingV2` authority.
- `ZoningSystem` remains the sole parcel-zoning-assignment authority.
- `PropertyMarketSystem` remains the sole current property holding and transaction-history authority.
- `LotSystem` remains a derived legacy compatibility facade and is never a transaction source of truth.
- Save V9 remains the canonical Urban Fabric persistence format; Save V8 remains the Phase 1R compatibility format.
- Existing V7/V8 migrations and legacy lot/building IDs must not silently change.
- A failed runtime mutation must leave every canonical domain bit-for-bit unchanged.
- No cross-domain mutation may partially commit.
- Historical records must not be rewritten to pretend newly created parcels existed before their cadastral creation.
- 3R transportation ownership, lane/intersection/routing behavior, and transportation-network replacement remain outside this PR.

## 3. Selected architecture

Introduce a simulation-layer coordinator named `CadastralRuntimeMutationService` under `src/simulation/land/`.

```text
SimulationCore
  └─ CadastralRuntimeMutationService
       ├─ stages CadastralGraph mutation on a cloned graph
       ├─ resolves canonical BuildingV2 references
       ├─ resolves parcel zoning assignments
       ├─ resolves property holdings
       ├─ validates historical property references through lineage
       ├─ validates concrete live parcel-referencing runtime state
       ├─ derives the legacy LotSystem projection
       └─ commits all resulting snapshots to owning systems
```

`SimulationCore` exposes one readonly instance:

```ts
readonly cadastralMutations: CadastralRuntimeMutationService;
```

Callers do not receive a raw mutable `CadastralMutationSystem` tied directly to `core.cadastre`.

The coordinator may depend on world/cadastre primitives and simulation-domain owners. The world/cadastre layer must not import simulation-layer systems.

## 4. Public mutation surface

```ts
splitParcel(parcelId: string, cutLine: readonly WorldPoint[]): CadastralRuntimeMutationResult;
assembleParcels(parcelIds: readonly string[]): CadastralRuntimeMutationResult;
dedicateRightOfWay(parcelId: string, geometry: PolygonRing): CadastralRuntimeMutationResult;
createEasement(parcelIds: readonly string[], kind: EasementKind, geometry: readonly WorldPoint[]): CadastralRuntimeMutationResult;
removeEasement(easementId: string): CadastralRuntimeMutationResult;
```

```ts
type CadastralRuntimeMutationResult = Readonly<{
  committed: boolean;
  resultingParcelIds: readonly string[];
  retiredParcelIds: readonly string[];
  parcelReferenceRewrites: Readonly<Record<string, string>>;
  rejectionReasons: readonly string[];
}>;
```

No separate success flag is introduced beyond `committed`.

## 5. Transaction algorithm

### 5.1 Snapshot owners

Capture deterministic snapshots of:

- `core.cadastre.snapshot()`;
- `core.buildings.listV2()`;
- `core.zoning.listParcelAssignments()`;
- `core.propertyMarket.snapshot()`;
- any concrete live runtime state already present in `SimulationCore` that stores parcel IDs.

`LotSystem` is not snapshotted as authority; it is rebuilt from committed cadastre.

### 5.2 Stage cadastre

Construct a temporary `CadastralGraph` from the canonical snapshot and run the requested `CadastralMutationSystem` operation against it.

If the low-level mutation rejects, return its rejection result and do not touch a live owner.

### 5.3 Resolve parcel references

For each retired parcel, determine whether references resolve to:

- one resulting parcel through `parcelReferenceRewrites`;
- multiple candidate children requiring geometry-based resolution;
- no valid live private parcel, which rejects unless the owning workflow explicitly supports removal.

One-to-many split resolution is geometric, never based on arbitrary child ordering.

### 5.4 Stage dependent state

Create rewritten in-memory copies of buildings, zoning assignments, property state, and any concrete participating runtime state. No owner mutates yet.

### 5.5 Validate the staged world

Before commit:

- every `BuildingV2.parcelIds` entry references a staged live parcel;
- every surviving building footprint is contained by its assigned staged parcel set;
- every V2 zoning assignment references a staged live parcel;
- every current property holding references a staged live parcel;
- any concrete live project/runtime parcel reference points only at staged live parcels;
- historical property transactions validate against live parcels plus cadastral lineage;
- staged cadastre passes cadastral validation;
- the legacy lot projection can be rebuilt from staged cadastre;
- ordering is deterministic.

Failure returns `committed: false` with no live mutation.

### 5.6 Commit and rollback

Commit in fixed order:

1. canonical cadastre;
2. parcel zoning assignments;
3. canonical `BuildingV2` store;
4. property-market snapshot;
5. any concrete participating runtime state;
6. rebuild `LotSystem` from committed cadastre.

All commit inputs are prevalidated. The coordinator still retains original snapshots. If an owner restore unexpectedly throws, rollback restores the original cadastre, zoning, buildings, property state, participating runtime state, and legacy lot projection before returning or throwing. Partial state may never escape the service.

## 6. Split semantics

### 6.1 Buildings

For each `BuildingV2` referencing the source parcel:

- compute complete footprint containment against every resulting child polygon;
- if exactly one child contains the footprint, rewrite the source parcel ID to that child;
- if the footprint crosses multiple children or is not fully contained, reject the split;
- preserve building ID, lifecycle, entitlement, project metadata, owner/developer fields, year built, and physical metrics exactly.

The service never splits one building into multiple buildings.

### 6.2 Zoning

If the source parcel has an explicit V2 zoning assignment, every split child inherits the same district ID and overlay IDs. If no explicit assignment exists, no assignment is fabricated.

### 6.3 Property holdings

If the source parcel has a current holding, every child inherits the same owner.

Reservation value is allocated by child area share:

```text
childReservationValue = sourceReservationValue * childArea / sum(childAreas)
```

Allocation rounds deterministically to cents. The final child in canonical ID order receives the residual cents so the child total exactly equals the source reservation value.

### 6.4 Historical transactions

Past transactions referencing the retired source parcel remain unchanged.

`PropertyMarketSystem` must support lineage-aware restore/validation via a narrow validator/callback supplied by the coordinator. A historical transaction parcel ID is valid when it identifies either:

- a current live holding; or
- a parcel appearing as a historical cadastral lineage source/ancestor.

`PropertyMarketSystem` does not own lineage.

## 7. Assembly semantics

The low-level mutation already enforces adjacency, one block, one zoning district, and common parcel owner metadata. Runtime checks additionally require:

- source property holdings, when present, have one owner;
- explicit V2 zoning assignments are either absent or identical in district and overlays;
- surviving buildings are contained by the assembled parcel.

On success:

- source `BuildingV2.parcelIds` become the assembled parcel ID;
- duplicate parcel IDs are removed and sorted;
- one identical zoning assignment is installed on the assembled parcel;
- source holdings collapse into one holding;
- assembled reservation value equals the exact sum of source values;
- historical transactions remain unchanged and validate through lineage;
- concrete live project/runtime parcel references rewrite to the assembled parcel.

## 8. Right-of-way dedication semantics

Right-of-way dedication retires one source private parcel and creates one residual private parcel.

It commits only if every referenced surviving building footprint is fully contained in the residual parcel. An intersected or excluded building rejects the mutation.

Current zoning assignment and holding rewrite one-to-one to the residual parcel. Reservation value scales by residual private-land area, rounded deterministically. No transportation compensation or acquisition economics are introduced here.

Historical transactions remain unchanged.

The operation updates legal land topology only. It does not create a 3R transportation network object.

## 9. Easement semantics

Creating/removing an easement does not retire parcel IDs and normally requires no dependent rewrites. It still runs through the same staged coordinator and validation path so every public cadastral mutation uses one safe runtime boundary.

## 10. Building identity and legacy compatibility

Runtime mutation must not silently regenerate canonical building IDs.

`reconcileCanonicalBuildingProjection()` currently derives canonical projections from legacy buildings and can synthesize canonical IDs from parcel IDs. After parcel mutation, later `core.step()` calls must recognize a surviving canonical building rather than replacing it because its parcel ID changed.

Required invariant:

```text
parcel mutation + core.step(n)
  preserves surviving BuildingV2.id
  preserves lifecycle state
  preserves yearBuilt
  preserves entitlement approvalTick
```

The implementation may add a narrow stable-identity/geometry matching helper to `BuildingSystem` or `SimulationCore`; it must not make the legacy lot/building model authoritative again.

`LotSystem` is rebuilt only after canonical commit.

## 11. Concrete runtime-state participation

Before implementation, search the branch for live/persisted parcel-ID state beyond cadastre, buildings, zoning, and property market.

If a concrete state exists, it must either:

- participate in deterministic one-to-one/assembly rewrites;
- resolve one-to-many split references uniquely from existing geometry/identity; or
- reject the mutation with a stable ambiguity reason.

Do not add speculative project persistence or new domain models solely for this feature. If safe mutation requires Save V9 schema expansion, stop and treat that expansion as a separate explicitly reviewed change.

## 12. Rejection reasons

Required deterministic runtime-level categories:

- `building-crosses-split`;
- `building-outside-resulting-parcel`;
- `conflicting-zoning-assignments`;
- `conflicting-property-owners`;
- `ambiguous-project-parcel-rewrite` when a concrete project state exists;
- `missing-resulting-parcel`;
- `property-value-not-conserved`;
- `dangling-parcel-reference`;
- `runtime-commit-rollback`.

Low-level cadastral rejection reasons pass through unchanged.

## 13. Persistence

No Save V10 is introduced by default.

Save V9 already persists cadastral topology/lineage, parcel V2 zoning assignments, canonical `BuildingV2` state, and property-market state. A committed mutation must round-trip through existing V9 serialization and hydration.

V8 migration behavior remains unchanged.

If implementation discovers a currently live parcel-referencing state that must persist but is absent from V9, implementation stops before schema expansion.

## 14. Determinism

- parcel IDs sort lexicographically before rewrite decisions;
- building IDs sort lexicographically before geometry resolution;
- zoning assignments use canonical parcel-ID order;
- property holdings use canonical parcel-ID order;
- value allocation uses cent rounding with the residual assigned to the final canonical child;
- rejection reason ordering is stable;
- no RNG stream is introduced.

Identical snapshots plus identical mutation requests must produce deep-equal results and staged snapshots.

## 15. Testing requirements

Implementation follows TDD. At minimum:

1. split success rewrites a fully contained building;
2. split crossing a building rejects with all owner snapshots unchanged;
3. explicit zoning assignment inherits to every split child;
4. split holdings conserve owner and reservation value exactly;
5. pre-split property transaction remains unchanged and hydrates through lineage-aware validation;
6. assembly rewrites buildings/zoning/holdings;
7. assembly owner/zoning conflict rejects atomically;
8. right-of-way success rewrites to the residual parcel;
9. right-of-way intersecting a building rejects atomically;
10. easement create/remove uses the runtime service without unrelated state changes;
11. mutation then `core.step(10)` preserves surviving building ID/lifecycle and leaves no dangling parcel references;
12. mutation → Save V9 → hydrate → continue preserves cadastre/buildings/zoning/property/history;
13. forced commit failure rolls back all owners;
14. identical cores and mutation requests produce deep-equal results.

Final repository gate:

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
```

plus the CI-managed Isometric Pass A visual smoke.

## 16. Expected file boundaries

- Create `src/simulation/land/CadastralRuntimeMutationService.ts` for staging, rewrite planning, validation, commit, and rollback orchestration.
- Modify `src/simulation/core/SimulationCore.ts` only to construct/expose the service and make canonical building reconciliation mutation-safe.
- Modify `src/simulation/buildings/BuildingSystem.ts` only for narrow stable-identity/validation helpers if required.
- Modify `src/simulation/zoning/ZoningSystem.ts` only for narrow staged assignment validation/restore support if required.
- Modify `src/simulation/development/PropertyMarketSystem.ts` only for lineage-aware historical validation and staged-state support; do not give it cadastral ownership.
- Modify concrete project/runtime code only when an existing parcel reference requires participation.
- Add focused runtime mutation tests.
- Extend Save V9 tests only for mutation round-trip behavior; do not change the schema by default.

If implementation pressure starts turning the coordinator into a general simulation god object, split the work instead of moving unrelated responsibilities into it.

## 17. Acceptance criteria

Task 13 is complete when:

- `SimulationCore` exposes `cadastralMutations` as the safe runtime mutation boundary;
- callers do not need a raw live-graph `CadastralMutationSystem`;
- split, assembly, right-of-way, and easement operations are all-or-nothing across every current parcel-referencing canonical domain;
- surviving buildings retain stable canonical identity/lifecycle across mutation and later simulation ticks;
- live zoning assignments and property holdings contain no retired parcel IDs;
- historical property transactions remain truthful and validate through lineage;
- Save V9 round-trip plus continued simulation preserve mutation state;
- failed mutations leave owner snapshots unchanged;
- V7/V8 compatibility remains green;
- exact-head full CI passes;
- no 3R transportation behavior is introduced.
