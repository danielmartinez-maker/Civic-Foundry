# Civic Foundry 2.0 — Phase 1R World Foundation 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's lightweight generated `TerrainGrid` with a deterministic geographic foundation containing real hierarchy, irregular geometry, terrain/geotechnical state, priority-flood-conditioned D8 hydrology, design-storm flooding, spatial queries, and Save V8 persistence while preserving V7 tile gameplay through compatibility adapters.

**Architecture:** Add a `WorldFoundation` aggregate that composes four clear owners: physical `TerrainField`, derived `HydrologyModel`, `GeographyHierarchy`, and rebuildable `GeometryIndex`. Generated games create this aggregate before existing V7 domains and expose a materialized legacy `TerrainGrid` compatibility surface; direct terrain fixtures and migrated V7 saves create neutral legacy modes. Save V8 restores the correct `WorldFoundation` before `SimulationCore` constructs terrain-dependent systems, so no authoritative world replacement occurs after roads/zoning/utilities/transit already hold terrain references.

**Tech Stack:** TypeScript 5.x ES modules; Node 22 built-in test runner with `--experimental-strip-types`; strict `tsc`; browser-native Canvas 2D; existing `SeededRandom` / `RandomStreamRegistry`; no runtime npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-1r-world-foundation-2-design.md`

## Global Constraints

- Target branch: `feat/1r-world-foundation-2`.
- `WorldFoundation` is authoritative for Phase 1R physical geography composition.
- `TerrainField` owns physical terrain/geotechnical state; `HydrologyModel` owns conditioned drainage, flow accumulation, watershed membership, channels and flood susceptibility.
- `WorldFoundation.terrainSampleAt()` is the combined public terrain+hydrology sample API; neither owner duplicates the other's authoritative fields.
- Existing cell roads remain authoritative until Phase 3R; existing one-cell lots remain authoritative until Phase 2R.
- Direct `new TerrainGrid(width, height, cells)` behavior remains valid and neutral; it must not silently gain soil/slope/flood cost penalties.
- Migrated V7 and earlier saves use a neutral legacy-flat terrain preparation multiplier of exactly `1.0` for buildable cells.
- Existing V7 road cost behavior remains exact on legacy-flat/direct-terrain worlds.
- Phase 1R introduces Save V8: `saveVersion: 8`, `gameVersion: '0.8.0-world-foundation'`.
- Save V3–V7 hydration remains supported through the existing migration chain.
- Phase 1R ships exactly eight soil classes: `rock`, `gravel`, `sand`, `loam`, `clay`, `alluvium`, `peat`, `fill_disturbed`.
- Phase 1R ships exactly six world-form presets: `plain`, `river_valley`, `basin`, `rolling_uplands`, `ridge_edge`, `coastal_lowland`.
- Generated hydrology uses deterministic priority-flood depression conditioning plus deterministic D8 routing with one fixed clockwise tie-break order.
- Flood susceptibility and event flood depth are distinct APIs.
- Generated randomness is isolated across `world.topography`, `world.soils`, `world.groundwater`, `world.vegetation`, and `world.boundaries`.
- Hydrology derived from generated elevation consumes no arbitrary RNG draws.
- Static geography performs no ordinary per-tick work; flood work runs only for explicit flood events.
- `WorldFoundation.lastFloodResult` is the only Phase 1R persisted flood-event state; no fabricated flood history is created.
- No full GIS dependency, geometry library, noise dependency, or runtime npm dependency may be added.
- No Phase 2R parcel ownership/zoning-envelope/split-merge behavior and no Phase 3R lane/curve road authority may be pulled into this tranche.
- Existing renderer world sizing, terrain art selection and cell picking remain driven by `core.terrain`; no renderer authority changes in 1R.
- Source-file target is under 500 LOC; split responsibilities before a new source file approaches 750 LOC.
- Every material behavior change follows red-green-refactor TDD and ends its task with a focused commit.
- After every integration task, existing V7 compatibility tests must remain green; regressions stop forward implementation until corrected.

---

## File Structure

### New geometry

- `src/world/geometry/GeometryTypes.ts` — point/segment/polyline/polygon/bounds types.
- `src/world/geometry/GeometryTolerance.ts` — one shared epsilon.
- `src/world/geometry/SegmentMath.ts` — segment/nearest/polyline operations.
- `src/world/geometry/PolygonMath.ts` — validation, winding, area, centroid, containment, bounds and frontage overlap.
- `src/world/geometry/GeometryIndex.ts` — derived deterministic spatial buckets.
- `tests/world-geometry.test.ts`
- `tests/world-spatial-index.test.ts`

### New geography

- `src/world/geography/GeographyTypes.ts` — hierarchy contracts and stable IDs.
- `src/world/geography/GeographyHierarchy.ts` — authoritative hierarchy validation/query/snapshot.
- `src/world/geography/AdministrativeBoundaryGenerator.ts` — deterministic irregular subdivisions.
- `tests/world-geography.test.ts`

### New physical terrain

- `src/world/terrain/TerrainTypes.ts` — physical and combined sample types, locked enums and snapshots.
- `src/world/terrain/SoilModel.ts` — engineering properties and preparation multiplier.
- `src/world/terrain/TerrainField.ts` — compact physical arrays and buildability.
- `src/world/terrain/TerrainGenerator.ts` — deterministic topography/soil/groundwater/vegetation generation.
- `src/world/terrain/LegacyTerrainAdapter.ts` — legacy compatibility state and conversion.
- Modify: `src/world/terrain/TerrainGrid.ts` only to support safe factory construction from already-derived compatibility cells; direct constructor semantics remain unchanged.
- `tests/world-terrain.test.ts`
- `tests/world-generation.test.ts`

### New hydrology/flooding

- `src/world/hydrology/HydrologyTypes.ts` — drainage, watershed, channel, storm and flood contracts.
- `src/world/hydrology/DepressionResolver.ts` — priority flood.
- `src/world/hydrology/DrainageGraph.ts` — D8 receivers and stable flat/tie resolution.
- `src/world/hydrology/WatershedModel.ts` — accumulation, outlets, watersheds and channels.
- `src/world/hydrology/HydrologyModel.ts` — derived hydrology owner and susceptibility.
- `src/world/hydrology/FloodModel.ts` — event runoff/infiltration/routing/accounting.
- `tests/world-hydrology.test.ts`
- `tests/world-flooding.test.ts`

### New world composition/generation

- `src/world/generation/WorldGenerationConfig.ts` — six presets/config validation.
- `src/world/generation/ScenarioWorldDefinition.ts` — authored overrides.
- `src/world/generation/WorldGenerator.ts` — ordered pipeline.
- `src/world/foundation/WorldFoundationTypes.ts` — mode/snapshot/combined sample contracts.
- `src/world/foundation/WorldFoundation.ts` — authoritative composition and combined query facade.
- `src/world/migration/V7WorldMigration.ts` — neutral legacy-flat conversion helpers.
- `tests/world-foundation-integration.test.ts`

### Save/runtime integration

- Modify: `src/simulation/core/SimulationCore.ts`.
- Modify: `src/world/roads/RoadSystem.ts`.
- Modify: `src/save/saveLegacy.ts`.
- Modify: `src/save/saveV5.ts`.
- Modify: `src/save/saveV6.ts`.
- Modify: `src/save/saveV7.ts`.
- Create: `src/save/saveV8.ts`.
- Modify: `src/save/save.ts`.
- Modify: `tests/save-v7.test.ts`.
- Create: `tests/save-v8.test.ts`.
- Create: `tests/world-cost-integration.test.ts`.

### Acceptance/docs

- Create: `tests/world-performance.test.ts`.
- Create: `tests/world-presentation-contract.test.ts`.
- Create: `tests/phase1r-headless.test.ts`.
- Modify: `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `README.md`, `docs/DEVELOPMENT_LOG.md`.

---

### Task 1: Geometry Primitives and Polygon Invariants

**Files:** create `GeometryTypes.ts`, `GeometryTolerance.ts`, `SegmentMath.ts`, `PolygonMath.ts`, `tests/world-geometry.test.ts`.

**Interfaces:**

```ts
export type Point2 = Readonly<{ x: number; y: number }>;
export type Segment2 = Readonly<{ a: Point2; b: Point2 }>;
export type Polyline2 = Readonly<{ points: readonly Point2[] }>;
export type Polygon2 = Readonly<{ points: readonly Point2[] }>;
export type BoundingBox2 = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
export const GEOMETRY_EPSILON = 1e-9;
export function normalizePolygon(points: readonly Point2[]): Polygon2;
export function polygonSignedArea(polygon: Polygon2): number;
export function polygonArea(polygon: Polygon2): number;
export function polygonPerimeter(polygon: Polygon2): number;
export function polygonCentroid(polygon: Polygon2): Point2;
export function polygonBounds(polygon: Polygon2): BoundingBox2;
export function pointInPolygon(point: Point2, polygon: Polygon2, includeBoundary?: boolean): boolean;
export function pointOnSegment(point: Point2, segment: Segment2): boolean;
export function segmentsIntersect(a: Segment2, b: Segment2): boolean;
export function nearestPointOnSegment(point: Point2, segment: Segment2): Point2;
export function polylineLength(line: Polyline2): number;
export function polygonIntersectsBounds(polygon: Polygon2, bounds: BoundingBox2): boolean;
export function frontageOverlapLength(parcel: Polygon2, frontage: Polyline2): number;
```

- [ ] Write tests using an inline 4×3 rectangle. Assert area `12`, centroid `{x:2,y:1.5}`, perimeter `14`, boundary inclusion, exterior rejection, endpoint/crossing segment intersections, nearest point, polyline length, overlap length, duplicate terminal normalization, clockwise reversal, non-finite rejection, zero-area rejection and bow-tie self-intersection rejection.
- [ ] Run `node --experimental-strip-types --test tests/world-geometry.test.ts`; expect module-not-found red state.
- [ ] Implement types/tolerance and cross-product segment math. `normalizePolygon()` removes one repeated terminal point, validates finite unique vertices, rejects self-intersections, then canonicalizes to counter-clockwise winding.
- [ ] Implement shoelace area/centroid/perimeter, ray-cast containment with explicit boundary handling, bounds and frontage intersection accumulation. All tolerance checks import `GEOMETRY_EPSILON`; no local epsilon constants.
- [ ] Run `node --experimental-strip-types --test tests/world-geometry.test.ts && npm run typecheck && npm run lint`; expect zero exits.
- [ ] Commit: `git add src/world/geometry/GeometryTypes.ts src/world/geometry/GeometryTolerance.ts src/world/geometry/SegmentMath.ts src/world/geometry/PolygonMath.ts tests/world-geometry.test.ts && git commit -m "feat: add deterministic world geometry primitives"`.

---

### Task 2: Geography Hierarchy and Deterministic Irregular Subdivision

**Files:** create `GeographyTypes.ts`, `GeographyHierarchy.ts`, `AdministrativeBoundaryGenerator.ts`, `tests/world-geography.test.ts`.

**Interfaces:**

```ts
export type GeographyKind = 'region' | 'municipality' | 'district' | 'neighborhood' | 'block';
export type GeographyId = string;
export type GeographyEntity = Readonly<{
  id: GeographyId;
  kind: GeographyKind;
  parentId: GeographyId | null;
  boundary: Polygon2;
  name?: string;
  sortKey: string;
}>;
export type GeographySnapshot = Readonly<{ entities: readonly GeographyEntity[] }>;

export class GeographyHierarchy {
  constructor(entities: readonly GeographyEntity[]);
  get(id: GeographyId): GeographyEntity | undefined;
  list(kind?: GeographyKind): readonly GeographyEntity[];
  childrenOf(id: GeographyId): readonly GeographyEntity[];
  parentOf(id: GeographyId): GeographyEntity | undefined;
  entityAt(point: Point2, kind?: GeographyKind): GeographyEntity | undefined;
  snapshot(): GeographySnapshot;
  static restore(snapshot: GeographySnapshot): GeographyHierarchy;
}

export function generateAdministrativeHierarchy(root: Polygon2, rng: SeededRandom): readonly GeographyEntity[];
```

**Test fixture:** define the root inline as `normalizePolygon([{x:0,y:0},{x:20,y:0},{x:20,y:12},{x:0,y:12}])`. Hand-authored validation fixture uses `region:0` → `municipality:region:0:000` → one district → one neighborhood → two non-overlapping blocks; each child polygon is written inline in the test.

- [ ] Write tests for exactly one Region root, immediate parent-kind enforcement, orphan/cycle rejection, child containment, sibling material-overlap rejection, stable traversal, deepest `entityAt()` result, snapshot/restore equality, generated ID stability and same-seed generated-boundary equality.
- [ ] Add generated-quality assertion that at least one district/neighborhood/block vertex is non-integer for seed `77`, proving boundaries are not all axis-aligned rectangles.
- [ ] Run the test and verify red state.
- [ ] Implement `PARENT_KIND = {municipality:'region',district:'municipality',neighborhood:'district',block:'neighborhood'}` and depth ordering. Boundary-point ties resolve deepest kind, then lexicographic ID.
- [ ] Implement recursive half-plane polygon splits through centroid with angle/offset jitter from the supplied RNG. Bound attempts at 8; on failure use deterministic unjittered centroid split. Generated structure is one Region + one Municipality covering root, 2–4 Districts, 2–4 Neighborhoods per District, 2–6 Blocks per Neighborhood. IDs are `${kind}:${parentId}:${ordinal.padStart(3,'0')}`.
- [ ] Run geography + geometry + typecheck; expect green.
- [ ] Commit `feat: add hierarchical geographic boundaries`.

---

### Task 3: Physical Terrain Types, Locked Soil Model, and TerrainField

**Files:** create `TerrainTypes.ts`, `SoilModel.ts`, `TerrainField.ts`, `tests/world-terrain.test.ts`.

**Ownership correction:** `TerrainField` stores only physical terrain/geotechnical state. Hydrology-derived values are owned by `HydrologyModel` and combined later by `WorldFoundation.terrainSampleAt()`.

**Interfaces:**

```ts
export type SoilClass = 'rock'|'gravel'|'sand'|'loam'|'clay'|'alluvium'|'peat'|'fill_disturbed';
export type VegetationClass = 'none'|'grass'|'forest'|'scrub'|'wetland';
export type SurfaceWaterClass = 'none'|'lake'|'river'|'coast';
export type WatershedId = string;
export type TerrainPhysicalSample = Readonly<{
  elevationMeters: number;
  slope: number;
  aspectRadians: number;
  soilClass: SoilClass;
  soilDepthMeters: number;
  bearingCapacityKpa: number;
  bedrockDepthMeters: number;
  groundwaterDepthMeters: number;
  vegetationClass: VegetationClass;
  contaminationIndex: number;
  landPreparationMultiplier: number;
  surfaceWater: SurfaceWaterClass;
  buildable: boolean;
}>;
export type TerrainSample = TerrainPhysicalSample & Readonly<{
  conditionedElevationMeters: number;
  watershedId: WatershedId;
  flowAccumulation: number;
  floodSusceptibility: number;
}>;
export type TerrainFieldSnapshot = Readonly<{ width:number; height:number; metersPerCell:number; samples: readonly TerrainPhysicalSample[] }>;

export class TerrainField {
  static fromSamples(width:number, height:number, metersPerCell:number, samples:readonly TerrainPhysicalSample[]): TerrainField;
  getPhysical(x:number,y:number): TerrainPhysicalSample;
  inBounds(x:number,y:number): boolean;
  isBuildable(x:number,y:number): boolean;
  preparationMultiplierAt(x:number,y:number): number;
  snapshotAuthoritative(): TerrainFieldSnapshot;
  static restore(snapshot:TerrainFieldSnapshot): TerrainField;
}
```

**Locked soil properties:**

```ts
rock: { infiltrationMmPerHour:4, bearingCapacityKpa:600, erodibility:0.10, preparationBase:1.05 }
gravel: { infiltrationMmPerHour:35, bearingCapacityKpa:300, erodibility:0.20, preparationBase:0.90 }
sand: { infiltrationMmPerHour:28, bearingCapacityKpa:180, erodibility:0.45, preparationBase:1.00 }
loam: { infiltrationMmPerHour:18, bearingCapacityKpa:160, erodibility:0.35, preparationBase:1.00 }
clay: { infiltrationMmPerHour:5, bearingCapacityKpa:120, erodibility:0.25, preparationBase:1.18 }
alluvium: { infiltrationMmPerHour:12, bearingCapacityKpa:90, erodibility:0.55, preparationBase:1.28 }
peat: { infiltrationMmPerHour:8, bearingCapacityKpa:35, erodibility:0.30, preparationBase:1.70 }
fill_disturbed: { infiltrationMmPerHour:10, bearingCapacityKpa:80, erodibility:0.50, preparationBase:1.35 }
```

- [ ] Write tests asserting exactly eight property keys; all properties finite/valid; `peat` weak/wet example costs more than `gravel`; permanent water is unbuildable; extreme slope is unbuildable; contamination/flood susceptibility are cost inputs, not automatic build bans; `fromSamples` rejects wrong length/non-finite values; snapshot is copy-isolated.
- [ ] Define `calculateLandPreparationMultiplier({slope,soilClass,bedrockDepthMeters,groundwaterDepthMeters,contaminationIndex,floodSusceptibility})`, clamped `[0.75,3.0]`, using soil `preparationBase` multiplied by bounded slope, shallow-groundwater, contamination, deep-bedrock and flood factors. Tests lock directionality, not exact balance coefficients except legacy multiplier later.
- [ ] Implement `TerrainField` with data-oriented internal arrays; public samples are frozen value objects. `buildable` is authoritative physical legality for generated worlds.
- [ ] Run terrain + typecheck + lint; expect green.
- [ ] Commit `feat: add physical terrain and geotechnical foundation`.

---

### Task 4: Six-Preset Deterministic Physical Terrain Generation

**Files:** create `WorldGenerationConfig.ts`, `TerrainGenerator.ts`, `tests/world-generation.test.ts`.

**Interfaces:**

```ts
export type WorldFormPreset = 'plain'|'river_valley'|'basin'|'rolling_uplands'|'ridge_edge'|'coastal_lowland';
export type WorldGenerationConfig = Readonly<{ width:number; height:number; metersPerCell:number; preset:WorldFormPreset }>;
export function resolveWorldGenerationConfig(input?:Partial<WorldGenerationConfig>): WorldGenerationConfig;
export type TerrainGenerationStreams = Readonly<{ topography:SeededRandom; soils:SeededRandom; groundwater:SeededRandom; vegetation:SeededRandom }>;
export function generatePhysicalTerrain(config:WorldGenerationConfig, streams:TerrainGenerationStreams): TerrainField;
```

**Test helper defined in `tests/world-generation.test.ts`:**

```ts
function streams(seed:number): TerrainGenerationStreams {
  const registry = new RandomStreamRegistry(seed);
  return {
    topography: registry.stream('world.topography'),
    soils: registry.stream('world.soils'),
    groundwater: registry.stream('world.groundwater'),
    vegetation: registry.stream('world.vegetation'),
  };
}
```

- [ ] Write same-seed byte-equivalent physical snapshot test, different-seed inequality, all-six-preset validation, finite slope/aspect, zero contamination, and useful buildable fraction `0.35..0.95` across seeds `[1,7,42,91,2026]` for non-coastal normal defaults.
- [ ] Add RNG isolation test: build two registries with seed 42, advance only `world.vegetation` 20 times in the second, generate both, and assert elevation/soil/groundwater fields equal while vegetation may differ.
- [ ] Implement one dependency-free 3-octave smooth value-noise generator from topography stream plus preset parameter modifiers; do not create six algorithms.
- [ ] Compute slope/aspect from neighboring elevation. Generate soil from terrain/moisture + soil stream, groundwater from elevation/moisture + groundwater stream, vegetation from physical moisture/elevation + vegetation stream. Generated contamination is exactly zero.
- [ ] Run generation + terrain tests and typecheck; expect green.
- [ ] Commit `feat: add deterministic physical world generation`.

---

### Task 5: Priority-Flood Conditioning and Deterministic D8 Drainage

**Files:** create `HydrologyTypes.ts`, `DepressionResolver.ts`, `DrainageGraph.ts`, `tests/world-hydrology.test.ts`.

**Interfaces:**

```ts
export const D8_CLOCKWISE: readonly (readonly [number,number])[] = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
export function resolveDepressions(width:number,height:number,rawElevation:Float64Array,permanentWater:Uint8Array): Float64Array;
export class DrainageGraph {
  static build(width:number,height:number,conditionedElevation:Float64Array,permanentWater:Uint8Array): DrainageGraph;
  receiverIndex(index:number): number | null;
  listOutlets(): readonly number[];
  topologicalOrder(): readonly number[];
}
```

**Exact fixtures:** use a 5×5 bowl with boundary 0, ring 5, center 1 to prove artificial sink conditioning; use this 3×3 tie fixture to lock north-first D8:

```ts
new Float64Array([9,4,9, 4,5,4, 9,4,9])
```

center index 4 must receive index 1.

- [ ] Write tests for input non-mutation, deterministic priority-flood output, no receiver higher than source beyond epsilon, explicit boundary/permanent-water outlets, no receiver cycles, and fixed clockwise tie behavior.
- [ ] Implement min-heap ordered `(elevation,index)`, seeded with boundary cells plus permanent-water sinks; visit each cell once and condition neighbor to `max(rawNeighbor,poppedElevation)`.
- [ ] Implement D8 steepest descent. For conditioned flats, precompute deterministic outlet-distance ranks by reverse breadth-first traversal from outlets and choose neighbors that reduce rank; equal ranks use `D8_CLOCKWISE`, preventing flat cycles.
- [ ] Run hydrology + typecheck + lint; expect green.
- [ ] Commit `feat: add deterministic terrain drainage`.

---

### Task 6: Watersheds, Accumulation, Channels, and HydrologyModel

**Files:** create `WatershedModel.ts`, `HydrologyModel.ts`; extend `tests/world-hydrology.test.ts`.

**Interfaces:**

```ts
export type WatershedRecord = Readonly<{ id:WatershedId; outletIndex:number; memberCount:number; upstreamAreaCells:number; primaryChannelId:string|null }>;
export type ChannelSegment = Readonly<{ id:string; fromIndex:number; toIndex:number; accumulation:number; capacityVolumeM3:number }>;
export type HydrologySample = Readonly<{ conditionedElevationMeters:number; watershedId:WatershedId; flowAccumulation:number; floodSusceptibility:number }>;
export type HydrologySnapshot = Readonly<{ width:number; height:number; conditionedElevationMeters:readonly number[]; receiver:readonly (number|null)[]; watersheds:readonly WatershedRecord[]; channels:readonly ChannelSegment[]; flowAccumulation:readonly number[]; watershedIds:readonly WatershedId[]; floodSusceptibility:readonly number[] }>;

export class HydrologyModel {
  static build(terrain:TerrainField, conditionedElevation:Float64Array): HydrologyModel;
  sampleAt(x:number,y:number): HydrologySample;
  channels(): readonly ChannelSegment[];
  watersheds(): readonly WatershedRecord[];
  snapshotAuthoritative(): HydrologySnapshot;
  static restore(snapshot:HydrologySnapshot): HydrologyModel;
}
```

- [ ] Extend controlled-fixture tests so every cell receives exactly one watershed ID, member counts total `width*height`, receiver accumulation is greater/equal than direct upstream accumulation, channel `toIndex` equals drainage receiver, and susceptibility is greater in a low/high-accumulation cell than a ridge cell.
- [ ] Implement accumulation using indegree/topological order with initial cell contribution `1`; process zero-indegree indices ascending.
- [ ] Trace terminal outlet with path compression; assign watershed IDs by sorted outlet index: `watershed:${ordinal.padStart(4,'0')}`.
- [ ] Extract channels when accumulation >= `max(12,floor(cellCount*0.015))`; capacity `cellAreaM2 * 0.02 * sqrt(accumulation)`. Susceptibility is a clamped deterministic blend of normalized accumulation, local relative elevation and channel proximity.
- [ ] `HydrologyModel.build()` validates dimensions and stores conditioned elevation separately from raw terrain elevation.
- [ ] Run hydrology + generation + typecheck; expect green.
- [ ] Commit `feat: add watersheds and terrain-derived channels`.

---

### Task 7: Design-Storm Flood Model and Exact Water Accounting

**Files:** create `FloodModel.ts`, `tests/world-flooding.test.ts`.

**Interfaces:**

```ts
export type DesignStormEvent = Readonly<{ id:string; rainfallMm:number; durationHours:number; saturationFactor?:number }>;
export type FloodExternalSurface = Readonly<{ imperviousFractionAt(x:number,y:number): number }>;
export type FloodResult = Readonly<{ eventId:string; depthMeters:readonly number[]; rainfallVolume:number; infiltrationVolume:number; retainedChannelSurfaceVolume:number; overbankFloodVolume:number; exportedVolume:number; balanceError:number }>;
export class FloodModel {
  run(event:DesignStormEvent, terrain:TerrainField, hydrology:HydrologyModel, externalSurface?:FloodExternalSurface): FloodResult;
}
```

**Test helper:** `tests/world-flooding.test.ts` creates a 3×3 `TerrainField.fromSamples()` with nine inline identical loam samples except the center soil is replaced per test; build conditioned elevation `new Float64Array([3,2,1,3,2,1,3,2,1])` and `HydrologyModel.build(field, conditioned)`. This fixture is fully specified and needs no undefined helper APIs.

- [ ] Test 0 mm rain => all zero depths and exact balance 0; 80 mm runoff >= 40 mm runoff; clay infiltration < gravel infiltration; all depths finite/nonnegative; repeated identical calls deep-equal; 100% impervious external surface reduces infiltration; balance error <= `max(1e-9,rainfallVolume*1e-9)`.
- [ ] Implement infiltration from soil infiltration rate × duration × saturation × `(1-impervious)`, bounded by rainfall. Cell area = `metersPerCell²`; runoff volume is routed in hydrology drainage topological order.
- [ ] Channel cells retain up to channel capacity; overflow becomes local overbank volume/depth; terminal outlet flow becomes exported. Retained ordinary non-channel surface storage remains zero in 1R unless permanent water receives runoff, where it is counted in retained channel/surface volume.
- [ ] Compute balance directly from double-precision volume accumulators, never reconstructed from display depth.
- [ ] Run flooding + hydrology + typecheck; expect green.
- [ ] Commit `feat: add deterministic flood event model`.

---

### Task 8: Scenario Overrides and Ordered World Generation Pipeline

**Files:** create `ScenarioWorldDefinition.ts`, `WorldGenerator.ts`; extend `tests/world-generation.test.ts`.

**Interfaces:**

```ts
export type ScenarioWorldDefinition = Readonly<{
  id:string;
  generation?: Partial<WorldGenerationConfig>;
  rootBoundary?: Polygon2;
  elevationOverrides?: readonly Readonly<{x:number;y:number;elevationMeters:number}>[];
  permanentWaterPolygons?: readonly Readonly<{class:Exclude<SurfaceWaterClass,'none'>; polygon:Polygon2}>[];
  soilRegions?: readonly Readonly<{soilClass:SoilClass; polygon:Polygon2}>[];
  groundwaterRegions?: readonly Readonly<{depthMeters:number; polygon:Polygon2}>[];
  contaminationRegions?: readonly Readonly<{index:number; polygon:Polygon2}>[];
  administrativeBoundaries?: GeographySnapshot;
}>;
export type GeneratedWorldComponents = Readonly<{ config:WorldGenerationConfig; terrain:TerrainField; hydrology:HydrologyModel; geography:GeographyHierarchy; scenarioId:string|null }>;
export function generateWorldComponents(seed:number, config:WorldGenerationConfig, registry:RandomStreamRegistry, scenario?:ScenarioWorldDefinition): GeneratedWorldComponents;
```

- [ ] Add tests for precedence defaults < preset < generated < scenario; authored elevation exact override; permanent water survives conditioning; authored contamination nonzero while generated default zero; malformed override polygon/out-of-bounds sample rejection; same seed+scenario equality.
- [ ] Implement root boundary default rectangle `(0,0)-(width,height)` in planning units; scenario root must contain all cell centers.
- [ ] Apply physical overrides deterministically in array order after physical generation, then recompute derived physical slope/aspect/preparation where affected.
- [ ] Build permanent-water mask from overridden surface-water classes, run `resolveDepressions`, then `HydrologyModel.build(terrain,conditioned)`.
- [ ] Use `registry.stream('world.boundaries')` only for generated hierarchy. Authored `administrativeBoundaries` are restored/validated without consuming the boundary RNG stream.
- [ ] Run world generation/geography/hydrology/flood tests; expect green.
- [ ] Commit `feat: compose deterministic world generation pipeline`.

---

### Task 9: Derived GeometryIndex and 10k-Candidate Query Semantics

**Files:** create `GeometryIndex.ts`, `tests/world-spatial-index.test.ts`.

**Interfaces:**

```ts
export type IndexedPoint = Readonly<{ id:string; point:Point2; category:string }>;
export class GeometryIndex {
  constructor(worldBounds:BoundingBox2);
  rebuild(entities:readonly GeographyEntity[], channels:readonly ChannelSegment[], points?:readonly IndexedPoint[]): void;
  entitiesAt(point:Point2, kind?:GeographyKind): readonly GeographyEntity[];
  queryBounds(bounds:BoundingBox2, kind?:GeographyKind): readonly GeographyEntity[];
  nearbyPoints(point:Point2,radius:number,category?:string): readonly IndexedPoint[];
  channelIdsNear(point:Point2,radius:number): readonly string[];
}
```

- [ ] Create three explicit overlapping-by-depth hierarchy entities and four indexed points. Compare `entitiesAt()` to direct `pointInPolygon`, assert boundary ties deepest-kind then ID, nearby points distance then ID, query result order invariant after reversed rebuild input, and rebuild equality.
- [ ] Implement derived uniform buckets: bucket size `max(4,sqrt(worldArea/max(1,entityCount)))`; insert sorted IDs into all overlapping buckets; exact geometry filtering after bucket candidate retrieval; never return internal mutable arrays.
- [ ] Run spatial + geometry + geography tests; expect green.
- [ ] Commit `feat: add deterministic world spatial index`.

---

### Task 10: WorldFoundation Composition and Legacy Terrain Compatibility

**Files:** create `WorldFoundationTypes.ts`, `WorldFoundation.ts`, `LegacyTerrainAdapter.ts`, `V7WorldMigration.ts`; modify `TerrainGrid.ts`, `SimulationCore.ts`; create `tests/world-foundation-integration.test.ts`; retain existing foundation/city tests.

**Interfaces:**

```ts
export type WorldFoundationMode = 'generated-1r'|'legacy-flat'|'legacy-explicit';
export type LegacyTerrainSnapshot = Readonly<{ width:number; height:number; cells:readonly TerrainCell[] }>;
export type WorldFoundationSnapshot = Readonly<{ mode:WorldFoundationMode; seed:number; config:WorldGenerationConfig; scenarioId:string|null; terrain:TerrainFieldSnapshot; hydrology:HydrologySnapshot; geography:GeographySnapshot; legacyCompatibility:LegacyTerrainSnapshot|null; lastFloodResult:FloodResult|null }>;

export class WorldFoundation {
  readonly mode:WorldFoundationMode;
  readonly terrain:TerrainField;
  readonly hydrology:HydrologyModel;
  readonly geography:GeographyHierarchy;
  readonly spatialIndex:GeometryIndex;
  static generate(input:{seed:number;config:WorldGenerationConfig;randomRegistry:RandomStreamRegistry;scenario?:ScenarioWorldDefinition}): WorldFoundation;
  static fromLegacyTerrain(terrain:TerrainGrid,seed:number,mode:'legacy-flat'|'legacy-explicit'): WorldFoundation;
  static restore(snapshot:WorldFoundationSnapshot): WorldFoundation;
  terrainSampleAt(x:number,y:number): TerrainSample;
  legacyTerrain(): TerrainGrid;
  preparationMultiplierAt(x:number,y:number): number;
  runDesignStorm(event:DesignStormEvent,externalSurface?:FloodExternalSurface): FloodResult;
  floodDepthAt(x:number,y:number): number;
  snapshotAuthoritative(): WorldFoundationSnapshot;
  diagnosticSnapshot(): Readonly<{mode:WorldFoundationMode;width:number;height:number;watersheds:number;channels:number;lastFloodedCells:number}>;
}
```

**Legacy conversion rules:** preserve exact old `TerrainCell` fields in `legacyCompatibility`; physical elevation = `legacy.elevation*100`; physical water from old `water`; neutral soil `loam`, soil depth 2 m, bearing 160 kPa, bedrock 8 m, groundwater 5 m, contamination 0; preparation multiplier forced exactly `1.0` for every legacy buildable cell regardless of converted physical values; legacy buildability comes from saved cell, not recalculation.

**SimulationCoreOptions addition:**

```ts
world?: WorldFoundation;
worldConfig?: Partial<WorldGenerationConfig>;
scenarioWorld?: ScenarioWorldDefinition;
terrainMode?: 'legacy-flat'|'legacy-explicit';
```

Construction precedence: `world` first; else `terrain` via `fromLegacyTerrain(terrain, seed, terrainMode ?? 'legacy-explicit')`; else generate with `kernel.random`. Then `this.terrain = this.world.legacyTerrain()` before constructing roads/zoning/utilities/services/transit.

- [ ] Write tests: direct terrain core mode `legacy-explicit`; direct terrain snapshot unchanged; prep multiplier exactly 1; generated core mode `generated-1r`; `terrainSampleAt` combines physical elevation with non-empty watershed; `core.terrain.width/height/get/isBuildable` work; `core.step(100)` leaves `world.snapshotAuthoritative()` unchanged; existing exact road/zoning/lot tests remain green.
- [ ] Implement `LegacyTerrainAdapter` as immutable exact compatibility snapshot + materializer. Generated `legacyTerrain()` maps combined sample to existing four fields; legacy modes return exact saved compatibility cells.
- [ ] `WorldFoundation.runDesignStorm()` updates only `lastFloodResult`; no physical terrain/hydrology mutation. `floodDepthAt` reads last result or 0.
- [ ] Build/rebuild `GeometryIndex` in constructor/restore from geography/channels; index is absent from authoritative snapshot.
- [ ] Register kernel snapshot provider `world`; no per-tick world system. Lightweight invariant validates world dimensions and compatibility terrain dimensions only.
- [ ] Run `world-foundation`, `core-foundation`, `city-foundation`, `kernel-v7-parity`, typecheck/lint; expect green.
- [ ] Commit `feat: integrate world foundation behind V7 terrain facade`.

---

### Task 11: Save V8 and Constructor-Time World Injection Through the Save Chain

**Files:** create `saveV8.ts`; modify `saveLegacy.ts`, `saveV5.ts`, `saveV6.ts`, `saveV7.ts`, `save.ts`, `tests/save-v7.test.ts`; create `tests/save-v8.test.ts`.

**Critical rule:** never hydrate V7 domains against one terrain and replace `world` afterward. Every V8 load passes restored `WorldFoundation` down to the base `SimulationCore` constructor before terrain-dependent systems exist.

**Internal hydration interfaces:**

```ts
// saveLegacy.ts
export function hydrateCoreWithWorld(input:unknown, world?:WorldFoundation): SimulationCore;
export function hydrateCore(input:unknown): SimulationCore { return hydrateCoreWithWorld(input); }

// saveV5.ts
export function hydrateCoreV5WithWorld(input:unknown, world?:WorldFoundation): SimulationCore;
// saveV6.ts
export function hydrateCoreV6WithWorld(input:unknown, world?:WorldFoundation): SimulationCore;
// saveV7.ts
export function hydrateCoreV7WithWorld(input:unknown, world?:WorldFoundation): SimulationCore;
```

Each existing public hydrator delegates to its `WithWorld` variant with `undefined`. Recursive migration calls pass the optional `world` down unchanged. Base legacy constructor does:

```ts
const core = world
  ? new SimulationCore({ world, seed: base.seed, startingFunds: base.treasury.balance })
  : new SimulationCore({ terrain, terrainMode: 'legacy-flat', seed: base.seed, startingFunds: base.treasury.balance });
```

**Save V8 interfaces:**

```ts
export type SaveV8 = Omit<SaveV7,'saveVersion'|'gameVersion'> & Readonly<{ saveVersion:8; gameVersion:'0.8.0-world-foundation'; world:WorldFoundationSnapshot }>;
export function serializeCoreV8(core:SimulationCore, baseV7?:SaveV7): SaveV8;
export function hydrateCoreV8(input:unknown): SimulationCore;
```

V8 hydrate converts the non-world fields to a V7 envelope, restores `WorldFoundation`, validates `world.legacyTerrain()` dimensions/cells against the inherited V7 `terrain` compatibility field, then calls `hydrateCoreV7WithWorld(v7,world)`. Non-V8 input calls ordinary `hydrateCoreV7(input)`; because base legacy hydration now passes `terrainMode:'legacy-flat'`, V3–V7 automatically receive neutral migration worlds.

- [ ] Write V8 tests: default/generated world round-trip exact; `lastFloodResult` round-trip; legacy-explicit V8 round-trip exact compatibility terrain; V7→current load yields `legacy-flat` and preserves roads/zones/buildings/funds; repeated V7 migration deep-equal; corrupt world terrain length/hierarchy/world-vs-compatibility dimensions rejected; V7 migration has `lastFloodResult === null`.
- [ ] Update `tests/save-v7.test.ts`: explicit V7 schema test uses `serializeCoreV7`; replace Phase0A default-V7 assertion with “explicit V7 serializer excludes 1R world state.”
- [ ] Implement hydration plumbing through V5/V6/V7 without changing their external behavior when no world is supplied.
- [ ] Implement `serializeCoreV8(core, baseV7=serializeCoreV7(core))`. In `save.ts`, sanitize the V7 portion first, then pass sanitized V7 into V8 serializer; default `serializeCore` returns V8 and default `hydrateCore` calls V8 hydrator.
- [ ] Run save V3–V8, kernel parity, typecheck/lint; expect green.
- [ ] Commit `feat: persist world foundation in Save V8`.

---

### Task 12: Terrain Preparation Cost Hooks for Roads and Development

**Files:** modify `RoadSystem.ts`, `SimulationCore.ts`, `tests/city-foundation.test.ts`; create `tests/world-cost-integration.test.ts`.

**Road interface:** constructor becomes `constructor(terrain:TerrainGrid, costMultiplierAt:(x:number,y:number)=>number = () => 1)`. Cost is sum over new cells of `definition.constructionCostPerCell * multiplier`, rounded once to cents. Invalid/nonpositive multiplier throws as authoritative configuration corruption. Restore never charges cost.

**Development integration:** keep existing utility/service index, multiply by terrain preparation, clamp existing `[0.85,1.50]` bounds exactly:

```ts
const serviceUtilityCostIndex = clamp(1 + (1 - utilityRatio) * 0.20 + (1 - serviceQuality) * 0.10, 0.85, 1.50);
const constructionCostIndex = clamp(serviceUtilityCostIndex * this.world.preparationMultiplierAt(lot.x, lot.y), 0.85, 1.50);
```

- [ ] Preserve existing three-local-cell `120` direct-terrain test.
- [ ] Add RoadSystem fixture with three cells and provider map multipliers `1,1.5,2`; assert local-road cost `180` and treasury debit exact.
- [ ] Add two identical development contexts except world prep factor 1 vs 1.4; assert difficult lot produces larger `hardConstructionCost` after `SimulationCore` context construction. Do not add a second direct charge inside `DevelopmentFeasibilitySystem`.
- [ ] `SimulationCore` passes `(x,y)=>this.world.preparationMultiplierAt(x,y)` to RoadSystem. Legacy modes return exactly 1.
- [ ] Run cost/city/development/kernel parity/typecheck; expect green.
- [ ] Commit `feat: apply terrain costs to infrastructure and development`.

---

### Task 13: Flood Events and Presentation-Read Boundary

**Files:** modify `WorldFoundationTypes.ts`, `WorldFoundation.ts`, `SimulationCore.ts`; create `tests/world-presentation-contract.test.ts`; extend `tests/world-foundation-integration.test.ts`. No renderer source modification is planned.

**Interfaces:**

```ts
public runDesignStorm(event:DesignStormEvent): FloodResult;
public recordWorldMigrationDiagnostic(fromSaveVersion:number): void;
```

`SimulationCore.runDesignStorm` appends `FloodEventStarted`, calls `world.runDesignStorm`, appends `FloodEventResolved` with `{eventId,floodedCells,balanceError}`, then returns result. World generation constructor path (no supplied `world`/`terrain`) appends one `WorldGenerated` diagnostic event. Direct TerrainGrid construction emits neither generation nor migration event. `hydrateCoreV8` non-V8 path calls `recordWorldMigrationDiagnostic(originalSaveVersion)` once after legacy hydration; V8 load emits no fabricated generation/migration event.

- [ ] Extend integration test to assert exact event type ordering for one 80mm storm, deterministic result, and no event on direct terrain construction.
- [ ] Add V7 migration test asserting one `WorldMigratedTo1R` diagnostic after default current hydration; V8 round-trip load asserts no migration event.
- [ ] Add presentation contract source test that `GroundRenderPass`/`WorldRenderer` continue to derive size/art from `core.terrain` and contain no calls to `runDesignStorm`, world mutation or save mutation APIs. Existing generated `legacyTerrain()` ensures water/forest/rock/grass render compatibility without renderer edits.
- [ ] Run world integration + presentation/isometric tests + typecheck; expect green.
- [ ] Commit `feat: expose world flood diagnostics safely`.

---

### Task 14: Spatial Performance and Static-World Long-Run Gate

**Files:** create `tests/world-performance.test.ts`.

- [ ] Generate a 96×64 `rolling_uplands` world, build 10,000 deterministic query points using modular integer sequences `(i*37)%width + 0.5`, `(i*53)%height + 0.5`, execute block/neighborhood/district `entitiesAt` lookups, assert valid membership and indexed elapsed < 2500 ms using `node:perf_hooks`.
- [ ] For the first 500 points, compare indexed membership IDs against direct `GeographyHierarchy.entityAt`/polygon result to prove performance layer correctness.
- [ ] Generate all six presets at 96×64 and print diagnostic generation elapsed values; assert finite/valid worlds but no hardware-specific generation threshold.
- [ ] Snapshot one generated `SimulationCore.world`, run `core.step(5000)` without storm/world mutation, assert authoritative snapshot unchanged.
- [ ] Run `node --experimental-strip-types --test tests/world-performance.test.ts tests/world-*.test.ts && npm run typecheck && npm run lint`; expect green.
- [ ] Commit `test: add 1R world performance gates`.

---

### Task 15: Full 1R Headless Acceptance and Documentation

**Files:** create `tests/phase1r-headless.test.ts`; modify `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `README.md`, `docs/DEVELOPMENT_LOG.md`.

**Headless acceptance fixture:** `new SimulationCore({width:48,height:32,seed:20260825,worldConfig:{preset:'river_valley'}})`. Deterministically scan y then x for three consecutive buildable cells for a road; scan adjacent buildable non-road cells for zoning/utilities instead of hard-coding geography-sensitive coordinates.

- [ ] Headless test asserts generated mode, valid hierarchy, >=1 channel, builds road/zoning/utilities through existing APIs, steps city, runs `{id:'acceptance-storm',rainfallMm:80,durationHours:2}`, checks nonnegative depths and balance tolerance, serializes V8, hydrates, asserts immediate save/world equality, steps original+loaded equally, and asserts final serialization equality.
- [ ] Run headless test alone; expect green.
- [ ] Update architecture path to `GameApp → SimulationCore facade → WorldFoundation + SimulationKernel → legacy V7 city domains`. State physical geography/hydrology ownership and that roads/lots remain V7-compatible pending 3R/2R.
- [ ] Update canonical save/runtime status to Save V8 / `0.8.0-world-foundation`; state explicit V3–V7 migration APIs remain supported.
- [ ] Update testing docs with geometry/hierarchy/terrain/hydrology/flooding/V8/performance/headless coverage and record diagnostic 10k query timing from the final run.
- [ ] Run `npm test && npm run typecheck && npm run lint && npm run build`.
- [ ] Run `npm run test:smoke && npm run test:smoke:phase7 && npm run test:smoke:isometric`; all must exit 0 because 1R intentionally preserves UI/render compatibility.
- [ ] Run explicit gate `node --experimental-strip-types --test tests/kernel-v7-parity.test.ts tests/save-v3.test.ts tests/save-v4.test.ts tests/save-v5.test.ts tests/save-v6.test.ts tests/save-v7.test.ts tests/save-v8.test.ts tests/phase1r-headless.test.ts tests/world-performance.test.ts`.
- [ ] Inspect `git diff --name-only main...HEAD` and `find src/world -name '*.ts' -print0 | xargs -0 wc -l | sort -n`; confirm no 2R legal-parcel implementation, no 3R lane model, no unrelated rewrite, normal new files <500 LOC and none >1000 LOC.
- [ ] Commit `docs: record verified 1R world foundation`.
- [ ] Before any completion claim, capture fresh total tests/failures, V8 round-trip, V7 migration, V7 parity, hydrology balance tolerance, 10k-query timing, typecheck/lint/build, three smoke results and final commit SHA.

---

## Plan Self-Review

### Spec coverage

- irregular geometry and shared numeric tolerance — Task 1.
- Region→Municipality→District→Neighborhood→Block hierarchy, stable IDs and topology validation — Task 2.
- physical terrain/geotechnics and eight locked soils — Task 3.
- six locked generation presets and isolated named RNG streams — Task 4.
- priority-flood conditioning and fixed-clockwise D8 drainage — Task 5.
- watersheds/accumulation/channels/static susceptibility — Task 6.
- design-storm runoff/infiltration/event flood depth/water conservation — Task 7.
- scenario overrides and generation precedence — Task 8.
- rebuildable deterministic spatial index — Task 9.
- combined read model without duplicated authority, legacy-flat/explicit compatibility and exact buildability preservation — Task 10.
- Save V8 plus constructor-time restored-world injection and V3–V7 migration — Task 11.
- terrain-driven road/development economics with exact legacy factor 1.0 — Task 12.
- typed WorldGenerated/WorldMigratedTo1R/FloodEventStarted/FloodEventResolved diagnostics and renderer read-only boundary — Task 13.
- >=10k spatial-query performance and zero static per-tick world mutation — Task 14.
- complete generate→play→storm→save/load→continue acceptance and docs — Task 15.

### Type consistency

The same signatures are used across tasks: `TerrainField` is physical-only; `HydrologyModel.build(terrain,conditionedElevation)` owns derived fields; `WorldFoundation.terrainSampleAt()` combines them. `WorldFoundation` is injected before `SimulationCore` constructs terrain-dependent systems. Save V8 uses `hydrateCoreV7WithWorld()` plumbing rather than post-construction world replacement. `DesignStormEvent`, `FloodResult`, `GeographyHierarchy`, `GeometryIndex`, `WorldGenerationConfig` and `ScenarioWorldDefinition` are defined before consumers.

### Placeholder scan

No unspecified implementation placeholders remain. Test fixtures referenced by name are defined within their task, every neighboring runtime interface is declared before use, every material task has red-state verification, implementation mechanics, green verification and a commit boundary.

### Scope check

1R remains a coherent dependency chain around one geographic substrate. Legal parcel economics/ownership and lane-level road transportation remain explicitly deferred to 2R/3R.
