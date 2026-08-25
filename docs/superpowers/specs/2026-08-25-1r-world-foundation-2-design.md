# Civic Foundry 2.0 — Phase 1R World Foundation 2.0 Design

## Status

Approved architectural direction in chat on 2026-08-25.

This specification defines the first geographic replacement tranche under the approved Civic Foundry 2.0 master architecture. It replaces the current lightweight terrain foundation with a deterministic geographic simulation platform while preserving V7 gameplay, tests, saves and tile-oriented compatibility surfaces until downstream replacement phases take ownership.

This phase is intentionally scoped so that it does not prematurely implement Phase 2R parcel economics or Phase 3R lane-aware transportation. It establishes the physical and topological substrate those phases require.

## 1. Product Purpose

Phase 1R makes geography a real causal layer in Civic Foundry.

After 1R, the world should no longer be merely a rectangular field of cells with a coarse elevation flag. The authoritative world foundation must represent:

- hierarchical geography;
- irregular polygonal boundaries;
- terrain elevation and slope;
- soils, bedrock and groundwater;
- deterministic watersheds and drainage;
- flood susceptibility and event flood depth;
- surface water;
- contamination and vegetation;
- land-preparation cost;
- reusable geometric primitives;
- deterministic seeded world generation;
- scenario-authored geographic overrides;
- rebuildable spatial indexes;
- explicit compatibility with V7 tile-based systems.

The intended causal chain for this phase is:

`world seed / scenario data`
→ `terrain and geology`
→ `watersheds and drainage`
→ `surface water and flood behavior`
→ `buildability and preparation cost`
→ `infrastructure/development inputs`
→ later 2R/3R/8R systems.

## 2. Scope Boundaries

### 2.1 In scope

1R owns:

- physical world extent;
- reusable geometric primitives;
- administrative/spatial hierarchy through block level;
- terrain samples and derived terrain metrics;
- soils and geotechnical properties;
- groundwater baseline;
- deterministic drainage graph;
- watershed membership;
- runoff/infiltration mechanics;
- channelized surface-water representation sufficient for flooding;
- flood susceptibility and event flood depths;
- world generation configuration and deterministic generation pipeline;
- scenario overrides for generated physical geography;
- rebuildable spatial query indexes;
- V7-to-1R migration and tile-compatibility adapters.

### 2.2 Explicitly out of scope

Phase 1R does not take authoritative ownership of:

- true legal parcels, parcel economics, ownership, FAR, setbacks or split/merge behavior — Phase 2R;
- lane-level road geometry, turn movements, parking or dynamic routing — Phase 3R;
- advanced climate forcing, multi-year climate cycles, long-term pollution transport or ecological simulation — later environmental phases;
- insurance markets, disaster recovery finance or property damage accounting — later finance/disaster phases;
- visually complete 3D/height-aware terrain rendering — presentation work may consume elevation, but 1R acceptance is simulation-first;
- arbitrary road-authoritative curves replacing current V7 road cells — 3R;
- replacement of the existing lot system — 2R.

## 3. Migration Strategy

The implementation uses a compatibility-backed geographic substrate.

### 3.1 Authoritative target

`SimulationCore` gains an authoritative `world: WorldFoundation` object.

`WorldFoundation` owns the 1R physical/geographic state and exposes read APIs to consumers.

### 3.2 Compatibility facade

The existing `core.terrain: TerrainGrid` API remains available during 1R.

It becomes one of two modes:

1. a legacy explicitly-constructed `TerrainGrid` used by existing V7 tests and fixtures; or
2. a compatibility view derived from `WorldFoundation` for generated 1R worlds.

Existing systems that currently require only:

- `terrain.width`;
- `terrain.height`;
- `terrain.get(x, y)`;
- `terrain.isBuildable(x, y)`;

continue to work during 1R.

No existing consumer is required to understand the full world foundation until its own replacement tranche.

### 3.3 Reversibility

Until 1R passes all acceptance gates:

- old direct `TerrainGrid` construction remains valid;
- existing V7 save hydration remains supported;
- generated world state is introduced behind explicit versioned save boundaries;
- downstream systems remain able to operate against a neutral legacy-flat geography.

## 4. WorldFoundation Architecture

The target structure is:

```text
WorldFoundation
├── GeometryModel
├── GeographyHierarchy
├── TerrainField
├── SoilField
├── HydrologyModel
├── FloodModel
├── WorldGenerator
├── ScenarioWorldDefinition
├── SpatialIndex
└── LegacyTerrainAdapter
```

Each component has one clear owner and a narrow interface.

### 4.1 WorldFoundation

Responsibilities:

- owns world extent and seed metadata;
- owns authoritative references to geography, terrain, soils and hydrology;
- exposes deterministic sample/query APIs;
- coordinates initial generation only;
- does not run ordinary simulation ticks unless a registered world-domain system requires it;
- produces a serializable authoritative snapshot;
- exposes rebuild hooks for derived indexes.

It must not become a giant coordinator for unrelated domains.

## 5. Geometry Model

### 5.1 Primitives

Add immutable geometry primitives:

```ts
Point2
Segment2
Polyline2
Polygon2
BoundingBox2
```

Coordinates use deterministic world-space numeric units. For Phase 1R, one existing tile maps to one world-space planning unit unless a scenario explicitly specifies another scale factor.

### 5.2 Polygon invariants

A valid authoritative polygon must:

- contain at least three unique vertices;
- have finite coordinates;
- have non-zero signed area;
- use one canonical winding convention;
- not repeat its terminal vertex in storage;
- pass deterministic self-intersection validation for authoritative administrative boundaries.

### 5.3 Core operations

Required deterministic operations:

- polygon signed/absolute area;
- perimeter;
- centroid;
- bounding box;
- point-on-segment;
- point-in-polygon;
- segment intersection;
- polyline length;
- nearest point on segment/polyline;
- polygon/bounding-box intersection test;
- deterministic boundary subdivision support;
- frontage overlap calculation.

Complex general-purpose computational geometry should not be added unless required by 1R. Polygon clipping sufficient for hierarchy generation/scenario validation is allowed, but a full GIS engine is not required.

### 5.4 Numeric policy

Geometry calculations use explicit tolerances defined in one place.

No module may invent its own epsilon constants.

Topology-changing commands in later phases must snap/normalize results through shared geometry utilities.

## 6. Hierarchical Geography

### 6.1 Authoritative hierarchy

The spatial hierarchy is:

```text
Region
  Municipality
    District
      Neighborhood
        Block
          ParcelRef
            BuildingRef
              OccupancyRef
```

Phase 1R owns authoritative entities from Region through Block.

`ParcelRef`, `BuildingRef` and `OccupancyRef` are compatibility/reference hooks only until 2R and later phases own their full models.

### 6.2 Stable IDs

Every geographic entity has:

- stable typed ID;
- entity kind;
- parent ID, except root region;
- polygon boundary;
- optional display name;
- deterministic sort key;
- metadata needed for migration/scenario identification.

IDs must not depend on array position.

Generated IDs derive from stable generation order and parent identity, not floating-point hashes.

### 6.3 Hierarchy invariants

- exactly one Region root;
- every non-root entity has exactly one valid parent;
- child type must be the immediate permitted type below its parent;
- child boundary must lie within or on the parent boundary within geometry tolerance;
- sibling boundaries may share edges but may not materially overlap;
- hierarchy traversal order is stable;
- no cycles;
- deleted/replaced geography cannot leave orphan references.

### 6.4 Boundary editing

1R establishes the topology model but does not require a full player-facing boundary editor.

Any future edit must occur through typed topology-changing commands. Direct mutation of polygon arrays is prohibited.

## 7. TerrainField

### 7.1 Terrain sample

Each authoritative terrain sample stores or exposes:

```ts
type TerrainSample = Readonly<{
  elevationMeters: number;
  slope: number;
  aspectRadians: number;
  soilClass: SoilClass;
  soilDepthMeters: number;
  bearingCapacityKpa: number;
  bedrockDepthMeters: number;
  groundwaterDepthMeters: number;
  vegetationClass: VegetationClass;
  watershedId: WatershedId;
  flowAccumulation: number;
  floodSusceptibility: number;
  contaminationIndex: number;
  landPreparationMultiplier: number;
  surfaceWater: SurfaceWaterClass;
}>;
```

Values may be stored in normalized arrays internally where appropriate, but public APIs expose domain units or named normalized indices.

### 7.2 Derived fields

The following should be derived rather than independently authored where practical:

- slope from neighboring elevations;
- aspect from elevation gradient;
- buildability from water, slope, soil/geotechnical thresholds and explicit restrictions;
- land-preparation multiplier from slope, soil, bedrock, groundwater, contamination and flood mitigation burden;
- legacy biome from vegetation/surface-water state;
- legacy `water` flag from surface-water classification;
- flood susceptibility from terrain/hydrology relationships.

### 7.3 Buildability

`isBuildable` remains a compatibility predicate, but 1R introduces richer reasons.

A sample may be unbuildable because of:

- permanent water;
- extreme slope;
- invalid/unstable terrain;
- scenario hard restriction.

Poor soil, shallow groundwater, contamination and moderate flood exposure should normally increase cost rather than automatically forbid construction. This preserves more interesting planning trade-offs.

## 8. Soil and Geotechnical Model

### 8.1 Soil classes

Phase 1R ships the following authoritative `SoilClass` values:

- `rock`;
- `gravel`;
- `sand`;
- `loam`;
- `clay`;
- `alluvium`;
- `peat`;
- `fill_disturbed`.

Each class maps to explicit engineering properties. Adding new soil classes after 1R requires a save-compatible enum migration rather than silently changing generated classification.

### 8.2 Properties

Each class supplies baseline ranges for:

- infiltration rate;
- bearing capacity;
- erodibility;
- typical soil depth;
- groundwater interaction;
- construction preparation cost.

Generated samples may vary deterministically around class baselines.

### 8.3 Contamination

1R stores contamination as a normalized physical planning input.

Generated untouched worlds default to zero contamination. Contamination appears only through explicit scenario-authored disturbed/industrial legacy areas in Phase 1R.

No health/damage simulation is required in this phase.

## 9. World Generation Pipeline

### 9.1 Deterministic generation stages

The canonical order is:

```text
seed + generation config
↓
world extent / root boundary
↓
macro elevation field
↓
ridges, valleys and local relief
↓
depression resolution / drainage conditioning
↓
slope + aspect
↓
soil / bedrock / groundwater
↓
flow direction + accumulation
↓
watersheds
↓
channels / rivers / lakes
↓
flood susceptibility baseline
↓
vegetation
↓
administrative boundary generation
↓
spatial-index rebuild
↓
legacy terrain compatibility view
```

### 9.2 Randomness isolation

Generation uses named deterministic random streams derived from the master seed:

- `world.topography`;
- `world.soils`;
- `world.groundwater`;
- `world.vegetation`;
- `world.boundaries`.

Hydrology derived from elevation does not consume arbitrary random draws.

Changing vegetation implementation must not alter generated elevation, soils or watersheds for the same seed/configuration.

### 9.3 Topography generation

Use an in-house deterministic multi-scale continuous-noise implementation rather than a heavyweight dependency.

The generator combines:

- low-frequency macro shape;
- medium-frequency ridge/valley structure;
- bounded high-frequency local relief;
- configurable world-form modifiers.

Phase 1R ships exactly six world-form presets:

- `plain`;
- `river_valley`;
- `basin`;
- `rolling_uplands`;
- `ridge_edge`;
- `coastal_lowland`.

Presets alter generation parameters rather than invoke separate unrelated algorithms.

### 9.4 Generation quality requirements

Generated maps must avoid common procedural failures:

- checkerboard terrain;
- single-noise static appearance;
- isolated one-cell lakes created only by noise thresholds;
- hydrology flowing uphill;
- rivers disconnected from drainage accumulation;
- administrative boundaries consisting only of axis-aligned rectangles;
- worlds dominated by fully unbuildable terrain under normal presets.

## 10. Hydrology Model

### 10.1 Drainage graph

Phase 1R uses deterministic D8 flow routing over conditioned elevation.

For each routable sample, the receiver is the valid neighboring sample with the steepest descending gradient. Equal-gradient ties resolve by one fixed clockwise neighbor precedence defined in `DrainageGraph` tests and documentation.

The drainage graph must preserve:

- deterministic downhill routing;
- explicit outlets;
- stable flow accumulation;
- depression handling;
- watershed assignment.

### 10.2 Depression handling

Raw noise commonly creates artificial sinks.

Phase 1R uses a deterministic priority-flood depression-conditioning pass so that ordinary drainage has a valid path to a sink/outlet unless a depression is explicitly retained as a scenario-authored lake/basin.

Conditioning preserves the source elevation separately from conditioned routing elevation.

### 10.3 Watersheds

Every non-permanent-water terrain sample belongs to a valid watershed/catchment.

Each watershed records:

- ID;
- outlet;
- member area/sample count;
- upstream runoff area;
- associated primary channel if present.

### 10.4 Surface channels

Channels emerge from flow accumulation thresholds and terrain context.

They are not arbitrary decorative lines.

A channel stores enough geometry/capacity information for flood routing and later infrastructure interactions.

## 11. Runoff and Flooding

### 11.1 Event inputs

Phase 1R supports deterministic design-storm events characterized by:

- rainfall depth or rainfall rate profile;
- event duration;
- optional scenario identifier.

Advanced stochastic weather arrives later.

### 11.2 Water balance

For every flood event, model accounting must satisfy within tolerance:

```text
rainfall input
=
infiltration
+ retained channel/surface storage
+ overbank flood storage
+ exported/outlet flow
```

Evaporation is excluded from short Phase 1R design-storm events and therefore from the water-balance equation.

### 11.3 Infiltration

Infiltration depends on:

- soil class/property;
- saturation state or simple event saturation factor;
- surface-water state;
- future imperviousness input when urban fabric is integrated.

During 1R, undeveloped worlds use physical soil infiltration. The API must allow later 2R development to provide imperviousness without rewriting hydrology ownership.

### 11.4 Routing

Runoff moves through the drainage graph toward channels/outlets.

Channel capacity exceedance contributes to local overbank flood storage/depth.

Flood depth must be nonnegative and finite.

### 11.5 Static susceptibility vs event depth

Expose two distinct concepts:

- `floodSusceptibility`: persistent planning risk derived from terrain and drainage context;
- `floodDepth(event)`: actual event result for a specific design storm.

Consumers must not treat susceptibility as literal water depth.

## 12. Spatial Index

### 12.1 Role

The spatial index is derived and rebuildable.

It never owns geographic truth.

### 12.2 Required queries

1R must support:

- point-in-geographic-entity;
- bounding-box polygon candidates;
- nearby point/facility candidates through generic indexed points;
- terrain/flood sampling at world position;
- neighborhood/district membership;
- later parcel/frontage hooks;
- channel proximity;
- world-cell compatibility lookup.

### 12.3 Determinism

Query result ordering must be stable regardless of internal map/set iteration order.

If multiple entities contain a boundary point within tolerance, deterministic precedence rules apply.

## 13. Scenario Overrides

### 13.1 ScenarioWorldDefinition

A scenario may override generated state with authored geographic data.

Supported override categories:

- world extent/root polygon;
- elevation samples or control points;
- permanent water bodies;
- soil regions;
- groundwater regions;
- contamination regions;
- administrative boundaries;
- generation preset/configuration values.

### 13.2 Precedence

Canonical precedence:

```text
base defaults
< world-generation preset
< seed-derived generated state
< scenario-authored overrides
```

Overrides are validated after application.

A scenario may not silently produce invalid hierarchy or geometry.

## 14. V7 Compatibility and Migration

### 14.1 Legacy-flat world profile

Hydrating a V7 save that lacks 1R world state creates a deterministic compatibility `WorldFoundation` from the existing terrain.

Migration rules:

- retain width/height;
- preserve old elevation values in a documented legacy scale conversion;
- preserve old water flags;
- preserve old buildability behavior exactly through the compatibility adapter;
- assign neutral/default soil engineering properties;
- assign stable/default bedrock depth;
- assign neutral groundwater depth;
- assign zero contamination;
- assign neutral land-preparation multiplier `1.0` for all legacy buildable cells;
- infer permanent surface water from old `water` cells;
- create drainage/hydrology state without changing existing placement legality;
- generate one root Region and one Municipality covering the map;
- generate deterministic default District/Neighborhood/Block hierarchy sufficient for valid membership;
- preserve all roads, zoning, lots, facilities and buildings unchanged.

### 14.2 Exact V7 road-cost preservation

Existing V7 road tests expect exact `constructionCostPerCell * newCellCount` behavior.

For migrated legacy-flat terrain, terrain preparation multiplier must evaluate to `1.0` so those costs remain identical.

New 1R-generated worlds apply terrain cost multipliers through a new construction-cost query without changing the legacy fixture contract.

### 14.3 Existing direct TerrainGrid fixtures

Tests and callers may continue constructing:

```ts
new TerrainGrid(width, height, cells)
```

Such terrain is treated as legacy-explicit mode.

The 1R implementation may provide conversion utilities, but direct construction cannot silently start applying new slope/soil/flood penalties.

## 15. Integration with Existing Systems

### 15.1 RoadSystem

During 1R:

- legality continues through `terrain.isBuildable` for compatibility;
- generated worlds query a world preparation-cost multiplier when computing new-world road costs;
- the road remains cell-authoritative;
- no curved authoritative road geometry is introduced yet.

### 15.2 ZoningSystem

Zoning remains cell-oriented in 1R.

It gains no authority over geography.

Environmental/flood zoning overlays belong to later policy/zoning work unless a minimal restriction hook is required for scenario hard restrictions.

### 15.3 LotSystem

The current one-cell lot system remains intact.

1R exposes geometry/frontage helpers only as read infrastructure and does not replace lot authority or split/merge behavior.

### 15.4 Development economics

Terrain contributes to the existing development `constructionCostIndex` for 1R-generated worlds.

The Phase 1R integration is multiplicative and bounded:

```text
existing utility/service construction-cost index
× terrain preparation multiplier
```

The combined value is clamped at the existing development-system safety bounds unless the implementation plan explicitly narrows those bounds through tests.

Legacy-flat worlds remain at terrain factor `1.0`.

### 15.5 Renderer

The renderer continues to derive world dimensions from the terrain compatibility surface during 1R.

Presentation may consume elevation, water classes and flood overlays, but rendering cannot become authoritative.

## 16. Save Format

### 16.1 Save V8

Phase 1R introduces `SaveV8` with:

- `saveVersion: 8`;
- `gameVersion: '0.8.0-world-foundation'`.

`serializeCore` becomes V8-primary after the tranche reaches its save-integration step. `hydrateCore` accepts V8 and continues routing older saves through existing V3–V7 migration layers before constructing the 1R compatibility world.

Save V8 owns:

- generation seed/config metadata;
- authoritative geographic hierarchy;
- terrain/geotechnical authoritative arrays or compact deterministic representation;
- permanent surface-water/channel state;
- any flood-event state that is authoritative and active at save time;
- scenario override identity/data required to reconstruct the same world.

### 16.2 Derived data not serialized unless required

Prefer rebuilding:

- spatial indexes;
- slope/aspect if exactly reconstructable;
- bounding boxes;
- hierarchy lookup maps;
- query acceleration structures;
- cached susceptibility visualizations.

### 16.3 Migration

V7 and earlier saves continue hydrating through existing migration layers, then receive deterministic 1R legacy-flat world state.

No fabricated historical flood series are created.

## 17. Commands and Events

1R generation itself occurs at world creation, not through arbitrary tick mutation.

Phase 1R defines these typed domain events:

- `WorldGenerated`;
- `WorldMigratedTo1R`;
- `FloodEventStarted`;
- `FloodEventResolved`.

Future boundary editing commands are reserved but their topology model must be compatible with:

- `CreateDistrictBoundaryCommand`;
- `AdjustAdministrativeBoundaryCommand`.

No player boundary UI is required now.

## 18. Error Handling and Validation

Generation and hydration fail fast on authoritative corruption.

Reject:

- non-finite terrain/geometric values;
- invalid dimensions;
- invalid polygon topology;
- hierarchy cycles/orphans;
- missing watershed/outlet references;
- negative physical capacities where prohibited;
- invalid soil enum/properties;
- malformed scenario overrides;
- flood state with non-finite or negative depth;
- inconsistent serialized array lengths.

Gameplay commands encountering expensive terrain should return explicit reason/cost metadata rather than throwing for normal player decisions.

## 19. Performance Design

### 19.1 Data-oriented fields

Large regular physical fields should prefer compact arrays over one object allocation per sample when that materially improves performance.

Public APIs may return immutable value objects while internal storage remains data-oriented.

### 19.2 Generation budget

Generation is allowed to be more expensive than an ordinary tick, but must remain bounded for normal world sizes.

No unbounded iterative erosion simulation is required in 1R.

### 19.3 Spatial query gate

A benchmark fixture must exercise at least 10,000 parcel-equivalent or point-in-area spatial queries and remain within the repository's agreed performance budget.

The benchmark must report hardware/runtime context or use a relative/regression budget suitable for CI.

### 19.4 Tick cost

Static terrain/hierarchy should not consume per-tick work.

Hydrology runs only when a rainfall/flood event is active or when explicitly recomputed after an authoritative physical change.

## 20. Testing Strategy

Implementation follows TDD.

### 20.1 Geometry tests

Test:

- area/perimeter/centroid;
- winding normalization;
- point containment including boundaries;
- segment intersection;
- deterministic subdivision;
- invalid self-intersection rejection;
- tolerance behavior.

### 20.2 Geography hierarchy tests

Test:

- valid parent chain;
- cycle/orphan rejection;
- child containment;
- sibling overlap rejection;
- deterministic traversal/order;
- stable generated IDs.

### 20.3 Terrain-generation tests

Test:

- same seed/config byte-equivalent snapshot;
- different seeds materially differ;
- finite values;
- slope/aspect consistency;
- reasonable buildable fraction across reference seeds;
- named RNG isolation;
- all six world-form presets produce valid worlds.

### 20.4 Soil/geotechnical tests

Test:

- property ranges by every Phase 1R soil class;
- deterministic generation;
- preparation multiplier directionality;
- poor soil/shallow groundwater increase cost;
- legacy-flat remains neutral.

### 20.5 Hydrology tests

Test:

- no D8 routed edge climbs above conditioned source elevation beyond tolerance;
- every routable sample reaches an outlet/lake/channel sink;
- accumulation is conserved;
- watershed membership complete;
- deterministic clockwise tie-breaking;
- priority-flood conditioning stable.

### 20.6 Flood tests

Test:

- zero rainfall yields zero event flood depth;
- more rainfall does not reduce total runoff under identical initial conditions;
- low-infiltration soil produces directionally more runoff than high-infiltration soil;
- flood depth nonnegative;
- water balance closes within tolerance;
- same event/seed/state produces identical result.

### 20.7 Compatibility tests

Retain and extend:

- `core-foundation.test.ts` terrain determinism;
- direct `TerrainGrid` fixture construction;
- exact V7 road placement cost;
- zoning behavior;
- lot frontage behavior;
- save V3–V7 migration suites;
- new Save V8 serialization/hydration/migration tests;
- isometric renderer compatibility tests;
- kernel deterministic regression/parity tests.

### 20.8 Integration tests

Add a headless 1R fixture that:

1. generates a world;
2. validates hierarchy;
3. places road/zoning/utility content through existing APIs;
4. runs simulation ticks;
5. executes a design storm;
6. saves as V8;
7. reloads;
8. verifies byte-equivalent authoritative 1R state and unchanged downstream invariants.

## 21. Acceptance Gates

Phase 1R is complete only when all gates pass.

### Determinism

- same seed + config produces byte-equivalent geography;
- named generation streams are isolated;
- same flood event/state produces identical flood output;
- Save V8 load retains authoritative geographic state exactly.

### Geography

- hierarchy validates with no cycles/orphans/multiple parents;
- generated boundaries are polygonal and deterministic;
- child boundaries respect parent boundaries;
- 10k+ spatial queries meet budget.

### Terrain

- all terrain/geotechnical values are finite and in valid ranges;
- generated normal presets retain a useful buildable fraction;
- slope/soil/groundwater/flood factors affect preparation cost directionally.

### Hydrology

- conditioned D8 drainage does not route uphill beyond tolerance;
- watershed coverage is complete;
- event water balance closes within defined numerical tolerance;
- flood depth is finite, deterministic and nonnegative.

### Compatibility

- existing V7 deterministic regression suite remains green;
- direct `TerrainGrid` test fixtures remain valid;
- existing V7 road costs remain exact on legacy-flat terrain;
- existing V7 maps/saves migrate with no loss of placed gameplay state;
- renderer and selection remain functional.

### Architecture

- `SimulationCore` does not absorb 1R implementation details;
- `WorldFoundation` does not own downstream urban/transport domains;
- geometry, geography, terrain and hydrology remain independently testable;
- no source module becomes a new giant coordinator;
- derived spatial indexes can be discarded/rebuilt without changing authoritative results.

## 22. Proposed Module Layout

Expected files include:

```text
src/world/foundation/
  WorldFoundation.ts
  WorldFoundationTypes.ts

src/world/geometry/
  GeometryTypes.ts
  GeometryTolerance.ts
  PolygonMath.ts
  SegmentMath.ts
  GeometryIndex.ts

src/world/geography/
  GeographyTypes.ts
  GeographyHierarchy.ts
  AdministrativeBoundaryGenerator.ts

src/world/terrain/
  TerrainField.ts
  TerrainTypes.ts
  TerrainGenerator.ts
  SoilModel.ts
  LegacyTerrainAdapter.ts
  TerrainGrid.ts            # retained compatibility API

src/world/hydrology/
  HydrologyTypes.ts
  DepressionResolver.ts
  DrainageGraph.ts
  WatershedModel.ts
  HydrologyModel.ts
  FloodModel.ts

src/world/generation/
  WorldGenerationConfig.ts
  WorldGenerator.ts
  ScenarioWorldDefinition.ts

src/world/migration/
  V7WorldMigration.ts

src/save/
  saveV8.ts
```

Exact file boundaries may be adjusted during planning to keep responsibilities focused and files under normal repository size targets.

## 23. Implementation Order Constraint

The implementation plan must sequence work so that each layer becomes independently testable:

1. geometry primitives and invariants;
2. hierarchy types/validation;
3. physical terrain storage;
4. deterministic terrain generator;
5. soil/geotechnical model;
6. priority-flood depression conditioning and D8 routing;
7. watersheds/channels;
8. flood event model and water accounting;
9. `WorldFoundation` composition;
10. legacy terrain adapter and `SimulationCore` integration;
11. Save V8 and migration;
12. spatial index;
13. development/road terrain-cost hooks;
14. presentation/diagnostic hooks if needed;
15. full compatibility/performance acceptance.

At every stage, V7 compatibility tests remain green or the work stops for correction.

## 24. Design Decisions Locked by This Spec

The following are deliberate decisions rather than placeholders:

- 1R uses a compatibility-backed replacement, not an in-place expansion of `TerrainGrid` and not an immediate all-geometry rewrite.
- `WorldFoundation` is authoritative for physical geography.
- existing tile roads/lots remain authoritative until 3R/2R respectively.
- irregular geometry is introduced now as reusable infrastructure and geographic boundary authority.
- Phase 1R uses the eight locked soil classes defined in section 8.
- Phase 1R ships the six locked world-form presets defined in section 9.
- generated hydrology uses priority-flood conditioning plus deterministic D8 routing.
- flooding has both static susceptibility and event depth.
- V7 migrations use a neutral legacy-flat preparation-cost profile.
- poor but usable terrain primarily changes cost rather than becoming categorically unbuildable.
- Save V8 is the authoritative 1R save envelope.
- advanced weather/climate and full environmental simulation remain later phases.
- spatial indexes are derived and rebuildable.
- generated randomness is domain/namespaced so implementation changes in one generation layer do not perturb unrelated layers.

## 25. Success Condition

When Phase 1R ships, Civic Foundry should have a world foundation that downstream systems can treat as real geography rather than decorative terrain.

A river valley should arise from elevation and drainage. Flood-prone land should be flood-prone for physical reasons. Difficult ground should cost more to develop. District and neighborhood membership should come from stable polygonal geography. The same seed should always reproduce the same world. Existing V7 cities should continue to function through a deliberate compatibility representation until later 2R and 3R tranches replace their own simplified assumptions.
