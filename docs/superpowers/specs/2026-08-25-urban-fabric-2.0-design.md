# Civic Foundry — Urban Fabric 2.0 Design

**Date:** 2026-08-25  
**Branch:** `feature/urban-fabric-2.0`  
**Status:** Approved architecture, pending implementation plan

## 1. Purpose

Urban Fabric 2.0 replaces Civic Foundry's cell-lot abstraction with a persistent cadastral/topological land model and extends development from fixed low/medium/high single-use buildings into parcel-constrained, mixed-use, economically evaluated projects.

The pass delivers:

- true cadastral parcels with explicit shared topology;
- FAR, height, lot coverage, setbacks, frontage/area rules, and overlays;
- mixed-use building massing with floor-area-derived capacity;
- deterioration, maintenance, vacancy, renovation, adaptive reuse, abandonment, and demolition;
- highest-and-best-use redevelopment economics;
- deterministic parcel subdivision and land assembly;
- ownership/transaction history and parcel lineage;
- V8 save migration from the current V7 lot/building model;
- cadastral, zoning-envelope, and redevelopment presentation;
- aggressive geometry invariant and property/fuzz testing.

The existing deterministic developer-market and pro-forma systems remain the economic foundation. Urban Fabric 2.0 replaces their coarse physical/legal inputs with parcel geometry, dimensional zoning, realized building form, and existing-asset economics.

## 2. Current-state constraints

Today `LotSystem` creates one `Lot` per zoned grid cell with `id`, `x`, `y`, `zone`, and one road-frontage key. `BuildingSystem` stores one building per lot. Building definitions are single-use, zone-bound, and expose fixed resident/job capacities. Development legality is primarily `ZoneType` plus low/medium/high `zoningMaxIntensity`.

That model cannot represent irregular parcels, shared boundaries, meaningful setbacks, land assembly, actual FAR, mixed-use floor area, or realistic redevelopment. Urban Fabric 2.0 therefore introduces a new canonical land model rather than extending `Lot` indefinitely.

The tile/grid remains available for terrain sampling, utilities, traffic occupancy, and low-level spatial indexing. It stops defining property boundaries.

## 3. Architectural decision

The selected architecture is a **full cadastral/topological graph from the start**.

```text
World
 └─ UrbanBlock
     └─ Parcel
         ├─ shared ParcelNodes
         ├─ shared ParcelEdges
         ├─ frontage/access relationships
         ├─ easements / rights-of-way
         ├─ zoning assignment
         └─ buildings / development sites
```

Adjacent parcels share boundary topology rather than storing approximately matching duplicate polygon lines.

## 4. Canonical cadastral model

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

`CadastralGraph` is authoritative for nodes, edges, parcels, blocks, easements, lineage, adjacency, and parcel lookup.

### 4.1 Topology invariants

Every committed graph must satisfy:

- parcel polygons are closed and non-self-intersecting;
- parcel area is positive;
- parcels do not overlap;
- shared boundaries use the same edge object;
- every edge terminates at valid nodes;
- there are no zero-length edges;
- normalization leaves no orphaned nodes;
- adjacency is symmetric;
- parcels belong to a valid block except explicitly modeled exceptional land;
- frontage/access references a legal right-of-way or access easement;
- topology-derived area agrees with stored area within tolerance;
- parcel lineage is acyclic;
- serialization order is deterministic.

World geometry uses a documented meter-based coordinate system. Coordinates are normalized to centimeter precision before topology identity comparisons. All tolerances are constants, versioned with the simulation, and deterministic.

## 5. Rights-of-way, access, and easements

Land ownership, building ownership, and developer project control are distinct concepts, even when one entity initially fills all three roles.

Dedicated right-of-way is excluded from developable private parcel area. Easements preserve underlying ownership while granting defined rights.

```ts
type EasementKind = 'access' | 'utility' | 'drainage' | 'pedestrian';

type Easement = Readonly<{
  id: string;
  parcelIds: readonly string[];
  kind: EasementKind;
  geometry: readonly WorldPoint[];
}>;
```

Interior parcels may satisfy access requirements through explicit access easements. Future utility/hydrology systems can reuse the same legal geometry without changing the cadastral core.

## 6. Blocks and roads

Blocks are primarily derived from road/right-of-way geometry and then subdivided into parcels. An `UrbanBlock` remains stable through ordinary parcel splits and assemblies.

A transportation project may mutate the land fabric. New road dedication can acquire/split private land, divide a block, and produce new block/parcel topology through the same transactional cadastral API. Road geometry therefore creates cadastral constraints; it is no longer merely checked as a neighboring tile.

## 7. Atomic cadastral mutations

All land-geometry changes go through `CadastralMutationSystem`.

Supported Urban Fabric 2.0 operations:

```ts
splitParcel(parcelId, cut)
assembleParcels(parcelIds)
adjustBoundary(edgeId, replacementGeometry)
dedicateRightOfWay(parcelId, geometry)
createEasement(parcelIds, geometry)
removeEasement(easementId)
```

Each operation:

1. copies the affected topology into a transactional working set;
2. performs the geometric mutation;
3. normalizes nodes/edges;
4. validates all graph invariants;
5. recalculates derived parcel metrics and references;
6. commits atomically;
7. emits a deterministic mutation/lineage event.

Failure leaves canonical state unchanged.

```ts
type CadastralTransactionKind =
  | 'split'
  | 'assembly'
  | 'boundary-adjustment'
  | 'right-of-way'
  | 'easement';

type CadastralTransaction = Readonly<{
  id: string;
  tick: number;
  kind: CadastralTransactionKind;
  sourceParcelIds: readonly string[];
  resultingParcelIds: readonly string[];
  topologyChanges: readonly TopologyChange[];
  lineageChanges: readonly ParcelLineageEvent[];
}>;
```

## 8. Parcel subdivision

A split accepts one source parcel plus a deterministic cut specification and produces two or more child parcels.

Validation requires:

- every child polygon is valid;
- minimum parcel area is met unless the parcel is explicitly grandfathered;
- frontage/access requirements are met where applicable;
- the split creates no inaccessible trapped parcel;
- an ordinary split does not cut through an occupied building footprint;
- every preserved building is geometrically contained by a resulting parcel.

The source parcel ID is retired to history and never reused. Children record the source parcel as lineage.

For preserved buildings, cadastral commit rewrites `building.parcelIds` to the child parcel(s) that contain the building. If a split intersects a building footprint, the transaction is rejected unless the caller is an explicit demolition/reconfiguration workflow.

## 9. Parcel assembly

Assembly requires a contiguous set of parcels under sufficient ownership/project control.

The system:

1. validates adjacency and control;
2. unions parcel geometry;
3. removes internal property boundaries;
4. preserves external edges;
5. creates one new current parcel ID;
6. retires all source parcel IDs to lineage;
7. recalculates frontage, access, area, centroid, depth/orientation, and zoning capacity;
8. rewrites preserved building references to the new parcel ID after geometric containment validation.

Existing buildings may remain on an assembled parcel if the development strategy is hold/renovate. A redevelopment workflow may instead preserve them only until the demolition phase completes.

Assembly economics include acquisition prices, seller reservation/holdout premiums, transaction costs, demolition cost, and carrying cost. Assembly is pursued only when the additional site capacity/value exceeds those costs and developer return requirements.

## 10. Dimensional zoning

### 10.1 Uses and districts

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

Conditional uses require an explicit approval flag from the policy/entitlement context; absent that approval they are illegal candidates.

### 10.2 Overlays

Base zoning is independent from overlays. The architecture supports floodplain, historic, airport-height, transit-oriented-development, waterfront/environmental, downtown bonus, and affordable-housing overlays.

An overlay applies explicit rule deltas such as tighter height, added setback, allowed FAR bonus, restricted uses, or preservation status. Overlay composition has a documented deterministic priority/order.

### 10.3 Buildable envelope

`BuildableEnvelopeSystem` classifies parcel edges, offsets them by applicable setbacks, intersects overlay/right-of-way constraints, and computes the legal footprint/capacity.

```ts
type ZoningConstraint = Readonly<{
  code: string;
  label: string;
  limitingValue?: number;
}>;

type ParcelDevelopmentEnvelope = Readonly<{
  parcelId: string;
  buildableFootprint: readonly WorldPoint[];
  parcelAreaM2: number;
  allowedFAR: number;
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

`maxGrossFloorAreaM2` begins with `parcelAreaM2 * allowedFAR` and is further constrained by the geometry-compatible combination of setbacks, lot coverage, height, story count, residential density, and overlays.

The engine explicitly distinguishes legal/allowed FAR from physically achievable effective FAR.

### 10.4 Nonconforming structures

Rezoning does not delete existing buildings. Each building retains its entitlement basis and may become legal nonconforming. Current rules apply to new construction, expansion, conversion, and redevelopment unless a policy/variance explicitly says otherwise.

## 11. Building model and entitlement

Buildings become instantiated physical projects.

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

type BuildingEntitlement = Readonly<{
  approvalTick: number;
  zoningDistrictId: string;
  approvedUses: readonly UseType[];
  approvedFAR: number;
  approvedHeightMeters: number;
  approvedCoverageRatio: number;
}>;

type FloorUseAllocation = Readonly<{
  use: UseType;
  floorAreaM2: number;
  residentialUnits?: number;
  jobs?: number;
  hotelRooms?: number;
  storageCapacity?: number;
}>;

type BuildingFloor = Readonly<{
  level: number;
  elevationMeters: number;
  grossAreaM2: number;
  uses: readonly FloorUseAllocation[];
}>;

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
  developerId?: string;
  ownerId?: string;
  projectCost: number;
  entitlement: BuildingEntitlement;
  lifecycle: BuildingLifecycleState;
}>;
```

`BuildingLifecycleState` is the sole canonical home for condition and maintenance-backlog state; cached presentation metrics may mirror it but are never independent writable state.

The schema supports multiple buildings on one parcel. A building may reference multiple current parcels only where the legal/project structure intentionally preserves them; after a formal parcel assembly, preserved buildings normally reference the single new assembled parcel.

## 12. Building typologies and massing

The existing building-definition catalog becomes a typology/template library rather than a realized fixed-capacity building table.

Typologies provide preferred floorplate, floor-to-floor height, efficiency, structural/complexity factors, construction cost per square meter, maintenance rate, typical unit/job density, construction duration, conversion suitability, and similar defaults.

Examples include detached house, rowhouse, courtyard apartment, podium apartment, residential tower, main-street mixed-use, office slab, office tower, strip retail, warehouse, logistics center, and industrial plant.

`BuildingMassingSystem` generates a finite deterministic candidate set from the parcel envelope. Initial strategies are:

- maximum footprint / fewer floors;
- balanced massing;
- compact/tower massing where appropriate;
- lower-cost massing;
- maximum legal floor-area massing;
- mixed-use variant where legal and economically relevant.

No continuous nonlinear optimizer is required in this pass.

## 13. Mixed use and derived capacity

Floor area is allocated by use, optionally floor-by-floor. Residential units, jobs, hotel rooms, storage, utility demand, garbage, tax base, and rent potential derive from usable floor area and use-specific assumptions.

Floor-allocation invariants require:

- use allocations on a floor do not exceed that floor's usable area;
- building total gross area reconciles to floor gross areas;
- derived residential/job capacity reconciles to the canonical floor allocations;
- uses are permitted by the building entitlement.

Detailed building state remains authoritative. High-frequency systems consume cached `BuildingMetrics` aggregates instead of traversing every floor.

## 14. Building lifecycle and maintenance

`BuildingLifecycleSystem` updates at a coarse deterministic cadence.

Condition evolves from:

- base aging;
- maintenance spending;
- deferred-maintenance backlog;
- utilization;
- vacancy;
- environmental exposure;
- infrastructure/service stress.

Physical age and effective age are separate. Renovation can reduce effective age without changing `yearBuilt`.

Required maintenance derives from floor area, typology maintenance rate, age, complexity, and condition. Under-maintenance increases backlog and accelerates deterioration.

Condition affects achievable rent, occupancy, operating expense, asset value, utility efficiency, tax base, and redevelopment pressure.

## 15. Vacancy, distress, abandonment, and safety

Vacancy progresses economically through partial vacancy, chronic vacancy, distress, and abandonment. Abandonment follows sustained operating/maintenance failure rather than a fixed timer.

Abandoned structures remain physically present. They may depress local desirability, provide little tax revenue, incur safety/code risk, and become redevelopment opportunities.

Low structural condition can mark a building unsafe for occupancy. This pass needs the state and economic consequence; detailed municipal inspection gameplay remains outside scope.

## 16. Renovation and adaptive reuse

Initial renovation scopes:

- **light** — interior/refit, modest recovery, short duration;
- **major** — systems/envelope work, substantial recovery, lower effective age;
- **gut** — near-total internal reconstruction, high condition reset, possible use conversion.

```ts
type RenovationScope = 'light' | 'major' | 'gut';

type RenovationProposal = Readonly<{
  buildingId: string;
  scope: RenovationScope;
  cost: number;
  durationTicks: number;
  projectedCondition: number;
  projectedEffectiveAge: number;
  projectedRentIncrease: number;
  projectedOperatingSavings: number;
  requiresVacancy: boolean;
}>;
```

Adaptive reuse requires current zoning/entitlement legality, typology conversion suitability, adequate physical characteristics, and an economic return that clears the applicable hurdle.

## 17. Demolition and project phases

Demolition is an explicit project state with cost and duration. Cost depends on floor area, structure, height, site accessibility, and future modifiers such as hazardous materials or salvage.

Development proceeds through:

```text
entitlement
→ acquisition / relocation
→ demolition / site preparation
→ foundation
→ structure
→ enclosure
→ fit-out
→ completion
→ lease-up / occupancy
→ stabilization
```

Rendering may group phases coarsely, but project availability, capital commitment, and financing carry respect them.

## 18. Highest-and-best-use analysis

`HighestBestUseSystem` evaluates:

1. hold;
2. renovate;
3. adaptive reuse;
4. demolish/redevelop;
5. assemble adjacent parcels and redevelop.

```ts
type HighestBestUseStrategy =
  | 'hold'
  | 'renovate'
  | 'convert'
  | 'redevelop'
  | 'assemble'
  | 'none';

type HighestBestUseResult = Readonly<{
  siteId: string;
  currentUseValue: number;
  holdValue: number;
  bestRenovationValue?: number;
  bestConversionValue?: number;
  bestRedevelopmentValue?: number;
  bestStrategy: HighestBestUseStrategy;
  redevelopmentPremium: number;
  projectedIRR: number;
  returnOnCost: number;
  candidateProjectIds: readonly string[];
}>;
```

Current asset value is stabilized NOI divided by an applicable cap rate, adjusted for maintenance backlog and near-term capital requirements. Redevelopment must exceed the opportunity cost of the existing asset plus acquisition, demolition, relocation, construction, financing, transaction costs, and required developer profit.

Redevelopment pressure is a diagnostic/prioritization signal; it never substitutes for this pro-forma comparison.

## 19. Residual land value and property transactions

```text
stabilized project value
− non-land development costs
− financing
− required developer profit
= residual land value
```

Acquisition requires residual value to exceed seller reservation value plus transaction costs. Seller reservation value can include current asset value, deterministic disruption/holdout premium, and option value from future development capacity.

```ts
type PropertyTransactionPurpose = 'investment' | 'redevelopment' | 'assembly';

type PropertyTransaction = Readonly<{
  id: string;
  parcelIds: readonly string[];
  buyerId: string;
  sellerId?: string;
  tick: number;
  salePrice: number;
  landValue: number;
  improvementValue: number;
  purpose: PropertyTransactionPurpose;
}>;

type ParcelOwnership = Readonly<{
  parcelId: string;
  ownerId: string;
  acquisitionTick: number;
  acquisitionBasis: number;
}>;
```

## 20. Developer-system integration

The existing developer systems are extended rather than discarded.

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
PropertyMarketSystem / SiteAssemblySystem
        ↓
RedevelopmentExecutionSystem
```

`DevelopmentFeasibilitySystem` stops treating `zoningMaxIntensity` as the principal legal constraint. It consumes physical candidate geometry, compliance output, actual floor area, site basis, actual construction cost, market conditions, and policy parameters.

Developers retain different capital, leverage, financing spread, hurdle rate, risk tolerance, concurrent-project capacity, and use preferences. Typology specialization can be added without changing the pipeline.

## 21. Redevelopment pressure

`RedevelopmentPressureSystem` remains explainable and is derived from:

- unused effective zoning capacity;
- land value / improvement value ratio;
- building condition/backlog;
- rent/demand strength;
- accessibility changes;
- rezoning/overlay changes;
- assembly opportunity;
- current building profitability;
- tenant relocation cost;
- demolition difficulty;
- preservation restrictions.

The parcel inspector surfaces the main positive and negative contributors.

## 22. Displacement and occupancy integrity

Redevelopment may not silently delete occupants. Before demolition, households and commercial/industrial occupants pass through relocation/lease-termination workflows in housing/employment systems.

Development cost includes applicable relocation, temporary vacancy, lease termination, and policy obligations. If required displacement cannot be resolved under current rules, demolition does not start.

## 23. Save format — V8 Urban Fabric

Urban Fabric 2.0 introduces:

```text
saveVersion: 8
gameVersion: 0.8.0-urban-fabric
```

Canonical sections:

```ts
type UrbanFabricSaveState = Readonly<{
  nodes: readonly ParcelNode[];
  edges: readonly ParcelEdge[];
  blocks: readonly UrbanBlock[];
  parcels: readonly Parcel[];
  easements: readonly Easement[];
  lineage: readonly ParcelLineageEvent[];
}>;

type ZoningAssignment = Readonly<{
  parcelId: string;
  zoningDistrictId: string;
}>;

type ZoningOverlayAssignment = Readonly<{
  parcelId: string;
  overlayIds: readonly string[];
}>;

type ZoningV2SaveState = Readonly<{
  districts: readonly ZoningDistrict[];
  assignments: readonly ZoningAssignment[];
  overlayAssignments: readonly ZoningOverlayAssignment[];
}>;

type PropertyMarketSaveState = Readonly<{
  transactions: readonly PropertyTransaction[];
  ownership: readonly ParcelOwnership[];
}>;

type SaveV8UrbanFabricSections = Readonly<{
  urbanFabric: UrbanFabricSaveState;
  zoningV2: ZoningV2SaveState;
  buildingsV2: readonly Building[];
  propertyMarket: PropertyMarketSaveState;
}>;
```

Overlay rule definitions themselves remain versioned game data unless an overlay is player-authored; only parcel overlay assignments are required in normal saves.

### 23.1 V7 migration

V7 and older compatible saves remain loadable.

Each legacy cell lot becomes a deterministic square parcel occupying the same world cell. Legacy `lot:<x>,<y>` references map through a migration table to deterministic parcel IDs such as `parcel:legacy:<x>,<y>`.

Existing buildings become one-parcel building masses derived from their legacy definition/intensity. Developer commitments, housing allocations, and all other lot/building references are remapped before hydration completes.

No backward V8→V7 serialization is required.

V8 hydration validates topology and all cross-system references before exposing state to the simulation.

## 24. Presentation and interaction

### 24.1 Cadastral overlay

An optional layer shows parcel edges, block boundaries, frontage/access, selection, and assembly candidates. Parcel lines are subtle during normal play and prominent in land/zoning tools or close zoom.

### 24.2 Buildable-envelope overlay

Selecting a parcel can show:

- parcel boundary;
- setback bands;
- legal footprint;
- maximum massing/height envelope;
- allowed FAR versus effective FAR;
- limiting zoning constraints.

### 24.3 Parcel inspector

Minimum inspector data:

- area, frontage, depth/orientation;
- base district and overlays;
- allowed/effective FAR, height, coverage, setbacks;
- current buildings, realized FAR, age, condition;
- land value and improvement value;
- redevelopment pressure and its principal drivers/constraints;
- parcel lineage/history.

Multi-select previews an assembly's combined land area, effective capacity, indicative acquisition cost, and potential development uplift.

### 24.4 Zoning controls

The player applies zoning districts rather than only broad use colors. District codes may use labels such as `R2`, `R5`, `MU4`, `MU8`, `C6`, and `IND`; the UI always exposes underlying FAR/height/coverage/setback/use rules.

## 25. Rendering integration

Simulation geometry is authoritative. Rendering consumes lightweight proxies containing footprint, height, typology/style, status, condition band, and construction phase.

The isometric renderer must support generated footprints/massing rather than exclusively one-cell building sprites. Existing art assets remain useful as style/facade selections mapped to generated masses.

Per-floor use allocations do not require per-floor render entities.

## 26. Performance model

High-frequency systems do not traverse full topology or floor arrays unless necessary.

Cache:

- parcel area/frontage/centroid/adjacency;
- spatial indexes for parcels and buildings;
- buildable envelopes until invalidated;
- building aggregate metrics;
- redevelopment-pressure inputs at coarse cadence.

Affected caches invalidate on cadastral mutation, road/right-of-way change, zoning/overlay change, or relevant environmental constraint change. Lifecycle and redevelopment evaluation run at slower deterministic cadences than base movement/traffic simulation.

## 27. Module boundaries

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

`SimulationCore` orchestrates these modules through narrow interfaces. Geometry algorithms, zoning calculations, and lifecycle internals do not move into the already-large core orchestrator.

## 28. Testing strategy

### 28.1 Geometry tests

Cover polygon area, centroid, orientation, point-in-polygon, segment intersection, polygon intersection, offset, union, split, normalization, and edge classification.

### 28.2 Cadastral invariant tests

Every mutation ends with `CadastralValidator`. Fixtures include rectangular, corner, narrow, and irregular parcels plus repeated split/assembly/right-of-way sequences.

### 28.3 Zoning tests

Known fixtures verify FAR, coverage, height, story limits, front/rear/side setbacks, corner-lot classification, minimum frontage/area, overlays, conditional-use handling, and effective-FAR constraints.

### 28.4 Building tests

Candidate footprints remain inside the legal envelope. Floor areas reconcile exactly to building gross/usable metrics within defined tolerance. Use allocations respect entitlement. Parcel-reference rewrite tests cover split and assembly.

### 28.5 Lifecycle/economic tests

Required directional cases:

- deterioration lowers hold value;
- adequate maintenance slows deterioration;
- major renovation restores condition/reduces effective age;
- upzoning increases capacity and, all else equal, residual land value;
- strong existing NOI can prevent redevelopment;
- assembly can unlock greater effective FAR but only proceeds when acquisition economics work;
- relocation/demolition costs can reverse a redevelopment decision.

### 28.6 Save determinism tests

`simulate → save → hydrate → simulate` must match uninterrupted simulation for topology, ownership, building lifecycle, development commitments, and relevant economic outputs.

V7 migration fixtures must produce the same V8 IDs and cross-references on repeated loads.

### 28.7 Property/fuzz tests

Generate deterministic split, assembly, boundary-adjustment, easement, and right-of-way sequences and assert:

- no parcel overlap;
- graph validity;
- area conservation within tolerance;
- deterministic serialization;
- stable acyclic lineage;
- valid building references;
- successful save/hydrate round trips.

Conservation invariant:

```text
private land area + dedicated right-of-way area = original controlled area
```

within the versioned geometry tolerance. Easements do not change underlying land area and therefore do not enter this sum.

## 29. Failure handling

Geometry/cadastral operations fail closed. Invalid transactions never partially mutate canonical state.

Buildable-envelope generation returns structured invalid/limiting reasons. Invalid or illegal development candidates are rejected before developer bidding.

Hydration validates topology, stable IDs, ownership, building-parcel containment, developer commitments, and occupancy references. Corrupt V8 saves fail with targeted errors rather than entering partially valid runtime state.

## 30. Implementation sequence

Urban Fabric 2.0 is implemented in six testable vertical slices:

1. **R1 — Cadastral Core**: geometry primitives, graph, validator, block/parcel generation, spatial lookup, temporary legacy-lot compatibility facade.
2. **R2 — Dimensional Zoning**: district catalog, overlay foundation, setbacks, FAR/coverage/height/frontage, buildable envelopes, compliance.
3. **R3 — Building Massing & Mixed Use**: building/entitlement types, typologies, finite massing candidates, floor allocation, aggregate metrics, legacy-building migration.
4. **R4 — Lifecycle**: condition, maintenance, vacancy/distress, renovation, adaptive reuse, demolition/project phases.
5. **R5 — Highest-and-Best-Use Redevelopment**: asset valuation, property market, candidate comparison, developer integration, displacement costs, explainable pressure.
6. **R6 — Split/Assembly + V8/Render/UI**: transactional subdivision/assembly, lineage/reference rewrites, V8 migration, overlays/inspector, full integration and fuzz coverage.

Each slice maintains only the compatibility needed by unmigrated consumers. Compatibility state is derived from parcels/buildings and is never authoritative.

## 31. Compatibility strategy

`LotSystem` becomes a transitional parcel-derived facade while runtime consumers migrate. Once all runtime callers consume parcel IDs/geometry, `LotSystem` remains only where required for old-save migration or is removed.

Legacy building definitions become typology seeds. New projects are not restricted to one fixed realized capacity per definition.

Legacy `ZoneType` may remain as a derived broad-use classification for UI/backward compatibility, but current development legality comes from the V2 district/overlay/compliance system.

## 32. Explicit non-goals

This pass does not require complete implementations of:

- condominium/vertical strata cadastre;
- air-rights markets;
- eminent-domain legal proceedings;
- detailed building-code inspection gameplay;
- individual elevators or MEP component simulation;
- continuous nonlinear massing optimization;
- full heritage-preservation gameplay;
- mortgage/title securitization;
- exact real-world survey/legal-description standards.

The architecture leaves room for these systems without making Urban Fabric 2.0 unbounded.

## 33. Acceptance criteria

Urban Fabric 2.0 is complete when:

1. Runtime development uses persistent cadastral parcels rather than one zoned cell equaling one lot.
2. Adjacent parcels share validated topology.
3. Deterministic parcel split/assembly mutations preserve invariants, lineage, area, and building references.
4. Zoning legality uses use permissions, FAR, setbacks, height, coverage, frontage/area, and overlays.
5. Developers evaluate physically valid candidate building masses.
6. Buildings can contain multiple uses and derive units/jobs/capacity from floor area.
7. Buildings age, accumulate maintenance backlog, become vacant/distressed, and can be renovated/adaptively reused.
8. Redevelopment compares hold, renovation, conversion, redevelopment, and assembly economics.
9. Assembly has real geometry, acquisition, and economic consequences.
10. Occupants are resolved before demolition.
11. V7 saves migrate deterministically to V8 with valid references.
12. Parcel, zoning-envelope, and redevelopment diagnostics are visible to the player.
13. Property/fuzz tests demonstrate topology validity and area conservation.
14. Existing developer-market behavior remains deterministic after migration.
15. Repository test, typecheck, build, and smoke gates pass before merge.

## 34. Final data flow

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

The result is a persistent urban land fabric in which geometry, zoning, ownership, building condition, transportation access, market demand, and developer economics jointly determine how the city evolves.