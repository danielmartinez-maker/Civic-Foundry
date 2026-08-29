# Cadastral Integrity Tranche 1 Design

## Goal

Prevent ordinary legacy road and zoning edits from silently destroying or dangling canonical Urban Fabric state.

## Scope

This tranche addresses CF-006 through CF-009 only. It covers `SimulationCore` road placement, zoning paint, road bulldoze, and zone bulldoze paths that currently call `rebuildCadastreFromLegacyState()` after mutating the legacy grid.

It does not redesign the cadastral mutation API, change Save V9, add new gameplay UI, or implement later Urban Fabric lifecycle/property-market roadmap work.

## Required invariants

1. A legacy edit that leaves a canonical parcel's geometry unchanged preserves that parcel's canonical ID.
2. Existing cadastral lineage is never discarded by a legacy rebuild.
3. Existing easements are preserved when every referenced parcel survives with the same geometry.
4. Explicit parcel zoning assignments, property holdings, and canonical BuildingV2 references never dangle after a legacy edit.
5. Canonical BuildingV2 identity and lifecycle metadata survive non-destructive legacy edits.
6. If a legacy edit would change the geometry of a parcel that has a canonical dependency that cannot be safely preserved, the entire gameplay edit is rejected and all mutated legacy/canonical/treasury state is restored.
7. Unreferenced parcel topology may still be regenerated from legacy roads/zoning. Retired/generated parcel history is recorded as deterministic `boundary-adjustment` lineage.
8. Save V9 schema and game version remain unchanged.

## Approach

Add a focused cross-domain `LegacyCadastreRebuildService` beside `CadastralRuntimeMutationService`.

The service receives the existing cadastre and a newly generated candidate snapshot from `ParcelGenerationSystem`. It compares old and candidate parcel polygons by normalized geometry. Geometry-stable candidate parcels inherit their previous canonical parcel ID and parcel metadata where that metadata is still meaningful, while candidate topology/edge/frontage data comes from the fresh generation.

Before commit, the service identifies every retired old parcel. A retired parcel is considered protected when it is referenced by any of:

- explicit parcel zoning assignment;
- live property holding;
- canonical BuildingV2 parcel references;
- live easement.

If a protected parcel does not have a geometry-identical survivor, the candidate is rejected as an unsafe legacy land mutation. This tranche intentionally prefers rejection over guessed split/merge semantics; canonical split/assembly/right-of-way operations already have the explicit transactional mutation service for legal parcel changes.

For permitted topology changes involving only unprotected parcels, the service appends one deterministic `boundary-adjustment` lineage event for the changed source/result set. Existing lineage is retained byte-for-byte and existing easements are retained because any easement-referenced parcel is protected from retirement.

The complete staged cadastral snapshot is validated before live state is replaced. After replacement, lots are re-derived from the new cadastre.

## Legacy edit transaction boundary

`SimulationCore` wraps each road/zoning edit in an edit transaction:

- snapshot legacy roads and revision;
- snapshot legacy zoning cells;
- snapshot treasury balance and transactions when the operation can spend money;
- snapshot cadastre, canonical parcel zoning assignments, BuildingV2, property state, and compatibility lots;
- execute the inherited legacy operation;
- run `LegacyCadastreRebuildService`;
- if reconciliation succeeds, keep the edit;
- if reconciliation rejects or throws, restore road/zoning/treasury and every canonical domain, then rebuild compatibility lots from the restored cadastre.

Existing public method signatures are preserved. A rolled-back road build returns `ok: false` with reason `cadastral reconciliation failed`; a rolled-back zoning paint reports `painted: 0`; a rolled-back road/zone bulldoze returns `ok: false` with the same reason.

## Determinism

Geometry matching uses normalized polygon coordinate fingerprints, not iteration order. Source/result parcel sets and lineage event IDs are sorted deterministically. Lineage IDs use the next available deterministic `legacy-boundary-adjustment:<n>` suffix derived from existing lineage.

## Tests

Add regression coverage proving:

1. an unrelated road edit preserves existing easements and lineage;
2. an unrelated zoning edit preserves explicit parcel zoning, property holding, canonical BuildingV2 ID, and lifecycle;
3. a road edit that would retire a protected parcel is rejected and restores roads, treasury, cadastre, zoning assignments, BuildingV2, property state, and lots byte-for-byte;
4. a zoning edit that would retire a protected parcel is rejected with the same canonical rollback guarantee;
5. a topology change affecting only unprotected parcels succeeds and appends deterministic boundary-adjustment lineage;
6. Save V9 round-trip behavior remains unchanged through the inherited suite.
