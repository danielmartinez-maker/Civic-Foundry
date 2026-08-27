# Cadastral Runtime Mutation Service Design

**Date:** 2026-08-26  
**Branch:** `feature/urban-fabric-2.0`  
**Status:** Approved architecture, pending implementation plan  
**Roadmap scope:** Phase 2R Urban Fabric 2.0 / Task 13 completion

## 1. Purpose

Urban Fabric 2.0 already makes `CadastralGraph` the canonical legal-land authority and includes deterministic low-level split, assembly, easement, and right-of-way mutation primitives. Those primitives are intentionally not exposed through `SimulationCore` because a successful graph mutation can retire parcel IDs that remain referenced by canonical buildings, parcel zoning assignments, property holdings, redevelopment state, and legacy compatibility projections.

This design closes that Task 13 gap by introducing a runtime transaction boundary that coordinates cadastral mutation with all live dependent references. A mutation either produces a fully valid cross-domain state and commits all affected authorities, or leaves runtime state unchanged.

The feature does **not** transfer ownership of buildings, zoning, property-market data, or redevelopment state into `CadastralGraph`. Each domain remains authoritative for its own state.

## 2. Non-negotiable invariants

The implementation must preserve the following repository-wide rules:

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

Introduce a simulation-layer coordinator named `CadastralRuntimeMutationService`.

```text
SimulationCore
  └─ CadastralRuntimeMutationService
       ├─ stages CadastralGraph mutation on a cloned graph
       ├─ resolves canonical BuildingV2 references
       ├─ resolves parcel zoning assignments
       ├─ resolves property holdings
       ├─ validates historical property references through lineage
       ├─ validates redevelopment/project references
       ├─ derives the legacy LotSystem projection
       └─ commits all resulting snapshots to owning systems
```

`SimulationCore` exposes one readonly instance:

```ts
readonly cadastralMutations: CadastralRuntimeMutationService;
```

Callers do not receive the raw mutable `CadastralMutationSystem` tied directly to `core.cadastre`.

The coordinator uses `CadastralMutationSystem` only against a staged `CadastralGraph` clone. The real graph is untouched until every dependent state has been rewritten and validated.

## 4. Public mutation surface

The runtime service exposes the Phase 2R operations that can be made safe with deterministic cross-domain rewriting:

```ts
splitParcel(parcelId: string, cutLine: readonly WorldPoint[]): CadastralRuntimeMutationResult;
assembleParcels(parcelIds: readonly string[]): CadastralRuntimeMutationResult;
dedicateRightOfWay(parcelId: string, geometry: PolygonRing): CadastralRuntimeMutationResult;
createEasement(parcelIds: readonly string[], kind: EasementKind, geometry: readonly WorldPoint[]): CadastralRuntimeMutationResult;
removeEasement(easementId: string): CadastralRuntimeMutationResult;
```

The result includes the low-level cadastral result plus explicit runtime outcome data:

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

Every runtime mutation follows the same high-level sequence.

### 5.1 Snapshot all owning domains

Before staging a mutation, capture deterministic snapshots of:

- `core.cadastre.snapshot()`;
- `core.buildings.listV2()`;
- `core.zoning.listParcelAssignments()`;
- `core.propertyMarket.snapshot()`;
- the live redevelopment/project state that contains parcel IDs, if any;
- the legacy lot projection only as derived output, not as source state.

### 5.2 Stage the cadastral graph

Construct a temporary `CadastralGraph` from the canonical snapshot and run the requested `CadastralMutationSystem` operation against that temporary graph.

If the low-level mutation rejects, return its rejection result and do not touch any live system.

### 5.3 Build a parcel-reference resolution plan

The coordinator derives a deterministic mapping from each retired parcel to either:

- one resulting live parcel;
- multiple candidate children requiring geometry-based resolution;
- no live private parcel, for a fully consumed/invalid operation, which must reject unless the dependent reference is explicitly removable by the owning workflow.

One-to-one rewrites use `parcelReferenceRewrites` emitted by the low-level mutation.

One-to-many split resolution uses geometry, not arbitrary child ordering.

### 5.4 Stage dependent domains

Rewritten copies of buildings, zoning, holdings, and project state are created in memory. No live owner is mutated during this step.

### 5.5 Cross-domain validation

The staged result must satisfy all of the following before commit:

- every live `BuildingV2.parcelIds` entry exists in the staged cadastre;
- every building footprint is contained by its assigned parcel set;
- every current parcel zoning assignment references a staged live parcel;
- every current property holding references a staged live parcel;
- no live redevelopment/project parcel reference points at a retired parcel;
- property transaction history remains internally valid under lineage-aware historical validation;
- the staged legacy lot projection can be rebuilt from the staged cadastre;
- cadastral validation remains valid;
- deterministic ordering is preserved in all snapshots.

Any failure returns `committed: false` and leaves all live state unchanged.

### 5.6 Commit

After validation succeeds, replace owning-domain state in a fixed order:

1. canonical cadastre;
2. parcel zoning assignments;
3. canonical `BuildingV2` store;
4. property-market current state/history snapshot;
5. redevelopment/project state, where applicable;
6. rebuild `LotSystem` from the committed cadastre.

Because all commit inputs have already been validated, owner `restore`/`replaceSnapshot` methods are expected to succeed. If a restore method can still throw for reasons not covered by prevalidation, the coordinator must retain the original snapshots and perform rollback before rethrowing or returning rejection. Partial state may never escape the service.

## 6. Split semantics

Splits are the hardest mutation because one retired parcel becomes multiple live children.

### 6.1 Buildings

For each `BuildingV2` referencing the source parcel:

- compute footprint containment against every resulting child polygon;
- if the complete footprint is contained in exactly one child, replace the source parcel ID with that child ID;
- if the footprint overlaps multiple children or is not fully contained in any child, reject the entire split;
- preserve the building ID, lifecycle state, entitlement, project state, owner/developer fields, and all physical metrics exactly.

The runtime service does not split one building into multiple buildings.

### 6.2 Zoning

A source parcel's explicit V2 zoning assignment is inherited by every child created by that split. District ID and overlay IDs are copied exactly.

If the source has no explicit V2 assignment, no child assignment is fabricated; normal parcel/legacy zoning fallback continues to apply.

### 6.3 Property holdings

If the source parcel has a current property holding, every child inherits the same owner.

The source reservation value is allocated by child-area share:

```text
childReservationValue = sourceReservationValue * childArea / sum(childAreas)
```

The final child in canonical ID order receives the residual cents needed for exact conservation after currency rounding. Total reservation value across children must equal the source value within the existing monetary tolerance.

### 6.4 Historical property transactions

Past transactions referencing the retired source parcel remain historical records of the parcel that existed at transaction time. They are not rewritten to child IDs.

`PropertyMarketSystem` validation therefore must stop requiring every historical transaction parcel ID to be a current holding. Instead, transaction parcel IDs are valid when they identify either:

- a current live holding; or
- a parcel represented in cadastral lineage as a historical source/ancestor.

This validation requires a lineage-aware restore/validation path supplied by the runtime coordinator or a narrow callback/interface. It must not make `PropertyMarketSystem` own cadastral history.

## 7. Assembly semantics

Assembly is deterministic because several retired source parcels become one resulting parcel.

### 7.1 Preconditions

The low-level cadastral mutation already requires adjacency, one block, one zoning district, and common parcel owner metadata. The runtime service adds cross-domain checks:

- all current property holdings for source parcels must have the same owner;
- conflicting explicit V2 parcel zoning assignments reject assembly unless they are identical in district and overlays;
- active buildings must remain geometrically contained by the assembled parcel.

### 7.2 Rewrites

- all `BuildingV2.parcelIds` source references become the assembled parcel ID;
- duplicate parcel IDs are removed and canonical ordering is preserved;
- one identical source zoning assignment is installed on the assembled parcel;
- current property holdings collapse to one holding for the assembled parcel;
- assembled reservation value equals the sum of source reservation values;
- historical transactions remain unchanged and are validated through lineage;
- live redevelopment/project parcel references are rewritten to the assembled parcel.

## 8. Right-of-way dedication semantics

Right-of-way dedication retires the source private parcel and creates a residual private parcel.

The operation is allowed only when every referenced active building footprint is fully contained in the residual parcel. If dedication intersects or excludes a building footprint, reject.

Current zoning assignment and holding transfer one-to-one to the residual parcel. Reservation value is scaled by residual private-land area unless the owning workflow supplies an explicit acquisition/value adjustment in a future phase; no transportation compensation economics are introduced here.

Historical transactions remain unchanged.

This operation only updates land topology. Creation of a 3R transportation network object from the dedicated right-of-way is explicitly out of scope.

## 9. Easement semantics

Creating or removing an easement does not retire parcel IDs and therefore normally requires no building/zoning/property rewrite.

The runtime service still stages the graph and runs the full cross-domain validation before commit so callers use one safe mutation boundary for every cadastral operation.

## 10. Building identity and legacy compatibility

Parcel mutation must not silently regenerate canonical building IDs.

`reconcileCanonicalBuildingProjection()` currently derives canonical projections from legacy buildings and may synthesize IDs from parcel IDs. After runtime mutations, continued simulation ticks must preserve an existing `BuildingV2` whose physical building survived the mutation.

The implementation must therefore ensure reconciliation recognizes existing canonical buildings by stable identity/geometry rather than treating a parcel-ID rewrite as demolition plus new construction.

Required invariant:

```text
parcel mutation + core.step(n)
  preserves surviving BuildingV2.id
  preserves lifecycle state
  preserves yearBuilt
  preserves entitlement approvalTick
```

The derived `LotSystem` is rebuilt only after canonical commit. Legacy lot/building compatibility behavior must continue to resolve occupied cells without becoming the authority for parcel rewrites.

## 11. Redevelopment/project references

Any live runtime state containing parcel IDs must either participate in the transaction or block mutation.

Initial implementation should support the currently persisted/live redevelopment structures actually present in `SimulationCore`. The rule is conservative:

- one-to-one and assembly rewrites are applied deterministically;
- one-to-many split references are allowed only when the project can be uniquely assigned by associated building footprint/site geometry;
- otherwise the mutation rejects with a stable reason code such as `ambiguous-project-parcel-rewrite`.

Do not add speculative project systems solely for this feature.

## 12. Rejection reasons

Runtime-level rejection reasons must be deterministic strings suitable for tests and diagnostics. Required categories include:

- `building-crosses-split`;
- `building-outside-resulting-parcel`;
- `conflicting-zoning-assignments`;
- `conflicting-property-owners`;
- `ambiguous-project-parcel-rewrite`;
- `missing-resulting-parcel`;
- `property-value-not-conserved`;
- `dangling-parcel-reference`;
- `runtime-commit-rollback`.

Low-level cadastral rejection reasons pass through unchanged when the graph mutation itself rejects.

## 13. Persistence behavior

No Save V10 is introduced.

Save V9 already persists:

- cadastral topology and lineage;
- parcel V2 zoning assignments;
- canonical `BuildingV2` state;
- property-market state.

A successfully committed runtime mutation must therefore round-trip through existing Save V9 serialization without schema expansion unless implementation discovers an already-live parcel-referencing project state that is not currently persisted. If such a state exists, the implementation must stop and treat persistence expansion as a separate explicitly reviewed change rather than silently adding fields.

V8 migration behavior remains unchanged.

## 14. Determinism

The runtime service must not introduce nondeterministic collection traversal.

- parcel IDs are sorted lexicographically before rewrite decisions;
- building IDs are sorted lexicographically before geometry resolution;
- zoning assignments use canonical parcel-ID order;
- property holdings use canonical parcel-ID order;
- area-based value allocation uses deterministic currency rounding with residual applied to the final canonical child;
- rejection reason ordering is stable;
- no new RNG stream is needed.

Running the same mutation against identical snapshots must produce byte-equivalent staged snapshots and the same result object.

## 15. Testing requirements

Implementation follows TDD. At minimum, tests must cover:

1. **Split success:** a parcel with a building fully contained in one child commits; building points to that child.
2. **Split rejection:** a cut through a building rejects and all canonical snapshots remain deep-equal to pre-mutation state.
3. **Zoning inheritance:** explicit parcel assignment copies to all split children.
4. **Property conservation:** child holdings preserve owner and total reservation value.
5. **Historical transactions:** pre-split sale remains unchanged and Save V9 hydration accepts it through lineage-aware validation.
6. **Assembly success:** buildings, zoning, holdings, and live project references rewrite to the assembled parcel.
7. **Assembly conflict:** inconsistent owners or zoning reject atomically.
8. **Right-of-way success:** residual parcel receives live references when buildings remain contained.
9. **Right-of-way rejection:** dedication intersecting a building rejects atomically.
10. **Easement mutation:** create/remove uses the runtime service and does not alter unrelated canonical domains.
11. **Continuation:** after split/assembly, `core.step(10)` leaves no dangling parcel references and preserves surviving `BuildingV2` identity/lifecycle.
12. **Save V9 round-trip:** mutation → serialize V9 → hydrate → continue simulation preserves cadastre, buildings, zoning, holdings, history, and deterministic IDs.
13. **Failure rollback:** forced restore/commit failure restores all original canonical snapshots.
14. **Determinism:** identical initial cores + identical mutation requests produce deep-equal results and snapshots.

The final repository gate remains:

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

The implementation plan should prefer the following structure:

- Create `src/world/cadastre/CadastralRuntimeMutationService.ts` for transaction staging, rewrite planning, validation, commit, and rollback orchestration.
- Modify `src/simulation/core/SimulationCore.ts` only to construct/expose the service and make canonical building reconciliation mutation-safe.
- Modify `src/simulation/buildings/BuildingSystem.ts` only for narrow stable-identity/validation helpers if required.
- Modify `src/simulation/zoning/ZoningSystem.ts` only for narrow staged assignment validation/restore support if required.
- Modify `src/simulation/development/PropertyMarketSystem.ts` only for lineage-aware historical validation and staged-state support; do not give it cadastral ownership.
- Modify redevelopment/project code only when a concrete current parcel reference requires participation.
- Add focused runtime mutation tests rather than expanding unrelated suites.
- Extend Save V9 tests only for mutation round-trip behavior; do not change the V9 schema by default.

If implementation pressure suggests moving unrelated responsibilities into the service or rewriting large existing systems, stop and split the work rather than creating a coordinator god object.

## 17. Acceptance criteria

Task 13 is complete when all of the following are true:

- `SimulationCore` exposes a safe cadastral runtime mutation service.
- No caller needs direct mutable access to `CadastralMutationSystem` bound to the live canonical graph.
- Split, assembly, right-of-way, and easement operations are all-or-nothing across every current parcel-referencing canonical domain.
- Surviving buildings retain stable canonical identity and lifecycle across mutation and later simulation ticks.
- Parcel zoning assignments and current property holdings contain no retired live parcel IDs.
- Historical property transactions remain historically truthful and validate through parcel lineage.
- Save V9 round-trip and continued simulation preserve the committed mutation state.
- Failed mutations leave all canonical snapshots unchanged.
- Existing V7/V8 compatibility remains green.
- Full repository CI passes on the exact implementation head.
- No 3R transportation behavior is introduced.
