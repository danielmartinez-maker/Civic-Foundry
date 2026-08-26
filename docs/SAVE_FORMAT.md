# Save Format — V9

Current canonical persistence envelope:

- `saveVersion: 9`
- `gameVersion: "0.9.0-urban-fabric"`

Save V9 extends, rather than replaces, the existing compatibility chain. Save V8 remains the explicit World Foundation format and V7 remains available for historical migration/parity tests.

## Inherited state

V9 retains the complete V8 envelope, which already contains the inherited deterministic V7 city state plus the authoritative `WorldFoundationSnapshot`.

That inherited state includes the simulation seed/RNG continuation, clock, treasury, compatibility terrain, roads/revision, legacy zoning/buildings/lots compatibility data, population, taxes, utilities, waste, economy, traffic/intersections, public services, transit, mobility continuation, firms/inventories/cargo/freight, housing/relocation, development policy, developer-market continuation, and World Foundation terrain/hydrology/geography/design-storm state.

## Urban Fabric V9 additions

V9 adds four authoritative Urban Fabric fields:

```ts
urbanFabric: CadastralSnapshot
zoningV2: {
  parcelAssignments: readonly ParcelZoningAssignment[]
}
buildingsV2: readonly BuildingV2[]
propertyMarket: PropertyMarketSnapshot
```

### `urbanFabric`

Persists the canonical legal-land topology:

- parcel nodes and boundary edges;
- urban blocks and block-to-parcel membership;
- parcels with canonical IDs, geometry-derived area/centroid, frontage/access edges, district identity, ownership, and historical parent IDs;
- easements;
- parcel lineage events from split, assembly, and right-of-way mutations.

The cadastral graph is the runtime land authority. Legacy `LotSystem` records are not a competing source of truth; after V9 hydration they are rebuilt as a compatibility projection from the restored cadastre.

### `zoningV2.parcelAssignments`

Persists parcel-level dimensional zoning assignments and overlays. References are validated against the restored cadastral graph before the live core is returned.

### `buildingsV2`

Persists canonical physical building state, including parcel references, footprints, massing, floor/use allocation, entitlement, lifecycle state, and project metadata where present. Legacy building persistence remains in the inherited envelope for compatibility; canonical V2 state is restored independently and must reference existing parcels.

### `propertyMarket`

Persists authoritative property holdings and transactions used by the Urban Fabric property market. Every persisted parcel reference is validated during hydration.

## V9 hydration order

`hydrateCoreV9()` restores in this order:

1. validate `saveVersion: 9`, `gameVersion`, and the four Urban Fabric envelopes;
2. construct the inherited V8 candidate through `hydrateCoreV8()` so `WorldFoundation` is restored before terrain-dependent legacy systems are created;
3. replace the runtime cadastral snapshot with `urbanFabric`;
4. rebuild the legacy lot facade from the restored cadastre;
5. validate parcel references in zoning assignments, canonical buildings, property holdings, and property transactions;
6. restore parcel zoning assignments;
7. restore canonical `BuildingV2` state;
8. restore the property market;
9. return the coherent V9 core.

Invalid or dangling Urban Fabric references fail hydration rather than being silently dropped or repaired.

## V8 → V9 migration

Loading a Save V8 through the current public API deterministically creates the V9 Urban Fabric state from the restored legacy land/city state. Migration preserves V8 identifiers and behavior and does not rewrite V8 itself.

The migration boundary is intentionally compatibility-first:

- `WorldFoundation` remains the physical/geographic authority introduced by V8;
- the cadastral graph becomes the legal-land authority introduced by V9;
- legacy lots remain derived compatibility records;
- legacy buildings remain available to older systems while canonical `BuildingV2` is projected/restored separately;
- no fabricated parcel transaction, easement, or redevelopment history is introduced merely because an old save was loaded.

## Older migration chain

The supported current-load chain remains progressive:

`V3/V4/V5/V6 → V7 → V8 → V9`

Older formats retain their explicit serializers/hydrators for migration tests and historical fixtures. A V7-or-earlier load receives the deterministic neutral World Foundation migration behavior established by V8, then the deterministic Urban Fabric migration required by V9.

## Derived and non-persisted state

V9 still excludes state that can be deterministically reconstructed or is presentation-only, including:

- transportation and multimodal route caches;
- render geometry, selected cells/parcels, overlay modes, and UI state;
- recomputable zoning envelopes, massing candidates, compliance diagnostics, highest-and-best-use evaluations, redevelopment-pressure diagnostics, bids, and other transient underwriting outputs;
- other caches and diagnostics already excluded by inherited formats.

## Compatibility guarantees

The public `serializeCore()` / `hydrateCore()` API uses V9 by default.

Explicit V8 serialization remains available and continues to use:

- `saveVersion: 8`
- `gameVersion: "0.8.0-world-foundation"`

Urban Fabric work therefore **extends persistence through Save V9**. It does not repurpose or silently mutate the World Foundation Save V8 contract.

## Acceptance requirements

V9 persistence is covered by tests requiring:

- exact Urban Fabric round-trip;
- deterministic continuation after load;
- canonical parcel/building/property references to remain valid;
- legacy lots to rebuild from persisted cadastral topology;
- V8 migration to produce deterministic V9 state;
- corrupt references to fail hydration;
- the compiled Urban Fabric browser smoke to preserve sorted canonical parcel and `BuildingV2` IDs across save/load.
