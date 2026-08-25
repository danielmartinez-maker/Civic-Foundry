# Civic Foundry — Isometric Tier 1 Asset Pass A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's square top-down primitive world presentation with a production-ready all-raster 2:1 isometric renderer and a Tier 1 North American metropolitan asset pack, while preserving V7 simulation and save behavior exactly.

**Architecture:** Keep simulation state on the existing authoritative `(x,y)` grid. Add one isometric camera/projection contract, a presentation-only manifest/atlas registry, stable variant-family selection, raster atlas generation from source-controlled SVG sheets, and focused ground/object/vehicle/overlay passes. Canvas remains the compositor and analytical-overlay surface; terrain, roads, buildings, facilities, vegetation, construction, and moving vehicles render from PNG atlas regions at runtime.

**Tech Stack:** TypeScript 5.x ES modules, browser Canvas 2D, Node 22 built-in test runner with TypeScript strip-types, Python Playwright + Chromium for build-time SVG→PNG rasterization and browser smoke tests.

**Spec:** `docs/superpowers/specs/2026-08-24-isometric-tier1-asset-pass-a-design.md`

## Global Constraints

- Preserve V7 (`0.7.0-metropolitan`) authoritative simulation formulas, public mutation semantics, deterministic results, and `saveVersion: 7` behavior.
- Do not persist visual asset IDs, camera orientation, or presentation RNG state in gameplay saves.
- Runtime world art is raster. Canvas primitives remain valid only for analytical overlays, selection/tool feedback, and deliberate diagnostic fallback.
- Fixed 2:1 projection: 64×32 logical display tile at 1× zoom; source ground tile 128×64.
- Preserve approximately 0.45×–2.5× zoom, cursor-centered zoom, pan, and four quarter-turn camera orientations.
- V7 building gameplay footprints remain one cell. Sprite overhang is visual only.
- V7 road classes remain `local`, `collector`, and `arterial`; no new gameplay road classes in Pass A.
- Persistent visual choice must be deterministic from stable inputs; never use `Math.random()` for building/terrain/vehicle variants.
- Use a general North American metropolitan art baseline, fictional signage, no real logos, and no copied proprietary assets.
- Shared daylight: upper-left/northwest screen-space sun, shadows lower-right/southeast, restrained AO/saturation.
- Target at least 27 materially distinct completed building variants before orientation frames: 3 per zone × intensity family.
- Construction exposes four derived visual stages plus completion from existing timing only.
- Asset/manifest failure degrades to readable fallback rendering without crashing the simulation loop.
- Introduce no runtime npm dependency.
- Split `WorldRenderer.ts`; do not turn it into a larger coordinator.

## Locked File Map

**Create**
- `src/rendering/isometric/IsometricProjection.ts`
- `src/rendering/isometric/IsometricCamera.ts`
- `src/rendering/isometric/IsometricOverlayPainter.ts`
- `src/rendering/isometric/IsometricCulling.ts`
- `src/rendering/assets/AssetTypes.ts`
- `src/rendering/assets/AssetManifestValidation.ts`
- `src/rendering/assets/AssetRegistry.ts`
- `src/rendering/assets/PassAAssetManifest.ts`
- `src/rendering/assets/VariantSelector.ts`
- `src/rendering/assets/RoadAutotile.ts`
- `src/rendering/assets/ConstructionVisuals.ts`
- `src/rendering/assets/VehicleVisuals.ts`
- `src/rendering/assets/SpritePainter.ts`
- `src/rendering/passes/RenderOrder.ts`
- `src/rendering/passes/GroundRenderPass.ts`
- `src/rendering/passes/ObjectRenderPass.ts`
- `src/rendering/passes/OverlayRenderPass.ts`
- `src/rendering/passes/SelectionRenderPass.ts`
- `assets/source/{terrain,roads,buildings,construction,civic,utilities,vegetation,vehicles}.svg`
- `tools/render_isometric_atlases.py`
- `tests/isometric-projection.test.ts`
- `tests/isometric-road-autotile.test.ts`
- `tests/isometric-assets.test.ts`
- `tests/isometric-variant-selection.test.ts`
- `tests/isometric-render-order.test.ts`
- `tests/isometric-construction-visuals.test.ts`
- `tests/smoke/isometric_pass_a_smoke.py`
- `tests/smoke/isometric_visual_smoke.py`
- `docs/art/ASSET_BIBLE.md`
- `docs/art/PASS_A_REPORT.md`

**Modify**
- `src/rendering/WorldRenderer.ts`
- `src/rendering/VehicleRenderer.ts`
- `src/rendering/ServiceVehicleRenderer.ts`
- `src/rendering/TransitVehicleRenderer.ts`
- `src/rendering/FreightVehicleRenderer.ts`
- `src/ui/LandHousingUiController.ts`
- `src/app/GameApp.ts`
- `package.json`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT_LOG.md`

Generated build output:
- `dist/assets/atlases/{terrain,roads,buildings,construction,civic,utilities,vegetation,vehicles}.png`

---

### Task 1: Build the single isometric projection, rotation, camera, and picking contract

**Files:** Create `src/rendering/isometric/IsometricProjection.ts`, `src/rendering/isometric/IsometricCamera.ts`, `tests/isometric-projection.test.ts`.

**Produces:** `QuarterTurn`, `IsoMetrics`, `WorldSize`, `Point`, `DEFAULT_ISO_METRICS`, `rotateWorldPoint()`, `inverseRotateWorldPoint()`, `rotatedWorldSize()`, `projectRotatedPoint()`, `inverseProjectPoint()`, `diamondContains()`, and `IsometricCamera`.

- [ ] **Step 1: Write failing projection tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ISO_METRICS, projectRotatedPoint, inverseProjectPoint,
  rotateWorldPoint, inverseRotateWorldPoint,
} from '../src/rendering/isometric/IsometricProjection.ts';

const size = { width: 40, height: 24 } as const;

test('uses the 64x32 2:1 contract', () => {
  assert.deepEqual(DEFAULT_ISO_METRICS, { tileWidth: 64, tileHeight: 32 });
  assert.deepEqual(projectRotatedPoint(1, 0), { x: 32, y: 16 });
  assert.deepEqual(projectRotatedPoint(0, 1), { x: -32, y: 16 });
});

test('projection round-trips fractional points', () => {
  const p = projectRotatedPoint(7.25, 11.75);
  const world = inverseProjectPoint(p.x, p.y);
  assert.ok(Math.abs(world.x - 7.25) < 1e-9);
  assert.ok(Math.abs(world.y - 11.75) < 1e-9);
});

test('all quarter turns round-trip authoritative coordinates', () => {
  for (const turn of [0, 1, 2, 3] as const) {
    const r = rotateWorldPoint(6, 9, size, turn);
    assert.deepEqual(inverseRotateWorldPoint(r.x, r.y, size, turn), { x: 6, y: 9 });
  }
});
```

- [ ] **Step 2: Verify failure**

```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts
```
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement pure math helpers**

```ts
export type QuarterTurn = 0 | 1 | 2 | 3;
export type IsoMetrics = Readonly<{ tileWidth: number; tileHeight: number }>;
export type WorldSize = Readonly<{ width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;
export const DEFAULT_ISO_METRICS: IsoMetrics = Object.freeze({ tileWidth: 64, tileHeight: 32 });

export function projectRotatedPoint(x: number, y: number, m = DEFAULT_ISO_METRICS): Point {
  return { x: (x - y) * m.tileWidth / 2, y: (x + y) * m.tileHeight / 2 };
}

export function inverseProjectPoint(x: number, y: number, m = DEFAULT_ISO_METRICS): Point {
  const a = x / (m.tileWidth / 2);
  const b = y / (m.tileHeight / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function diamondContains(localX: number, localY: number, m = DEFAULT_ISO_METRICS): boolean {
  return Math.abs(localX) / (m.tileWidth / 2) + Math.abs(localY) / (m.tileHeight / 2) <= 1 + 1e-9;
}
```

Port current quarter-turn formulas from `WorldRenderer` into pure rotation helpers and support fractional coordinates for moving vehicles.

- [ ] **Step 4: Add camera round-trip tests**

For all four rotations, project `(0,0)`, `(39,0)`, `(0,23)`, `(39,23)`, and `(6,9)`, then verify `canvasToCell()` returns the original cell when given the projected center. Add edge/corner tests where points outside a diamond return `null` or the neighboring correct cell rather than a false hit.

- [ ] **Step 5: Implement `IsometricCamera`**

```ts
export class IsometricCamera {
  constructor(metrics?: IsoMetrics);
  get zoom(): number;
  get quarterTurns(): QuarterTurn;
  get tileWidth(): number;
  get tileHeight(): number;
  pan(dx: number, dy: number): void;
  zoomBy(factor: number, anchorX: number, anchorY: number): void;
  rotate(direction: -1 | 1): void;
  worldToCanvas(x: number, y: number, size: WorldSize): Point;
  canvasToCell(canvasX: number, canvasY: number, size: WorldSize): { x: number; y: number } | null;
  tileCenter(x: number, y: number, size: WorldSize): Point;
  tilePolygon(x: number, y: number, size: WorldSize): readonly Point[];
}
```

Use a rotation-aware horizontal map offset based on rotated height so negative `(x-y)` projection remains in the map bounding box. Clamp zoom to `0.45–2.5`; cursor anchoring must preserve the screen point under the cursor.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts
npm run typecheck
git add src/rendering/isometric tests/isometric-projection.test.ts
git commit -m "feat: add deterministic isometric camera projection"
```

---

### Task 2: Add road autotile masks and deterministic render ordering

**Files:** Create `src/rendering/assets/RoadAutotile.ts`, `src/rendering/passes/RenderOrder.ts`, `tests/isometric-road-autotile.test.ts`, `tests/isometric-render-order.test.ts`.

- [ ] **Step 1: Write failing mask tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAD_NORTH, ROAD_EAST, ROAD_SOUTH, roadConnectivityMask, rotateRoadMask }
  from '../src/rendering/assets/RoadAutotile.ts';

const roads = new Set(['2,2', '2,1', '3,2', '2,3']);
const lookup = (x: number, y: number) => roads.has(`${x},${y}`) ? 'local' as const : undefined;

test('derives topology mask', () => {
  assert.equal(roadConnectivityMask(2, 2, lookup), ROAD_NORTH | ROAD_EAST | ROAD_SOUTH);
});

test('camera rotation rotates mask bits', () => {
  assert.equal(rotateRoadMask(ROAD_NORTH, 1), ROAD_EAST);
});
```

Add table coverage for every mask `0..15`.

- [ ] **Step 2: Implement cardinal bits and rotation**

```ts
export const ROAD_NORTH = 1;
export const ROAD_EAST = 2;
export const ROAD_SOUTH = 4;
export const ROAD_WEST = 8;
```

Connectivity is to any cardinal road cell, regardless of road class, because current V7 topology supports class transitions. Camera rotation changes presentation mask only; it never mutates road topology.

- [ ] **Step 3: Write and implement render-order tests**

```ts
const keys = [
  makeDepthKey('objects', 4, 2, 0, 'b'),
  makeDepthKey('objects', 4, 2, 0, 'a'),
  makeDepthKey('objects', 2, 1, 0, 'z'),
].sort(compareDepthKeys);
assert.deepEqual(keys.map((k) => k.stableId), ['z', 'a', 'b']);
```

Use explicit scene layer ranks; within a layer sort by `rotatedX + rotatedY`, then elevation, then stable ID. Never use nondeterministic collection order as a tie-breaker.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/isometric-road-autotile.test.ts tests/isometric-render-order.test.ts
npm run typecheck
git add src/rendering/assets/RoadAutotile.ts src/rendering/passes/RenderOrder.ts tests/isometric-road-autotile.test.ts tests/isometric-render-order.test.ts
git commit -m "feat: add isometric road masks and render ordering"
```

---

### Task 3: Add the presentation manifest, variant families, validation, and safe registry

**Files:** Create `src/rendering/assets/AssetTypes.ts`, `AssetManifestValidation.ts`, `AssetRegistry.ts`, `VariantSelector.ts`, `PassAAssetManifest.ts`, `tests/isometric-assets.test.ts`, `tests/isometric-variant-selection.test.ts`.

**Key rule:** `variantKey` is stable across camera orientations. A building may change orientation frame when the camera rotates, but it must not become a different architectural variant.

- [ ] **Step 1: Define the schema and failing validation tests**

```ts
export type AssetManifestEntry = Readonly<{
  assetId: string;
  variantKey: string;
  atlasId: string;
  sourceRect: Readonly<{ x: number; y: number; width: number; height: number }>;
  footprint: Readonly<{ width: number; height: number }>;
  anchor: Readonly<{ x: number; y: number }>;
  category: string;
  subcategory?: string;
  zone?: 'residential' | 'commercial' | 'industrial';
  intensity?: 'low' | 'medium' | 'high';
  qualityTier?: 'economy' | 'standard' | 'premium' | 'luxury';
  condition?: 'new' | 'maintained' | 'aging' | 'neglected' | 'abandoned';
  constructionStage?: string;
  orientation?: 0 | 1 | 2 | 3;
  animation?: Readonly<{ frames: number; frameTicks: number }>;
  nightVariantAssetId?: string;
  weight?: number;
  tags?: readonly string[];
}>;

export type AtlasDescriptor = Readonly<{ atlasId: string; url: string; width: number; height: number }>;
export type AssetManifest = Readonly<{ schemaVersion: 1; atlases: readonly AtlasDescriptor[]; entries: readonly AssetManifestEntry[] }>;
```

Tests must reject duplicate `assetId`, unknown atlas IDs, non-positive rectangles/footprints, out-of-bounds source rectangles, invalid weights, invalid orientation, and nonexistent night-variant targets.

- [ ] **Step 2: Implement pure manifest validation**

`validateAssetManifest(manifest): string[]` returns all validation errors without throwing. `AssetRegistry` throws only during constructor programmer-error setup if schema itself is unusable; runtime missing images become fallback resolutions.

- [ ] **Step 3: Write stable variant-family tests**

```ts
const variants = [
  { variantKey: 'house-a', weight: 1 },
  { variantKey: 'house-b', weight: 1 },
  { variantKey: 'house-c', weight: 1 },
] as const;
const chosen = selectWeightedVariantKey('building:lot-8', variants);
assert.equal(chosen, selectWeightedVariantKey('building:lot-8', variants));
```

For 100 stable keys assert all three families appear. No selector may call `Math.random()`.

- [ ] **Step 4: Implement stable hashing and orientation-safe selection**

Use FNV-1a or equivalent in `stableHash32()`. Sort candidate variant families by `variantKey` before applying weights. Selection flow for any oriented asset is:
1. select `variantKey` using a key that excludes camera orientation;
2. resolve the entry with that `variantKey` and requested orientation;
3. if the variant is explicitly tagged `symmetric`, orientation 0 may be reused;
4. otherwise return fallback if the orientation frame is missing.

- [ ] **Step 5: Implement `AssetRegistry`**

```ts
export type AssetResolution =
  | Readonly<{ kind: 'sprite'; entry: AssetManifestEntry; image: HTMLImageElement }>
  | Readonly<{ kind: 'fallback'; assetId: string; reason: string }>;

export class AssetRegistry {
  constructor(manifest: AssetManifest);
  preload(): Promise<void>;
  get ready(): boolean;
  query(query: AssetQuery): readonly AssetManifestEntry[];
  resolveAssetId(assetId: string): AssetResolution;
  resolveVariant(variantKey: string, orientation: 0 | 1 | 2 | 3): AssetResolution;
  diagnostics(): readonly string[];
}
```

Build indexes once in the constructor. Load one `Image` per atlas URL. Cache image handles/failures and deduplicate diagnostics so rendering cannot flood the console.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-variant-selection.test.ts
npm run typecheck
git add src/rendering/assets/AssetTypes.ts src/rendering/assets/AssetManifestValidation.ts src/rendering/assets/AssetRegistry.ts src/rendering/assets/VariantSelector.ts src/rendering/assets/PassAAssetManifest.ts tests/isometric-assets.test.ts tests/isometric-variant-selection.test.ts
git commit -m "feat: add isometric asset registry and stable variant families"
```

---

### Task 4: Add a reproducible source-art to raster-atlas build pipeline

**Files:** Create `tools/render_isometric_atlases.py`, eight `assets/source/*.svg` sheets; modify `package.json`.

- [ ] **Step 1: Create transparent source SVG sheets with explicit dimensions**

Each sheet has a transparent background and fixed pixel dimensions. No remote images, fonts, or external URLs. Example root:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="64" viewBox="0 0 1024 64">
  <defs><clipPath id="diamond"><polygon points="64,0 128,32 64,64 0,32"/></clipPath></defs>
</svg>
```

- [ ] **Step 2: Implement `tools/render_isometric_atlases.py`**

Required commands:

```bash
python tools/render_isometric_atlases.py --check
python tools/render_isometric_atlases.py
```

`--check` verifies all eight sources and numeric root dimensions without Chromium. Normal mode uses Python Playwright/Chromium to render each SVG at exact pixel dimensions with transparent background to `dist/assets/atlases/<name>.png`. Any failure exits non-zero.

- [ ] **Step 3: Update build scripts**

```json
"assets:check": "python tools/render_isometric_atlases.py --check",
"assets:build": "python tools/render_isometric_atlases.py",
"build": "rm -rf dist && tsc -p tsconfig.json && cp index.html dist/index.html && cp src/styles.css dist/styles.css && python tools/render_isometric_atlases.py"
```

Keep existing scripts intact.

- [ ] **Step 4: Verify PNG output signatures**

```bash
npm run assets:check
npm run build
python - <<'PY'
from pathlib import Path
for n in ('terrain','roads','buildings','construction','civic','utilities','vegetation','vehicles'):
    p = Path('dist/assets/atlases') / f'{n}.png'
    assert p.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
print('atlas PNG signatures ok')
PY
```

- [ ] **Step 5: Commit source pipeline only**

```bash
git add tools/render_isometric_atlases.py assets/source package.json
git commit -m "build: add reproducible isometric atlas pipeline"
```

---

### Task 5: Author terrain and all road masks

**Files:** Modify `assets/source/terrain.svg`, `assets/source/roads.svg`, `PassAAssetManifest.ts`, relevant tests.

- [ ] **Step 1: Lock first-pass art constants**

```ts
export const PASS_A_ART_BIBLE = Object.freeze({
  grass: '#7f956e', forestGround: '#647d59', rock: '#7d7f7d', water: '#5f88a4',
  asphalt: '#3f454a', sidewalk: '#b9b1a5', concrete: '#aaa79f',
  laneWhite: '#e3e0d5', laneYellow: '#d9be69', shadow: 'rgba(38,45,48,.24)',
} as const);
```

These guide source artwork only; they do not affect simulation values.

- [ ] **Step 2: Create two 128×64 variants for each current biome**

Create `terrain_grass_01/02`, `terrain_forest_01/02`, `terrain_rock_01/02`, `terrain_water_01/02`. Keep alpha transparent outside the diamond. Use low-frequency detail; no microscopic noise.

- [ ] **Step 3: Create all 48 road sprites**

Use a `2048×192` road sheet with 16 masks per row, each 128×64. Rows: local, collector, arterial. Source X is `mask * 128`; row Y is `0`, `64`, `128`.

Road carriageway targets:
- local ≈55% of diamond width;
- collector ≈68%;
- arterial ≈82%.

Include coherent curbs/sidewalks and restrained North American markings. No geometry may imply a connection missing from the mask.

- [ ] **Step 4: Register road entries mechanically**

```ts
const roadEntries = (['local','collector','arterial'] as const).flatMap((roadType, row) =>
  Array.from({ length: 16 }, (_, mask) => ({
    assetId: `road_${roadType}_mask_${mask.toString().padStart(2,'0')}`,
    variantKey: `road_${roadType}_mask_${mask.toString().padStart(2,'0')}`,
    atlasId: 'roads',
    sourceRect: { x: mask * 128, y: row * 64, width: 128, height: 64 },
    footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 32 },
    category: 'road', subcategory: roadType, orientation: 0 as const,
    tags: [`mask:${mask}`, 'symmetric-camera-mask'], weight: 1,
  })),
);
```

Road camera rotation is handled by rotating the mask, not by changing the road's authoritative topology.

- [ ] **Step 5: Add manifest coverage tests**

Assert exactly 48 road entries, masks `0..15` exactly once per class, all eight terrain variants, and all source rectangles within atlas bounds.

- [ ] **Step 6: Build/test/commit**

```bash
npm run build
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-road-autotile.test.ts
git add assets/source/terrain.svg assets/source/roads.svg src/rendering/assets/PassAAssetManifest.ts tests/isometric-assets.test.ts tests/isometric-road-autotile.test.ts
git commit -m "feat: add Tier 1 terrain and road atlases"
```

---

### Task 6: Author 27+ building variants and construction stages

**Files:** Modify `assets/source/buildings.svg`, `assets/source/construction.svg`, `PassAAssetManifest.ts`, `VariantSelector.ts`; create `ConstructionVisuals.ts`, `tests/isometric-construction-visuals.test.ts`.

- [ ] **Step 1: Write construction-stage test**

```ts
const building = {
  id: 'building:lot:1', lotId: 'lot:1', x: 2, y: 3, zone: 'residential',
  definitionId: 'residential_apartment', status: 'construction',
  constructionStartedTick: 100, completionTick: 200,
} as const;
assert.equal(constructionStageFor(building, 100), 'site');
assert.equal(constructionStageFor(building, 120), 'foundation');
assert.equal(constructionStageFor(building, 150), 'structure');
assert.equal(constructionStageFor(building, 180), 'facade');
assert.equal(constructionStageFor({ ...building, status: 'occupied' }, 220), 'complete');
```

Use thresholds `[0,.15) site`, `[.15,.35) foundation`, `[.35,.70) structure`, `[.70,1] facade`, occupied→complete.

- [ ] **Step 2: Author exactly these 27 core completed variant families**

Residential low: `res_low_detached_01`, `_02`, `_03`.
Residential medium: `res_mid_rowhouse_01`, `res_mid_walkup_01`, `res_mid_courtyard_01`.
Residential high: `res_high_slab_01`, `res_high_podium_01`, `res_high_tower_01`.

Commercial low: `com_low_corner_01`, `com_low_strip_01`, `com_low_office_01`.
Commercial medium: `com_mid_block_01`, `com_mid_office_01`, `com_mid_hotel_01`.
Commercial high: `com_high_office_01`, `com_high_hotel_01`, `com_high_corporate_01`.

Industrial low: `ind_low_workshop_01`, `ind_low_repair_01`, `ind_low_warehouse_01`.
Industrial medium: `ind_mid_distribution_01`, `ind_mid_logistics_01`, `ind_mid_factory_01`.
Industrial high: `ind_high_plant_01`, `ind_high_processing_01`, `ind_high_manufacturing_01`.

Each name above is a `variantKey`. Orientation frames use unique asset IDs such as `res_low_detached_01_o0` through `_o3`, or reuse an orientation-0 source rectangle only when tagged `symmetric`.

- [ ] **Step 3: Enforce architecture identity across rotation**

`selectBuildingAsset(building,tick,orientation,manifest)` first chooses `variantKey` from zone/intensity using stable key `${building.id}|${building.definitionId}`. Then resolve that same `variantKey` at requested orientation. The stable selection key must not contain camera orientation.

- [ ] **Step 4: Author construction families**

For each intensity `low|medium|high`, author `site`, `foundation`, `structure`, `facade` variant families. Use fencing/material stacks at early stages, exposed frame at structure, partial cladding/scaffolding at facade. Do not use a tower crane on low-density housing.

- [ ] **Step 5: Add coverage/repetition tests**

Assert at least three completed `variantKey`s for every zone/intensity family. For a synthetic 12×12 grid of stable building IDs, assert all three families appear and no row/column has more than five identical consecutive variant keys. Re-running selection must produce identical grids. Rotate the camera through all four orientations and assert each building retains its chosen `variantKey`.

- [ ] **Step 6: Build/test/commit**

```bash
npm run build
node --experimental-strip-types --test tests/isometric-construction-visuals.test.ts tests/isometric-variant-selection.test.ts tests/isometric-assets.test.ts
npm run typecheck
git add assets/source/buildings.svg assets/source/construction.svg src/rendering/assets/ConstructionVisuals.ts src/rendering/assets/PassAAssetManifest.ts src/rendering/assets/VariantSelector.ts tests/isometric-construction-visuals.test.ts tests/isometric-variant-selection.test.ts tests/isometric-assets.test.ts
git commit -m "feat: add Tier 1 buildings and construction art"
```

---

### Task 7: Author civic, utility, vegetation, and vehicle families

**Files:** Modify `assets/source/civic.svg`, `utilities.svg`, `vegetation.svg`, `vehicles.svg`, `PassAAssetManifest.ts`, tests.

- [ ] **Step 1: Author current civic/service facilities**

Create original raster-source families for fire station, police station, clinic, elementary school, landfill, and recycling center. Use orientation frames where entrance/apron direction is asymmetric. No floating letters replace architecture in normal rendering.

- [ ] **Step 2: Author current utilities**

Create `utility_power_01`, `utility_water_01`, and a separate legacy utility-landfill family only if the current utility API still exposes it independently. Keep mappings explicit to current service/utility type names.

- [ ] **Step 3: Author vegetation**

Create at least two young street trees, two mature street trees, three large forest/park trees, and two shrubs. Forest placement is deterministic from biome + coordinates and never authoritative.

- [ ] **Step 4: Author vehicle variant families with four orientation frames**

Required families: sedan/compact, SUV/pickup, delivery van, box truck, semi/freight truck, bus, BRT, tram, fire engine, police vehicle, ambulance, garbage truck. Use `variantKey` per authored vehicle design and `_o0.._o3` asset IDs.

- [ ] **Step 5: Add manifest coverage tests**

Assert every current service/utility type resolves, every required vehicle family has all four orientations unless explicitly symmetric, vegetation categories are present, and every entry references a known atlas.

- [ ] **Step 6: Build/test/commit**

```bash
npm run build
node --experimental-strip-types --test tests/isometric-assets.test.ts
npm run typecheck
git add assets/source/civic.svg assets/source/utilities.svg assets/source/vegetation.svg assets/source/vehicles.svg src/rendering/assets/PassAAssetManifest.ts tests/isometric-assets.test.ts
git commit -m "feat: add civic vegetation and vehicle art"
```

---

### Task 8: Add sprite painting, culling, ground pass, and object pass

**Files:** Create `SpritePainter.ts`, `IsometricCulling.ts`, `GroundRenderPass.ts`, `ObjectRenderPass.ts`; modify `WorldRenderer.ts`; extend render-order/projection tests.

- [ ] **Step 1: Implement `SpritePainter`**

```ts
export class SpritePainter {
  draw(
    ctx: CanvasRenderingContext2D,
    resolution: AssetResolution,
    anchor: Readonly<{ x: number; y: number }>,
    displayScale: number,
    fallback: Readonly<{ footprintWidth: number; footprintHeight: number; label?: string }>,
  ): void;
}
```

Sprite mode uses `drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh)` with manifest source rectangle and anchor. Fallback mode draws a restrained diagnostic isometric diamond/box; it is resilience, not normal art.

- [ ] **Step 2: Implement conservative culling**

`isProjectedSpriteVisible()` performs screen-space AABB checks using source size × display scale and anchor offsets, with a 32 logical-pixel margin to avoid pop-in. Ground tiles use projected diamond bounds.

- [ ] **Step 3: Implement `GroundRenderPass`**

Per frame:
1. determine visible cells;
2. draw deterministic terrain raster;
3. draw transparent zoning diamond underlay;
4. build one road lookup structure;
5. compute road mask and rotate mask to camera orientation;
6. draw `road_<type>_mask_XX` raster.

No simulation state writes.

- [ ] **Step 4: Implement `ObjectRenderPass`**

Build commands for visible buildings/construction, service facilities, utilities, and deterministic forest vegetation. Compute depth key from rotated coordinates + stable entity ID; sort once; draw through `SpritePainter`. Use `selectBuildingAsset()` and explicit facility maps.

- [ ] **Step 5: Refactor `WorldRenderer` into orchestration**

It owns canvas/DPR, `IsometricCamera`, `AssetRegistry`, passes, and public facade methods:

```ts
get cellSize(): number; // logical tile width * zoom for old scale thresholds
get tileWidth(): number;
get tileHeight(): number;
worldToCanvas(x:number,y:number,core:SimulationCore): CanvasPoint; // tile center
canvasToCell(clientX:number,clientY:number,core:SimulationCore): CellCoord | null;
tilePolygon(x:number,y:number,core:SimulationCore): readonly CanvasPoint[];
pan(dx:number,dy:number): void;
zoomBy(factor:number,anchorX:number,anchorY:number): void;
rotate(direction:-1|1): void;
preloadAssets(): Promise<void>;
assetDiagnostics(): readonly string[];
```

Remove normal primitive terrain/road/building/facility drawing from `WorldRenderer`.

- [ ] **Step 6: Verify and commit**

```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts tests/isometric-render-order.test.ts tests/isometric-assets.test.ts
npm run typecheck
git add src/rendering/assets/SpritePainter.ts src/rendering/isometric/IsometricCulling.ts src/rendering/passes/GroundRenderPass.ts src/rendering/passes/ObjectRenderPass.ts src/rendering/WorldRenderer.ts tests/isometric-projection.test.ts tests/isometric-render-order.test.ts
git commit -m "refactor: render world through isometric raster passes"
```

---

### Task 9: Convert moving vehicles to raster sprites

**Files:** Create `VehicleVisuals.ts`; modify all four existing vehicle renderers; extend variant tests.

- [ ] **Step 1: Define/test travel orientation**

```ts
assert.equal(vehicleOrientationFromWorldDelta(1, 0, 0), 0);
assert.equal(vehicleOrientationFromWorldDelta(1, 0, 1), 1);
assert.equal(vehicleOrientationFromWorldDelta(0, 1, 0), 1);
```

Document exact `_o0.._o3` screen-facing mapping in `VehicleVisuals.ts`.

- [ ] **Step 2: Map existing vehicle domains to visual families**

Private traffic → stable sedan/SUV variants; freight → semi/freight truck with box-truck only when current state supports a lighter class; fire/police/healthcare/garbage → corresponding service vehicles; bus/BRT/tram → matching transit family; underground metro remains route/station-only where current renderer has no surface vehicle.

- [ ] **Step 3: Preserve interpolation and replace only final paint**

Keep current edge progress, queue timing, graph reads, route timing, and weights. Project fractional world coordinates through the isometric camera and draw a raster sprite. Vehicle `variantKey` is chosen from stable vehicle identity independent of orientation; orientation resolution happens after selection.

- [ ] **Step 4: Verify and commit**

```bash
node --experimental-strip-types --test tests/isometric-variant-selection.test.ts
npm run typecheck
git add src/rendering/assets/VehicleVisuals.ts src/rendering/VehicleRenderer.ts src/rendering/ServiceVehicleRenderer.ts src/rendering/TransitVehicleRenderer.ts src/rendering/FreightVehicleRenderer.ts tests/isometric-variant-selection.test.ts
git commit -m "feat: render vehicles from isometric atlases"
```

---

### Task 10: Reproject all analytical overlays, selection, and road preview

**Files:** Create `IsometricOverlayPainter.ts`, `OverlayRenderPass.ts`, `SelectionRenderPass.ts`; modify `WorldRenderer.ts`, `LandHousingUiController.ts`.

- [ ] **Step 1: Implement projected overlay primitives**

Provide:

```ts
fillCell(ctx, camera, x, y, worldSize, fillStyle): void;
strokeCell(ctx, camera, x, y, worldSize, strokeStyle, lineWidth): void;
strokeWorldSegment(ctx, camera, a, b, worldSize, strokeStyle, lineWidth): void;
drawLabelAtCell(ctx, camera, x, y, worldSize, label, font): void;
```

Cell overlays draw diamonds, never square bounding boxes.

- [ ] **Step 2: Move traffic/service/transit/economy drawing into `OverlayRenderPass`**

Keep all current data snapshots, colors, legends, labels, and normalized values. Only geometry changes. Route lines connect projected cell centers without `+cellSize/2` square offsets.

- [ ] **Step 3: Add selection/path preview pass**

Selected cell is a white diamond outline. Road preview is translucent projected diamonds following the unchanged authoritative Manhattan path.

- [ ] **Step 4: Convert land/housing overlay canvas**

Replace `fillRect` square cells in `LandHousingUiController` with renderer `tilePolygon()`/isometric overlay helpers. Keep the separate overlay canvas pointer-transparent and mutually exclusive with other overlay selectors.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
node --experimental-strip-types --test tests/development-policy-presentation.test.ts tests/economy-presentation.test.ts
git add src/rendering/isometric/IsometricOverlayPainter.ts src/rendering/passes/OverlayRenderPass.ts src/rendering/passes/SelectionRenderPass.ts src/rendering/WorldRenderer.ts src/ui/LandHousingUiController.ts
git commit -m "feat: align analytical overlays to isometric city"
```

---

### Task 11: Integrate preload and preserve GameApp interaction semantics

**Files:** Modify `GameApp.ts`, `WorldRenderer.ts`.

- [ ] **Step 1: Preload without blocking simulation startup**

Immediately after renderer creation:

```ts
void this.renderer.preloadAssets().catch(() => {
  // The registry already records failure and fallback rendering remains available.
});
```

The simulation loop starts normally; fallback may render until images load.

- [ ] **Step 2: Keep existing pointer API**

Retain all current `renderer.canvasToCell(event.clientX,event.clientY,core)` calls. The renderer handles DOM-rect subtraction, inverse projection, rotation, and diamond hit-testing.

- [ ] **Step 3: Keep authoritative Manhattan road dragging**

Do not replace `manhattanPath()`. Isometric screen axes do not imply diagonal simulation roads.

- [ ] **Step 4: Preserve wheel/pan/Q/E behavior**

Existing inputs call camera-backed renderer methods. Rotation changes presentation only.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
git add src/app/GameApp.ts src/rendering/WorldRenderer.ts
git commit -m "feat: integrate isometric renderer with existing controls"
```

---

### Task 12: Add browser smoke, visual scenes, repetition validation, and full production report

**Files:** Create both isometric smoke scripts and art docs; modify package/readme/architecture/development log.

- [ ] **Step 1: Add dedicated smoke script command**

```json
"test:smoke:isometric": "python tests/smoke/isometric_pass_a_smoke.py"
```

- [ ] **Step 2: Implement browser interaction smoke**

`isometric_pass_a_smoke.py` must fail on page/console errors and verify:
1. app and renderer load;
2. required atlas requests return successfully;
3. logical metrics are 64×32 at zoom 1;
4. clicking projected world cell `(6,6)` zones exactly `(6,6)`;
5. after Q/E rotation, projected click still targets the same authoritative requested cell;
6. road drag from `(3,3)` to `(8,6)` produces the current horizontal-then-vertical Manhattan path;
7. zoom remains inside `0.45–2.5`;
8. pan changes screen position, not world state;
9. traffic/economy/land-housing overlays render without errors;
10. save→mutate→load restores authoritative state.

Use `window.__civicApp.renderer.worldToCanvas()` to obtain exact click centers rather than hard-coded screen pixels.

- [ ] **Step 3: Implement deterministic visual smoke scenes**

`isometric_visual_smoke.py` creates screenshots named:
- `suburban_edge.png`
- `urban_mixed_density.png`
- `dense_core.png`
- `industrial_logistics.png`
- `civic_cluster.png`
- `construction.png`
- `traffic_freight.png`
- `overlay.png`

Save to a temp/test-artifact directory, not authoritative game data. Fail on blank/near-uniform screenshots using pixel-variance sampling. Do not add brittle pixel-perfect baselines in Pass A.

- [ ] **Step 4: Run full regression before documentation**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

Every command must exit 0. If any V7 deterministic digest changes, fix renderer integration; never update V7 expected results to hide a presentation-induced simulation change.

- [ ] **Step 5: Write `docs/art/ASSET_BIBLE.md`**

Record exact projection, 128×64 source/64×32 display tile, scale ranges, northwestern light, material/window/signage rules, North American baseline, orientation/variant-family rule, naming, alpha, originality, and runtime raster requirement.

- [ ] **Step 6: Write `docs/art/PASS_A_REPORT.md` with actual counts**

Use headings:

```markdown
# Civic Foundry Isometric Pass A Report
## Assets created
## Gameplay systems supported
## Variants
## Integration
## Testing
## Problems discovered
## Remaining gaps
## Recommended next batch
## Acceptance criteria
```

Compute counts directly from `PASS_A_ASSET_MANIFEST`; list exact source SVGs, generated PNG atlas files, manifest entries, zone/intensity variant counts, road-mask counts, vehicle/facility/terrain/construction counts, test commands, visual scenes, zoom/rotation coverage, and all 15 design acceptance criteria.

- [ ] **Step 7: Update architecture/readme/development log**

Document that V7 simulation/save remains unchanged; the same authoritative grid is projected isometrically; raster atlases are build outputs from source-controlled art sheets; manifest/registry are presentation-only; fallback is deliberate and non-authoritative.

- [ ] **Step 8: Commit docs and final verification**

```bash
git add tests/smoke/isometric_pass_a_smoke.py tests/smoke/isometric_visual_smoke.py package.json docs/art/ASSET_BIBLE.md docs/art/PASS_A_REPORT.md README.md docs/ARCHITECTURE.md docs/DEVELOPMENT_LOG.md
git commit -m "docs: complete isometric Tier 1 asset Pass A"
npm test && npm run typecheck && npm run lint && npm run build && npm run test:smoke && npm run test:smoke:phase7 && npm run test:smoke:isometric
```

Expected: all green on the final commit.

---

## Reviewer Gates

1. Reject any renderer code that writes to authoritative simulation domains or changes save payloads.
2. Reject use of diagnostic fallback as a substitute for required Tier 1 asset coverage.
3. Reject camera rotation that changes a building/vehicle's selected `variantKey`; only its orientation frame may change.
4. Reject whole-canvas bitmap rotation; rotate world coordinates/masks and select correct orientation assets instead.
5. Reject per-frame `Image` construction, full-manifest scans per entity, or frame-rate-dependent simulation behavior.
6. Reject fake multi-cell building footprints in V7.
7. Reject scope creep into highways, full parking, pedestrians, nighttime, weather, landmarks, mixed-use simulation, or full UI icon replacement; those remain later passes.
8. Pass A is incomplete until all 15 acceptance criteria in the approved design spec are checked off in `docs/art/PASS_A_REPORT.md` with evidence.