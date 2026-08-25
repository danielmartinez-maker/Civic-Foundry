# Civic Foundry — Isometric Tier 1 Asset Pass A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Civic Foundry's square top-down primitive world presentation with a production-ready all-raster 2:1 isometric renderer and the first Tier 1 North American metropolitan asset pack, without changing authoritative V7 simulation or save behavior.

**Architecture:** Keep V7 simulation coordinates and state authoritative. Add a single isometric camera/projection contract, a typed presentation-only asset manifest/registry, deterministic sprite selection, raster atlas generation from source-controlled vector atlas sheets, and focused ground/object/vehicle/overlay render passes. Canvas remains the compositor and analytical-overlay surface; normal terrain, roads, buildings, facilities, vegetation, construction, and moving vehicles render from PNG atlas regions generated at build time.

**Tech Stack:** TypeScript 5.x ES modules, browser Canvas 2D, Node 22 built-in test runner with TypeScript strip-types, Python Playwright + Chromium for build-time rasterization and browser smoke tests, source-controlled SVG atlas sheets, generated PNG runtime atlases.

**Spec:** `docs/superpowers/specs/2026-08-24-isometric-tier1-asset-pass-a-design.md`

## Global Constraints

- Preserve V7 (`0.7.0-metropolitan`) authoritative simulation, deterministic formulas, public mutation semantics, and `saveVersion: 7` behavior.
- Do not persist presentation asset IDs or visual random state.
- Runtime world assets are raster sprites/atlas regions; Canvas primitives are permitted only for overlays, selection/tool feedback, and deliberate diagnostic fallback.
- Fixed 2:1 projection: 64×32 logical display tile at 1× zoom; source ground art 128×64.
- Preserve approximately 0.45×–2.5× zoom, cursor-centered zoom, pan, and four quarter-turn camera orientations.
- Current V7 authoritative building footprints remain one simulation cell; visual sprites may extend upward/outward but cannot manufacture multi-cell gameplay occupancy.
- Current road classes remain `local`, `collector`, and `arterial`; Pass A does not add gameplay road types.
- Variant selection must be deterministic from stable presentation inputs; browser RNG is prohibited for persistent visual selection.
- Use a general North American metropolitan visual baseline, fictional signage only, no real logos or copied proprietary game/building assets.
- Shared daylight: upper-left/northwest screen-space light, shadows down-right/southeast, restrained AO and saturation.
- At least three materially distinct core variants per zone × intensity family where production scope permits, targeting 27+ core building sprites before orientation variants.
- Construction must expose four derived progress stages plus completion using existing construction timing only.
- Asset-load or manifest failure must degrade to readable fallback rendering without crashing the simulation loop.
- No runtime npm dependency is introduced.
- Keep new rendering files focused; do not expand `WorldRenderer.ts` into a larger monolith.

---

## File Structure Locked for This Pass

### New rendering modules

- `src/rendering/isometric/IsometricProjection.ts` — pure rotation, projection, inverse projection, diamond geometry.
- `src/rendering/isometric/IsometricCamera.ts` — pan, zoom, quarter-turn state, map offset, public world/canvas conversion.
- `src/rendering/isometric/IsometricOverlayPainter.ts` — projected diamond fills/strokes and world-edge line helpers.
- `src/rendering/assets/AssetTypes.ts` — manifest, atlas, query, resolution, diagnostics types.
- `src/rendering/assets/PassAAssetManifest.ts` — atlas descriptors and all Pass A sprite metadata.
- `src/rendering/assets/AssetManifestValidation.ts` — pure manifest validation.
- `src/rendering/assets/AssetRegistry.ts` — image preload/cache and safe sprite resolution.
- `src/rendering/assets/VariantSelector.ts` — stable weighted hashing and building/terrain/vehicle selectors.
- `src/rendering/assets/RoadAutotile.ts` — 4-bit road connectivity masks and camera mask rotation.
- `src/rendering/assets/ConstructionVisuals.ts` — construction progress → presentation stage.
- `src/rendering/assets/SpritePainter.ts` — atlas-region drawing at a world anchor with scale/orientation.
- `src/rendering/passes/GroundRenderPass.ts` — terrain, zoning underlay, road raster pass.
- `src/rendering/passes/ObjectRenderPass.ts` — buildings, facilities, vegetation, construction objects and deterministic depth ordering.
- `src/rendering/passes/OverlayRenderPass.ts` — existing traffic/service/transit/economy overlays in isometric geometry.
- `src/rendering/passes/SelectionRenderPass.ts` — selection and road-preview diamonds.

### Existing rendering files modified

- `src/rendering/WorldRenderer.ts` — becomes orchestration/camera facade; delegates passes.
- `src/rendering/VehicleRenderer.ts`
- `src/rendering/ServiceVehicleRenderer.ts`
- `src/rendering/TransitVehicleRenderer.ts`
- `src/rendering/FreightVehicleRenderer.ts`
- `src/ui/LandHousingUiController.ts`
- `src/app/GameApp.ts`

### Asset source and build files

- `assets/source/terrain.svg`
- `assets/source/roads.svg`
- `assets/source/buildings.svg`
- `assets/source/construction.svg`
- `assets/source/civic.svg`
- `assets/source/utilities.svg`
- `assets/source/vegetation.svg`
- `assets/source/vehicles.svg`
- `tools/render_isometric_atlases.py`
- generated at build time: `dist/assets/atlases/{terrain,roads,buildings,construction,civic,utilities,vegetation,vehicles}.png`

### New tests

- `tests/isometric-projection.test.ts`
- `tests/isometric-road-autotile.test.ts`
- `tests/isometric-assets.test.ts`
- `tests/isometric-variant-selection.test.ts`
- `tests/isometric-render-order.test.ts`
- `tests/isometric-construction-visuals.test.ts`
- `tests/smoke/isometric_pass_a_smoke.py`
- `tests/smoke/isometric_visual_smoke.py`

### Documentation modified/created

- `package.json`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT_LOG.md`
- `docs/art/ASSET_BIBLE.md`
- `docs/art/PASS_A_REPORT.md`

---

### Task 1: Introduce the single isometric projection and picking contract

**Files:**
- Create: `src/rendering/isometric/IsometricProjection.ts`
- Create: `src/rendering/isometric/IsometricCamera.ts`
- Create: `tests/isometric-projection.test.ts`

**Interfaces:**
- Produces: `QuarterTurn`, `IsoMetrics`, `DEFAULT_ISO_METRICS`, `rotateWorldPoint()`, `inverseRotateWorldPoint()`, `rotatedWorldSize()`, `projectRotatedPoint()`, `inverseProjectPoint()`, `diamondContains()`, `IsometricCamera.worldToCanvas()`, `IsometricCamera.canvasToCell()`, `IsometricCamera.tilePolygon()`, `IsometricCamera.tileCenter()`, `IsometricCamera.pan()`, `IsometricCamera.zoomBy()`, `IsometricCamera.rotate()`.
- Consumes: only numeric world coordinates and world dimensions; no simulation mutations.

- [ ] **Step 1: Write failing projection/round-trip tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ISO_METRICS,
  inverseProjectPoint,
  projectRotatedPoint,
  rotateWorldPoint,
  inverseRotateWorldPoint,
} from '../src/rendering/isometric/IsometricProjection.ts';

const size = { width: 40, height: 24 } as const;

test('2:1 projection uses the 64x32 logical tile contract', () => {
  assert.deepEqual(DEFAULT_ISO_METRICS, { tileWidth: 64, tileHeight: 32 });
  assert.deepEqual(projectRotatedPoint(0, 0, DEFAULT_ISO_METRICS), { x: 0, y: 0 });
  assert.deepEqual(projectRotatedPoint(1, 0, DEFAULT_ISO_METRICS), { x: 32, y: 16 });
  assert.deepEqual(projectRotatedPoint(0, 1, DEFAULT_ISO_METRICS), { x: -32, y: 16 });
});

test('projection and inverse projection round-trip fractional world points', () => {
  const p = projectRotatedPoint(7.25, 11.75, DEFAULT_ISO_METRICS);
  const world = inverseProjectPoint(p.x, p.y, DEFAULT_ISO_METRICS);
  assert.ok(Math.abs(world.x - 7.25) < 1e-9);
  assert.ok(Math.abs(world.y - 11.75) < 1e-9);
});

test('all four rotations round-trip authoritative cells', () => {
  for (const turn of [0, 1, 2, 3] as const) {
    const rotated = rotateWorldPoint(6, 9, size, turn);
    assert.deepEqual(inverseRotateWorldPoint(rotated.x, rotated.y, size, turn), { x: 6, y: 9 });
  }
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:
```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts
```
Expected: FAIL because the isometric projection module does not exist.

- [ ] **Step 3: Implement pure projection helpers**

Implement these exact exported contracts:

```ts
export type QuarterTurn = 0 | 1 | 2 | 3;
export type IsoMetrics = Readonly<{ tileWidth: number; tileHeight: number }>;
export type WorldSize = Readonly<{ width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;

export const DEFAULT_ISO_METRICS: IsoMetrics = Object.freeze({ tileWidth: 64, tileHeight: 32 });

export function projectRotatedPoint(x: number, y: number, metrics = DEFAULT_ISO_METRICS): Point {
  return { x: (x - y) * metrics.tileWidth / 2, y: (x + y) * metrics.tileHeight / 2 };
}

export function inverseProjectPoint(x: number, y: number, metrics = DEFAULT_ISO_METRICS): Point {
  const a = x / (metrics.tileWidth / 2);
  const b = y / (metrics.tileHeight / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
```

Implement rotation/inverse rotation using the current `WorldRenderer` quarter-turn behavior, generalized for fractional coordinates. Add `diamondContains(localX, localY, metrics)` using normalized Manhattan distance:

```ts
return Math.abs(localX) / (metrics.tileWidth / 2) + Math.abs(localY) / (metrics.tileHeight / 2) <= 1 + 1e-9;
```

- [ ] **Step 4: Add camera tests for map offsets, zoom anchoring, rotation, and picking**

Add tests that instantiate `IsometricCamera`, project cells `(0,0)`, `(39,0)`, `(0,23)`, `(39,23)`, then verify `canvasToCell(worldToCanvas(cell))` returns the original cell for all four rotations. Add a test where a point outside the diamond bounding region returns `null` rather than the wrong cell.

- [ ] **Step 5: Implement `IsometricCamera`**

Use these public methods:

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

The camera must include a rotation-aware map X offset based on the rotated world height so negative `(x-y)` coordinates remain inside the map's projected bounding box before user pan is applied. Keep zoom clamped to `0.45–2.5`.

- [ ] **Step 6: Run projection tests and typecheck**

```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/rendering/isometric/IsometricProjection.ts src/rendering/isometric/IsometricCamera.ts tests/isometric-projection.test.ts
git commit -m "feat: add deterministic isometric camera projection"
```

---

### Task 2: Add road connectivity masks and deterministic render depth keys

**Files:**
- Create: `src/rendering/assets/RoadAutotile.ts`
- Create: `src/rendering/passes/RenderOrder.ts`
- Create: `tests/isometric-road-autotile.test.ts`
- Create: `tests/isometric-render-order.test.ts`

**Interfaces:**
- Produces: `ROAD_NORTH`, `ROAD_EAST`, `ROAD_SOUTH`, `ROAD_WEST`, `roadConnectivityMask()`, `rotateRoadMask()`, `SceneLayer`, `makeDepthKey()`, `compareDepthKeys()`.
- Consumes: `(x, y) => RoadType | undefined` lookup and `QuarterTurn`.

- [ ] **Step 1: Write failing road-mask tests for all logical cases**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROAD_EAST, ROAD_NORTH, ROAD_SOUTH, ROAD_WEST,
  roadConnectivityMask, rotateRoadMask,
} from '../src/rendering/assets/RoadAutotile.ts';

const roads = new Set(['2,2', '2,1', '3,2', '2,3']);
const lookup = (x: number, y: number) => roads.has(`${x},${y}`) ? 'local' as const : undefined;

test('road mask derives cardinal connectivity from topology', () => {
  assert.equal(roadConnectivityMask(2, 2, lookup), ROAD_NORTH | ROAD_EAST | ROAD_SOUTH);
});

test('camera rotation rotates mask bits without changing topology', () => {
  assert.equal(rotateRoadMask(ROAD_NORTH, 1), ROAD_EAST);
  assert.equal(rotateRoadMask(ROAD_NORTH | ROAD_EAST, 2), ROAD_SOUTH | ROAD_WEST);
});
```

Correct the fixture so the expected mask exactly matches the inserted neighbor set; include table-driven coverage for masks `0..15`.

- [ ] **Step 2: Run and verify failure**

```bash
node --experimental-strip-types --test tests/isometric-road-autotile.test.ts
```
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement road masking**

Use bit assignments:

```ts
export const ROAD_NORTH = 1;
export const ROAD_EAST = 2;
export const ROAD_SOUTH = 4;
export const ROAD_WEST = 8;
export type RoadMask = number;
```

`roadConnectivityMask()` connects to any existing cardinal road regardless of class because current V7 graph connectivity allows class transitions. `rotateRoadMask(mask, turn)` rotates bits clockwise once per quarter turn.

- [ ] **Step 4: Write failing deterministic render-order tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDepthKeys, makeDepthKey } from '../src/rendering/passes/RenderOrder.ts';

test('objects sort by isometric depth then elevation then stable id', () => {
  const keys = [
    makeDepthKey('objects', 4, 2, 0, 'b'),
    makeDepthKey('objects', 4, 2, 0, 'a'),
    makeDepthKey('objects', 2, 1, 0, 'z'),
  ].sort(compareDepthKeys);
  assert.deepEqual(keys.map((key) => key.stableId), ['z', 'a', 'b']);
});
```

- [ ] **Step 5: Implement render-order types**

```ts
export type SceneLayer = 'terrain' | 'roads' | 'low-props' | 'objects' | 'vehicles' | 'construction';
export type DepthKey = Readonly<{
  layerRank: number;
  isoDepth: number;
  elevation: number;
  stableId: string;
}>;

export function makeDepthKey(layer: SceneLayer, rotatedX: number, rotatedY: number, elevation: number, stableId: string): DepthKey;
export function compareDepthKeys(a: DepthKey, b: DepthKey): number;
```

Use explicit layer ranks and `isoDepth = rotatedX + rotatedY`. Never rely on Map insertion order as a tie-breaker.

- [ ] **Step 6: Run tests and commit**

```bash
node --experimental-strip-types --test tests/isometric-road-autotile.test.ts tests/isometric-render-order.test.ts
npm run typecheck
git add src/rendering/assets/RoadAutotile.ts src/rendering/passes/RenderOrder.ts tests/isometric-road-autotile.test.ts tests/isometric-render-order.test.ts
git commit -m "feat: add road autotile masks and render ordering"
```

---

### Task 3: Add typed manifest validation, safe asset resolution, and deterministic variant selection

**Files:**
- Create: `src/rendering/assets/AssetTypes.ts`
- Create: `src/rendering/assets/AssetManifestValidation.ts`
- Create: `src/rendering/assets/AssetRegistry.ts`
- Create: `src/rendering/assets/VariantSelector.ts`
- Create: `tests/isometric-assets.test.ts`
- Create: `tests/isometric-variant-selection.test.ts`

**Interfaces:**
- Produces: `AssetManifestEntry`, `AtlasDescriptor`, `AssetManifest`, `AssetQuery`, `AssetResolution`, `validateAssetManifest()`, `AssetRegistry.preload()`, `AssetRegistry.resolve()`, `AssetRegistry.query()`, `stableHash32()`, `selectWeightedVariant()`.
- Consumes: browser `Image` only inside `AssetRegistry`; validation and selection stay pure for Node tests.

- [ ] **Step 1: Define the failing manifest-validation tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssetManifest } from '../src/rendering/assets/AssetManifestValidation.ts';

const manifest = {
  schemaVersion: 1,
  atlases: [{ atlasId: 'terrain', url: '/assets/atlases/terrain.png', width: 1024, height: 64 }],
  entries: [{
    assetId: 'terrain_grass_01', atlasId: 'terrain',
    sourceRect: { x: 0, y: 0, width: 128, height: 64 },
    footprint: { width: 1, height: 1 }, anchor: { x: 64, y: 32 },
    category: 'terrain', subcategory: 'grass', weight: 1,
  }],
} as const;

test('valid manifest passes', () => assert.deepEqual(validateAssetManifest(manifest), []));

test('out-of-bounds source rect is rejected', () => {
  const bad = structuredClone(manifest) as any;
  bad.entries[0].sourceRect.x = 1000;
  assert.match(validateAssetManifest(bad).join('\n'), /sourceRect.*atlas bounds/);
});

test('duplicate asset ids are rejected', () => {
  const bad = { ...manifest, entries: [manifest.entries[0], manifest.entries[0]] };
  assert.match(validateAssetManifest(bad).join('\n'), /duplicate assetId/);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --experimental-strip-types --test tests/isometric-assets.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement the exact presentation schema**

`AssetTypes.ts` must include the spec fields plus atlas metadata:

```ts
export type AssetManifestEntry = Readonly<{
  assetId: string;
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
export type AssetResolution =
  | Readonly<{ kind: 'sprite'; entry: AssetManifestEntry; image: HTMLImageElement }>
  | Readonly<{ kind: 'fallback'; assetId: string; reason: string }>;
```

Validation must reject duplicate IDs, unknown atlases, non-positive footprints/source rectangles, out-of-bounds rectangles, invalid weights, invalid orientations, and nonexistent night-variant references.

- [ ] **Step 4: Write deterministic weighted-selection tests**

```ts
test('stable selection is repeatable and uses only eligible entries', () => {
  const eligible = [
    { assetId: 'a', weight: 1 },
    { assetId: 'b', weight: 2 },
    { assetId: 'c', weight: 1 },
  ] as const;
  assert.equal(selectWeightedVariant('building:lot-8', eligible).assetId,
               selectWeightedVariant('building:lot-8', eligible).assetId);
  assert.ok(eligible.some((item) => item.assetId === selectWeightedVariant('building:lot-8', eligible).assetId));
});
```

Also test 100 stable keys distribute across all three equal-weight variants and that no call uses `Math.random()`.

- [ ] **Step 5: Implement `stableHash32()` and weighted selection**

Use a small deterministic string hash (FNV-1a or equivalent), convert to an unsigned 32-bit integer, then map into cumulative positive weights. Sort eligible entries by `assetId` before weighting so manifest declaration order does not change visual choice.

- [ ] **Step 6: Implement browser asset registry with one-time diagnostics**

`AssetRegistry` must:

```ts
export class AssetRegistry {
  constructor(manifest: AssetManifest);
  preload(): Promise<void>;
  get ready(): boolean;
  query(query: AssetQuery): readonly AssetManifestEntry[];
  resolve(assetId: string): AssetResolution;
  resolveOrientation(assetId: string, orientation: 0 | 1 | 2 | 3): AssetResolution;
  diagnostics(): readonly string[];
}
```

Load one `Image` per atlas URL. Validate declared image dimensions after load. Cache failures by atlas ID. `resolve()` returns `fallback` instead of throwing for unavailable/invalid sprites. Deduplicate diagnostic strings so the render loop cannot spam the console every frame.

- [ ] **Step 7: Run tests, typecheck, and commit**

```bash
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-variant-selection.test.ts
npm run typecheck
git add src/rendering/assets/AssetTypes.ts src/rendering/assets/AssetManifestValidation.ts src/rendering/assets/AssetRegistry.ts src/rendering/assets/VariantSelector.ts tests/isometric-assets.test.ts tests/isometric-variant-selection.test.ts
git commit -m "feat: add isometric asset manifest registry"
```

---

### Task 4: Create the reproducible SVG-to-raster atlas build pipeline

**Files:**
- Create: `tools/render_isometric_atlases.py`
- Create: `assets/source/terrain.svg`
- Create: `assets/source/roads.svg`
- Create: `assets/source/buildings.svg`
- Create: `assets/source/construction.svg`
- Create: `assets/source/civic.svg`
- Create: `assets/source/utilities.svg`
- Create: `assets/source/vegetation.svg`
- Create: `assets/source/vehicles.svg`
- Modify: `package.json`
- Modify: `.gitignore` only if local generated-art directories need exclusion.

**Interfaces:**
- Produces: `dist/assets/atlases/*.png` with dimensions exactly matching `PassAAssetManifest` atlas descriptors.
- Consumes: source-controlled SVG sheets with explicit `width`, `height`, transparent backgrounds, and no external font/image dependencies.

- [ ] **Step 1: Create minimal valid transparent atlas sheets**

Start each SVG with explicit pixel dimensions and no page-sized opaque background. Example terrain source root:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="64" viewBox="0 0 1024 64">
  <defs>
    <clipPath id="diamond"><polygon points="64,0 128,32 64,64 0,32"/></clipPath>
  </defs>
  <!-- eight 128x64 terrain cells are authored in later tasks -->
</svg>
```

Do not use embedded raster references or remote URLs.

- [ ] **Step 2: Implement the atlas rasterizer**

`tools/render_isometric_atlases.py` must use Python Playwright synchronously, iterate the fixed source list, read SVG width/height, open the local SVG in Chromium, set viewport to the exact sheet dimensions, and write a transparent PNG to `dist/assets/atlases/<name>.png`.

Required CLI behavior:

```bash
python tools/render_isometric_atlases.py --check
python tools/render_isometric_atlases.py
```

`--check` validates source existence, numeric dimensions, and duplicate/missing sheet names without launching Chromium. Normal mode creates `dist/assets/atlases/` and rasterizes all eight sheets. Any rasterization failure exits non-zero.

- [ ] **Step 3: Update package scripts**

Change `package.json` scripts to include:

```json
{
  "assets:check": "python tools/render_isometric_atlases.py --check",
  "assets:build": "python tools/render_isometric_atlases.py",
  "build": "rm -rf dist && tsc -p tsconfig.json && cp index.html dist/index.html && cp src/styles.css dist/styles.css && python tools/render_isometric_atlases.py"
}
```

Keep existing test/smoke scripts unchanged.

- [ ] **Step 4: Verify generated files are real raster PNGs**

```bash
npm run assets:check
npm run build
python - <<'PY'
from pathlib import Path
for name in ('terrain','roads','buildings','construction','civic','utilities','vegetation','vehicles'):
    p = Path('dist/assets/atlases') / f'{name}.png'
    data = p.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', p
    assert len(data) > 100, p
print('atlas PNG signatures ok')
PY
```
Expected: all eight PNG signatures pass.

- [ ] **Step 5: Commit source pipeline, not generated `dist/`**

```bash
git add tools/render_isometric_atlases.py assets/source package.json .gitignore
git commit -m "build: add reproducible isometric atlas pipeline"
```

---

### Task 5: Author Tier 1 terrain and complete 48-sprite road autotile atlas

**Files:**
- Modify: `assets/source/terrain.svg`
- Modify: `assets/source/roads.svg`
- Create: `src/rendering/assets/PassAAssetManifest.ts`
- Extend test: `tests/isometric-assets.test.ts`
- Extend test: `tests/isometric-road-autotile.test.ts`

**Interfaces:**
- Produces terrain IDs `terrain_{grass,forest,rock,water}_{01,02}` and road IDs `road_{local,collector,arterial}_mask_00` through `_15`.
- Produces atlas descriptors used by `AssetRegistry`.

- [ ] **Step 1: Lock the first-pass palette and geometry in `PassAAssetManifest.ts` comments/constants**

Use restrained North American daytime values as source-art guidance:

```ts
export const PASS_A_ART_BIBLE = Object.freeze({
  grass: '#7f956e',
  forestGround: '#647d59',
  rock: '#7d7f7d',
  water: '#5f88a4',
  asphalt: '#3f454a',
  localSidewalk: '#b9b1a5',
  concrete: '#aaa79f',
  laneWhite: '#e3e0d5',
  laneYellow: '#d9be69',
  shadow: 'rgba(38,45,48,.24)',
} as const);
```

These are source-art controls, not gameplay colors.

- [ ] **Step 2: Author eight seamless terrain cells**

Use two materially different low-frequency variants per current biome. Keep the exact 128×64 diamond silhouette transparent outside the diamond. Forest ground should remain ground-only; trees come from the vegetation atlas. Water should be readable with two or three broad highlight bands, not noisy micro-wave patterns.

Manifest entries use weight `1` and tags `['pass-a','north-american']`.

- [ ] **Step 3: Author all 16 masks for each road class**

Lay out road sprites in three 2048×64 rows inside a `2048×192` roads SVG: local row 0, collector row 1, arterial row 2. Each source rectangle is `128×64`; mask `m` starts at `x = m * 128`.

Road shapes must obey these carriageway proportions of the diamond:
- local ~55%;
- collector ~68%;
- arterial ~82%.

Include coherent curb/sidewalk edges. Collectors and arterials use restrained lane markings; arterials may use a center median treatment only where it does not create impossible joins at mask transitions.

- [ ] **Step 4: Register exact road and terrain source rectangles**

Generate manifest entries mechanically in TypeScript rather than hand-writing 48 repeated blocks:

```ts
const ROAD_TYPES = ['local', 'collector', 'arterial'] as const;
const roadEntries = ROAD_TYPES.flatMap((roadType, row) =>
  Array.from({ length: 16 }, (_, mask) => ({
    assetId: `road_${roadType}_mask_${mask.toString().padStart(2, '0')}`,
    atlasId: 'roads',
    sourceRect: { x: mask * 128, y: row * 64, width: 128, height: 64 },
    footprint: { width: 1, height: 1 },
    anchor: { x: 64, y: 32 },
    category: 'road', subcategory: roadType,
    tags: [`mask:${mask}`], weight: 1,
  })),
);
```

- [ ] **Step 5: Add manifest-count and mask-coverage tests**

Assert:
- exactly 48 road entries exist;
- each road class contains every mask `0..15` once;
- all terrain/road rectangles stay inside declared atlas dimensions;
- terrain includes both variants for all four biomes.

- [ ] **Step 6: Build atlases and visually inspect source/output dimensions**

```bash
npm run build
node --experimental-strip-types --test tests/isometric-assets.test.ts tests/isometric-road-autotile.test.ts
```
Expected: PASS; `dist/assets/atlases/roads.png` is `2048×192` and terrain atlas matches its descriptor.

- [ ] **Step 7: Commit**

```bash
git add assets/source/terrain.svg assets/source/roads.svg src/rendering/assets/PassAAssetManifest.ts tests/isometric-assets.test.ts tests/isometric-road-autotile.test.ts
git commit -m "feat: add Tier 1 terrain and road raster atlases"
```

---

### Task 6: Author 27+ building variants and deterministic construction-stage selection

**Files:**
- Modify: `assets/source/buildings.svg`
- Modify: `assets/source/construction.svg`
- Create: `src/rendering/assets/ConstructionVisuals.ts`
- Extend: `src/rendering/assets/PassAAssetManifest.ts`
- Extend: `src/rendering/assets/VariantSelector.ts`
- Create: `tests/isometric-construction-visuals.test.ts`
- Extend: `tests/isometric-variant-selection.test.ts`

**Interfaces:**
- Produces: `selectBuildingAsset(building, tick, orientation, manifest)` and `constructionStageFor(building, tick)`.
- Consumes: `Building`, `definitionForBuilding()`, current simulation tick, manifest entries.

- [ ] **Step 1: Write construction-stage tests before implementation**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { constructionStageFor } from '../src/rendering/assets/ConstructionVisuals.ts';

const building = {
  id: 'building:lot:1', lotId: 'lot:1', x: 2, y: 3, zone: 'residential',
  definitionId: 'residential_apartment', status: 'construction',
  constructionStartedTick: 100, completionTick: 200,
} as const;

test('construction timing maps to four derived stages without new state', () => {
  assert.equal(constructionStageFor(building, 100), 'site');
  assert.equal(constructionStageFor(building, 120), 'foundation');
  assert.equal(constructionStageFor(building, 150), 'structure');
  assert.equal(constructionStageFor(building, 180), 'facade');
  assert.equal(constructionStageFor({ ...building, status: 'occupied' }, 220), 'complete');
});
```

Use thresholds `0–0.15 site`, `0.15–0.35 foundation`, `0.35–0.70 structure`, `0.70–1.0 facade`, with `occupied → complete` regardless of tick.

- [ ] **Step 2: Implement `constructionStageFor()` and pass the test**

It must clamp progress to `[0,1]`, handle zero/invalid duration defensively as `facade`, and never mutate the building.

- [ ] **Step 3: Author the building source atlas**

Create at least these 27 core architectural variants before orientation reuse:

Residential:
- low: `res_low_detached_01`, `_02`, `_03`;
- medium: `res_mid_rowhouse_01`, `res_mid_walkup_01`, `res_mid_courtyard_01`;
- high: `res_high_slab_01`, `res_high_podium_01`, `res_high_tower_01`.

Commercial:
- low: `com_low_corner_01`, `com_low_strip_01`, `com_low_office_01`;
- medium: `com_mid_block_01`, `com_mid_office_01`, `com_mid_hotel_01`;
- high: `com_high_office_01`, `com_high_hotel_01`, `com_high_corporate_01`.

Industrial:
- low: `ind_low_workshop_01`, `ind_low_repair_01`, `ind_low_warehouse_01`;
- medium: `ind_mid_distribution_01`, `ind_mid_logistics_01`, `ind_mid_factory_01`;
- high: `ind_high_plant_01`, `ind_high_processing_01`, `ind_high_manufacturing_01`.

Each variant must have one transparent 1×1 ground diamond and architectural mass rising above it. Use materially distinct rooflines/facades/site treatment, shared light direction, no fake multi-cell occupancy. Author explicit orientation frames for visibly asymmetric forms; symmetric forms may map multiple orientations to the same source rectangle through manifest entries.

- [ ] **Step 4: Author reusable construction art by intensity**

For `low`, `medium`, and `high` intensity, create four stage families: `site`, `foundation`, `structure`, `facade`. Use fencing/material stacks at site/foundation, exposed frames at structure, partial glazing/cladding/scaffolding at facade. Include a crane only where scale supports it; do not place tower cranes over low-density houses.

- [ ] **Step 5: Register building and construction metadata**

Building entries must carry `zone`, `intensity`, `orientation`, `weight`, and `tags`. Construction entries carry `intensity`, `constructionStage`, and orientation. The manifest must expose at least three eligible completed entries for every zone/intensity combination.

- [ ] **Step 6: Implement deterministic building selection**

Use authoritative building identity and definition intensity:

```ts
export function selectBuildingAsset(
  building: Building,
  tick: number,
  orientation: QuarterTurn,
  manifest: AssetManifest,
): AssetManifestEntry | undefined;
```

If `building.status === 'construction'`, query construction entries by intensity/stage/orientation. Otherwise query completed building entries by zone/intensity/orientation. Use stable key `${building.id}|${building.definitionId}|${orientation}` and `selectWeightedVariant()`.

- [ ] **Step 7: Test minimum variation coverage and stable save/load behavior**

Create synthetic buildings for all nine current definitions. Assert each family has at least 3 completed variants. For 100 stable building IDs in one family, assert at least all three variants are selected and repeated calls produce identical IDs.

- [ ] **Step 8: Build, test, and commit**

```bash
npm run build
node --experimental-strip-types --test tests/isometric-construction-visuals.test.ts tests/isometric-variant-selection.test.ts tests/isometric-assets.test.ts
npm run typecheck
git add assets/source/buildings.svg assets/source/construction.svg src/rendering/assets/ConstructionVisuals.ts src/rendering/assets/PassAAssetManifest.ts src/rendering/assets/VariantSelector.ts tests/isometric-construction-visuals.test.ts tests/isometric-variant-selection.test.ts tests/isometric-assets.test.ts
git commit -m "feat: add Tier 1 building and construction assets"
```

---

### Task 7: Author civic, utility, vegetation, and vehicle raster families

**Files:**
- Modify: `assets/source/civic.svg`
- Modify: `assets/source/utilities.svg`
- Modify: `assets/source/vegetation.svg`
- Modify: `assets/source/vehicles.svg`
- Extend: `src/rendering/assets/PassAAssetManifest.ts`
- Extend: `tests/isometric-assets.test.ts`

**Interfaces:**
- Produces facility IDs used by service/utility type, vegetation selectors by biome/cell, and vehicle IDs by family/orientation.

- [ ] **Step 1: Author current placeable civic/service facilities**

Create original North American municipal forms for:
- `civic_fire_station_01`;
- `civic_police_station_01`;
- `civic_clinic_01`;
- `civic_elementary_school_01`;
- `civic_landfill_01`;
- `civic_recycling_center_01`.

Register four orientations where entrance/apron direction materially changes the view. Keep buildings recognizable through architecture and site cues rather than floating letters.

- [ ] **Step 2: Author current utility facilities**

Create:
- `utility_power_01` as a compact substation/utility compound;
- `utility_water_01` as a pumping/water-service compound;
- `utility_landfill_01` only if the legacy utility landfill path remains separately placeable from the service landfill.

Preserve exact gameplay type mappings; do not add new utility mechanics.

- [ ] **Step 3: Author vegetation**

Create at least:
- `tree_street_young_01`, `_02`;
- `tree_street_mature_01`, `_02`;
- `tree_forest_large_01`, `_02`, `_03`;
- `shrub_low_01`, `_02`.

Trees use shared northwest lighting and transparent alpha. Forest tree placement is deterministic from biome + coordinates; tree sprites are presentation-only.

- [ ] **Step 4: Author the minimum vehicle family with four travel orientations**

Create four directional frames for:
- sedan/compact;
- SUV/pickup;
- delivery van;
- box truck;
- semi/freight truck;
- bus;
- BRT vehicle;
- tram vehicle;
- fire engine;
- police vehicle;
- ambulance;
- garbage truck.

No recognizable real-world manufacturer styling or logos. Passenger colors may vary through separate authored variants, not arbitrary runtime hue filters.

- [ ] **Step 5: Add manifest coverage tests**

Assert every current service type and utility type resolves to at least one asset; every required vehicle family has orientations `0..3`; vegetation has all required categories; no entry references an unknown atlas.

- [ ] **Step 6: Build and commit**

```bash
npm run build
node --experimental-strip-types --test tests/isometric-assets.test.ts
npm run typecheck
git add assets/source/civic.svg assets/source/utilities.svg assets/source/vegetation.svg assets/source/vehicles.svg src/rendering/assets/PassAAssetManifest.ts tests/isometric-assets.test.ts
git commit -m "feat: add civic vegetation and vehicle asset families"
```

---

### Task 8: Add shared sprite painting and split the world renderer into ground/object passes

**Files:**
- Create: `src/rendering/assets/SpritePainter.ts`
- Create: `src/rendering/passes/GroundRenderPass.ts`
- Create: `src/rendering/passes/ObjectRenderPass.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Extend: `tests/isometric-render-order.test.ts`

**Interfaces:**
- Consumes: `IsometricCamera`, `AssetRegistry`, `PassAAssetManifest`, current `SimulationCore` read APIs.
- Produces: `SpritePainter.draw()`, `GroundRenderPass.draw()`, `ObjectRenderPass.draw()`, and a slimmer `WorldRenderer` facade retaining `worldToCanvas`, `canvasToCell`, `pan`, `zoomBy`, `rotate`.

- [ ] **Step 1: Implement a single atlas-region painter**

Use this signature:

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

For sprite resolutions, call `drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)` using the manifest source rectangle and anchor. For fallback resolutions, draw one restrained diagnostic isometric diamond/box and label once only when zoom permits.

- [ ] **Step 2: Write a render-order unit test that does not require DOM Canvas**

Expose `ObjectRenderPass.buildCommands(core, camera)` or a pure helper returning command metadata. Given three synthetic objects at different rotated `x+y` and stable IDs, assert deterministic order independent of input array order.

- [ ] **Step 3: Implement `GroundRenderPass`**

Responsibilities:
1. iterate visible terrain cells in deterministic isometric order;
2. select deterministic terrain variant;
3. draw terrain raster;
4. draw zoning as a translucent isometric diamond under roads/buildings;
5. derive road topology lookup once per frame;
6. compute road mask, rotate mask into camera orientation, resolve `road_<type>_mask_XX`, draw raster.

Do not mutate zoning, roads, terrain, or graph state.

- [ ] **Step 4: Implement `ObjectRenderPass`**

Build a bounded command array for visible:
- buildings/construction;
- service facilities;
- utility facilities;
- deterministic forest vegetation.

Compute depth keys from rotated coordinates plus stable entity IDs, sort once, then paint. Building selection uses `selectBuildingAsset()`. Service/utility mapping uses explicit type→asset-family maps in this module or a small adjacent constant file; no emoji/letter markers remain in normal rendering.

- [ ] **Step 5: Refactor `WorldRenderer` into orchestration**

`WorldRenderer` should own:
- canvas/context/DPR resize;
- `IsometricCamera`;
- `AssetRegistry`;
- render-pass instances;
- public compatibility methods used by `GameApp`/LandHousing UI.

Keep public compatibility:

```ts
get cellSize(): number; // return logical tile width * zoom for callers still using scale thresholds
get tileWidth(): number;
get tileHeight(): number;
worldToCanvas(x: number, y: number, core: SimulationCore): CanvasPoint; // now returns tile center
canvasToCell(clientX: number, clientY: number, core: SimulationCore): CellCoord | null;
```

Remove primitive normal terrain/road/building/facility loops from `WorldRenderer`; they live in the passes.

- [ ] **Step 6: Run focused tests/typecheck and commit**

```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts tests/isometric-render-order.test.ts tests/isometric-assets.test.ts
npm run typecheck
git add src/rendering/assets/SpritePainter.ts src/rendering/passes/GroundRenderPass.ts src/rendering/passes/ObjectRenderPass.ts src/rendering/WorldRenderer.ts tests/isometric-render-order.test.ts
git commit -m "refactor: render Civic Foundry through isometric passes"
```

---

### Task 9: Convert passenger, service, transit, and freight vehicles to raster sprites

**Files:**
- Modify: `src/rendering/VehicleRenderer.ts`
- Modify: `src/rendering/ServiceVehicleRenderer.ts`
- Modify: `src/rendering/TransitVehicleRenderer.ts`
- Modify: `src/rendering/FreightVehicleRenderer.ts`
- Create: `src/rendering/assets/VehicleVisuals.ts`
- Extend: `tests/isometric-variant-selection.test.ts`

**Interfaces:**
- Produces: `vehicleOrientationFromWorldDelta(dx, dy, quarterTurns)`, `selectVehicleAsset(family, stableId, orientation, manifest)`.
- Consumes: current graph/vehicle state, camera's fractional `worldToCanvas()` conversion, `AssetRegistry`, `SpritePainter`.

- [ ] **Step 1: Write direction/orientation tests**

```ts
test('world travel direction rotates with the camera', () => {
  assert.equal(vehicleOrientationFromWorldDelta(1, 0, 0), 0);
  assert.equal(vehicleOrientationFromWorldDelta(1, 0, 1), 1);
  assert.equal(vehicleOrientationFromWorldDelta(0, 1, 0), 1);
});
```

Define orientation values explicitly as the four authored screen-facing travel directions and document the mapping in `VehicleVisuals.ts`.

- [ ] **Step 2: Implement deterministic vehicle family selection**

Map current renderers to the minimum family:
- private traffic → sedan or SUV/pickup variants from stable vehicle ID;
- freight → semi/freight truck, with box-truck fallback only where the domain exposes a lighter class;
- service fire → fire engine;
- police → police vehicle;
- healthcare → ambulance;
- garbage → garbage truck;
- transit bus/BRT/tram → matching vehicle family; metro remains route/station presentation if not surface-visible.

- [ ] **Step 3: Replace circle/primitive vehicle drawing**

Preserve each renderer's existing position interpolation, queue progress, route timing, and authoritative inputs. Only replace final primitive drawing with `SpritePainter.draw()` at the fractional isometric world point. Use queue/status effects as subtle Canvas markers only if necessary; do not recolor the entire vehicle dynamically.

- [ ] **Step 4: Test, typecheck, and commit**

```bash
node --experimental-strip-types --test tests/isometric-variant-selection.test.ts
npm run typecheck
git add src/rendering/VehicleRenderer.ts src/rendering/ServiceVehicleRenderer.ts src/rendering/TransitVehicleRenderer.ts src/rendering/FreightVehicleRenderer.ts src/rendering/assets/VehicleVisuals.ts tests/isometric-variant-selection.test.ts
git commit -m "feat: render moving vehicles from isometric atlases"
```

---

### Task 10: Reproject every existing analytical overlay and selection state

**Files:**
- Create: `src/rendering/isometric/IsometricOverlayPainter.ts`
- Create: `src/rendering/passes/OverlayRenderPass.ts`
- Create: `src/rendering/passes/SelectionRenderPass.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/ui/LandHousingUiController.ts`
- Existing map-data layers remain data-only: `TrafficOverlayLayer.ts`, `ServiceOverlayLayer.ts`, `TransitOverlayLayer.ts`, `EconomyOverlayLayer.ts`, `LandHousingOverlayLayer.ts`.

**Interfaces:**
- Produces: `fillCell()`, `strokeCell()`, `strokeWorldSegment()`, `drawLabelAtCell()` using camera-projected diamond geometry.
- Consumes: existing overlay snapshots unchanged.

- [ ] **Step 1: Implement reusable isometric overlay painter**

Use camera `tilePolygon()`/`tileCenter()` and Canvas paths. A cell fill must draw a diamond, not its square bounding box. World route/traffic segments must connect projected centers without adding half-cell square offsets.

- [ ] **Step 2: Move WorldRenderer's traffic/service/transit/economy drawing into `OverlayRenderPass`**

Preserve existing colors, numeric labels, legends, line widths scaled by zoom, and source snapshots. Only geometry changes.

- [ ] **Step 3: Add `SelectionRenderPass`**

Draw:
- selected cell as a white diamond outline;
- road preview as translucent projected diamonds;
- no square `fillRect`/`strokeRect` for normal selection/path feedback.

- [ ] **Step 4: Convert `LandHousingUiController` overlay canvas**

Replace its `fillRect(point.x + inset, ...)` path with `app.renderer.tilePolygon()` or a public `fillOverlayCell()` helper. Labels use `app.renderer.worldToCanvas()` directly as the tile center. Keep its overlay canvas pointer-transparent and mutually exclusive behavior unchanged.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
node --experimental-strip-types --test tests/development-policy-presentation.test.ts tests/economy-presentation.test.ts
git add src/rendering/isometric/IsometricOverlayPainter.ts src/rendering/passes/OverlayRenderPass.ts src/rendering/passes/SelectionRenderPass.ts src/rendering/WorldRenderer.ts src/ui/LandHousingUiController.ts
git commit -m "feat: align overlays and selection to isometric projection"
```

---

### Task 11: Integrate asset preload and preserve GameApp input semantics

**Files:**
- Modify: `src/app/GameApp.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Modify: `src/main.ts` only if a test/debug readiness handle is needed.

**Interfaces:**
- Produces: `WorldRenderer.preloadAssets(): Promise<void>`, `WorldRenderer.assetDiagnostics(): readonly string[]`.
- Preserves: `GameApp` pointer/wheel/key behavior and all existing tool/controller APIs.

- [ ] **Step 1: Start asset preload at app initialization without blocking simulation construction**

In `GameApp` after `new WorldRenderer(canvas)`, call:

```ts
void this.renderer.preloadAssets().catch(() => {
  // Renderer already retains deliberate fallback state; do not stop the game loop.
});
```

Do not gate `requestAnimationFrame` on asset completion. Frames rendered before preload completion use fallback diagnostics and automatically switch to sprites when ready.

- [ ] **Step 2: Preserve pointer coordinate conversion**

Keep all existing `canvasToCell(event.clientX, event.clientY, core)` call sites. The renderer now handles DOM rect subtraction, camera offset, inverse iso transform, rotation, and diamond hit-testing.

Road drag must still call the unchanged `manhattanPath()` in authoritative coordinates. Do not create diagonal simulation roads just because isometric screen axes are diagonal.

- [ ] **Step 3: Preserve Q/E, wheel zoom, and pan commands**

Existing GameApp shortcuts remain unchanged. `renderer.rotate()`, `.zoomBy()`, and `.pan()` now forward to `IsometricCamera`.

- [ ] **Step 4: Expose non-authoritative test diagnostics only**

If browser smoke needs it, expose read-only renderer state through existing `window.__civicApp.renderer`, which already exists through `__civicApp`. Do not add persistence fields.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/GameApp.ts src/rendering/WorldRenderer.ts src/main.ts
git commit -m "feat: integrate isometric asset preload with game input"
```

---

### Task 12: Add bounded culling and fallback diagnostics before visual smoke testing

**Files:**
- Create: `src/rendering/isometric/IsometricCulling.ts`
- Modify: `src/rendering/passes/GroundRenderPass.ts`
- Modify: `src/rendering/passes/ObjectRenderPass.ts`
- Modify: `src/rendering/WorldRenderer.ts`
- Extend: `tests/isometric-projection.test.ts`

**Interfaces:**
- Produces: `projectedWorldBounds()`, `isProjectedSpriteVisible()`.
- Consumes: camera, canvas CSS width/height, conservative sprite padding.

- [ ] **Step 1: Add culling tests around map/canvas edges**

Test that a projected 1×1 tile just outside the viewport is culled, a tall sprite whose anchor is outside but extent overlaps the viewport remains visible, and zoom/rotation do not produce negative-size bounds.

- [ ] **Step 2: Implement conservative culling**

Use screen-space AABB tests after projection. Ground uses tile diamond bounds. Elevated objects use manifest source size × display scale and anchor offsets. Add 32 logical pixels of safety margin to avoid popping at edges.

- [ ] **Step 3: Avoid per-frame asset allocation**

Audit render passes:
- atlas images are preloaded once;
- manifest indexes are constructed once in registry constructor;
- road lookup Map/Set may be rebuilt once per frame, not once per cell;
- no `new Image()` in draw paths;
- no manifest `filter()` across every entry for every building; registry query indexes keys such as category/zone/intensity/orientation.

- [ ] **Step 4: Surface diagnostics without frame spam**

`WorldRenderer.assetDiagnostics()` returns deduplicated failures. Log each new failure once from preload/first resolution, not each frame. Fallback sprites remain readable.

- [ ] **Step 5: Test and commit**

```bash
node --experimental-strip-types --test tests/isometric-projection.test.ts tests/isometric-assets.test.ts tests/isometric-render-order.test.ts
npm run typecheck
git add src/rendering/isometric/IsometricCulling.ts src/rendering/passes/GroundRenderPass.ts src/rendering/passes/ObjectRenderPass.ts src/rendering/WorldRenderer.ts tests/isometric-projection.test.ts
git commit -m "perf: add conservative isometric view culling"
```

---

### Task 13: Add browser interaction smoke tests, deterministic visual scenes, and repetition checks

**Files:**
- Create: `tests/smoke/isometric_pass_a_smoke.py`
- Create: `tests/smoke/isometric_visual_smoke.py`
- Modify: `package.json`
- Extend: `tests/isometric-variant-selection.test.ts`

**Interfaces:**
- Consumes: production browser app through `window.__civicApp` and visible UI.
- Produces: repeatable smoke validation; screenshots are local CI/test artifacts, not authoritative game state.

- [ ] **Step 1: Add a dedicated package smoke command**

```json
"test:smoke:isometric": "python tests/smoke/isometric_pass_a_smoke.py"
```

- [ ] **Step 2: Write browser load/atlas smoke test**

`isometric_pass_a_smoke.py` must:
1. run against the built app using the same server pattern as existing phase smoke tests;
2. capture console errors/page errors and fail on uncaught errors;
3. wait until `window.__civicApp.renderer` exists;
4. wait until atlas preload finishes or diagnostics stabilize;
5. assert no required atlas request returned 404;
6. assert renderer tile metrics report `64×32` at zoom 1 before interaction.

- [ ] **Step 3: Test isometric click targeting**

From the browser, obtain a visible authoritative cell center via:

```js
const app = window.__civicApp;
const p = app.renderer.worldToCanvas(6, 6, app.core);
return { x: p.x, y: p.y };
```

Click that canvas point with the residential zoning tool and assert `core.zoning.get(6,6)?.zone === 'residential'`. Repeat after one Q rotation and verify the same requested world cell is selected using its newly projected center.

- [ ] **Step 4: Test road drag semantics**

Project start `(3,3)` and end `(8,6)`, perform the existing road pointer drag, then assert the road cells match the current Manhattan path semantics: horizontal segment first, then vertical segment, with no diagonal-only cells.

- [ ] **Step 5: Test zoom, pan, overlays, and save/load**

Verify:
- wheel zoom changes renderer zoom but remains within `0.45–2.5`;
- middle/right pan changes projected screen point for a fixed world cell without changing world state;
- activate one traffic/economy/land-housing overlay and take a screenshot while no page error occurs;
- save, mutate a visible cell, load, and confirm authoritative state returns to the saved value.

- [ ] **Step 6: Create deterministic visual smoke scenes**

`isometric_visual_smoke.py` should use existing public tools/core APIs to construct and capture these named screenshots in a temp/artifact directory:
- `suburban_edge.png`;
- `urban_mixed_density.png`;
- `dense_core.png`;
- `industrial_logistics.png`;
- `civic_cluster.png`;
- `construction.png`;
- `traffic_freight.png`;
- `overlay.png`.

The script must fail if any screenshot is blank/near-uniform by sampling pixel variance, but it does not establish brittle pixel-perfect baselines in Pass A.

- [ ] **Step 7: Add deterministic repetition guard**

In `tests/isometric-variant-selection.test.ts`, generate a 12×12 synthetic grid of stable IDs for each zone/intensity and select variants. Assert:
- every family uses at least 3 variant IDs;
- no row or column contains a run of more than 5 identical selected asset IDs;
- rerunning selection returns byte-identical asset-ID grids.

This guards algorithmic repetition; the visual smoke scene remains the manual art-quality check.

- [ ] **Step 8: Run smoke tests and commit**

```bash
npm run build
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
node --experimental-strip-types --test tests/isometric-variant-selection.test.ts
git add tests/smoke/isometric_pass_a_smoke.py tests/smoke/isometric_visual_smoke.py tests/isometric-variant-selection.test.ts package.json
git commit -m "test: validate isometric interaction and visual scenes"
```

---

### Task 14: Run full regression, finalize art documentation, and produce the Pass A production report

**Files:**
- Create: `docs/art/ASSET_BIBLE.md`
- Create: `docs/art/PASS_A_REPORT.md`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_LOG.md`

**Interfaces:**
- No new runtime interfaces. Documentation records the shipped presentation contract and exact verification evidence.

- [ ] **Step 1: Run the full existing simulation regression suite before changing docs**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
```

Expected: every command exits 0. If any pre-existing deterministic digest changes, stop and fix the presentation code; do not update expected V7 snapshots to hide a renderer-induced simulation change.

- [ ] **Step 2: Inspect generated atlas inventory and record exact counts**

Use a small one-off Node command against `PASS_A_ASSET_MANIFEST` to print counts by category, zone/intensity, road class, vehicle family, facility, terrain, and construction stage. Copy the actual counts into `PASS_A_REPORT.md`; do not estimate.

- [ ] **Step 3: Write `docs/art/ASSET_BIBLE.md`**

Record the locked values from the approved spec and implementation:
- 2:1 projection;
- 128×64 source ground tile / 64×32 display tile;
- floor/vehicle/tree scale ranges;
- northwest light direction and southeast shadows;
- palette/material/window/signage rules;
- anchor/orientation rules;
- North American baseline;
- naming and atlas conventions;
- explicit prohibition on real logos/copied proprietary assets.

- [ ] **Step 4: Write the exact Pass A report**

Use these headings from the spec:

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
```

Under **Assets created**, list each source SVG, generated atlas filename, manifest location, and actual entry counts. Under **Testing**, paste command names and pass/fail results, plus visual-scene names and zoom/rotation coverage. Under **Remaining gaps**, keep Pass B/C/D/E items out of Pass A unless they are actual defects.

- [ ] **Step 5: Update architecture/readme/development log**

Document that:
- authoritative V7 simulation/save remains unchanged;
- `WorldRenderer` now projects the same grid isometrically and delegates focused passes;
- raster atlases are build-time outputs from source-controlled SVG sheets;
- manifest/registry are presentation-only;
- fallback rendering is deliberate and non-authoritative.

- [ ] **Step 6: Review Pass A acceptance criteria one-by-one**

Confirm in `PASS_A_REPORT.md` that all 15 acceptance criteria from the design spec are met. If any criterion is not met, mark Pass A incomplete and fix it before the final commit.

- [ ] **Step 7: Commit final documentation**

```bash
git add docs/art/ASSET_BIBLE.md docs/art/PASS_A_REPORT.md README.md docs/ARCHITECTURE.md docs/DEVELOPMENT_LOG.md
git commit -m "docs: complete isometric Tier 1 asset Pass A"
```

- [ ] **Step 8: Final verification after the documentation commit**

```bash
npm test && npm run typecheck && npm run lint && npm run build && npm run test:smoke && npm run test:smoke:phase7 && npm run test:smoke:isometric
```
Expected: all green on the final commit.

---

## Implementation Notes for Reviewers

1. **Presentation-only invariant:** Every code review should reject renderer code that writes to `SimulationCore`, road graph, zoning, buildings, service state, transit state, economy state, housing state, or save payloads.
2. **No silent fallback as production art:** Diagnostic fallback is resilience, not a substitute for required Tier 1 atlas coverage. Smoke tests should normally report zero required-asset fallbacks.
3. **Generated PNG policy:** SVG atlas sheets are source-controlled authoring files; PNG atlases are generated into `dist/` by the build and are not authoritative source files.
4. **Rotation correctness:** Rotate world coordinates and topology masks before selection/drawing. Do not rotate the Canvas bitmap wholesale; that breaks text, overlays, picking, and directional asset semantics.
5. **Building identity:** Use current `Building.id`/`lotId` and `definitionId` for stable selection. Do not add visual IDs to saves.
6. **Construction:** Stage is derived from `constructionStartedTick`, `completionTick`, `status`, and current tick only.
7. **Future geometry:** Keep manifest footprint/anchor fields even though V7 uses one-cell authoritative buildings. Phase 2R can later consume larger footprints without replacing the asset contract.
8. **Pass boundary:** Do not add highways, parking simulation, full mixed-use mechanics, nighttime, weather, pedestrians, landmarks, or the full UI icon replacement in this plan. Those remain later reviewed passes.
