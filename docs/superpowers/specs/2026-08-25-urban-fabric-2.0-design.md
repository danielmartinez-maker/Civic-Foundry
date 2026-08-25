# Civic Foundry — Urban Fabric 2.0 Design

**Date:** 2026-08-25  
**Branch:** `feature/urban-fabric-2.0`  
**Status:** Approved architecture, pending implementation plan

## 1. Purpose

Urban Fabric 2.0 replaces Civic Foundry's cell-lot abstraction with a persistent cadastral/topological land model and extends development from fixed low/medium/high single-use buildings into parcel-constrained, mixed-use, economically evaluated projects.

The target scope is:

- true cadastral parcels with explicit shared topology;
- FAR, height, lot coverage, setbacks, minimum lot area/frontage, and overlays;
- mixed-use buildings with explicit massing and floor-area allocation;
- building deterioration, maintenance, vacancy, renovation, adaptive reuse, abandonment, and demolition;
- highest-and-best-use redevelopment economics;
- parcel subdivision and land assembly;
- property transactions and parcel lineage;
- V8 save migration from the current V7 lot/building model;
- parcel, zoning-envelope, and redevelopment-pressure presentation;
- deterministic geometry and property-based topology tests.

This subsystem must preserve the existing developer-market and pro-forma work where useful. The physical/legal inputs become substantially richer; the economic layer remains the primary evaluator of whether development actually occurs.

## 2. Current-state constraints

The current `LotSystem` creates a `Lot` for each zoned grid cell with `id`, `x`, `y`, `zone`, and one road-frontage key. `BuildingSystem` stores one building per lot and identifies buildings by the owning lot. Building definitions are single-use, zone-bound, and expose fixed resident/job capacities. Development feasibility currently checks matching `ZoneType` and a low/medium/high `zoningMaxIntensity`.

Urban Fabric 2.0 therefore requires a replacement physical model rather than incremental fields on `Lot`.

The tile/grid remains useful for terrain sampling, utilities, traffic occupancy, and low-level world indexing, but it no longer defines property boundaries.

## 3. Architectural choice

The selected approach is a **full cadastral/topological graph from the start**.

The canonical spatial hierarchy becomes:

```text
World
 └─ UrbanBlock
     └─ Parcel
         ├─ ParcelNode
         ├─ ParcelEdge
         ├─ frontage/access relationships
         ├─ easements / rights-of-way
         ├─ zoning assignment
         └─ buildings / development sites
```

Adjacent parcels share boundary topology rather than keeping approximately matching duplicate polygon edges.

## 4. Cadastre domain

### 4.1 Core types

```ts
type WorldPoint = Readonly<{ x: number; y: number }>;

type ParcelNode = Readonly<{
  id: string;
  point: WorldPoint;
}>;

type ParcelEdgeKind =
  | 'property-boundary'
  | 'street-frontage'
  | 'water-boundary'
  | 'right-of-way'
  | 'easement-boundary';

type ParcelEdge = Readonly<{
  id: string;
  fromNodeId: string;
  toNodeId: string;
  leftParcelId?: string;
  rightParcelId?: string;
  kind: ParcelEdgeKind;
  roadRef?: string;
}>;

type Parcel = Readonly<{
  id: string;
  blockId: string;
  boundaryEdgeIds: readonly string[];
  areaM2: number;
  centroid: WorldPoint;
  frontageEdgeIds: readonly string[];
  accessEdgeIds: readonly string[];
  zoningDistrictId: string;
  ownerId?: string;
  historicalParentIds: readonly string[];
}>;

type UrbanBlock = Readonly<{
  id: string;
  boundary: readonly WorldPoint[];
  parcelIds: readonly string[];
  roadEdgeIds: readonly string[];
}>;
```

`CadastralGraph` is authoritative for nodes, edges, parcels, blocks, easements, lineage, and adjacency queries.

### 4.2 Required invariants

Every committed graph must satisfy:

- closed, non-self-intersecting parcel polygons;
- positive parcel area;
- no overlapping parcels;
- shared boundaries reference the same edge object;
- valid edge endpoints;
- no zero-length edges;
- no orphaned nodes after normalization;
- symmetric parcel adjacency;
- valid block membership except explicitly modeled exceptional land;
- frontage edges reference legal rights-of-way or recognized access facilities;
- topology-derived area agrees with stored area within tolerance;
- lineage is acyclic;
- deterministic ordering and serialization.

Geometry uses one documented world-space coordinate system and a fixed precision policy. Coordinates are normalized to centimeter-scale precision before topology identity comparisons. All tolerance decisions must be deterministic.

### 4.3 Ownership, access, right-of-way, easements

Land ownership is distinct from building ownership and project control even if the first implementation often uses the same developer/owner entity.

Rights-of-way remove land from normal developable parcel capacity. Easements may preserve private ownership while granting access, utility, drainage, or pedestrian rights.

```ts
type EasementKind = 'access' | 'utility' | 'drainage' | 'pedestrian';

type Easement = Readonly<{
  id: string;
  parcelIds: readonly string[];
  kind: EasementKind;
  geometry: readonly WorldPoint[];
}>;
```

## 5. Parcel generation and topology relationship to roads

Blocks are primarily derived from the road/right-of-way network and then subdivided into cadastral parcels. A block remains stable across ordinary subdivision and assembly operations.

Transportation changes may mutate the land fabric. A newly dedicated avenue or right-of-way can split an existing block, acquire parcel land, and produce new blocks/parcels after a cadastral transaction.

Road geometry is therefore a producer of cadastral constraints, not a grid neighbor lookup.

## 6. Atomic cadastral mutations

All land geometry changes go through `CadastralMutationSystem`.

Supported operations in Urban Fabric 2.0:

```ts
splitParcel(parcelId, cut)
assembleParcels(parcelIds)
adjustBoundary(edgeId, replacementGeometry)
dedicateRightOfWay(parcelId, geometry)
createEasement(parcelIds, geometry)
removeEasement(easementId)
```

Each mutation executes against a temporary affected topology, validates all invariants, recalculates derived metrics, and only then commits atomically.

```ts
type CadastralTransaction = Readonly<{
  id: string;
  tick: number;
  kind: 'split' | 'assembly' | 'boundary-adjustment' | 'right-of-way' | 'easement';
  sourceParcelIds: readonly string[];
  resultingParcelIds: readonly string[];
  topologyChanges: readonly TopologyChange[];
  lineageChanges: readonly ParcelLineageEvent[];
}>;
```

Failed transactions leave the authoritative graph unchanged.

## 7. Parcel subdivision

A subdivision accepts a source parcel and deterministic cut specification and produces two or more child parcels.

Validation requires:

- valid child polygons;
- minimum parcel area unless explicitly grandfathered;
- required frontage/access where applicable;
- no trapped inaccessible child parcel;
- no cut through an occupied building footprint in ordinary subdivision;
- all existing buildings resolve wholly to a legal resulting parcel.

Source IDs are retired to history. IDs are never recycled. Child parcels record their parent in lineage.

If an existing building lies wholly inside one child parcel, its parcel relationship migrates to that child. If the proposed split bisects a structure, the mutation is rejected unless the caller is executing an explicit demolition/reconfiguration workflow.

## 8. Parcel assembly

Assembly requires a contiguous set of parcels and valid project control/ownership state.

The engine:

1. verifies adjacency and control;
2. unions parcel polygons;
3. removes internal property edges;
4. preserves external boundary edges;
5. recalculates frontage, access, area, depth, centroid, and orientation;
6. creates a new parcel ID;
7. records every source parcel as historical lineage;
8. recomputes zoning/buildable-envelope capacity.

Assembly economics include acquisition price, seller reservation premiums, transaction costs, demolition, and carrying cost. Assembly is valuable only where the larger site unlocks enough additional development value.

## 9. Zoning model

### 9.1 Zoning districts

The existing broad `residential | commercial | industrial` legality check is replaced by a dimensional district model.

```ts
type UseType =
  | 'residential'
  | 'retail'
  | 'office'
  | 'hospitality'
  | 'light-industrial'
  | 'heavy-industrial'
  | 'logistics'
  | 'civic';

type ZoningDistrict = Readonly<{
  id: string;
  permittedUses: readonly UseType[];
  conditionalUses: readonly UseType[];
  maxFAR: number;
  maxHeightMeters: number;
  maxStories?: number;
  maxCoverageRatio: number;
  frontSetbackMeters: number;
  rearSetbackMeters: number;
  sideSetbackMeters: number;
  minParcelAreaM2: number;
  minFrontageMeters: number;
  maxResidentialUnitsPerHectare?: number;
}>;
```

### 9.2 Overlays

Base districts are independent from overlays. Initial architecture supports overlays such as floodplain, historic, airport-height, transit-oriented, waterfront/environmental, downtown bonus, and affordable-housing bonus.

The effective legal envelope is the composition of:

```text
base district
+ applicable overlays
+ parcel topology
+ right-of-way/easement constraints
+ environmental/infrastructure constraints
= ParcelDevelopmentEnvelope
```

### 9.3 Buildable envelope

`BuildableEnvelopeSystem` offsets actual parcel edges according to edge classification and applicable setbacks, then computes the legal footprint and dimensional capacity.

```ts
type ParcelDevelopmentEnvelope = Readonly<{
  parcelId: string;
  buildableFootprint: readonly WorldPoint[];
  parcelAreaM2: number;
  maxFootprintAreaM2: number;
  maxGrossFloorAreaM2: number;
  maxHeightMeters: number;
  maxStories: number;
  effectiveFAR: number;
  effectiveCoverageRatio: number;
  permittedUses: readonly UseType[];
  limitingConstraints: readonly ZoningConstraint[];
}>;
```

Maximum gross floor area begins with `parcelAreaM2 * maxFAR`, but effective capacity may be lower because of setbacks, footprint geometry, height, coverage, density, and overlay rules.

The system must explicitly distinguish **allowed FAR** from **effective physically achievable FAR**.

### 9.4 Nonconforming buildings

Rezoning never deletes existing buildings. Buildings retain their approval basis and may become legal nonconforming. New construction, expansion, renovation, conversion, and redevelopment apply the current legal rules unless a later policy system grants exceptions.

## 10. Building model

Buildings become physical projects rather than one-cell fixed-capacity definitions.

```ts
type BuildingStatus =
  | 'proposed'
  | 'entitlement'
  | 'demolition'
  | 'construction'
  | 'occupied'
  | 'renovation'
  | 'vacant'
  | 'abandoned';

type BuildingFloor = Readonly<{
  level: number;
  elevationMeters: number;
  grossAreaM2: number;
  uses: readonly FloorUseAllocation[];
}>;

type FloorUseAllocation = Readonly<{
  use: UseType;
  floorAreaM2: number;
  residentialUnits?: number;
  jobs?: number;
  hotelRooms?: number;
  storageCapacity?: number;
}>;

type Building = Readonly<{
  id: string;
  parcelIds: readonly string[];
  footprint: readonly WorldPoint[];
  grossFloorAreaM2: number;
  heightMeters: number;
  stories: number;
  realizedFAR: number;
  coverageRatio: number;
  floors: readonly BuildingFloor[];
  status: BuildingStatus;
  yearBuilt: number;
  condition: number;
  maintenanceBacklog: number;
  developerId?: string;
  ownerId?: string;
  projectCost: number;
  entitlement: BuildingEntitlement;
}>;
```

The data model supports multiple buildings per parcel and, when legally necessary, a building referencing multiple controlled parcels.

### 10.1 Building typologies

The existing building-definition concept is retained as a typology/template catalog rather than a fixed realized building.

Typologies define preferred floorplate, floor-to-floor height, efficiency, structural/complexity parameters, cost per square meter, maintenance rate, typical unit/job density, construction duration, conversion suitability, and other defaults.

Examples include detached house, rowhouse, courtyard apartment, podium apartment, residential tower, main-street mixed-use, office slab, office tower, strip retail, warehouse, logistics center, and industrial plant.

### 10.2 Massing generation

`BuildingMassingSystem` generates a finite deterministic set of candidate masses from the parcel development envelope and selected typology. Initial strategies should include maximum-footprint, balanced, compact/tower, lower-cost, maximum-legal-floor-area, and mixed-use variants where legal.

The engine does not need a continuous mathematical optimizer in the first implementation. A finite candidate set gives the developer system meaningful choice while remaining deterministic, testable, and performant.

### 10.3 Mixed use and derived capacity

Mixed-use buildings allocate floor area explicitly by use and optionally by floor. Residential units, jobs, hotel rooms, storage, utilities, garbage, taxes, and rents are derived from usable floor area and use-specific density assumptions instead of fixed low/medium/high capacities.

Building detail remains authoritative, while high-frequency simulation systems consume cached `BuildingMetrics` aggregates.

## 11. Building lifecycle

`BuildingLifecycleSystem` updates building physical/economic condition at a lower cadence than traffic and routing systems.

```ts
type BuildingLifecycleState = Readonly<{
  ageTicks: number;
  condition: number;
  structuralCondition: number;
  systemsCondition: number;
  exteriorCondition: number;
  maintenanceBacklog: number;
  deferredMaintenanceTicks: number;
  lastMajorRenovationTick?: number;
  effectiveAge: number;
  vacancyDurationTicks: number;
  distressScore: number;
}>;
```

Condition evolves deterministically from base aging, maintenance spending, deferred maintenance, utilization, vacancy, environmental exposure, and service/infrastructure stress.

Physical age and effective age remain separate. Renovation can reduce effective age without rewriting the actual construction year.

## 12. Maintenance, vacancy, and distress

Required maintenance is derived from floor area, typology maintenance rate, age, complexity, and condition. Under-maintenance accumulates backlog and accelerates future deterioration.

Condition feeds back into achievable rents, occupancy, asset value, operating cost, utility efficiency, and redevelopment pressure.

Vacancy progresses economically through partial vacancy, chronic vacancy, distress, and abandonment. Abandonment is triggered by sustained inability to operate/maintain the building, not by an arbitrary timer.

Abandoned structures remain present and may depress local desirability, generate little tax revenue, become unsafe, or present redevelopment opportunities.

## 13. Renovation and adaptive reuse

Urban Fabric 2.0 supports three initial renovation scopes:

- **light** — interior/refit, modest condition recovery, short duration;
- **major** — envelope/building systems, substantial condition recovery and lower effective age;
- **gut** — near-total internal reconstruction, high condition reset, use conversion where legal.

```ts
type RenovationProposal = Readonly<{
  buildingId: string;
  scope: 'light' | 'major' | 'gut';
  cost: number;
  durationTicks: number;
  projectedCondition: number;
  projectedEffectiveAge: number;
  projectedRentIncrease: number;
  projectedOperatingSavings: number;
  requiresVacancy: boolean;
}>;
```

Adaptive reuse requires zoning legality, typology conversion suitability, adequate structural/floorplate characteristics, and a successful economic pro forma.

## 14. Demolition and construction phases

Demolition is a project state with explicit cost and duration. Cost may depend on gross floor area, structural type, height, site accessibility, and future modifiers such as hazardous materials or salvage.

New development proceeds through explicit states:

```text
entitlement
→ site preparation / relocation / demolition
→ foundation
→ structure
→ enclosure
→ fit-out
→ completion
→ lease-up / occupancy
→ stabilization
```

The first implementation may render these phases coarsely, but financing carry and project availability must respect the states.

## 15. Highest-and-best-use redevelopment

`HighestBestUseSystem` evaluates alternative strategies for each developed parcel or candidate assemblage:

1. hold existing asset;
2. light/major/gut renovation;
3. adaptive reuse;
4. demolition and redevelopment;
5. adjacent parcel assembly and redevelopment.

```ts
type HighestBestUseResult = Readonly<{
  siteId: string;
  currentUseValue: number;
  holdValue: number;
  bestRenovationValue?: number;
  bestConversionValue?: number;
  bestRedevelopmentValue?: number;
  bestStrategy: 'hold' | 'renovate' | 'convert' | 'redevelop' | 'assemble' | 'none';
  redevelopmentPremium: number;
  projectedIRR: number;
  returnOnCost: number;
  candidateProjects: readonly DevelopmentCandidate[];
}>;
```

Current asset value is based on stabilized NOI/cap rate less maintenance backlog and near-term capital requirements. Redevelopment must beat the opportunity cost of the existing asset plus demolition, relocation, transaction, construction, financing, and developer-profit requirements.

## 16. Residual land value, ownership, and transactions

Residual land value becomes central:

```text
stabilized project value
− non-land development costs
− financing
− required developer profit
= residual land value
```

A developer can acquire a site only when residual value exceeds seller reservation value and transaction costs.

Seller reservation value may include current asset value, disruption/relocation premium, deterministic holdout factor, and option value from expected future development capacity.

```ts
type PropertyTransaction = Readonly<{
  id: string;
  parcelIds: readonly string[];
  buyerId: string;
  sellerId?: string;
  tick: number;
  salePrice: number;
  landValue: number;
  improvementValue: number;
  purpose: 'investment' | 'redevelopment' | 'assembly';
}>;
```

Property transaction history becomes available for later assessment and market-analysis systems.

## 17. Developer-market integration

The existing deterministic developer system is preserved and extended.

The new pipeline is:

```text
BuildingMassingSystem
        ↓
ZoningComplianceSystem
        ↓
DevelopmentFeasibilitySystem
        ↓
HighestBestUseSystem
        ↓
DeveloperMarketSystem
        ↓
PropertyMarket / SiteAssembly
        ↓
RedevelopmentExecutionSystem
```

Developers continue to differ by capital, leverage, financing spread, hurdle rate, risk tolerance, project-size capacity, and use preferences. Future typology specialization can fit the same model.

`DevelopmentFeasibilitySystem` should stop treating `zoningMaxIntensity` as the principal legality constraint. It instead consumes physical project data, legal compliance results, actual floor area, actual cost, site acquisition basis, and market context.

## 18. Redevelopment pressure

`RedevelopmentPressureSystem` becomes an explainable diagnostic derived from:

- unused effective zoning capacity;
- land value / improvement value ratio;
- building condition and maintenance backlog;
- rent/demand strength;
- accessibility gains;
- rezoning or overlay changes;
- assembly opportunity;
- current building profitability;
- tenant relocation costs;
- demolition difficulty;
- preservation restrictions.

This pressure score is descriptive and prioritizing. It must not replace the actual highest-and-best-use/pro-forma decision.

## 19. Tenant and household displacement

Redevelopment may not silently delete occupants. Before demolition, households and commercial/industrial tenants must pass through relocation/termination workflows already present or extended in housing/employment systems.

Development cost therefore includes applicable relocation payments, lease termination, temporary vacancy, and policy obligations.

## 20. Save format: V8 Urban Fabric

Urban Fabric 2.0 introduces:

```text
saveVersion: 8
gameVersion: 0.8.0-urban-fabric
```

Canonical V8 sections include:

```ts
urbanFabric: {
  nodes: ParcelNode[];
  edges: ParcelEdge[];
  blocks: UrbanBlock[];
  parcels: Parcel[];
  easements: Easement[];
  lineage: ParcelLineageEvent[];
};

zoningV2: {
  districts: ZoningDistrict[];
  parcelAssignments: ...;
  overlays: ...;
};

buildingsV2: Building[];

propertyMarket: {
  transactions: PropertyTransaction[];
  ownership: ...;
};
```

### 20.1 V7 migration

V7 and older compatible saves remain loadable.

Each legacy cell lot becomes a deterministic square cadastral parcel occupying the corresponding world cell. Legacy lot IDs map to deterministic parcel IDs such as `parcel:legacy:<x>,<y>`.

Existing buildings become simple one-parcel massing objects derived from their current building definition and intensity. Existing developer commitments and housing references are remapped through the lot-to-parcel migration table.

No backward serialization to V7 is required.

Hydration validates all cadastral and cross-system references before state becomes active.

## 21. Presentation and UI

### 21.1 Cadastral overlay

Add an optional parcel layer showing parcel edges, block boundaries, frontage, selected parcel geometry, and assembly candidates. Parcel boundaries remain subtle during ordinary gameplay and become prominent in zoning/land tools and close zoom.

### 21.2 Buildable-envelope visualization

Parcel selection can display:

- parcel boundary;
- setback bands;
- legal footprint polygon;
- maximum height/massing envelope;
- allowed FAR versus effective FAR;
- limiting zoning constraints.

### 21.3 Parcel inspector

The inspector should expose at minimum:

- area, frontage, depth/orientation;
- district and overlays;
- FAR, effective FAR, height, coverage, setbacks;
- current building(s), realized FAR, age, condition;
- land and improvement value;
- redevelopment pressure and primary drivers/constraints;
- lineage/history where useful.

Multi-parcel selection previews assembly capacity and indicative acquisition/development uplift.

### 21.4 Zoning controls

The player applies zoning districts rather than only broad land-use paint. District labels may use codes such as `R2`, `R5`, `MU4`, `MU8`, `C6`, and `IND`, while the UI exposes the underlying understandable rules.

## 22. Rendering integration

Simulation geometry remains authoritative; rendering consumes lightweight render proxies.

The isometric renderer should support generated footprints and massing rather than relying exclusively on one-cell building sprites. Existing art assets and typology sprites remain useful as facade/style selections mapped onto generated masses.

Detailed floor allocations do not need per-floor render entities. Render proxies expose footprint, projected height, typology/style, status, condition band, and construction phase.

## 23. Performance model

High-frequency systems do not traverse topology or individual floors unnecessarily.

Cache:

- parcel area/frontage/centroid/adjacency;
- buildable envelope and zoning capacity until invalidated;
- building aggregate metrics;
- spatial indexes for parcel/building lookup;
- redevelopment-pressure inputs at an appropriate slower cadence.

Topology caches invalidate only for affected blocks/parcels after cadastral mutations, road/right-of-way changes, zoning changes, or relevant overlays.

Lifecycle and redevelopment evaluation run at coarse simulation cadence rather than every base tick.

## 24. Proposed module boundaries

```text
src/world/cadastre/
  Geometry.ts
  CadastralTypes.ts
  CadastralGraph.ts
  CadastralValidator.ts
  CadastralMutationSystem.ts
  ParcelGenerationSystem.ts
  ParcelLineage.ts

src/simulation/zoning/
  ZoningTypes.ts
  ZoningDistrictCatalog.ts
  BuildableEnvelopeSystem.ts
  ZoningComplianceSystem.ts

src/simulation/buildings/
  BuildingTypes.ts
  BuildingMassingSystem.ts
  BuildingLifecycleSystem.ts
  RenovationSystem.ts

src/simulation/development/
  HighestBestUseSystem.ts
  PropertyMarketSystem.ts
  SiteAssemblySystem.ts
```

`SimulationCore` orchestrates these systems through narrow interfaces. Urban Fabric 2.0 must avoid putting geometry algorithms, zoning calculations, or lifecycle internals directly into the already-large `SimulationCore.ts`.

## 25. Testing strategy

### 25.1 Geometry unit tests

Cover polygon area, centroid, orientation, point-in-polygon, edge classification, intersection, offset, union, and split behavior.

### 25.2 Cadastral invariant tests

After every mutation, `CadastralValidator` verifies all invariants. Fixtures include rectangular, corner, narrow, and irregular parcels plus repeated split/assembly sequences.

### 25.3 Zoning tests

Known geometry fixtures verify FAR, lot coverage, height, front/rear/side setbacks, corner-lot classification, frontage minimums, overlays, and effective-FAR constraints.

### 25.4 Building tests

Candidate footprints must remain inside legal envelopes. Floor-use allocation must tie to usable area. Building metrics must reconcile to floor detail.

### 25.5 Lifecycle/economic tests

Required directional cases include:

- deterioration lowers hold value;
- maintenance slows deterioration;
- major renovation restores condition/effective age;
- upzoning raises legal capacity and, all else equal, residual land value;
- strong existing NOI can prevent otherwise legal redevelopment;
- parcel assembly may unlock a higher effective FAR but proceeds only when the acquisition economics work;
- relocation/demolition costs can reverse a redevelopment decision.

### 25.6 Save determinism tests

`simulate → save → hydrate → simulate` must produce the same cadastral topology, project state, lifecycle state, and economic outputs as uninterrupted simulation.

V7 fixture migration must be deterministic and preserve cross-references.

### 25.7 Property/fuzz tests

Generate deterministic sequences of split, assembly, boundary adjustment, and right-of-way transactions and assert:

- no overlap;
- graph validity;
- area conservation within tolerance;
- deterministic serialization;
- stable lineage;
- successful round-trip hydration.

A key conservation invariant is:

```text
private land area + dedicated right-of-way area = original controlled area
```

within the defined geometry tolerance.

## 26. Failure handling

Geometry and cadastral errors fail closed. Invalid mutations do not partially modify canonical state.

Zoning-envelope generation returns structured invalid/limiting reasons instead of silently constructing malformed geometry.

Development candidates that cannot produce valid geometry or legal compliance are rejected before economic bidding.

Hydration validates topology, IDs, references, and stored derived values where relevant; corrupt V8 saves fail with targeted validation errors rather than entering partially valid runtime state.

## 27. Implementation sequence

Urban Fabric 2.0 should be implemented in six vertical slices:

1. **R1 — Cadastral Core**: geometry primitives, graph, block/parcel types, generation, validator, legacy compatibility facade.
2. **R2 — Dimensional Zoning**: district catalog, overlays foundation, setbacks, FAR/coverage/height, buildable envelopes, compliance.
3. **R3 — Building Massing & Mixed Use**: new building types, finite candidate massing, floor-area allocation, aggregate metrics, compatibility migration.
4. **R4 — Lifecycle**: deterioration, maintenance, vacancy/distress, renovation, adaptive reuse, demolition phases.
5. **R5 — Highest-and-Best-Use Redevelopment**: asset valuation, candidate comparison, property transactions, developer integration, displacement costs.
6. **R6 — Split/Assembly + Save/Render/UI**: transactional subdivision and assembly, lineage, V8 migration, cadastral/zoning overlays, parcel inspector, full integration/fuzz coverage.

Each slice must be testable and maintain temporary compatibility with existing simulation consumers until the next slice replaces them.

## 28. Compatibility strategy

`LotSystem` should become a transitional compatibility facade during migration. New authoritative systems consume parcels. Existing consumers that still require `Lot` receive deterministic parcel-derived compatibility views until they are migrated.

The compatibility layer must not become a second source of truth and should be deleted or reduced to save migration after all runtime consumers move to parcels.

Similarly, the current fixed building definitions remain as typology seeds while legacy tests and saves migrate. New development candidates must not be restricted to one realized fixed-capacity object per definition.

## 29. Explicit non-goals for this pass

Urban Fabric 2.0 establishes interfaces for several future systems but does not require complete implementations of:

- condominium/vertical strata cadastral ownership;
- air-rights markets;
- eminent-domain policy and legal proceedings;
- detailed building-code inspection;
- individual elevators/MEP components;
- continuous nonlinear massing optimization;
- full heritage-preservation gameplay;
- dynamic title financing/mortgage securitization;
- exact real-world survey/legal descriptions.

These are deferred intentionally so the cadastral architecture remains extensible without making the initial implementation unbounded.

## 30. Acceptance criteria

Urban Fabric 2.0 is complete when all of the following are true:

1. Runtime development uses persistent cadastral parcels rather than one zoned cell equaling one lot.
2. Adjacent parcels share validated topology and survive deterministic split/assembly mutations.
3. Zoning legality uses FAR, setbacks, height, coverage, frontage, use permissions, and overlays rather than only low/medium/high intensity.
4. Developers evaluate physically valid candidate building masses.
5. A building may contain multiple uses and capacity derives from floor area.
6. Buildings age, accumulate maintenance backlog, become vacant/distressed, and can be renovated or adaptively reused.
7. Redevelopment compares hold, renovation, conversion, redevelopment, and assembly economics.
8. Parcel assembly has real acquisition/geometry/economic consequences.
9. Occupants are handled before demolition rather than silently deleted.
10. V7 saves migrate deterministically to V8.
11. Parcel, zoning-envelope, and redevelopment diagnostics are visible to the player.
12. Geometry/property fuzz tests demonstrate topology validity and land-area conservation across mutation sequences.
13. Existing developer-market behavior remains deterministic after migration.
14. Full repository test/typecheck/build/smoke gates pass before merge.

## 31. Final data flow

```text
Road / right-of-way network
        ↓
Urban blocks + CadastralGraph
        ↓
Persistent parcels
        ↓
Zoning districts + overlays
        ↓
BuildableEnvelopeSystem
        ↓
BuildingMassingSystem
        ↓
ZoningComplianceSystem
        ↓
DevelopmentFeasibilitySystem
        ↓
HighestBestUseSystem
        ↓
DeveloperMarketSystem
        ↓
Property acquisition / site assembly
        ↓
Relocation / demolition / construction
        ↓
Occupancy + BuildingLifecycleSystem
        ↓
Maintenance / renovation / distress
        ↓
RedevelopmentPressure + next HBU cycle
        ↺
```

This establishes a persistent urban land fabric in which zoning, ownership, physical geometry, building condition, market demand, transportation access, and developer economics jointly determine how the city evolves.