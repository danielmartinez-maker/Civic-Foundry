# Civic Foundry — Development Log

This log records durable phase-level checkpoints. Detailed task-by-task history remains available in Git commits, implementation plans, PR discussion, and GitHub Actions runs.

## 2026-08-21 — Phase 1–3 fresh reimplementation

Rebuilt the deterministic playable baseline in the durable GitHub repository after the earlier temporary execution workspace expired.

Restored:

- terrain, treasury, zoning, road-frontage lots, buildings, population, employment, taxes, utilities, garbage, and demand;
- road hierarchy, transportation graph, deterministic routing, weighted trip generation, moving traffic, intersections, congestion, and accessibility;
- deterministic save/load and headless parity coverage.

## 2026-08-21 — Phase 4 Public Services

Implemented fire, police, clinics, schools, landfill/recycling, department funding/staffing/capacity/fleets, network-based service accessibility, explicit routed service vehicles, incidents, fire spread, routed waste, education, neighborhood service quality, V4 persistence, and browser acceptance.

## 2026-08-21 — Phase 5 Transit Revolution

Implemented deterministic bus/BRT/tram/metro topology, multimodal generalized-cost planning, person-trip cohorts, mode choice, queues/transfers/partial boarding, explicit transit vehicles, headways/fleet/fare/cost/reliability/crowding feedback, V5 persistence, and compiled browser coverage.

## 2026-08-22 — Phase 6 Firms, Production & Freight

Implemented deterministic establishments/labor, conserved inventories and production chains, freight gateways, generalized-cost supplier matching, imports/exports, routed freight trucks, logistics-cost feedback, sustained firm lifecycle state, dispatch capacity/queue aging, V6 continuation, and economy/freight UI diagnostics.

## 2026-08-22 — Phase 7 Land, Housing & Development

Added the first economic property/development layer above the legacy cell-lot model:

- R/C/I property-market signals;
- developer pro-forma underwriting and competing capital-constrained developers;
- persistent housing tenure/relocation;
- redevelopment pressure and occupied-residential safeguards;
- development-policy controls;
- V7 developer/housing continuation;
- land/housing panels, overlays, and browser smoke.

This phase intentionally did **not** make legal parcel geometry authoritative yet.

## 2026-08-24 — Civic Foundry 2.0 Phase 0A Kernel

Inserted the deterministic `SimulationKernel` beneath the existing city model without rewriting gameplay ownership. The kernel provides one shared clock, deterministic scheduling/dependency validation, command sequencing, diagnostic event journaling, named RNG streams, invariants, snapshot providers, and fail-stop behavior.

## 2026-08-24 — Isometric Presentation Pass A

Reworked presentation into a deterministic 64×32 2:1 isometric renderer with quarter-turn rotation, deterministic sprite identity/road autotiling, atlas contracts, explicit render order, viewport culling, coordinate-correct interaction, and compiled functional/visual Chromium smoke coverage.

## 2026-08-25 — Phase 1R World Foundation 2.0

Implemented the authoritative physical-world substrate:

- `WorldFoundation`;
- physical terrain and engineering soil properties;
- geography hierarchy `Region → Municipality → District → Neighborhood → Block`;
- deterministic world generation with six presets and named RNG streams;
- priority-flood terrain conditioning and D8 hydrology;
- watersheds, channels, flood susceptibility, and design storms;
- scenario overrides and spatial indexing;
- terrain-preparation economics;
- legacy terrain compatibility adapter.

Introduced Save V8 (`0.8.0-world-foundation`) so the complete inherited V7 gameplay envelope could persist alongside authoritative world state. Older saves migrate through deterministic neutral legacy-world semantics without fabricated physical history.

Phase 1R intentionally stopped at block geography. Legal parcels were reserved for the next reviewed tranche.

## 2026-08-25–27 — Urban Fabric 2.0 / 2R on PR #63

Urban Fabric 2.0 was implemented on `feature/urban-fabric-2.0` / draft PR #63 while keeping `main` untouched.

### Reconciliation with the 1R baseline

The 2R branch was reconciled onto the 1R baseline without rewriting its existing history. The key compatibility rules were locked before continuing:

- `WorldFoundation` remains the sole physical/geographic authority;
- legal cadastral parcels become the canonical runtime land authority;
- legacy lot/building identifiers required by V7/V8 compatibility cannot silently change;
- Urban Fabric persistence extends the chain through **Save V9** instead of repurposing Save V8.

### Canonical cadastre and legacy lot compatibility

The first Task 13 integration exposed an authority/identity mismatch: a canonical parcel can group multiple compatible legacy frontage cells, while existing runtime/tests still require stable per-cell `lot:x,y` records.

The fix made `LotSystem` a projection of cadastral frontage rather than a second authority. One cadastral parcel can therefore project multiple legacy lots while parcel identity remains canonical for new land/development work.

Legacy V7/V8 hydration was also repaired to rebuild the cadastre after restored roads/zoning, preventing a loaded core from carrying a stale/empty canonical land model.

### Urban Fabric runtime services

`SimulationCore` owns the parcel-development service set:

- buildable envelopes;
- zoning compliance;
- physical massing;
- building lifecycle;
- renovation/adaptive reuse;
- highest-and-best-use;
- property market;
- bounded site assembly;
- the cross-domain `CadastralRuntimeMutationService` exposed as readonly `cadastralMutations`.

Raw `CadastralMutationSystem` remains the low-level legal-geometry engine. Runtime callers use `CadastralRuntimeMutationService`, which stages the requested graph operation on a cloned cadastre, rewrites and validates dependent canonical building/zoning/current-holding references, validates historical property records through cadastral lineage, proves the legacy lot projection can be rebuilt, and only then commits live owners in fixed order.

If any live commit stage fails, the service restores the original cadastre, zoning, canonical buildings, and property-market snapshot and rebuilds the lot facade from the restored cadastre. Partial cross-domain parcel mutation is not permitted to escape.

### Canonical BuildingV2 storage

`BuildingSystem` gained independent canonical `BuildingV2` storage while retaining the legacy building map.

Canonical APIs provide deterministic listing, ID lookup, and compatibility-cell spatial lookup without changing canonical IDs. Restore validates duplicate IDs transactionally and returns isolated read copies.

Runtime development was then moved to cadastral parcel identity so developer awards and physical massing materialize canonical `BuildingV2` state while legacy lots remain derived compatibility records.

Grandfathered legacy structures sharing a newly grouped parcel are preserved rather than silently discarded. Safe runtime parcel rewrites additionally preserve surviving canonical building ID, lifecycle, year built, entitlement timing, and project metadata through later simulation continuation.

### Legal parcel operations

`CadastralMutationSystem` supports low-level transactional:

- parcel split;
- compatible parcel assembly;
- easement creation/removal;
- right-of-way dedication.

Candidate snapshots are validated before graph replacement. Tests lock area conservation, atomic rejection, shared-boundary behavior, access/frontage state, and lineage.

`CadastralRuntimeMutationService` now coordinates those same operations across all participating live parcel-reference owners. Splits resolve buildings geometrically to one child or reject; assemblies reject conflicting explicit zoning/current owners; right-of-way dedication transfers live references only when surviving building geometry remains valid; easements use the same public transaction boundary even though parcel IDs normally remain stable.

### Dimensional zoning, massing, lifecycle, and redevelopment

Urban Fabric added:

- deterministic dimensional zoning districts;
- parcel-level zoning assignments independent of legacy cell paint;
- setbacks, FAR, height, coverage, minimum parcel geometry, and use controls;
- legal buildable envelopes;
- physical building massing and mixed-use floor allocation;
- lifecycle condition/effective age/maintenance/distress;
- renovation/adaptive reuse;
- explainable physical redevelopment pressure;
- highest-and-best-use competition among hold/renovate/convert/redevelop;
- property holdings/transactions;
- deterministic site-assembly economics;
- relocation-safe redevelopment sequencing.

Illegal physical candidates are rejected before developer bidding. Unresolved displacement continues to block demolition.

### Save V9

Introduced current default **Save V9**:

- `saveVersion: 9`;
- `gameVersion: '0.9.0-urban-fabric'`;
- inherited complete Save V8 state;
- `urbanFabric` cadastral snapshot;
- `zoningV2.parcelAssignments`;
- `buildingsV2`;
- `propertyMarket`.

V9 hydration restores V8/World Foundation first, replaces the cadastre, rebuilds legacy lots from that cadastre, validates live parcel references, then restores parcel zoning, canonical buildings, and property state.

Historical property transactions deliberately keep the parcel IDs that existed when the transaction occurred. After runtime split/assembly/right-of-way mutation, retired transaction parcel IDs remain valid only when persisted cadastral lineage recognizes them. Current holdings remain restricted to live parcels. No Save V10 was introduced for Task 13.

Explicit Save V8 remains available unchanged for World Foundation compatibility and migration testing.

### Player-facing Urban Fabric UI

Added a mutually exclusive Urban Fabric analytical overlay selector with:

- Cadastre;
- Zoning envelope;
- Redevelopment.

The canonical parcel inspector exposes parcel/zoning/building/condition/property/redevelopment information. A browser integration defect in parcel click handling was fixed by rendering from the exact canonical parcel ID already selected by the overlay instead of re-resolving through a legacy cell center.

### Task 16 hardening

Added deterministic cadastral mutation fuzzing using seeds:

`3, 7, 11, 19, 31, 47, 73, 101`

Each seed runs 80 mixed mutation attempts and validates the cadastral graph plus snapshot round-trip after every step. Final controlled private-land + dedicated-right-of-way area must remain conserved within 0.05 m².

Added a dedicated compiled Chromium Urban Fabric smoke that verifies:

- browser boot without page/console errors;
- real road/zoning/utility setup;
- runtime cadastral parcel generation;
- runtime `BuildingV2` materialization;
- cadastre/zoning-envelope UI behavior and canonical parcel inspection;
- current Save V9 identity/version;
- canonical parcel/building IDs unchanged after hydrate.

The smoke is a required GitHub Actions CI step via `npm run test:smoke:urban-fabric`.

### Task 13 runtime mutation closure

The final Task 13 audit gap is implemented and verified.

The closure adds:

- public safe split/assembly/right-of-way/easement mutation through `SimulationCore.cadastralMutations`;
- deterministic cross-domain staging and fixed-order commit;
- stable `BuildingV2` identity and lifecycle state across parcel-ID rewrites and continued simulation;
- lineage-aware preservation of historical property transactions;
- mutation → Save V9 → hydrate → continue coverage;
- twin-core split → assembly determinism with deep-equal canonical snapshots;
- a narrow optional commit fault injector used to force a failure after real live writes and prove byte-for-byte rollback across cadastre, zoning, canonical buildings, property market, and derived lots.

The Task 6 RED checkpoint had **594/595** tests passing, with only the forced rollback contract failing because no commit failpoint existed. The minimal production seam was added in commit `fa23d77bdaba7f8d260b10ca2d75507f38ed81a6`.

Exact-head Civic Foundry CI run **#992** then passed on `fa23d77b`, including **595/595 Node tests**, typecheck, lint/policy/architecture checks, asset validation, production build, Phase 6 browser smoke, Phase 7 browser smoke, Urban Fabric browser smoke, Isometric Pass A functional browser smoke, and Isometric Pass A visual smoke.

### Final documentation gate

At this checkpoint, the implementation head was green and the documentation/reconciliation checkpoint still required its own exact-head CI run before PR #63 could be treated as integration-ready. That final reconciliation head subsequently passed CI run **#993** with the full then-current gate.

### Integration boundary

At this checkpoint, PR #63 remained isolated from `main` pending explicit approval. It was subsequently approved and merged into `main` as merge commit `ee296a988a0be6db5a3f535c08e21ffb085906cc` on 2026-08-27. Save V9, cadastral land authority, and the Urban Fabric runtime described above are therefore part of the integrated baseline rather than an isolated feature branch.

## 2026-08-27 — Desktop GPU Runtime / PR #98 integrated

PR #98 replaced the production `GameApp` Canvas2D world-rendering path with `GpuWorldRenderer` backed by PixiJS 8/WebGL while preserving the authoritative TypeScript simulation, Save V9, `IsometricCamera`, tools, HUD, inspector, and compatibility boundaries.

The tranche also added the hardened Electron Windows host around the same local `dist/` build used for browser development. Node integration is disabled, context isolation and sandboxing are enabled, unexpected navigation/window creation is denied, and no generic IPC or new simulation authority was introduced.

Feature head `725c9cec539f1df32386c4c35e95c81a7fe134ab` passed GitHub Actions run `33137152536` with **600/600 Node tests**, core verification, Phase 6/7/Urban Fabric browser smokes, Isometric Pass A functional smoke, and Isometric Pass A visual smoke. PR #98 was then merged into `main` as `c2e7befd9174b65dadc90e1e381d892accf780c6`.

Legacy Canvas2D renderer/pass sources remain in the repository only as transitional parity references. They are not instantiated by the production `GameApp` path; specialized visual parity, retained-scene performance work, installer/update packaging, optional WebGPU evaluation, and eventual legacy renderer deletion remain deferred presentation work.
