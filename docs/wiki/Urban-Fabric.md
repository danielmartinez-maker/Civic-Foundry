# Urban Fabric

[← Wiki Home](Home.md)

**Status: Implemented — Phase 2R.**

Urban Fabric moves Civic Foundry beyond simple lot/cell assumptions toward durable legal parcels, dimensional zoning, physical building massing, lifecycle, and property state.

## Cadastre

`CadastralGraph` is the legal-land authority. It tracks parcels, shared boundaries, block membership, geometry, centroid/area, frontage/access, ownership identity, zoning-district identity, easements, and lineage.

A canonical parcel can span multiple legacy cells. Parcel IDs and legacy lot IDs are deliberately different identity spaces.

## Dimensional zoning

Zoning is a constraint system rather than a direct building recipe. Controls can include allowed uses, FAR, height, lot coverage, setbacks, minimum frontage, mixed-use permissions, and overlays.

```text
parcel geometry
+ setbacks
+ dimensional controls
+ overlays
→ buildable envelope
```

## `BuildingV2`

Canonical buildings can record parcel identity, footprint, floors, use components, gross/use area, area-derived capacity, condition, quality, age, lifecycle state, and project state. Mixed use is first-class.

## Development pipeline

```text
parcel
→ effective zoning
→ buildable envelope
→ massing candidates
→ compliance
→ economics / highest-and-best-use
→ developer bid/award
→ canonical BuildingV2
```

Private development is intended to depend on feasibility and market conditions, not only zoning paint.

## Lifecycle and redevelopment

Urban Fabric supports building condition, effective age, maintenance need, deterioration, renovation/adaptive reuse, distress, redevelopment, demolition, and grandfathered/nonconforming behavior. Redevelopment is constrained by economics and displacement/relocation safeguards.

## Parcel mutation

Supported legal operations include split, assembly, right-of-way dedication, and easement create/remove. Runtime mutations must coordinate cadastre, parcel zoning, canonical buildings, property holdings, and the derived legacy-lot projection transactionally.

## Property state

Current Urban Fabric property systems track live parcel holdings and historical transactions. Historical records should survive later parcel changes and may reference retired parcel IDs only when cadastral lineage validates that history.

## Boundary with transportation

Right-of-way dedication changes legal land. It does not create lanes, signals, routing, parking, or traffic authority. Those belong to transportation.