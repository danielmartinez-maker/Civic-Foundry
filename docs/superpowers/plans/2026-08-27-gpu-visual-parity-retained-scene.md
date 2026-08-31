# GPU Visual Parity & Retained Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary geometry-first Pixi world presentation with deterministic Pass A atlas sprites and retained/pool-based GPU scene synchronization without changing simulation authority.

**Architecture:** Keep `GpuWorldRenderer` as the application-facing facade. Add pure retained-scene bookkeeping and deterministic sprite-command builders that are Node-testable, plus a browser-facing `GpuAssetRegistry` that translates the existing `PASS_A_ASSET_MANIFEST` into cached Pixi textures. The renderer synchronizes keyed sprites instead of clearing/recreating base scene objects every frame; selection/basic Phase 1 overlay seams remain Graphics until Phase 3.

**Tech Stack:** TypeScript 5.8.3, PixiJS 8.20.1/WebGL, Node test runner, Playwright browser smoke, existing Pass A atlas generator and manifest.

**Spec:** `docs/superpowers/specs/2026-08-27-gpu-visual-parity-retained-scene.md`

## Global Constraints

- `GpuWorldRenderer` remains the production renderer and explicitly initializes WebGL with `preference: 'webgl'` and `powerPreference: 'high-performance'`.
- `PASS_A_ASSET_MANIFEST` remains the only atlas/asset identity authority.
- Reuse `VariantSelector`, `RoadAutotile`, `ConstructionVisuals`, `VehicleVisuals`, `RenderOrder`, and `IsometricCamera`; do not fork their rules.
- No production GPU module may acquire `CanvasRenderingContext2D` or call `getContext('2d')`.
- No edits under `src/simulation/`, `src/world/`, or `src/save/` unless a separately handled compatibility defect is discovered.
- A second unchanged draw must not create replacement static scene display objects.
- Vehicle pools and all renderer caches must remain bounded.

---

### Task 1: RED contracts for canonical asset reuse and retained identity

**Files:**
- Create: `tests/gpu-retained-scene.test.ts`
- Modify: `tests/desktop_gpu_runtime.test.ts`

**Interfaces:**
- Consumes: existing manifest and helper modules.
- Produces required API for later tasks: `RetainedSceneIndex<T>`, `GpuAssetCatalog`, `buildBaseSpriteCommands(...)`, `GpuWorldRenderer.debugSceneStats()`.

- [ ] **Step 1: Write failing retained-scene behavior tests**

Create tests that import the not-yet-existing modules and specify the API:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { RetainedSceneIndex } from '../src/rendering/gpu/RetainedSceneIndex.ts';
import { GpuAssetCatalog } from '../src/rendering/gpu/GpuAssetCatalog.ts';
import { PASS_A_ASSET_MANIFEST } from '../src/rendering/assets/PassAAssetManifest.ts';

test('retained index reuses identity for an unchanged fingerprint', () => {
  const index = new RetainedSceneIndex<{ id: number }>();
  let nextId = 0;
  const first = index.sync([{ key: 'road:4,4', fingerprint: 'local|3' }], {
    create: () => ({ id: ++nextId }),
    update: () => undefined,
    destroy: () => undefined,
  });
  const second = index.sync([{ key: 'road:4,4', fingerprint: 'local|3' }], {
    create: () => ({ id: ++nextId }),
    update: () => undefined,
    destroy: () => undefined,
  });
  assert.equal(first.entries[0]?.value.id, second.entries[0]?.value.id);
  assert.equal(second.delta.created, 0);
  assert.equal(second.delta.updated, 0);
});

test('retained index updates in place and removes missing keys', () => {
  const index = new RetainedSceneIndex<{ id: number }>();
  let updates = 0;
  let destroys = 0;
  const hooks = {
    create: () => ({ id: 1 }),
    update: () => { updates += 1; },
    destroy: () => { destroys += 1; },
  };
  index.sync([{ key: 'building:a', fingerprint: 'occupied|a' }], hooks);
  const changed = index.sync([{ key: 'building:a', fingerprint: 'construction|a' }], hooks);
  assert.equal(changed.delta.updated, 1);
  index.sync([], hooks);
  assert.equal(updates, 1);
  assert.equal(destroys, 1);
});

test('GPU asset catalog queries the canonical Pass A manifest', () => {
  const catalog = new GpuAssetCatalog(PASS_A_ASSET_MANIFEST);
  assert.equal(catalog.query({ category: 'road', subcategory: 'local' }).length, 16);
  assert.equal(catalog.resolveEntry('vehicle_bus_01_o2')?.variantKey, 'vehicle_bus_01');
  assert.deepEqual(catalog.diagnostics(), []);
});
```

- [ ] **Step 2: Add source-contract assertions**

Extend `tests/desktop_gpu_runtime.test.ts` so it requires the production GPU renderer to import `GpuAssetRegistry`, `PASS_A_ASSET_MANIFEST`, and Pixi `Sprite`, and forbids a base-scene `clearLayers()` implementation from remaining.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run in CI-compatible form:

```bash
node --experimental-strip-types --test tests/gpu-retained-scene.test.ts tests/desktop_gpu_runtime.test.ts
```

Expected: failure because `RetainedSceneIndex.ts`, `GpuAssetCatalog.ts`, and the sprite-based renderer integration do not exist yet.

- [ ] **Step 4: Commit the RED tests only**

```bash
git add tests/gpu-retained-scene.test.ts tests/desktop_gpu_runtime.test.ts
git commit -m "test: define GPU retained scene contracts"
```

---

### Task 2: Pure retained-scene index and canonical asset catalog

**Files:**
- Create: `src/rendering/gpu/RetainedSceneIndex.ts`
- Create: `src/rendering/gpu/GpuAssetCatalog.ts`
- Test: `tests/gpu-retained-scene.test.ts`

**Interfaces:**
- `RetainedDescriptor = Readonly<{ key: string; fingerprint: string }>`.
- `RetainedSceneIndex<T>.sync(descriptors, hooks)` returns `{ entries, delta, totals }` where each entry includes `{ key, fingerprint, value }` and counters include created/updated/removed/active.
- `GpuAssetCatalog` exposes `query(query)`, `resolveEntry(assetId)`, `resolveVariant(variantKey, orientation)`, and `diagnostics()` over an existing `AssetManifest`.

- [ ] **Step 1: Implement the minimum retained index**

Use one `Map<string, { fingerprint: string; value: T }>`; on sync create missing keys, call update only when fingerprint changes, destroy removed values, and return immutable snapshots/counters. Never let the index inspect simulation objects.

- [ ] **Step 2: Implement the manifest-backed catalog**

Validate using `validateAssetManifest`, index entries by ID and variant family, reuse `resolveVariantEntry`, and implement the same filter dimensions as `AssetQuery`. Do not import Pixi here.

- [ ] **Step 3: Run focused tests GREEN**

```bash
node --experimental-strip-types --test tests/gpu-retained-scene.test.ts tests/isometric-assets.test.ts tests/isometric-variant-selection.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/gpu/RetainedSceneIndex.ts src/rendering/gpu/GpuAssetCatalog.ts tests/gpu-retained-scene.test.ts
git commit -m "feat: add GPU retained scene primitives"
```

---

### Task 3: Deterministic base-scene sprite command builder

**Files:**
- Create: `src/rendering/gpu/BaseSpriteCommands.ts`
- Modify: `tests/gpu-retained-scene.test.ts`

**Interfaces:**
- Produces `BaseSpriteCommand` with exact fields:

```ts
export type BaseSpriteCommand = Readonly<{
  key: string;
  fingerprint: string;
  assetId: string;
  x: number;
  y: number;
  depth: DepthKey;
  category: 'terrain' | 'road' | 'building' | 'construction' | 'civic' | 'utility' | 'vegetation';
}>;

export function buildBaseSpriteCommands(core: SimulationCore, quarterTurns: QuarterTurn): readonly BaseSpriteCommand[];
```

- [ ] **Step 1: Add failing semantic tests**

Add fixture assertions that prove:
- terrain command selection equals `selectCoordinateVariantEntry` for the same coordinate;
- a road command asset ID equals `road_<type>_mask_<rotated mask>`;
- occupied building commands equal `selectBuildingVariantEntry`;
- construction commands track `constructionStageFor`;
- forest vegetation is absent when a building/road/facility/utility occupies the cell;
- returned object commands are sorted with `compareDepthKeys`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --experimental-strip-types --test tests/gpu-retained-scene.test.ts
```

Expected: FAIL because `BaseSpriteCommands.ts` is missing.

- [ ] **Step 3: Implement command derivation by reusing canonical helpers**

Use `PASS_A_ASSET_MANIFEST` only as input to `GpuAssetCatalog`; reuse:

```ts
roadConnectivityMask(...)
rotateRoadMask(...)
selectCoordinateVariantEntry(...)
selectBuildingVariantEntry(...)
selectStableVariantEntry(...)
constructionStageFor(...)
makeDepthKey(...)
compareDepthKeys(...)
rotateWorldPoint(...)
```

Map unsupported/missing asset selections to deterministic fallback asset IDs only; do not invent simulation state.

- [ ] **Step 4: Run focused tests GREEN and typecheck**

```bash
node --experimental-strip-types --test tests/gpu-retained-scene.test.ts tests/isometric-variant-selection.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rendering/gpu/BaseSpriteCommands.ts tests/gpu-retained-scene.test.ts
git commit -m "feat: derive deterministic GPU sprite commands"
```

---

### Task 4: Pixi atlas registry and retained static sprite layers

**Files:**
- Create: `src/rendering/gpu/GpuAssetRegistry.ts`
- Create: `src/rendering/gpu/RetainedSpriteLayer.ts`
- Modify: `src/rendering/gpu/GpuWorldRenderer.ts`
- Modify: `tests/desktop_gpu_runtime.test.ts`
- Modify: `tests/smoke/isometric_pass_a_smoke.py`

**Interfaces:**
- `GpuAssetRegistry.preload(): Promise<void>`.
- `GpuAssetRegistry.texture(assetId): { entry: AssetManifestEntry; texture: Texture } | null`.
- `GpuAssetRegistry.diagnostics(): readonly string[]`.
- `RetainedSpriteLayer.sync(commands, projectionContext)` retains `Sprite` by command key and exposes counters.
- `GpuWorldRenderer.debugSceneStats()` returns presentation-only counts/cumulative create/update/remove values.

- [ ] **Step 1: Add failing browser/source assertions**

Require:
- `preloadAssets()` to wait for both Pixi application initialization and atlas preload;
- `assetDiagnostics()` to return registry diagnostics;
- `debugSceneStats()` to exist;
- two unchanged draw cycles to leave cumulative static creation counters unchanged.

Update the smoke fixture after seeded world creation:

```python
before = page.evaluate("() => window.__civicApp.renderer.debugSceneStats()")
page.evaluate("() => window.__civicApp.renderer.draw(window.__civicApp.core,'none',null)")
page.evaluate("() => window.__civicApp.renderer.draw(window.__civicApp.core,'none',null)")
after = page.evaluate("() => window.__civicApp.renderer.debugSceneStats()")
assert after["staticCreated"] == before["staticCreated"]
```

- [ ] **Step 2: Verify RED through unit/source tests**

```bash
node --experimental-strip-types --test tests/desktop_gpu_runtime.test.ts tests/gpu-retained-scene.test.ts
```

Expected: FAIL because renderer integration is not present.

- [ ] **Step 3: Implement `GpuAssetRegistry`**

Use PixiJS 8 `Assets`, `Texture`, and `Rectangle`. For each atlas descriptor, load its URL once, then create/cached subtextures from `entry.sourceRect`. Anchor each sprite from manifest pixel anchors:

```ts
sprite.anchor.set(
  entry.anchor.x / entry.sourceRect.width,
  entry.anchor.y / entry.sourceRect.height,
);
```

Surface manifest validation, atlas load, missing entry, and texture-creation errors through renderer diagnostics.

- [ ] **Step 4: Implement retained static sprite synchronization**

Replace terrain/road/building/construction/civic/utility/vegetation `Graphics` drawing with keyed Pixi `Sprite`s. Use `0.5 * camera.zoom` display scale, project through `IsometricCamera`, reuse `isProjectedSpriteVisible`, and reorder object children according to the sorted `DepthKey` sequence without replacing sprite identity.

Zoning may remain a lightweight vector layer in this phase because it has no atlas identity; selection/preview and Phase 1 overlay seam remain Graphics.

- [ ] **Step 5: Make initialization failure observable**

Store the initialization promise and error; `preloadAssets()` awaits it and rejects on fatal Pixi initialization instead of polling forever.

- [ ] **Step 6: Run verification**

```bash
npm run typecheck
npm test
npm run build
python tests/smoke/isometric_pass_a_smoke.py
```

Expected: PASS with `assetDiagnostics() === []` in browser smoke.

- [ ] **Step 7: Commit**

```bash
git add src/rendering/gpu/GpuAssetRegistry.ts src/rendering/gpu/RetainedSpriteLayer.ts src/rendering/gpu/GpuWorldRenderer.ts tests/desktop_gpu_runtime.test.ts tests/smoke/isometric_pass_a_smoke.py
git commit -m "feat: render retained GPU atlas sprites"
```

---

### Task 5: Retained/pool-based vehicle sprite presentation

**Files:**
- Create: `src/rendering/gpu/VehicleSpriteCommands.ts`
- Create: `src/rendering/gpu/RetainedVehicleLayer.ts`
- Modify: `src/rendering/gpu/GpuWorldRenderer.ts`
- Modify: `tests/gpu-retained-scene.test.ts`
- Modify: `tests/smoke/isometric_pass_a_smoke.py`

**Interfaces:**
- `buildVehicleSpriteCommands(core, quarterTurns)` returns key, assetId, position, orientation, and queued-emphasis metadata for private/service/transit/freight vehicles.
- `RetainedVehicleLayer` retains active identity and pools released sprites by compatible asset family with a fixed per-family maximum.

- [ ] **Step 1: Add failing command/pool tests**

Assert private vehicles use `privateVehicleVariantKey`, service/transit use their existing helper functions, freight uses `vehicle_freight_truck_01`, orientation uses `vehicleOrientationFromWorldDelta`, and repeated appearance/disappearance cannot grow a family pool beyond the exported fixed maximum.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/gpu-retained-scene.test.ts
```

- [ ] **Step 3: Implement command derivation using existing locator logic**

Reuse `locateServiceVehicle`, `locateTransitVehicle`, `locateFreightVehicle` and the same graph interpolation used by `VehicleRenderer`; do not modify vehicle systems.

- [ ] **Step 4: Implement pooled Pixi sprites**

Retain by `private:<id>`, `service:<id>`, `transit:<id>`, `freight:<id>`. Return removed sprites to bounded pools; reuse compatible sprites for new identities. Keep metro behavior consistent with the current visual contract (no surface transit vehicle sprite for metro if the legacy draw contract excludes it).

- [ ] **Step 5: Run focused + browser verification**

```bash
npm run typecheck
npm test
npm run build
python tests/smoke/isometric_pass_a_smoke.py
```

- [ ] **Step 6: Commit**

```bash
git add src/rendering/gpu/VehicleSpriteCommands.ts src/rendering/gpu/RetainedVehicleLayer.ts src/rendering/gpu/GpuWorldRenderer.ts tests/gpu-retained-scene.test.ts tests/smoke/isometric_pass_a_smoke.py
git commit -m "feat: add retained GPU vehicle sprites"
```

---

### Task 6: Phase 2 regression/authority gate and draft PR

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/adr/0002-desktop-gpu-runtime.md`
- Test: all existing suites.

**Interfaces:**
- Produces a Phase 2 branch that Phase 3 can stack on.

- [ ] **Step 1: Document the retained GPU scene**

State that Pass A atlases are now the production base-scene presentation, static sprites are retained, moving sprites are pooled, and the generic analytical overlay seam remains intentionally pending Phase 3.

- [ ] **Step 2: Run the full repository verification**

```bash
npm run verify
python tests/smoke/phase6_smoke.py
python tests/smoke/phase7_land_housing_smoke.py
python tests/smoke/urban_fabric_smoke.py
python tests/smoke/isometric_pass_a_smoke.py
python tests/smoke/isometric_visual_smoke.py
```

Expected: every command PASS.

- [ ] **Step 3: Verify authority-domain isolation**

Compare branch to `main` and assert no changed path begins with `src/simulation/`, `src/world/`, or `src/save/`.

- [ ] **Step 4: Commit docs**

```bash
git add README.md docs/ARCHITECTURE.md docs/adr/0002-desktop-gpu-runtime.md
git commit -m "docs: record retained GPU presentation parity"
```

- [ ] **Step 5: Open a draft PR against `main`**

Title: `GPU Presentation Phase 2 — Atlas parity + retained scene`

PR body must include TDD RED evidence, final CI run ID/head SHA, authority isolation statement, and deferred Phase 3 overlay parity.

- [ ] **Step 6: Do not merge**

Leave the Phase 2 PR open for the user's explicit integration decision. Phase 3 may be implemented as a stacked branch based on the verified Phase 2 head because the user requested both phases.
