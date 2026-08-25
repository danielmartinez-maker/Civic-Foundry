# Civic Foundry 2.0 — Phase 1R World Foundation 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's lightweight generated `TerrainGrid` with a deterministic geographic foundation containing real hierarchy, irregular geometry, terrain/geotechnical state, priority-flood-conditioned D8 hydrology, design-storm flooding, spatial queries, and Save V8 persistence while preserving V7 tile gameplay through compatibility adapters.

**Architecture:** Build new `src/world/` domain packages behind a `WorldFoundation` aggregate. Generated games create `WorldFoundation` first and expose a legacy `TerrainGrid` view to existing roads/zoning/lots/rendering; explicitly supplied `TerrainGrid` fixtures and migrated V7 saves become neutral legacy-flat `WorldFoundation` instances. Keep existing roads and lots authoritative until 3R/2R, feed terrain only through bounded construction-cost hooks, and serialize authoritative 1R state in Save V8 while rebuilding derived indexes/caches after load.

**Tech Stack:** TypeScript 5.x ES modules; Node 22 built-in test runner with `--experimental-strip-types`; strict `tsc`; browser-native Canvas 2D; existing `SeededRandom` / `RandomStreamRegistry`; no runtime npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-1r-world-foundation-2-design.md`

## Global Constraints

- Target branch: `feat/1r-world-foundation-2`.
- `WorldFoundation` is authoritative for Phase 1R physical geography.
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
- No full GIS dependency, geometry library, noise dependency, or runtime npm dependency may be added.
- No Phase 2R parcel ownership/zoning-envelope/split-merge behavior and no Phase 3R lane/curve road authority may be pulled into this tranche.
- Existing renderer world sizing and tile selection remain driven by the terrain compatibility surface.
- Source-file target is under 500 LOC; split responsibilities before a new source file approaches 750 LOC.
- Every material behavior change follows red-green-refactor TDD and ends its task with a focused commit.
- After every integration task, existing V7 compatibility tests must remain green; regressions stop forward implementation until corrected.

---

## File Structure

### New geometry files

- `src/world/geometry/GeometryTypes.ts` — immutable point/segment/polyline/polygon/bounds types.
- `src/world/geometry/GeometryTolerance.ts` — the single shared geometry epsilon and coordinate comparison helpers.
- `src/world/geometry/SegmentMath.ts` — point-on-segment, segment intersection, nearest-point, polyline length.
- `src/world/geometry/PolygonMath.ts` — winding normalization, validation, area, perimeter, centroid, containment, bounding-box intersection, frontage overlap.
- `tests/world-geometry.test.ts` — deterministic geometry invariants and edge cases.

### New geography files

- `src/world/geography/GeographyTypes.ts` — typed geographic IDs/kinds/entities/snapshots.
- `src/world/geography/GeographyHierarchy.ts` — authoritative hierarchy validation, traversal, lookup and snapshot/restore.
- `src/world/geography/AdministrativeBoundaryGenerator.ts` — deterministic irregular Region→Municipality→District→Neighborhood→Block subdivision.
- `tests/world-geography.test.ts` — hierarchy and generated-boundary tests.

### New terrain/geotechnical files

- `src/world/terrain/TerrainTypes.ts` — terrain, soil, vegetation, water and serialized-field contracts.
- `src/world/terrain/SoilModel.ts` — locked soil engineering properties and site-preparation calculation.
- `src/world/terrain/TerrainField.ts` — compact authoritative physical arrays + immutable sampling API.
- `src/world/terrain/TerrainGenerator.ts` — deterministic multi-scale topography, soil, groundwater and vegetation generation.
- `src/world/terrain/LegacyTerrainAdapter.ts` — compatibility conversion in both generated-world and legacy-flat directions.
- Modify: `src/world/terrain/TerrainGrid.ts` — retain public API; add factory/view support without changing direct-constructor behavior.
- `tests/world-terrain.test.ts` — terrain storage, soil/geotechnical, generation and compatibility tests.

### New hydrology files

- `src/world/hydrology/HydrologyTypes.ts` — flow, watershed, channel, storm and flood-result contracts.
- `src/world/hydrology/DepressionResolver.ts` — deterministic priority-flood conditioning.
- `src/world/hydrology/DrainageGraph.ts` — D8 receiver graph and stable clockwise ties.
- `src/world/hydrology/WatershedModel.ts` — accumulation, outlets, watershed membership and channel extraction.
- `src/world/hydrology/FloodModel.ts` — deterministic runoff/infiltration/routing/water-balance calculation.
- `src/world/hydrology/HydrologyModel.ts` — immutable composition/snapshot of conditioned elevation, drainage, watersheds, channels and flood susceptibility.
- `tests/world-hydrology.test.ts`
- `tests/world-flooding.test.ts`

### New generation/foundation/index files

- `src/world/generation/WorldGenerationConfig.ts` — six presets, dimensions, scale and validation.
- `src/world/generation/ScenarioWorldDefinition.ts` — validated scenario override contract and precedence application.
- `src/world/generation/WorldGenerator.ts` — ordered deterministic generation pipeline.
- `src/world/foundation/WorldFoundationTypes.ts` — authoritative snapshot, mode, query and event payload contracts.
- `src/world/foundation/WorldFoundation.ts` — composition root and read-only domain facade.
- `src/world/geometry/GeometryIndex.ts` — derived deterministic spatial buckets/query ordering.
- `tests/world-generation.test.ts`
- `tests/world-spatial-index.test.ts`
- `tests/world-foundation-integration.test.ts`

### Existing runtime/save integration

- Modify: `src/simulation/core/SimulationCore.ts` — add `world`, select generated vs legacy-explicit construction path, register world diagnostics/invariants, expose explicit design-storm API, multiply development site cost by terrain factor.
- Modify: `src/world/roads/RoadSystem.ts` — accept optional terrain-cost provider and sum per-cell preparation multipliers for generated 1R worlds while retaining exact legacy behavior.
- Create: `src/world/migration/V7WorldMigration.ts` — deterministic legacy-flat `WorldFoundation` creation.
- Create: `src/save/saveV8.ts` — authoritative world persistence and V7 migration.
- Modify: `src/save/save.ts` — make V8 primary while exporting V7 APIs.
- Modify: `tests/save-v7.test.ts` — update the former Phase 0A “default is V7” assertion so V7 serializer remains testable explicitly while default serialization becomes V8.
- Create: `tests/save-v8.test.ts`.

### Diagnostics/docs/final acceptance

- Modify: `docs/ARCHITECTURE.md`.
- Modify: `docs/TESTING.md`.
- Modify: `README.md`.
- Modify: `docs/DEVELOPMENT_LOG.md`.
- Create: `tests/world-performance.test.ts`.

---

### Task 1: Geometry Primitives and Deterministic Polygon Math

**Files:**
- Create: `src/world/geometry/GeometryTypes.ts`
- Create: `src/world/geometry/GeometryTolerance.ts`
- Create: `src/world/geometry/SegmentMath.ts`
- Create: `src/world/geometry/PolygonMath.ts`
- Create: `tests/world-geometry.test.ts`

**Interfaces:**
- Produces `Point2`, `Segment2`, `Polyline2`, `Polygon2`, `BoundingBox2`.
- Produces `GEOMETRY_EPSILON = 1e-9`.
- Produces `normalizePolygon(points: readonly Point2[]): Polygon2`.
- Produces `polygonSignedArea()`, `polygonArea()`, `polygonPerimeter()`, `polygonCentroid()`, `polygonBounds()`.
- Produces `pointOnSegment()`, `segmentsIntersect()`, `nearestPointOnSegment()`, `polylineLength()`.
- Produces `pointInPolygon(point, polygon, includeBoundary = true)`.
- Produces `polygonIntersectsBounds()` and `frontageOverlapLength()`.

- [ ] **Step 1: Write geometry tests first**

Create `tests/world-geometry.test.ts` with known shapes and invalid input:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolygon, polygonArea, polygonCentroid, pointInPolygon } from '../src/world/geometry/PolygonMath.ts';
import { segmentsIntersect } from '../src/world/geometry/SegmentMath.ts';

const rectangle = normalizePolygon([
  { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 },
]);

test('polygon math normalizes winding and returns exact rectangle measures', () => {
  assert.equal(polygonArea(rectangle), 12);
  assert.deepEqual(polygonCentroid(rectangle), { x: 2, y: 1.5 });
  assert.equal(pointInPolygon({ x: 4, y: 1 }, rectangle), true);
  assert.equal(pointInPolygon({ x: 5, y: 1 }, rectangle), false);
});

test('self-intersecting authoritative polygons are rejected', () => {
  assert.throws(() => normalizePolygon([
    { x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 },
  ]), /self-intersection/);
});

test('segment intersection handles endpoint and crossing cases deterministically', () => {
  assert.equal(segmentsIntersect({ a: { x: 0, y: 0 }, b: { x: 2, y: 2 } }, { a: { x: 0, y: 2 }, b: { x: 2, y: 0 } }), true);
});
```

Add tests for finite coordinates, duplicate terminal vertex normalization, zero area, nearest-point projection, polyline length, bounding-box intersection and frontage overlap.

- [ ] **Step 2: Run the geometry test and verify red state**

```bash
node --experimental-strip-types --test tests/world-geometry.test.ts
```

Expected: FAIL because geometry modules do not exist.

- [ ] **Step 3: Implement immutable types and one tolerance source**

`GeometryTypes.ts`:

```ts
export type Point2 = Readonly<{ x: number; y: number }>;
export type Segment2 = Readonly<{ a: Point2; b: Point2 }>;
export type Polyline2 = Readonly<{ points: readonly Point2[] }>;
export type Polygon2 = Readonly<{ points: readonly Point2[] }>;
export type BoundingBox2 = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
```

`GeometryTolerance.ts`:

```ts
export const GEOMETRY_EPSILON = 1e-9;
export function nearlyEqual(a: number, b: number): boolean { return Math.abs(a - b) <= GEOMETRY_EPSILON; }
```

- [ ] **Step 4: Implement segment and polygon algorithms**

Use cross products/orientation tests in `SegmentMath.ts`; use shoelace area and centroid formulas in `PolygonMath.ts`. `normalizePolygon()` must copy/freeze points, remove one repeated terminal point, reject non-finite/duplicate-degenerate/self-intersecting shapes, and reverse clockwise input to canonical counter-clockwise winding.

Core validation loop:

```ts
for (let i = 0; i < points.length; i++) {
  const edgeA = { a: points[i]!, b: points[(i + 1) % points.length]! };
  for (let j = i + 1; j < points.length; j++) {
    if (j === i || j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    const edgeB = { a: points[j]!, b: points[(j + 1) % points.length]! };
    if (segmentsIntersect(edgeA, edgeB)) throw new Error('polygon self-intersection');
  }
}
```

- [ ] **Step 5: Run geometry tests and strict checks**

```bash
node --experimental-strip-types --test tests/world-geometry.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0.

- [ ] **Step 6: Commit geometry foundation**

```bash
git add src/world/geometry tests/world-geometry.test.ts
git commit -m "feat: add deterministic world geometry primitives"
```

---

### Task 2: Authoritative Geography Hierarchy and Irregular Boundary Generation

**Files:**
- Create: `src/world/geography/GeographyTypes.ts`
- Create: `src/world/geography/GeographyHierarchy.ts`
- Create: `src/world/geography/AdministrativeBoundaryGenerator.ts`
- Create: `tests/world-geography.test.ts`

**Interfaces:**
- Produces `GeographyKind = 'region' | 'municipality' | 'district' | 'neighborhood' | 'block'`.
- Produces branded-string aliases `RegionId`, `MunicipalityId`, `DistrictId`, `NeighborhoodId`, `BlockId`, `GeographyId`.
- Produces `GeographyEntity` with `{ id, kind, parentId, boundary, name?, sortKey }`.
- Produces `GeographyHierarchy` methods `get()`, `list(kind?)`, `childrenOf()`, `parentOf()`, `entityAt()`, `snapshot()` and static `restore()`.
- Produces `generateAdministrativeHierarchy(root, rng): GeographyEntity[]`.

- [ ] **Step 1: Write hierarchy tests**

Use a hand-authored root/children fixture and assert immediate parent kinds, cycle/orphan rejection, child containment, sibling material-overlap rejection and stable sorting. Include a generator determinism test using two `SeededRandom(77)` instances.

```ts
test('hierarchy requires one valid root and immediate parent kinds', () => {
  const hierarchy = new GeographyHierarchy(validEntities());
  assert.equal(hierarchy.list('region').length, 1);
  assert.equal(hierarchy.childrenOf('region:0').every((e) => e.kind === 'municipality'), true);
});

test('generated boundaries are deterministic and not all axis-aligned rectangles', () => {
  const a = generateAdministrativeHierarchy(rootPolygon(), new SeededRandom(77));
  const b = generateAdministrativeHierarchy(rootPolygon(), new SeededRandom(77));
  assert.deepEqual(a, b);
  assert.ok(a.some((entity) => entity.boundary.points.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))));
});
```

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-geography.test.ts
```

Expected: FAIL because geography modules do not exist.

- [ ] **Step 3: Implement types and hierarchy validation**

Use a fixed parent-kind table:

```ts
const PARENT_KIND: Readonly<Partial<Record<GeographyKind, GeographyKind>>> = Object.freeze({
  municipality: 'region', district: 'municipality', neighborhood: 'district', block: 'neighborhood',
});
```

`GeographyHierarchy` copies and freezes entities, validates exactly one root, validates parent chains and containment, sorts by `sortKey || id`, and returns copied immutable arrays. `entityAt()` resolves the deepest containing entity using kind depth then stable `id` ordering for boundary ties.

- [ ] **Step 4: Implement deterministic subdivision**

Implement recursive polygon subdivision using clipped half-plane splits through a centroid with deterministic jitter sourced only from the supplied `world.boundaries` stream. Generate one municipality, 2–4 districts, 2–4 neighborhoods per district and 2–6 blocks per neighborhood, with IDs based on parent identity and stable ordinal:

```ts
const childId = `${childKind}:${parent.id}:${String(index).padStart(3, '0')}`;
```

The split line angle and offset may vary by RNG, but every candidate must normalize/validate before acceptance; fall back to an unjittered centroid split after a bounded 8 attempts.

- [ ] **Step 5: Run hierarchy + geometry tests**

```bash
node --experimental-strip-types --test tests/world-geometry.test.ts tests/world-geography.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 6: Commit geography hierarchy**

```bash
git add src/world/geography tests/world-geography.test.ts
git commit -m "feat: add hierarchical geographic boundaries"
```

---

### Task 3: TerrainField, Locked Soil Model, and Site-Preparation Economics

**Files:**
- Create: `src/world/terrain/TerrainTypes.ts`
- Create: `src/world/terrain/SoilModel.ts`
- Create: `src/world/terrain/TerrainField.ts`
- Create: `tests/world-terrain.test.ts`

**Interfaces:**
- Produces locked `SoilClass`, `VegetationClass`, `SurfaceWaterClass`, `WatershedId`.
- Produces `TerrainSample` matching the design spec.
- Produces `SoilProperties` and `SOIL_PROPERTIES` for all eight classes.
- Produces `calculateLandPreparationMultiplier(input): number` clamped to `[0.75, 3.0]`.
- Produces `TerrainField` methods `get(x,y)`, `inBounds()`, `isBuildable()`, `preparationMultiplierAt()`, `snapshotAuthoritative()`.

- [ ] **Step 1: Write terrain/storage/soil tests**

Tests must prove every locked soil class exists, values are finite/positive, weak/wet ground costs more, permanent water is unbuildable, moderate flood exposure increases cost without automatically blocking construction, and snapshots are copied.

```ts
test('all eight soil classes have explicit engineering properties', () => {
  assert.deepEqual(Object.keys(SOIL_PROPERTIES).sort(), [
    'alluvium','clay','fill_disturbed','gravel','loam','peat','rock','sand',
  ]);
});

test('site preparation responds directionally to weak and wet terrain', () => {
  const good = calculateLandPreparationMultiplier({ slope: 0.02, soilClass: 'gravel', bedrockDepthMeters: 4, groundwaterDepthMeters: 8, contaminationIndex: 0, floodSusceptibility: 0 });
  const poor = calculateLandPreparationMultiplier({ slope: 0.18, soilClass: 'peat', bedrockDepthMeters: 15, groundwaterDepthMeters: 0.5, contaminationIndex: 0.4, floodSusceptibility: 0.7 });
  assert.ok(poor > good);
});
```

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-terrain.test.ts
```

Expected: FAIL because terrain 2.0 modules do not exist.

- [ ] **Step 3: Implement locked terrain/soil contracts**

Use these exact soil baseline infiltration/bearing/cost relationships (values may later be balance-tuned only through tests):

```ts
export const SOIL_PROPERTIES = Object.freeze({
  rock: Object.freeze({ infiltrationMmPerHour: 4, bearingCapacityKpa: 600, erodibility: 0.10, preparationBase: 1.05 }),
  gravel: Object.freeze({ infiltrationMmPerHour: 35, bearingCapacityKpa: 300, erodibility: 0.20, preparationBase: 0.90 }),
  sand: Object.freeze({ infiltrationMmPerHour: 28, bearingCapacityKpa: 180, erodibility: 0.45, preparationBase: 1.00 }),
  loam: Object.freeze({ infiltrationMmPerHour: 18, bearingCapacityKpa: 160, erodibility: 0.35, preparationBase: 1.00 }),
  clay: Object.freeze({ infiltrationMmPerHour: 5, bearingCapacityKpa: 120, erodibility: 0.25, preparationBase: 1.18 }),
  alluvium: Object.freeze({ infiltrationMmPerHour: 12, bearingCapacityKpa: 90, erodibility: 0.55, preparationBase: 1.28 }),
  peat: Object.freeze({ infiltrationMmPerHour: 8, bearingCapacityKpa: 35, erodibility: 0.30, preparationBase: 1.70 }),
  fill_disturbed: Object.freeze({ infiltrationMmPerHour: 10, bearingCapacityKpa: 80, erodibility: 0.50, preparationBase: 1.35 }),
});
```

- [ ] **Step 4: Implement compact `TerrainField`**

Store numeric fields in typed arrays and enums in small integer arrays. Constructor validates `width * height` lengths. `get()` assembles/freeze-copies one `TerrainSample`. Keep source and conditioned elevation distinct in authoritative snapshot fields so hydrology does not overwrite raw terrain.

- [ ] **Step 5: Run terrain and prior tests**

```bash
node --experimental-strip-types --test tests/world-terrain.test.ts tests/world-geometry.test.ts tests/world-geography.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0.

- [ ] **Step 6: Commit terrain storage/geotechnics**

```bash
git add src/world/terrain/TerrainTypes.ts src/world/terrain/SoilModel.ts src/world/terrain/TerrainField.ts tests/world-terrain.test.ts
git commit -m "feat: add terrain and geotechnical foundation"
```

---

### Task 4: Deterministic Multi-Scale Terrain Generation and Six World Presets

**Files:**
- Create: `src/world/generation/WorldGenerationConfig.ts`
- Create: `src/world/terrain/TerrainGenerator.ts`
- Create: `tests/world-generation.test.ts`

**Interfaces:**
- Produces `WorldFormPreset` with exactly six values.
- Produces `WorldGenerationConfig` `{ width, height, metersPerCell, preset }` and `resolveWorldGenerationConfig()`.
- Produces `generatePhysicalTerrain(config, streams): TerrainField` where `streams` supplies isolated named `SeededRandom`s.

- [ ] **Step 1: Write preset/determinism tests**

Test identical seed/config snapshots, materially different seeds, all six presets, useful buildable fraction across reference seeds `[1, 7, 42, 91, 2026]`, zero generated contamination, finite slope/aspect, and RNG isolation.

```ts
test('vegetation stream changes do not perturb topography soil or groundwater', () => {
  const first = generateReferenceWorld(42, 'river_valley', 0);
  const second = generateReferenceWorld(42, 'river_valley', 20);
  assert.deepEqual(first.elevationMeters, second.elevationMeters);
  assert.deepEqual(first.soilClass, second.soilClass);
  assert.deepEqual(first.groundwaterDepthMeters, second.groundwaterDepthMeters);
});
```

Implement the test helper by advancing only `world.vegetation` before generation; generator APIs must accept stream objects rather than one shared sequential RNG.

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-generation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config/preset parameters**

Each preset maps to one parameter record consumed by one common generator. Example shape:

```ts
type PresetParameters = Readonly<{
  baseElevation: number;
  macroAmplitude: number;
  ridgeStrength: number;
  basinStrength: number;
  valleyStrength: number;
  seaLevelMeters: number | null;
}>;
```

Do not create six unrelated generation algorithms.

- [ ] **Step 4: Implement dependency-free coherent value noise**

Generate fixed random lattice control values from `world.topography`, bilinearly interpolate with smoothstep, and combine 3 octaves. Apply preset macro modifiers in normalized map coordinates. Compute slope/aspect from elevation gradients after elevation generation.

- [ ] **Step 5: Generate soil/groundwater/vegetation using isolated streams**

Classify soil from terrain position/moisture plus `world.soils`; generate groundwater depth from elevation-to-drainage proxy plus `world.groundwater`; vegetation from moisture/elevation plus `world.vegetation`. Generated contamination is exactly zero.

- [ ] **Step 6: Run generation + terrain tests**

```bash
node --experimental-strip-types --test tests/world-generation.test.ts tests/world-terrain.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 7: Commit deterministic terrain generation**

```bash
git add src/world/generation/WorldGenerationConfig.ts src/world/terrain/TerrainGenerator.ts tests/world-generation.test.ts
git commit -m "feat: add deterministic world terrain generation"
```

---

### Task 5: Priority-Flood Depression Conditioning and D8 Drainage Graph

**Files:**
- Create: `src/world/hydrology/HydrologyTypes.ts`
- Create: `src/world/hydrology/DepressionResolver.ts`
- Create: `src/world/hydrology/DrainageGraph.ts`
- Create: `tests/world-hydrology.test.ts`

**Interfaces:**
- Produces `resolveDepressions(width, height, rawElevation, permanentWater): Float64Array`.
- Produces `D8_CLOCKWISE = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]`.
- Produces `DrainageGraph.receiverIndex(index): number | null`, `listOutlets()`, `flowAccumulation()`.

- [ ] **Step 1: Write priority-flood/D8 tests**

Use hand-authored 5×5 bowls and tie grids. Assert the center artificial sink is raised enough to drain, raw input is not mutated, every receiver has conditioned elevation `<=` source within tolerance, and equal-gradient ties choose the earliest neighbor in `D8_CLOCKWISE`.

```ts
test('D8 ties use fixed clockwise precedence beginning at north', () => {
  const graph = DrainageGraph.build(3, 3, new Float64Array([
    9,4,9,
    4,5,4,
    9,4,9,
  ]), new Uint8Array(9));
  assert.equal(graph.receiverIndex(4), 1);
});
```

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-hydrology.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic priority flood**

Seed a binary min-heap with boundary cells plus explicit permanent-water sinks. Heap ordering is `(elevation, index)` to make ties deterministic. For each unvisited neighbor, conditioned elevation becomes `max(rawNeighbor, poppedElevation)` and is pushed once.

- [ ] **Step 4: Implement D8 receiver graph**

For each non-permanent-water cell, inspect valid neighbors in `D8_CLOCKWISE`, choose the maximum positive `(sourceElevation - neighborElevation) / distance`; ties retain the first direction. Flat conditioned paths created by priority flood must use deterministic outlet-distance/index fallback so cells do not form cycles.

- [ ] **Step 5: Run hydrology tests and static checks**

```bash
node --experimental-strip-types --test tests/world-hydrology.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0.

- [ ] **Step 6: Commit conditioning/routing**

```bash
git add src/world/hydrology/HydrologyTypes.ts src/world/hydrology/DepressionResolver.ts src/world/hydrology/DrainageGraph.ts tests/world-hydrology.test.ts
git commit -m "feat: add deterministic terrain drainage"
```

---

### Task 6: Watersheds, Accumulation, Channels, and Static Flood Susceptibility

**Files:**
- Create: `src/world/hydrology/WatershedModel.ts`
- Create: `src/world/hydrology/HydrologyModel.ts`
- Modify: `tests/world-hydrology.test.ts`

**Interfaces:**
- Produces `WatershedRecord { id, outletIndex, memberCount, upstreamAreaCells, primaryChannelId }`.
- Produces `ChannelSegment { id, fromIndex, toIndex, accumulation, capacityVolume }`.
- Produces `HydrologyModel.build(terrain): HydrologyModel`.
- Produces `hydrology.watershedIdAt()`, `flowAccumulationAt()`, `channels()`, `floodSusceptibilityAt()`, `snapshotAuthoritative()`.

- [ ] **Step 1: Add failing watershed/channel tests**

Assert every routable land cell has one watershed, total member counts equal non-permanent-water count, accumulation at a receiver is at least each direct upstream value, channel segments follow drainage receivers, and susceptibility is higher in low-elevation/high-accumulation cells than adjacent ridge cells in a controlled fixture.

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-hydrology.test.ts
```

Expected: FAIL on missing watershed/model interfaces.

- [ ] **Step 3: Implement topological accumulation and watershed IDs**

Count indegree from receiver edges, process zero-indegree nodes in ascending index order, propagate `1 + upstream`. Trace each cell to its terminal outlet with path compression. Assign watershed IDs by sorted outlet index: `watershed:0000`, `watershed:0001`, etc.

- [ ] **Step 4: Extract channels and susceptibility**

Use a deterministic channel threshold `max(12, floor(width * height * 0.015))`. A routed edge is a channel when source accumulation exceeds threshold. Capacity volume scales with `sqrt(accumulation)` and remains finite/positive. Susceptibility combines normalized accumulation, local relative elevation and channel proximity, clamped `[0,1]`.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types --test tests/world-hydrology.test.ts tests/world-generation.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 6: Commit watershed model**

```bash
git add src/world/hydrology/WatershedModel.ts src/world/hydrology/HydrologyModel.ts tests/world-hydrology.test.ts
git commit -m "feat: add watersheds and terrain-derived channels"
```

---

### Task 7: Deterministic Design-Storm Flood Model with Water Conservation

**Files:**
- Create: `src/world/hydrology/FloodModel.ts`
- Create: `tests/world-flooding.test.ts`

**Interfaces:**
- Produces `DesignStormEvent { id, rainfallMm, durationHours, saturationFactor?: number }`.
- Produces `FloodExternalSurface { imperviousFractionAt(x,y): number }`; 1R default is zero imperviousness.
- Produces `FloodResult { eventId, depthMeters, rainfallVolume, infiltrationVolume, retainedChannelSurfaceVolume, overbankFloodVolume, exportedVolume, balanceError }`.
- Produces `FloodModel.run(event, terrain, hydrology, externalSurface?): FloodResult`.

- [ ] **Step 1: Write flood conservation tests**

```ts
test('zero rainfall produces zero flood depth and exact zero balance', () => {
  const result = fixtureFloodModel().run({ id: 'dry', rainfallMm: 0, durationHours: 1 }, fixtureTerrain(), fixtureHydrology());
  assert.ok(result.depthMeters.every((v) => v === 0));
  assert.equal(result.balanceError, 0);
});

test('design storm water balance closes', () => {
  const result = runFixtureStorm(80);
  assert.ok(Math.abs(result.balanceError) <= Math.max(1e-9, result.rainfallVolume * 1e-9));
});
```

Also test rainfall monotonic runoff, clay vs gravel infiltration, nonnegative finite depth, deterministic replay and imperviousness reducing infiltration.

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-flooding.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement infiltration and routed runoff**

For each cell:

```ts
const rainfallM = event.rainfallMm / 1000;
const potentialInfiltrationM = properties.infiltrationMmPerHour * event.durationHours / 1000;
const impervious = clamp01(externalSurface?.imperviousFractionAt(x, y) ?? 0);
const infiltrationM = Math.min(rainfallM, potentialInfiltrationM * (1 - impervious) * (1 - 0.75 * saturation));
const runoffVolume = Math.max(0, rainfallM - infiltrationM) * cellAreaM2;
```

Route runoff in drainage topological order. Channel cells retain up to `capacityVolume`; overflow becomes overbank storage assigned to source/receiver low cells; terminal outlet flow is exported. Derive flood depth as overbank volume / cell area.

- [ ] **Step 4: Close accounting from exact accumulators**

Calculate balance from accumulated model terms, not by reconstructing from rounded display depths:

```ts
const balanceError = rainfallVolume - infiltrationVolume - retainedChannelSurfaceVolume - overbankFloodVolume - exportedVolume;
```

Reject non-finite input and negative rainfall/duration.

- [ ] **Step 5: Run flood/hydrology tests**

```bash
node --experimental-strip-types --test tests/world-flooding.test.ts tests/world-hydrology.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 6: Commit flood mechanics**

```bash
git add src/world/hydrology/FloodModel.ts tests/world-flooding.test.ts
git commit -m "feat: add deterministic flood event model"
```

---

### Task 8: Scenario Overrides and Complete WorldGenerator Pipeline

**Files:**
- Create: `src/world/generation/ScenarioWorldDefinition.ts`
- Create: `src/world/generation/WorldGenerator.ts`
- Modify: `src/world/geography/AdministrativeBoundaryGenerator.ts`
- Modify: `tests/world-generation.test.ts`

**Interfaces:**
- Produces `ScenarioWorldDefinition` override types for extent, elevation/control samples, permanent water, soil regions, groundwater, contamination, boundaries and preset config.
- Produces `generateWorldComponents({ seed, config, scenario?, randomRegistry }): GeneratedWorldComponents`.

- [ ] **Step 1: Add failing pipeline/override precedence tests**

Assert precedence `defaults < preset < generated < scenario`, scenario contamination can introduce nonzero contamination while generated default is zero, authored water remains permanent through depression conditioning, malformed polygons are rejected, and same scenario+seed produces identical output.

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-generation.test.ts
```

Expected: FAIL on missing scenario/pipeline APIs.

- [ ] **Step 3: Implement override validation and application**

Validate every override coordinate/region against world bounds. Apply scalar/region overrides in deterministic array order after generated state. Authored administrative boundaries replace generated boundaries only after a complete `GeographyHierarchy` validates them.

- [ ] **Step 4: Implement ordered `WorldGenerator`**

The method order is fixed:

```ts
const physical = generatePhysicalTerrain(config, streams);
const overridden = applyScenarioPhysicalOverrides(physical, scenario);
const conditioned = resolveDepressions(...);
const hydrology = HydrologyModel.build(overridden, conditioned);
const terrain = overridden.withHydrology(hydrology);
const geography = scenario?.administrativeBoundaries
  ? new GeographyHierarchy(scenario.administrativeBoundaries)
  : new GeographyHierarchy(generateAdministrativeHierarchy(root, streams.boundaries));
return { terrain, hydrology, geography, generation: metadata };
```

- [ ] **Step 5: Run all world-generation tests**

```bash
node --experimental-strip-types --test tests/world-generation.test.ts tests/world-geography.test.ts tests/world-hydrology.test.ts tests/world-flooding.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 6: Commit scenario/pipeline**

```bash
git add src/world/generation src/world/geography/AdministrativeBoundaryGenerator.ts tests/world-generation.test.ts
git commit -m "feat: compose deterministic world generation pipeline"
```

---

### Task 9: Derived Spatial Index and Stable Geographic Queries

**Files:**
- Create: `src/world/geometry/GeometryIndex.ts`
- Create: `tests/world-spatial-index.test.ts`

**Interfaces:**
- Produces `GeometryIndex.rebuild(entities, channels, points)`.
- Produces `entitiesAt(point, kind?)`, `queryBounds(bounds, kind?)`, `nearbyPoints(point, radius)`, `channelsNear(point, radius)`.
- Query output is always stable by distance then ID or kind-depth then ID, never Map insertion order.

- [ ] **Step 1: Write index correctness/rebuild tests**

Compare indexed point-in-area results to direct `pointInPolygon()` for a fixture, assert stable boundary tie behavior, rebuild produces identical answers, and source entity mutation is impossible because authoritative entities are immutable.

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-spatial-index.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic uniform buckets**

Use a derived uniform grid whose bucket size is `max(4, sqrt(worldArea / max(1, entityCount)))` planning units. Insert entity IDs into every overlapping bucket and sort IDs after rebuild. Queries deduplicate IDs with a `Set`, then perform exact geometry checks and deterministic final sort.

- [ ] **Step 4: Run index + geography tests**

```bash
node --experimental-strip-types --test tests/world-spatial-index.test.ts tests/world-geography.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 5: Commit index**

```bash
git add src/world/geometry/GeometryIndex.ts tests/world-spatial-index.test.ts
git commit -m "feat: add deterministic world spatial index"
```

---

### Task 10: WorldFoundation Composition, LegacyTerrainAdapter, and SimulationCore Compatibility

**Files:**
- Create: `src/world/foundation/WorldFoundationTypes.ts`
- Create: `src/world/foundation/WorldFoundation.ts`
- Create: `src/world/terrain/LegacyTerrainAdapter.ts`
- Create: `src/world/migration/V7WorldMigration.ts`
- Modify: `src/world/terrain/TerrainGrid.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Create: `tests/world-foundation-integration.test.ts`
- Modify: `tests/core-foundation.test.ts`
- Modify: `tests/city-foundation.test.ts`

**Interfaces:**
- Produces `WorldFoundationMode = 'generated-1r' | 'legacy-flat' | 'legacy-explicit'`.
- Produces `WorldFoundation.generate({ seed, config, randomRegistry, scenario? })`.
- Produces `WorldFoundation.fromLegacyTerrain(terrain, seed, mode)`.
- Produces `world.terrain`, `world.hydrology`, `world.geography`, `world.spatialIndex`.
- Produces `world.legacyTerrain(): TerrainGrid`.
- Produces `world.preparationMultiplierAt(x,y)`, `world.runDesignStorm(event)` and `world.snapshotAuthoritative()`.
- `SimulationCoreOptions` gains optional `world?: WorldFoundation`, `worldConfig?: Partial<WorldGenerationConfig>`, `scenarioWorld?: ScenarioWorldDefinition`; `terrain` remains supported and takes legacy-explicit precedence.

- [ ] **Step 1: Write compatibility-first integration tests**

Test direct terrain construction remains byte-identical, generated core gets `world.mode === 'generated-1r'`, `core.terrain` still supports renderer/road/zoning contracts, `terrain` option results in `legacy-explicit`, and static world does not change from `core.step(100)`.

```ts
test('direct TerrainGrid core stays legacy-explicit and neutral', () => {
  const terrain = flatTerrain();
  const core = new SimulationCore({ terrain, seed: 9, startingFunds: 1000 });
  assert.equal(core.world.mode, 'legacy-explicit');
  assert.equal(core.world.preparationMultiplierAt(2, 2), 1);
  assert.deepEqual(core.terrain.snapshot(), terrain.snapshot());
});
```

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-foundation-integration.test.ts tests/core-foundation.test.ts tests/city-foundation.test.ts
```

Expected: new test fails; existing tests still pass before integration.

- [ ] **Step 3: Implement legacy conversion**

Use a documented legacy elevation conversion such as `elevationMeters = legacy.elevation * 100`. Preserve old `water`, `buildable`, and `biome` directly in `TerrainGrid` compatibility output; do not recompute placement legality from 1R thresholds for legacy modes. Assign neutral loam/default engineering values and force preparation multiplier `1.0` for legacy buildable cells.

- [ ] **Step 4: Implement `WorldFoundation` and generated legacy view**

`WorldFoundation` owns authoritative components and rebuilds its `GeometryIndex`. `legacyTerrain()` maps each 1R sample to the existing four-field `TerrainCell`:

```ts
return {
  elevation: sample.elevationMeters / 100,
  water: sample.surfaceWater !== 'none',
  buildable: terrain.isBuildable(x, y),
  biome: sample.surfaceWater !== 'none' ? 'water' : sample.vegetationClass === 'forest' ? 'forest' : sample.slope > 0.55 ? 'rock' : 'grass',
};
```

- [ ] **Step 5: Integrate `SimulationCore` constructor without moving other domains**

Construction precedence is exact:

```ts
if (options.world) this.world = options.world;
else if (options.terrain) this.world = WorldFoundation.fromLegacyTerrain(options.terrain, this.seed, 'legacy-explicit');
else this.world = WorldFoundation.generate({ seed: this.seed, config: resolveWorldGenerationConfig(...), randomRegistry: this.kernel.random, scenario: options.scenarioWorld });
this.terrain = this.world.legacyTerrain();
```

Register `kernel.snapshots.register('world', () => this.world.diagnosticSnapshot())` and a cadence-1 invariant that checks only lightweight immutable world dimensions/reference validity; do not run hydrology each tick.

- [ ] **Step 6: Run compatibility suites**

```bash
node --experimental-strip-types --test tests/world-foundation-integration.test.ts tests/core-foundation.test.ts tests/city-foundation.test.ts tests/kernel-v7-parity.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0 and the committed V7 parity fixture remains unchanged for explicit flat-terrain scenarios.

- [ ] **Step 7: Commit world composition/integration**

```bash
git add src/world/foundation src/world/terrain/LegacyTerrainAdapter.ts src/world/migration src/world/terrain/TerrainGrid.ts src/simulation/core/SimulationCore.ts tests/world-foundation-integration.test.ts tests/core-foundation.test.ts tests/city-foundation.test.ts
git commit -m "feat: integrate world foundation behind V7 terrain facade"
```

---

### Task 11: Save V8 World Persistence and Honest V3–V7 Migration

**Files:**
- Create: `src/save/saveV8.ts`
- Modify: `src/save/save.ts`
- Create: `tests/save-v8.test.ts`
- Modify: `tests/save-v7.test.ts`

**Interfaces:**
- Produces `SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion'> & { saveVersion: 8; gameVersion: '0.8.0-world-foundation'; world: WorldFoundationSnapshot }`.
- Produces `serializeCoreV8(core): SaveV8` and `hydrateCoreV8(input): SimulationCore`.
- Default `serializeCore()` returns `SaveV8`; default `hydrateCore()` routes through V8.
- Explicit `serializeCoreV7()` remains exported for compatibility tests/tools.

- [ ] **Step 1: Write Save V8 tests before changing default serializer**

Cover generated-world exact round trip, active flood result/state if authoritative, legacy-explicit round trip, V7→V8 migration preservation of placed roads/zones/buildings/funds, deterministic repeated V7 migration, corrupt terrain array lengths, corrupt hierarchy references and no fabricated historical flood events.

```ts
test('default save becomes V8 and preserves authoritative world exactly', () => {
  const core = new SimulationCore({ width: 32, height: 20, seed: 42 });
  const save = serializeCoreV8(core);
  assert.equal(save.saveVersion, 8);
  assert.equal(save.gameVersion, '0.8.0-world-foundation');
  const loaded = hydrateCoreV8(structuredClone(save));
  assert.deepEqual(loaded.world.snapshotAuthoritative(), core.world.snapshotAuthoritative());
});
```

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/save-v8.test.ts
```

Expected: FAIL because Save V8 does not exist.

- [ ] **Step 3: Implement world snapshot serialization/restore**

Persist generation metadata, geography entities, raw authoritative terrain/geotechnical arrays, permanent water/channel state and active flood state only. Do not serialize `GeometryIndex`, lookup Maps, slope/aspect when regenerated exactly from stored authoritative elevation if implementation proves byte-equivalent reconstruction, or diagnostic susceptibility rendering caches.

- [ ] **Step 4: Implement V7 migration path**

`hydrateCoreV8(input)`:

```ts
if (record.saveVersion !== 8) {
  const legacyCore = hydrateCoreV7(input);
  legacyCore.replaceWorldForMigration(WorldFoundation.fromLegacyTerrain(legacyCore.terrain, legacyCore.seed, 'legacy-flat'));
  return legacyCore;
}
```

If mutating a readonly property would be required, instead add a narrowly scoped constructor/static hydration entry point on `SimulationCore`; do not use casts to defeat readonly ownership.

- [ ] **Step 5: Switch default save API to V8**

Update `save.ts` exports and make existing `sanitizePausedServiceState` generic over the V7-derived fields so sanitation runs before the V8 wrapper is returned. Update `tests/save-v7.test.ts` to call `serializeCoreV7()` for explicit V7 schema assertions and add an assertion that default `serializeCore()` is V8 in `save-v8.test.ts`.

- [ ] **Step 6: Run all save/regression tests**

```bash
node --experimental-strip-types --test tests/save-v3.test.ts tests/save-v4.test.ts tests/save-v5.test.ts tests/save-v6.test.ts tests/save-v7.test.ts tests/save-v8.test.ts tests/kernel-v7-parity.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0.

- [ ] **Step 7: Commit Save V8**

```bash
git add src/save/saveV8.ts src/save/save.ts src/simulation/core/SimulationCore.ts tests/save-v8.test.ts tests/save-v7.test.ts
git commit -m "feat: persist world foundation in Save V8"
```

---

### Task 12: Terrain Cost Hooks for Roads and Development without Breaking Legacy Economics

**Files:**
- Modify: `src/world/roads/RoadSystem.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `tests/city-foundation.test.ts`
- Create: `tests/world-cost-integration.test.ts`

**Interfaces:**
- `RoadSystem` constructor gains optional `costMultiplierAt?: (x: number, y: number) => number`.
- Road cost becomes `sum(baseConstructionCostPerCell * multiplier)` rounded once to cents with `Math.round(total * 100) / 100`.
- Direct/legacy world provider always returns `1`.
- Development local parcel `constructionCostIndex = clamp(existingIndex * world.preparationMultiplierAt(lot.x, lot.y), 0.85, 1.50)` using the existing safety bounds.

- [ ] **Step 1: Write legacy and generated-cost tests**

Keep the existing exact `120` three-local-cell road assertion. Add a generated/fixture provider where multipliers `[1, 1.5, 2]` produce exact cost `40 + 60 + 80 = 180`. Add development test showing a difficult terrain lot has a greater `hardConstructionCost` than an otherwise identical neutral lot.

- [ ] **Step 2: Verify red state for new behavior**

```bash
node --experimental-strip-types --test tests/world-cost-integration.test.ts tests/city-foundation.test.ts
```

Expected: new generated-cost assertions fail while legacy road test remains green.

- [ ] **Step 3: Implement optional road terrain-cost provider**

Validate multiplier finite and `> 0`; use provider only for new coordinates. Restore continues to validate legality but does not charge cost. `SimulationCore` passes `(x,y) => this.world.preparationMultiplierAt(x,y)`.

- [ ] **Step 4: Multiply existing development cost channel**

Change only the calculation in `localParcelContextForLot()`:

```ts
const serviceUtilityCostIndex = clamp(1 + (1 - utilityRatio) * 0.20 + (1 - serviceQuality) * 0.10, 0.85, 1.50);
const terrainPreparation = this.world.preparationMultiplierAt(lot.x, lot.y);
const constructionCostIndex = clamp(serviceUtilityCostIndex * terrainPreparation, 0.85, 1.50);
```

Do not add a second site-cost charge elsewhere in `DevelopmentFeasibilitySystem`.

- [ ] **Step 5: Run development/city compatibility suites**

```bash
node --experimental-strip-types --test tests/world-cost-integration.test.ts tests/city-foundation.test.ts tests/development-feasibility.test.ts tests/development-integration.test.ts tests/developer-market.test.ts tests/kernel-v7-parity.test.ts
npm run typecheck
```

Expected: all exit 0; V7 explicit terrain costs and parity remain exact.

- [ ] **Step 6: Commit cost integration**

```bash
git add src/world/roads/RoadSystem.ts src/simulation/core/SimulationCore.ts tests/city-foundation.test.ts tests/world-cost-integration.test.ts
git commit -m "feat: apply terrain costs to infrastructure and development"
```

---

### Task 13: Flood Events, Kernel Diagnostics, and Presentation-Safe World Read Hooks

**Files:**
- Modify: `src/world/foundation/WorldFoundationTypes.ts`
- Modify: `src/world/foundation/WorldFoundation.ts`
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/rendering/passes/GroundRenderPass.ts`
- Modify: `tests/world-foundation-integration.test.ts`
- Create: `tests/world-presentation-contract.test.ts`

**Interfaces:**
- Produces `SimulationCore.runDesignStorm(event: DesignStormEvent): FloodResult`.
- Emits `FloodEventStarted` then `FloodEventResolved` to `kernel.events` with immutable summary payloads.
- Generated construction emits/records `WorldGenerated` once at core creation; legacy migration path emits `WorldMigratedTo1R` only during actual migration/hydration, not normal V8 load.
- Renderer may read `core.world.terrain.get()` but performs no mutations.

- [ ] **Step 1: Write event and presentation-contract tests**

Assert design storm produces exactly ordered start/resolved events, repeated event output is deterministic from identical initial state, dry storm leaves depths zero, and renderer source contains no world mutation APIs. Add a minimal GroundRenderPass contract that generated `surfaceWater` still maps to existing water visuals via `core.terrain`, so this task does not require new art.

- [ ] **Step 2: Verify red state**

```bash
node --experimental-strip-types --test tests/world-foundation-integration.test.ts tests/world-presentation-contract.test.ts
```

Expected: FAIL on missing public design-storm/event hooks.

- [ ] **Step 3: Add explicit storm execution and events**

`runDesignStorm()` appends:

```ts
this.kernel.events.append(this.clock.tick, { type: 'FloodEventStarted', source: 'world', payload: { eventId: event.id, rainfallMm: event.rainfallMm, durationHours: event.durationHours } });
const result = this.world.runDesignStorm(event);
this.kernel.events.append(this.clock.tick, { type: 'FloodEventResolved', source: 'world', payload: { eventId: event.id, floodedCells: countPositive(result.depthMeters), balanceError: result.balanceError } });
return result;
```

Keep flood execution command-like and explicit; do not insert storms into `runLegacyV7Tick()`.

- [ ] **Step 4: Keep rendering compatibility minimal**

Only adjust `GroundRenderPass` if generated terrain compatibility needs a stable visual mapping. Do not add authoritative rendering state or new overlay mode in 1R. Existing tile size, camera and selection remain unchanged.

- [ ] **Step 5: Run world + isometric contract tests**

```bash
node --experimental-strip-types --test tests/world-foundation-integration.test.ts tests/world-presentation-contract.test.ts tests/isometric-projection.test.ts tests/isometric-assets.test.ts tests/presentation-contract.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 6: Commit events/presentation hooks**

```bash
git add src/world/foundation src/simulation/core/SimulationCore.ts src/rendering/passes/GroundRenderPass.ts tests/world-foundation-integration.test.ts tests/world-presentation-contract.test.ts
git commit -m "feat: expose world flood diagnostics safely"
```

---

### Task 14: 10k Spatial Query Performance Gate and World-Generation Long-Run Checks

**Files:**
- Create: `tests/world-performance.test.ts`

**Interfaces:**
- No production API changes unless profiling proves a bounded derived-index optimization is required.
- Uses `node:perf_hooks` in tests only.

- [ ] **Step 1: Add diagnostic performance tests**

Build a 96×64 generated world and execute 10,000 deterministic district/neighborhood/block membership queries. Time both direct polygon scanning and indexed queries; assert answer parity. Use a generous CI safety gate rather than hardware-specific microbenchmarking:

```ts
assert.ok(indexedMs < 2500, `10k indexed geography queries too slow: ${indexedMs.toFixed(1)}ms`);
```

Also construct/reference-generate all six presets at 96×64 and assert completion plus finite state without a strict cross-hardware generation threshold; record elapsed values to diagnostic output.

- [ ] **Step 2: Run performance test**

```bash
node --experimental-strip-types --test tests/world-performance.test.ts
```

Expected: PASS within the 2.5s spatial-query safety gate.

- [ ] **Step 3: Run long-run static-world invariant check**

In the test, snapshot `core.world.snapshotAuthoritative()`, run `core.step(5000)`, and assert unchanged world state when no design storm or physical-world mutation occurs.

- [ ] **Step 4: Run full world test group**

```bash
node --experimental-strip-types --test tests/world-*.test.ts
npm run typecheck
npm run lint
```

Expected: all exit 0.

- [ ] **Step 5: Commit performance evidence**

```bash
git add tests/world-performance.test.ts
git commit -m "test: add 1R world performance gates"
```

---

### Task 15: Full 1R Headless Acceptance, Documentation, and Final Verification

**Files:**
- Create: `tests/phase1r-headless.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`
- Modify: `README.md`
- Modify: `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- No new runtime interfaces. This task validates the complete tranche and documents only implemented behavior.

- [ ] **Step 1: Write the complete headless acceptance scenario**

`tests/phase1r-headless.test.ts` must:

1. generate a 48×32 `river_valley` world with seed `20260825`;
2. assert valid hierarchy and at least one terrain-derived channel;
3. find a buildable three-cell road path deterministically by scanning y/x order;
4. build a road and adjacent zoning through existing APIs;
5. place required utilities on buildable road-adjacent cells;
6. step the city enough to prove existing simulation operates;
7. run an 80 mm / 2 h design storm;
8. assert water balance tolerance and nonnegative depth;
9. serialize as V8;
10. hydrate;
11. assert immediate Save V8 equality and world authoritative equality;
12. step original and loaded cores identically and assert serialized equality.

The test must not hard-code cells that happen to be unbuildable for the reference world; use deterministic scanning helpers.

- [ ] **Step 2: Run acceptance test alone**

```bash
node --experimental-strip-types --test tests/phase1r-headless.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update architecture/status docs**

Document runtime path as:

```text
GameApp → SimulationCore facade → WorldFoundation + SimulationKernel → legacy V7 city domains
```

State explicitly that 1R owns physical geography/hydrology while road and lot authority remains V7-compatible pending 3R/2R. Update canonical save text to Save V8 / `0.8.0-world-foundation`, while noting explicit V3–V7 serializers/hydrators remain migration support.

- [ ] **Step 4: Update testing documentation**

Add commands and coverage for geometry, hierarchy, terrain generation, hydrology, flooding, Save V8, legacy migration, spatial performance and `phase1r-headless.test.ts`. Record diagnostic 10k-query timing from the verification run without presenting it as a universal hardware guarantee.

- [ ] **Step 5: Run full unit/integration verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Run all existing browser smoke gates**

```bash
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
```

Expected: all exit 0. Any browser regression is a 1R compatibility defect because 1R does not intentionally replace the renderer/UI.

- [ ] **Step 7: Run explicit legacy/save/parity gates**

```bash
node --experimental-strip-types --test tests/kernel-v7-parity.test.ts tests/save-v3.test.ts tests/save-v4.test.ts tests/save-v5.test.ts tests/save-v6.test.ts tests/save-v7.test.ts tests/save-v8.test.ts tests/city-foundation.test.ts
```

Expected: all exit 0.

- [ ] **Step 8: Inspect scope and file sizes**

```bash
git diff --name-only main...HEAD
find src/world -name '*.ts' -print0 | xargs -0 wc -l | sort -n
```

Expected: no Phase 2R legal-parcel implementation, no Phase 3R lane model, no unrelated domain rewrite; new source files should normally remain under 500 lines and none may cross 1,000 without review.

- [ ] **Step 9: Commit documentation and acceptance**

```bash
git add tests/phase1r-headless.test.ts docs/ARCHITECTURE.md docs/TESTING.md README.md docs/DEVELOPMENT_LOG.md
git commit -m "docs: record verified 1R world foundation"
```

- [ ] **Step 10: Capture completion evidence before claiming 1R complete**

Record fresh outputs/exit codes for:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
node --experimental-strip-types --test tests/phase1r-headless.test.ts tests/world-performance.test.ts
```

Completion report must include: total tests/failures; Save V8 round-trip and V7 migration result; V7 parity result; hydrology water-balance tolerance result; 10k-query timing; build/lint/typecheck status; all smoke statuses; final commit SHA; and deferred 2R/3R work explicitly left out.

---

## Plan Self-Review

### Spec coverage

- immutable irregular geometry primitives and shared tolerance — Task 1.
- Region→Municipality→District→Neighborhood→Block hierarchy — Task 2.
- stable IDs, parent validation, containment and non-overlap — Task 2.
- physical terrain samples, all eight locked soils and geotechnical preparation cost — Task 3.
- all six locked world presets and deterministic namespaced generation — Task 4.
- priority-flood conditioning and fixed-clockwise D8 routing — Task 5.
- complete watershed membership, accumulation, channels and susceptibility — Task 6.
- event flooding, infiltration, nonnegative depth and explicit water accounting — Task 7.
- scenario override precedence and authored geography validation — Task 8.
- rebuildable deterministic spatial index — Task 9.
- `WorldFoundation` composition and compatibility-backed `TerrainGrid` facade — Task 10.
- direct `TerrainGrid` fixtures remain neutral — Task 10.
- legacy-flat V7 conversion with preparation factor exactly `1.0` — Tasks 10–11.
- Save V8 and V3–V7 migration — Task 11.
- exact legacy road economics plus generated terrain road/development costs — Task 12.
- typed flood events and presentation-read-only boundary — Task 13.
- 10,000+ spatial-query performance gate and no static per-tick world work — Task 14.
- complete generation→city gameplay→storm→save/load→continue acceptance — Task 15.
- architecture/testing/status documentation — Task 15.

### Type consistency

The plan consistently uses these public names:

- `WorldFoundation`
- `WorldFoundationMode`
- `WorldGenerationConfig`
- `WorldFormPreset`
- `ScenarioWorldDefinition`
- `TerrainField`
- `TerrainSample`
- `SoilClass`
- `HydrologyModel`
- `FloodModel`
- `DesignStormEvent`
- `FloodResult`
- `GeographyHierarchy`
- `GeographyEntity`
- `GeometryIndex`
- `LegacyTerrainAdapter`
- `serializeCoreV8()` / `hydrateCoreV8()`
- `SimulationCore.runDesignStorm()`

### Placeholder scan

The plan contains no `TBD`, `TODO`, “implement later”, generic “write tests”, or undefined neighboring interfaces. Each material task states files, produced/consumed interfaces, a failing-test step, expected red state, implementation mechanics, green verification and a focused commit.

### Scope check

Phase 1R is large but remains one coherent dependency chain: every layer feeds the same authoritative geographic substrate and the later tasks cannot ship meaningfully without the earlier layers. Parcel economics/ownership and lane-level transportation remain explicitly deferred to 2R/3R rather than becoming independent subprojects inside this plan.
