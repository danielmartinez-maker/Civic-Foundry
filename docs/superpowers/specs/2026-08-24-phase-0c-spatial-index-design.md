# Civic Foundry 2.0 — Phase 0C Spatial Index & Deterministic Spatial Query Layer Design

## Status

Approved direction in chat on 2026-08-24. This specification defines the third Civic Foundry 2.0 Foundry Kernel tranche after Phase 0A and Phase 0B.

This document is intentionally written as a handoff specification for a separate implementation session. The implementation chat must treat this file, the Civic Foundry 2.0 master architecture, and the completed Phase 0B entity-registry contract as the source of truth.

Phase 0C adds a deterministic, derived, rebuildable spatial query layer. It does **not** migrate gameplay ownership out of current V7 systems, does not replace routing, and does not introduce a GIS-scale subsystem.

## Hard Prerequisite

Phase 0C depends on the Phase 0B entity identity layer.

Before implementation begins, the implementation session must confirm that the target branch contains a completed and verified Phase 0B implementation providing generation-aware `EntityHandle`s and active-entity lookup semantics equivalent to the Phase 0B design.

If Phase 0B has not been implemented and merged yet, the implementation session must not invent a parallel identity scheme inside Phase 0C. It should wait for or build on the completed 0B branch.

The Phase 0C index may represent derived V7 topology that is not yet an EntityRegistry entity, but any indexed object that already has a Phase 0B entity identity must use the exact active `EntityHandle`, never a raw legacy ID as its canonical owner.

## Relationship to the Master Architecture

The Civic Foundry 2.0 master architecture requires a `SpatialIndex` supporting:

- point-in-parcel queries;
- nearby-facility lookup;
- buildings intersecting buffers;
- network attachment;
- neighborhood membership;
- flood/noise/pollution sampling;
- parcel frontage;
- corridor analysis.

The master architecture also requires that derived state be rebuildable, deterministic, non-authoritative, and excluded from saves unless a later phase explicitly changes that rule.

Phase 0C establishes those spatial primitives and query contracts before Phase 1R geography/parcels, Phase 2R urban fabric, Phase 3R transportation, infrastructure networks, environment, households, regional simulation, and analytics begin depending on shared spatial behavior.

# Why This Tranche Comes Next

Current V7 systems perform spatial reasoning independently and repeatedly:

- roads are keyed by grid coordinates;
- lots are rebuilt from zoning plus cardinal road adjacency;
- buildings use cell coordinates and linear scans for some lookup paths;
- utility and service facilities each implement their own occupancy/access checks;
- transit stops maintain their own point/cell lookup logic;
- utility connectivity builds separate road-component indexes;
- many systems reason about adjacency using local one-off loops;
- future parcels, neighborhoods, environment fields, corridors, and infrastructure layers do not yet share a query contract.

This is acceptable for the V7 compatibility baseline, but it is not sufficient for Civic Foundry 2.0. Later systems need one deterministic vocabulary for geometry, proximity, containment, attachment, and derived spatial sampling.

Phase 0C solves the shared-query problem without changing any current gameplay formula.

# Goals

Phase 0C must provide:

1. A deterministic spatial geometry vocabulary in world-cell coordinates.
2. A generic derived `SpatialIndex` using deterministic broad-phase bucketing and exact geometry predicates.
3. Stable spatial feature identity tied to Phase 0B `EntityHandle`s where available.
4. A derived-subject mechanism for V7 topology that is not yet entity-registered.
5. Atomic rebuild semantics.
6. Deterministic point, AABB, radius, buffer, nearest, and corridor queries.
7. Semantic query helpers for parcel/lot containment, nearby facilities, building buffers, network attachment, neighborhood lookup, parcel frontage, and corridor membership.
8. A scalar spatial-field registry suitable for elevation now and flood/noise/pollution later.
9. A V7 compatibility projector that indexes existing lots, buildings, facilities, transit stops, and roads without making the index authoritative.
10. Kernel integration after the Phase 0B identity synchronization boundary.
11. Constructor/bootstrap and hydrate rebuild behavior.
12. Exact V7 parity preservation.
13. No Save V8 requirement.
14. Deterministic diagnostics, snapshots, invariants, and scale benchmarks.
15. A stable API that later replacement phases can consume without knowing V7 storage conventions.

# Non-Goals

Phase 0C does **not**:

- replace `RoadSystem`, `LotSystem`, `BuildingSystem`, `UtilitySystem`, `ServiceFacilitySystem`, `TransitNetworkSystem`, or current traffic systems;
- change road placement, zoning, development, redevelopment, utility, service, transit, traffic, housing, freight, or economy outcomes;
- replace the V7 transportation graph or pathfinder;
- replace current utility road-component connectivity;
- introduce real Phase 1R polygon parcels as authoritative gameplay state;
- introduce neighborhood simulation;
- implement flood, noise, or pollution models;
- implement network node/edge entity migration;
- spatially index every moving vehicle on every tick;
- implement arbitrary GIS projections, latitude/longitude, spherical geometry, geodesics, map reprojection, or external GIS file formats;
- implement polygon boolean operations, polygon clipping, or general-purpose constructive geometry;
- require an R-tree, quadtree, or third-party spatial dependency;
- persist index buckets, spatial features, cached query results, or field samples;
- introduce a new save version;
- change UI behavior;
- change gameplay RNG consumption;
- change simulation cadence or balance;
- use the new index to silently replace V7 logic during this tranche.

# Design Choice

## Recommended Architecture: Uniform-Grid Spatial Hash + Exact Predicates

Phase 0C uses a deterministic uniform-grid spatial hash as the broad-phase index.

This is preferred over an R-tree or quadtree because:

- Civic Foundry currently operates in a regular cell world;
- bucket assignment is deterministic and easy to rebuild;
- implementation order does not affect tree shape because there is no mutable tree shape;
- candidate generation is simple to inspect and test against brute force;
- most current and near-future geometry is local and compact;
- later polygon and corridor geometry can still use the same buckets by indexing their AABBs;
- no third-party dependency is needed;
- the derived index can be discarded and reconstructed safely.

The broad phase may over-select candidates. Exact predicates determine final results.

## Rejected Alternative: Dynamic R-tree

A dynamic R-tree can outperform a grid in some distributions, but Phase 0C does not need that complexity. Insertion heuristics, split behavior, mutation ordering, serialization/debugging complexity, and determinism risk are not justified for the current map scale.

## Rejected Alternative: Brute-Force Query Registry

A typed list plus brute-force queries would be simple but would immediately become a scaling bottleneck for parcels, buildings, facilities, environmental overlays, corridors, and future regional layers. It would also fail the purpose of establishing spatial infrastructure before later phases expand entity counts.

# Package Layout

Phase 0C introduces a focused package:

```text
src/spatial/
  SpatialTypes.ts
  SpatialGeometry.ts
  SpatialIndex.ts
  SpatialProjection.ts
  LegacyV7SpatialProjector.ts
  SpatialQueryService.ts
  SpatialFieldRegistry.ts
  SpatialDiagnostics.ts
```

The implementation may split a geometry-predicate file further if it approaches the normal architecture file-size warning.

Tests remain focused under `tests/`.

No file should become a generic dumping ground for unrelated geometry, projection, query, and compatibility logic.

# Coordinate System

## World Units

Phase 0C uses **world-cell units**.

Current V7 integer `(x, y)` coordinates identify cells.

A grid cell at `(x, y)` occupies the half-open area:

```text
[x, x + 1) × [y, y + 1)
```

Its geometric center is:

```text
(x + 0.5, y + 0.5)
```

This convention prevents a generic point from belonging to two adjacent cells merely because it lies on an internal integer boundary.

The existing V7 domain owners remain free to continue using their current integer coordinate APIs. Phase 0C converts those coordinates into explicit spatial geometry at projection time.

## Numeric Requirements

All geometry coordinates must be finite numbers.

The spatial package rejects:

- `NaN`;
- positive/negative infinity;
- negative radii or buffer widths;
- malformed AABBs;
- empty required geometry;
- invalid polygon rings.

Validation occurs before committed index state is changed.

## Distance Metric

Generic geometric proximity uses Euclidean distance in world-cell units.

Domain-specific topology may use stricter semantics where required. For example, V7 parcel frontage means cardinal shared-edge road adjacency, not merely Euclidean proximity.

The query API must not silently substitute Manhattan distance for Euclidean distance.

# Geometry Vocabulary

Phase 0C supports these geometry primitives:

```ts
export type SpatialPoint = Readonly<{
  type: 'point';
  x: number;
  y: number;
}>;

export type SpatialCell = Readonly<{
  type: 'cell';
  x: number;
  y: number;
}>;

export type SpatialAabb = Readonly<{
  type: 'aabb';
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

export type SpatialPolyline = Readonly<{
  type: 'polyline';
  points: readonly Readonly<{ x: number; y: number }>[];
}>;

export type SpatialPolygon = Readonly<{
  type: 'polygon';
  points: readonly Readonly<{ x: number; y: number }>[];
}>;

export type SpatialGeometry =
  | SpatialPoint
  | SpatialCell
  | SpatialAabb
  | SpatialPolyline
  | SpatialPolygon;
```

## Polygon Scope

Phase 0C supports **simple single-ring polygons** only.

Requirements:

- at least three distinct vertices;
- no non-finite vertices;
- implicit closure is allowed; callers do not need to repeat the first vertex;
- self-intersecting polygons are invalid;
- holes and multipolygons are deferred;
- later phases may compose multiple features where a more complex region is needed.

This is sufficient to establish future parcel/neighborhood compatibility without turning Phase 0C into a full computational-geometry engine.

## Geometry Helpers

`SpatialGeometry.ts` owns deterministic pure helpers for at least:

- geometry validation;
- canonical geometry normalization;
- AABB calculation;
- point containment;
- AABB intersection;
- point-to-geometry squared distance;
- point-to-segment squared distance;
- segment intersection;
- polyline-to-feature distance required for corridor queries;
- stable geometric equality used by projection change detection.

Square roots should be avoided where squared distances are sufficient.

No helper may depend on browser rendering coordinates or pixel scale.

# Spatial Subjects

Not every current V7 spatial object is an EntityRegistry entity yet.

Phase 0C therefore distinguishes entity-backed and derived subjects:

```ts
export type SpatialSubject =
  | Readonly<{
      type: 'entity';
      handle: EntityHandle;
    }>
  | Readonly<{
      type: 'derived';
      namespace: string;
      id: string;
    }>;
```

## Entity Subject Rules

An entity-backed spatial feature must reference an **active exact generation-aware handle** from Phase 0B.

It may not contain only:

- raw building ID;
- raw firm ID;
- raw facility ID;
- raw transit-stop ID.

When an entity is replaced and receives a new generation, the spatial feature must point to the new handle after the next spatial synchronization.

Historical entities are not kept in the live `SpatialIndex`. Historical spatial reconstruction belongs to a future HistoryStore or analytics layer.

## Derived Subject Rules

Derived subjects represent rebuildable topology that Phase 0B does not yet own as entities.

Initial example:

```text
namespace = v7-road-cell
id = 8,12
```

Derived subjects must have stable developer-defined namespaces and deterministic IDs.

They are not a parallel entity system. They exist only to allow the spatial layer to index current compatibility topology until later replacement phases create true network entities.

# Spatial Features

A spatial feature binds one subject role to one geometry:

```ts
export type SpatialFeature = Readonly<{
  subject: SpatialSubject;
  role: string;
  layer: string;
  geometry: SpatialGeometry;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;
```

Examples:

- active building + `role: 'footprint'` + `layer: 'building'` + cell geometry;
- service facility + `role: 'footprint'` + `layer: 'service-facility'`;
- derived road cell + `role: 'cell'` + `layer: 'v7-road'`;
- future parcel entity + `role: 'boundary'` + `layer: 'parcel'` + polygon geometry;
- future neighborhood entity + `role: 'boundary'` + `layer: 'neighborhood'`.

## Feature Key

The index derives a canonical feature key from:

```text
canonical subject identity + role
```

`layer` is metadata for query grouping and is not a substitute for identity.

The serialization must be unambiguous. Length-prefixing or another escape-safe canonical encoding is required.

Duplicate feature keys are rejected during rebuild.

## Metadata

Metadata is diagnostic/query-filter metadata only.

It must use primitive scalar values.

Examples:

- road type;
- zone;
- facility type;
- department;
- transit stop type.

Material gameplay state remains owned by the domain system.

The spatial package must not become a shadow building/facility/parcel database.

# Deterministic Spatial Index

## Core Structure

```ts
export class SpatialIndex {
  readonly bucketSize: number;

  rebuild(features: readonly SpatialFeature[]): void;
  getFeature(featureKey: string): SpatialFeature | undefined;
  listFeatures(filter?: SpatialFilter): readonly SpatialFeature[];
  queryPoint(point: SpatialPoint, filter?: SpatialFilter): readonly SpatialFeature[];
  queryAabb(aabb: SpatialAabb, filter?: SpatialFilter): readonly SpatialFeature[];
  queryRadius(center: SpatialPoint, radius: number, filter?: SpatialFilter): readonly SpatialQueryHit[];
  queryCorridor(polyline: SpatialPolyline, halfWidth: number, filter?: SpatialFilter): readonly SpatialQueryHit[];
  nearest(point: SpatialPoint, filter?: SpatialFilter, maxDistance?: number): SpatialQueryHit | undefined;
  snapshot(): SpatialIndexSnapshot;
}
```

Exact method names may adapt to existing repository style, but the semantics in this specification are required.

## Bucket Size

Default broad-phase bucket size is **8 world cells**.

The constructor may accept a different positive finite bucket size for tests or future tuning, but bucket size is immutable after construction.

Bucket size must not auto-adapt based on feature insertion order or query history.

## Feature Insertion

For each normalized feature:

1. compute the feature AABB;
2. compute every broad-phase bucket overlapped by that AABB;
3. register the feature key in those buckets;
4. preserve canonical global feature storage independent of insertion order.

Conservative bucket inclusion is allowed. False-positive candidates are removed by exact predicates.

## Deterministic Rebuild

`rebuild()` is atomic.

It must:

1. validate all input features;
2. normalize geometry and metadata;
3. sort features by canonical feature key using ordinal semantics;
4. reject duplicate keys;
5. verify active entity subjects against Phase 0B;
6. build a complete new feature map and bucket map off to the side;
7. run structural checks;
8. swap committed state only if all checks succeed.

If rebuild fails, the previous committed spatial index remains intact.

The error propagates because an invalid derived view indicates a programming/invariant defect.

## Query Candidate Ordering

Broad-phase bucket traversal order must never become observable nondeterminism.

Candidate results are deduplicated by canonical feature key and exact-filtered before return.

Normal result ordering is ascending canonical feature key.

Distance-ranked results are ordered by:

1. exact squared distance;
2. canonical feature key.

No `localeCompare()` or locale-sensitive collation may influence simulation-visible ordering.

# Filters

The deterministic core filter is declarative:

```ts
export type SpatialFilter = Readonly<{
  layers?: readonly string[];
  entityKinds?: readonly EntityKind[];
  roles?: readonly string[];
  derivedNamespaces?: readonly string[];
  metadataEquals?: Readonly<Record<string, string | number | boolean | null>>;
}>;
```

Filter collections are normalized to stable ordinal order.

The deterministic core does not accept arbitrary callback predicates as part of authoritative query semantics. Consumers may post-filter returned stable results if needed for diagnostics.

# Exact Query Semantics

## Point Query

`queryPoint()` returns features whose exact geometry contains the point.

For cell geometry, the half-open cell convention applies.

For polygons, points on the polygon boundary count as contained for the generic primitive.

If a semantic query such as parcel lookup encounters multiple overlapping parcel candidates, that is treated as an overlap diagnostic and deterministic tie handling is specified by the semantic service.

## AABB Query

`queryAabb()` returns features whose exact geometry intersects the requested AABB.

Touching boundaries count as intersection for generic geometry.

## Radius Query

`queryRadius()` returns features whose exact minimum distance from the center point is less than or equal to the radius.

The result carries squared distance so callers do not recompute it differently.

## Corridor Query

`queryCorridor()` treats the input polyline plus `halfWidth` as a corridor.

A feature matches when its exact minimum distance to the polyline is less than or equal to `halfWidth`.

Phase 0C does not need polygon clipping or area-intersection percentages. The result is a deterministic set of intersecting features with distance metadata.

This is enough for later corridor counts, affected-building lists, access analysis, and planning diagnostics.

## Nearest Query

`nearest()` returns the minimum exact-distance feature satisfying the filter and optional maximum distance.

Ties are resolved by canonical feature key.

# Spatial Query Service

`SpatialIndex` is generic. `SpatialQueryService` provides stable Civic Foundry semantics for high-value operations.

Proposed surface:

```ts
export class SpatialQueryService {
  parcelAt(point: SpatialPoint): SpatialFeature | undefined;
  nearbyFacilities(point: SpatialPoint, radius: number, filter?: SpatialFilter): readonly SpatialQueryHit[];
  buildingsInBuffer(point: SpatialPoint, radius: number): readonly SpatialQueryHit[];
  nearestNetworkAttachment(point: SpatialPoint, maxDistance?: number): SpatialQueryHit | undefined;
  neighborhoodAt(point: SpatialPoint): SpatialFeature | undefined;
  parcelFrontage(parcel: EntityHandle | SpatialFeature): ParcelFrontageResult;
  corridor(polyline: SpatialPolyline, halfWidth: number, filter?: SpatialFilter): readonly SpatialQueryHit[];
}
```

Exact names may vary, but consumers must not repeatedly reimplement these semantics.

# Point-in-Parcel Compatibility

Phase 0C must support both current V7 lots and future Phase 1R parcels.

Selection order:

1. active `parcel` layer/entity if one exists;
2. otherwise current compatibility `lot` layer/entity.

Current V7 lots are indexed as cell geometry.

Future Phase 1R parcels may be polygons and can register through a new projection provider without changing consumers of `parcelAt()`.

If multiple same-priority parcel features contain the same point:

- emit/report a spatial-overlap diagnostic;
- return the lowest canonical feature key for deterministic inspection behavior;
- do not silently mutate domain ownership to resolve the overlap.

# Nearby Facilities

Phase 0C indexes current:

- utility facilities;
- service facilities;
- transit stops.

Semantic nearby-facility queries are radius queries over those layers.

Results are distance-ranked then canonical-key ranked.

The service may filter by metadata such as facility type or department.

It does not calculate service effectiveness, staffing, utility capacity, or transit headway. Those remain domain concerns.

# Building Buffer Queries

Current buildings are indexed using their occupied cell footprint whether under construction or occupied, because the physical cell is spatially occupied in V7 once development starts.

`buildingsInBuffer(point, radius)` returns building features whose cell geometry intersects the radius around the point.

Future multi-cell or polygon building footprints can replace the compatibility geometry without changing the query contract.

# Network Attachment

Phase 0C does not replace routing.

Current V7 road cells are projected as derived features:

```text
layer: v7-road
namespace: v7-road-cell
geometry: cell
metadata: road type
```

`nearestNetworkAttachment()` returns the nearest compatible network spatial feature.

For current road-cell attachment:

- exact geometric distance from point to road-cell footprint is used;
- optional max distance is honored;
- ties are canonical-key deterministic.

Domain systems may impose stricter rules later, such as access-class compatibility, lane direction, transit mode, frontage side, or network-capacity constraints.

A spatial attachment result is not automatically a valid route.

# Neighborhood Membership

V7 currently has no authoritative neighborhood-boundary system.

Phase 0C therefore establishes the query contract and layer semantics without fabricating neighborhoods.

`neighborhoodAt()`:

- queries `neighborhood` boundary features when future providers register them;
- returns `undefined` when no neighborhood layer exists;
- uses exact polygon containment;
- reports overlap diagnostics if multiple active neighborhoods claim the same point;
- never invents neighborhood boundaries from nearby buildings or road names.

# Parcel Frontage

## V7 Compatibility Semantics

For current V7 lots, frontage means cardinal shared-edge contact with one or more road cells.

Phase 0C must compute **all** road frontage, not only the first road key currently stored by `LotSystem`.

A compatibility frontage result includes at least:

```ts
export type ParcelFrontageResult = Readonly<{
  parcelFeatureKey: string;
  roadFeatureKeys: readonly string[];
  frontageLength: number;
}>;
```

For one-cell V7 lots, each cardinal shared edge contributes one world-cell unit of frontage.

Road keys are returned in canonical order.

This is derived analysis only. Phase 0C must not change current development logic that relies on the existing `frontageRoadKey` behavior.

## Future Polygon Parcels

General polygon-to-network frontage calculation may be extended in Phase 1R when real parcel polygons become authoritative.

Phase 0C must not implement a full polygon clipping engine solely for future frontage.

The 0C API and feature model must allow the future implementation to extend frontage semantics without breaking consumers.

# Corridor Analysis

A corridor is defined by:

- a non-empty polyline;
- a non-negative half-width;
- a declarative spatial filter.

The result is the deterministic set of features intersecting the corridor buffer, plus exact minimum-distance metadata.

Phase 0C corridor analysis does **not** aggregate taxes, households, jobs, pollution, land value, or travel demand. Later analytics systems use the returned feature set to compute domain-specific measures.

# Scalar Spatial Field Registry

Not all spatial information should be represented as indexed geometry.

Flood depth, noise, pollution concentration, elevation, heat, and similar continuous/raster values are sampled fields.

Phase 0C introduces:

```ts
export type SpatialScalarField = Readonly<{
  id: string;
  sampling: 'nearest-cell' | 'bilinear' | 'computed';
  sample(point: Readonly<{ x: number; y: number }>): number | undefined;
}>;

export class SpatialFieldRegistry {
  register(field: SpatialScalarField): void;
  sample(fieldId: string, point: SpatialPoint): number | undefined;
  listIds(): readonly string[];
  snapshot(): SpatialFieldRegistrySnapshot;
}
```

## Initial Field

Phase 0C registers current terrain elevation as:

```text
terrain.elevation
sampling = nearest-cell
```

A point samples the terrain cell containing it using the same half-open cell convention.

Points outside terrain bounds return `undefined`.

Unknown field IDs throw an explicit error rather than returning a misleading zero.

## Future Fields

Later phases may register:

- `environment.flood-depth`;
- `environment.noise-db`;
- `environment.air-pollution`;
- `environment.heat-index`.

Phase 0C does not generate those values.

Fields are derived providers; field samples are not serialized in Save V7.

# Projection Architecture

## SpatialProjectionProvider

Future phases must be able to add spatial layers without editing one giant projector.

Phase 0C defines a provider boundary conceptually equivalent to:

```ts
export interface SpatialProjectionProvider {
  readonly id: string;
  collect(): readonly SpatialFeature[];
}
```

The coordinator:

- rejects duplicate provider IDs;
- evaluates providers in ordinal provider-ID order;
- combines and normalizes features;
- validates entity handles;
- detects unchanged projections;
- rebuilds the index only when the normalized feature signature changed.

Registration order must not alter output.

## Change Detection

Phase 0C should avoid rebuilding all buckets when spatial geometry has not changed.

Do **not** require invasive revision-counter rewrites across V7 domains solely for this tranche.

Instead:

1. providers collect their normalized features;
2. the coordinator derives a collision-free canonical feature signature string for each feature from subject, role, layer, normalized geometry, and query-relevant metadata;
3. signatures are sorted by canonical feature key;
4. the current normalized signature vector is compared with the prior vector;
5. if identical, the committed index is retained and its revision does not advance;
6. if different, perform an atomic rebuild.

This remains O(n) for synchronization but avoids unnecessary bucket reconstruction and avoids relying on hash collisions.

A future phase may add provider revision hints as an optimization without changing semantics.

# Legacy V7 Spatial Projector

`LegacyV7SpatialProjector` is the compatibility bridge from current V7 state to spatial features.

It reads public list/snapshot APIs and the Phase 0B EntityRegistry.

It does not mutate V7 domain state.

## Required Initial Coverage

### Lots

- subject: active Phase 0B `lot` handle;
- layer: `lot`;
- role: `footprint`;
- geometry: cell `(x, y)`;
- metadata: zone.

### Buildings

- subject: active Phase 0B `building` handle;
- layer: `building`;
- role: `footprint`;
- geometry: cell `(x, y)`;
- metadata may include zone and definition ID if needed for deterministic filtering;
- status is not required for geometry identity unless a defined query filter needs it.

Redevelopment that changes the building generation while keeping the same V7 string ID must update the spatial feature subject to the new generation.

### Utility Facilities

- subject: active `utility-facility` handle;
- layer: `utility-facility`;
- role: `footprint`;
- geometry: cell;
- metadata: facility type.

### Service Facilities

- subject: active `service-facility` handle;
- layer: `service-facility`;
- role: `footprint`;
- geometry: cell;
- metadata: facility type and department.

### Transit Stops

- subject: active `transit-stop` handle;
- layer: `transit-stop`;
- role: `footprint`;
- geometry: cell;
- metadata: stop type.

### Roads

Current roads are not forced into Phase 0B entity ownership.

Each road cell becomes:

- subject: derived namespace `v7-road-cell`;
- ID: existing deterministic cell key;
- layer: `v7-road`;
- role: `cell`;
- geometry: cell;
- metadata: road type.

## Deferred Dynamic Geometry

Phase 0C does not require active traffic, transit, service, or freight vehicles to be inserted into the shared spatial index on every tick.

Current vehicle systems do not expose one uniform authoritative world-position contract, and indexing high-churn moving geometry would add complexity before any replacement phase consumes it.

Dynamic-agent spatial indexing may be added by the relevant transport/service replacement phase using the same provider API.

No fake or approximate vehicle position may be invented solely to satisfy Phase 0C.

# Consistency Boundary

Phase 0C guarantees:

> At the end of each completed kernel tick, the committed spatial index represents the projected authoritative spatial state for that tick.

The index is also synchronized once during SimulationCore bootstrap and once after hydrate restores authoritative V7 state.

Direct legacy `SimulationCore` facade mutations made between ticks may remain invisible to the index until the next derived-state synchronization boundary.

This is acceptable in 0C because the index is not yet authoritative gameplay state.

Future command-driven replacement phases may tighten same-command visibility when they begin consuming the index authoritatively.

No public “force sync” gameplay API should be added merely for Phase 0C.

# Kernel Integration

Assuming Phase 0B has an entity synchronization system, Phase 0C adds one derived system conceptually:

```ts
{
  id: 'spatial-index-sync',
  reads: ['legacy-v7-city', 'entity-registry'],
  writes: ['spatial-index'],
  cadence: { every: 1 },
  after: ['entity-registry-sync'],
  execute: () => spatialProjection.synchronize(),
}
```

Exact domain-key names should match the actual Phase 0B implementation.

The required ordering is:

```text
legacy-v7-city
→ entity-registry-sync
→ spatial-index-sync
→ kernel invariants
```

Spatial synchronization must not advance the simulation clock, consume gameplay RNG, emit gameplay commands, debit money, move agents, or mutate gameplay owners.

## Spatial Invariant

Register a kernel invariant equivalent to `spatial-index-valid`.

It checks the committed derived index, not V7 gameplay state directly.

Failure identifies the invariant, tick, feature/provider where possible, and structural reason.

# Bootstrap

The index must be useful at tick 0.

After SimulationCore constructs current V7 domain owners and Phase 0B performs its initial entity projection, Phase 0C performs one spatial synchronization without advancing the clock.

Bootstrap must not change the kernel tick or current save-visible values.

# Persistence and Hydration

## No Save V8

Phase 0C does not introduce a save schema change.

The following are **not serialized**:

- spatial features;
- bucket maps;
- canonical feature signatures;
- index revision;
- query caches;
- spatial field registry snapshots;
- frontage results;
- corridor results.

They are derived state.

## Hydration Sequence

Hydration remains conceptually:

```text
construct SimulationCore
→ restore V7 authoritative domains
→ restore shared clock and legacy RNG state
→ rebuild existing V7 derived state
→ rebuild Phase 0B EntityRegistry/reference graph
→ rebuild Phase 0C spatial projection/index
→ run entity + spatial integrity checks
→ return hydrated core
```

The reconstructed spatial snapshot for the restored authoritative state must equal the snapshot produced by an equivalent uninterrupted simulation state.

No historical geometry is fabricated.

# Spatial Index Revision

The index owns a diagnostic `revision` starting at 0 or 1 according to implementation convention.

Rules:

- revision advances only when normalized projected spatial features actually change;
- repeated synchronization of identical features does not advance revision;
- query operations never advance revision;
- field sampling never advances index revision;
- revision is diagnostic/derived and is not persisted in Save V7.

# Diagnostics

`SpatialDiagnostics.ts` provides deterministic structural inspection.

At minimum, diagnostics can report:

- total feature count;
- counts by layer;
- counts by entity kind;
- derived-subject counts by namespace;
- bucket count;
- maximum bucket occupancy;
- average feature bucket replication;
- index revision;
- field IDs;
- overlap diagnostics for semantic parcel/neighborhood queries;
- invalid or stale entity-handle references if detected.

Diagnostics must not become gameplay inputs in Phase 0C.

# Snapshot Contract

A diagnostic `SpatialIndexSnapshot` contains enough canonical information to compare deterministic rebuilds without serializing the internal mutable bucket representation as authoritative state.

Recommended snapshot information:

```ts
export type SpatialIndexSnapshot = Readonly<{
  revision: number;
  bucketSize: number;
  features: readonly Readonly<{
    key: string;
    layer: string;
    subjectKey: string;
    role: string;
    geometry: SpatialGeometry;
    metadata: Readonly<Record<string, string | number | boolean | null>>;
  }>[];
}>;
```

Features are sorted by canonical key.

Bucket contents may be exposed in a separate deep diagnostic if useful, but ordinary determinism checks should compare canonical feature state and query outcomes rather than rely on internal map insertion order.

# Error Handling

## Invalid Projection

Projection/rebuild errors are fatal development/invariant errors.

Examples:

- duplicate feature key;
- malformed geometry;
- entity-backed feature references inactive or unknown generation;
- duplicate provider ID;
- non-finite metadata number if numeric metadata is allowed;
- invalid bucket size.

The old committed index remains intact when rebuild staging fails.

The kernel step propagates the error; Phase 0C does not attempt to roll back already-advanced authoritative V7 state.

## Query Input Errors

Invalid query geometry, negative radius, negative corridor width, or non-finite values throw before work begins.

An unknown scalar-field ID throws.

Sampling a known field outside its valid spatial domain returns `undefined`.

A valid query with no matches returns an empty immutable array or `undefined` for singular lookup APIs.

# Determinism Requirements

Phase 0C must explicitly prove:

1. feature input order does not affect snapshot or query results;
2. provider registration order does not affect snapshot or query results;
3. bucket-map insertion order does not affect results;
4. duplicate broad-phase candidates are deduplicated deterministically;
5. distance ties resolve by canonical feature key;
6. rebuild from the same feature set produces byte-equivalent canonical snapshot content;
7. repeated unchanged sync does not change revision;
8. save → hydrate → spatial rebuild produces the same canonical spatial state;
9. building generation replacement cannot leave the new geometry bound to the old Phase 0B handle;
10. no query consumes RNG;
11. no locale-sensitive string comparison affects ordering.

# Invariants

Phase 0C adds at least these derived-state invariants:

## `spatial-feature-key-unique`

Every committed feature key is unique.

## `spatial-entity-subject-active`

Every entity-backed live feature references an active exact Phase 0B handle.

## `spatial-geometry-valid`

Every committed geometry is normalized and finite.

## `spatial-bucket-coverage`

Every feature is present in every bucket required by its broad-phase AABB coverage.

Extra conservative bucket membership is allowed only if the implementation deliberately uses conservative bounds and query exactness remains correct.

## `spatial-query-order-stable`

Canonical diagnostics/query test fixtures prove stable ordering.

## `spatial-no-authoritative-save-state`

Save V7 excludes Phase 0C index/field internals.

# Testing Strategy

Phase 0C implementation must use TDD.

Tests should be split by responsibility rather than placed in one giant file.

Recommended files:

```text
tests/spatial-geometry.test.ts
tests/spatial-index.test.ts
tests/spatial-fields.test.ts
tests/spatial-projection.test.ts
tests/spatial-query-service.test.ts
tests/spatial-core-integration.test.ts
tests/spatial-save-hydrate.test.ts
```

The implementation plan may refine names.

## Geometry Unit Tests

Cover:

- cell half-open containment;
- points on cell boundaries;
- AABB intersection;
- segment intersection;
- point-to-segment distance;
- valid/invalid polylines;
- simple polygon containment;
- polygon boundary behavior;
- self-intersecting polygon rejection;
- exact radius inclusion at equality;
- corridor distance inclusion at equality;
- invalid NaN/infinite coordinates.

## Index Unit Tests

Cover:

- empty index;
- one feature;
- cross-bucket feature;
- feature spanning several buckets;
- duplicate feature rejection;
- deterministic rebuild under shuffled input;
- deterministic queries under shuffled input;
- point query vs brute-force oracle;
- AABB query vs brute-force oracle;
- radius query vs brute-force oracle;
- nearest query vs brute-force oracle;
- corridor query vs brute-force oracle;
- stable tie ordering;
- unchanged rebuild signature behavior;
- atomic failure leaves old index unchanged.

## Property-Style Deterministic Tests

Without adding a runtime dependency, generate deterministic batches of test geometry and compare indexed queries against a brute-force exact-predicate oracle.

Use a fixed test seed and enough cases to cover bucket boundaries, negative/positive coordinates where supported, ties, sparse geometry, and dense geometry.

A failed indexed query must print the seed/case number needed to reproduce it.

## Entity Integration Tests

Cover:

- entity-backed feature rejects unknown handle;
- entity-backed feature rejects historical handle;
- current handle indexes successfully;
- building redevelopment generation changes feature subject;
- old generation no longer appears in live spatial index;
- derived road cells do not require fake EntityRegistry entries.

## V7 Projection Tests

Build a deterministic city containing:

- roads;
- multiple zoned lots;
- buildings;
- utility facilities;
- service facilities;
- transit stops.

Assert exact projected feature keys, geometry, layers, and metadata.

Then verify:

- lot containment;
- building buffer results;
- nearby facilities;
- nearest road attachment;
- all-cardinal-edge frontage;
- deterministic corridor membership.

## Frontage Oracle Test

For V7 lots, independently calculate cardinal adjacent roads directly from `RoadSystem` and compare with `parcelFrontage()`.

The spatial result must match exactly for every projected lot.

Do not change `LotSystem.frontageRoadKey` to make this test pass.

## Save/Hydrate Test

Create developed state, capture canonical spatial snapshot, serialize with existing V7 save, hydrate, rebuild Phase 0B + 0C derived state, then compare canonical spatial snapshots and representative query outputs.

Save payload must remain schema-compatible and contain no spatial-index data.

## V7 Parity Test

The existing immutable Phase 0A V7 parity fixture remains unchanged.

Phase 0C must pass it exactly.

The fixture must never be updated to accommodate a Phase 0C mismatch.

# Performance Requirements

Phase 0C exists partly to prevent future brute-force spatial scaling problems.

Performance testing must distinguish:

- projection collection cost;
- unchanged-sync signature comparison cost;
- full index rebuild cost;
- point/radius/corridor query cost;
- unrelated CI runner contention.

## Simulation Regression Gate

On the same representative headless workload used for prior Foundry Kernel tranches:

- median simulation regression target: **<= 5%**;
- >5% triggers investigation and controlled remeasurement;
- do not optimize or weaken deterministic semantics based on one noisy hosted-runner sample.

## Spatial Scale Benchmark

Add a controlled benchmark using at least **10,000 synthetic deterministic features** and a representative query batch.

Record:

- rebuild median;
- unchanged-sync median;
- point/radius query median;
- corridor-query median;
- feature count;
- bucket count;
- max bucket occupancy;
- average feature bucket replication.

The benchmark should also compare representative indexed queries against the same exact brute-force oracle to demonstrate that the index provides material scaling benefit at nontrivial feature counts.

Avoid brittle absolute-millisecond CI assertions unless measured runner behavior justifies one.

# Compatibility Rules

Phase 0C is a platform tranche.

The following V7 behaviors remain authoritative and unchanged:

- road placement legality;
- zoning legality;
- lot rebuild behavior;
- current single `frontageRoadKey` behavior;
- building placement/redevelopment behavior;
- utility placement and connectivity;
- service placement/accessibility;
- transit stop/line topology;
- traffic pathfinding and movement;
- housing/development/economy formulas;
- Save V7 serialization.

Phase 0C may expose richer derived spatial answers than V7 currently uses, but those answers do not replace gameplay decisions until a later replacement phase explicitly migrates a domain and passes its own parity/quality gates.

# Expected Production Scope

Normal Phase 0C production changes should be concentrated in:

```text
src/spatial/*
src/simulation/core/SimulationCore.ts
```

plus minimal Phase 0B integration imports/types if exact wiring requires them.

Potential small compatibility changes outside those paths require explicit justification in the implementation plan.

Phase 0C should **not** normally modify:

```text
src/app/*
src/ui/*
src/rendering/*
src/save/saveV7.ts
src/save/saveLegacy.ts
src/simulation/economy/*
src/simulation/housing/*
src/simulation/development/*
src/simulation/traffic/*
src/simulation/transit/*
src/simulation/services/*
src/simulation/utilities/*
src/world/roads/*
src/world/lots/*
```

The projector should read those systems through existing public APIs rather than refactor them merely to make spatial projection easier.

If implementation discovers a missing read-only accessor that is truly required, add the smallest behavior-neutral accessor with a regression test and document why it was unavoidable.

# Documentation Updates

When implementation completes, update at least:

- `docs/ARCHITECTURE.md`;
- `README.md` if the architecture overview describes the Foundry Kernel;
- testing documentation if new spatial benchmark/smoke commands are introduced.

The architecture should show:

```text
SimulationKernel
  ├─ legacy-v7-city
  ├─ entity-registry-sync
  └─ spatial-index-sync
         ├─ SpatialProjection providers
         ├─ SpatialIndex
         ├─ SpatialQueryService
         └─ SpatialFieldRegistry
```

The documentation must state clearly that the index is derived and not saved.

# Acceptance Gates

Phase 0C is complete only when all of the following are true:

1. Phase 0B prerequisite is present and verified.
2. Geometry primitives and validation are implemented and tested.
3. Uniform-grid broad phase is deterministic and rebuildable.
4. Exact point/AABB/radius/nearest/corridor queries match brute-force oracles.
5. Entity-backed features use exact active generation-aware handles.
6. Derived V7 road cells work without fake entity registration.
7. V7 lots, buildings, utilities, services, transit stops, and roads project deterministically.
8. Building redevelopment changes the spatial entity generation correctly.
9. Point-in-parcel/lot works through the semantic query service.
10. Nearby-facility lookup is deterministic.
11. Building buffer lookup is deterministic.
12. Network attachment is deterministic and explicitly non-routing.
13. Neighborhood query contract exists without fabricating neighborhoods.
14. V7 frontage matches an independent cardinal-adjacency oracle.
15. Corridor analysis returns exact deterministic membership.
16. Terrain elevation sampling works through the scalar field registry.
17. Repeated unchanged spatial sync does not rebuild or advance spatial revision.
18. Failed staged rebuild leaves the prior committed index intact.
19. Bootstrap builds a valid tick-0 index without advancing the clock.
20. Save → hydrate rebuild produces equivalent canonical spatial state.
21. Save V7 schema is unchanged.
22. Immutable V7 parity fixture remains exact.
23. No gameplay RNG sequence changes.
24. Full test suite passes.
25. Typecheck passes.
26. Lint passes.
27. Build passes.
28. Existing browser smoke relevant to current V7 behavior passes.
29. Controlled performance evidence shows <=5% representative simulation regression or any larger result has been investigated and resolved/explained before merge.
30. Spatial scale benchmark and brute-force equivalence evidence are recorded.
31. Architecture/documentation is updated.
32. Code review finds no hidden gameplay migration or duplicate identity system.

# Explicit Deferred Work

Phase 0C deliberately leaves these items to later phases:

- authoritative Phase 1R polygon parcels;
- polygon holes and multipolygons;
- general polygon clipping/boolean operations;
- polygon-based frontage production semantics;
- neighborhood generation;
- environment model generation;
- pollution/noise/flood simulation;
- dynamic moving-agent shared indexing;
- network-node/edge entity migration;
- true multimodal network snap semantics;
- GIS import/export;
- regional coordinate systems;
- spatial history/time-travel queries;
- UI map-selection rewrites.

Deferral is intentional and must not be interpreted as an incomplete Phase 0C implementation.

# Implementation Handoff Instructions

The separate implementation chat should proceed as follows:

1. Read this specification in full.
2. Read `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`.
3. Read the completed Phase 0B entity-registry spec and actual implementation.
4. Inspect the actual Phase 0B API names before writing the plan; preserve semantics even if class/method names differ slightly from the design draft.
5. Inspect current V7 `TerrainGrid`, `RoadSystem`, `LotSystem`, `BuildingSystem`, utility/service/transit public read APIs, `SimulationCore`, Save V7 tests, and the immutable parity fixture.
6. Use Superpowers brainstorming only if implementation discovers a material contradiction or architectural choice not resolved here; do not reopen already-specified choices casually.
7. Use the Superpowers writing-plans workflow to create a detailed Phase 0C implementation plan before production changes.
8. Use TDD for every implementation task.
9. Keep Phase 0C on an isolated branch/worktree.
10. Do not modify the V7 parity fixture to make regressions pass.
11. Do not introduce a new identity registry, gameplay spatial owner, save version, or routing system.
12. Before completion, run the verification-before-completion and code-review workflows with fresh evidence.

# Completion State

When Phase 0C is accepted, Civic Foundry 2.0 will have:

- deterministic kernel scheduling and diagnostics from Phase 0A;
- generation-aware shared entity identity and referential integrity from Phase 0B;
- a deterministic shared spatial query substrate from Phase 0C.

The next Foundry Kernel tranche may then introduce the EconomicLedger without forcing future economic systems to invent their own identity or spatial-location conventions.
