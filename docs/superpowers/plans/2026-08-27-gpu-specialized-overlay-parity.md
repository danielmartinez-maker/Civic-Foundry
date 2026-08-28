# GPU Specialized Overlay Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic GPU overlay tint with retained Pixi/WebGL rendering for every existing traffic, service, transit, economy, cadastral, and zoning-envelope analytical mode.

**Architecture:** Build a pure `GpuOverlayCommands` translation layer over the existing canonical mapper outputs, then synchronize those commands through a `GpuOverlayCoordinator` containing dedicated retained Pixi containers/pools. Base-scene sprites from Phase 2 remain untouched when overlays change. After parity is verified, run an explicit usage gate before removing legacy Canvas-only rendering code.

**Tech Stack:** TypeScript 5.8.3, PixiJS 8.20.1/WebGL, existing overlay mapper modules, `IsometricCamera`, Node test runner, Playwright browser/visual smoke.

**Spec:** `docs/superpowers/specs/2026-08-27-gpu-specialized-overlay-parity.md`

## Global Constraints

- Phase 3 starts from the fully verified Phase 2 head.
- Existing mapper functions remain canonical; GPU code must not derive independent traffic/service/transit/economy/cadastral metrics.
- Overlay-only changes must not increase Phase 2 base-scene sprite creation counters.
- All projections use `IsometricCamera` and canonical graph/cadastral geometry.
- No production GPU module may use Canvas2D.
- No edits under `src/simulation/`, `src/world/`, or `src/save/` unless a separately handled compatibility defect is discovered.
- Legacy Canvas code is removed only after the explicit removal gate passes.

---

### Task 1: RED semantic command contracts for every overlay family

**Files:**
- Create: `tests/gpu-overlay-parity.test.ts`
- Create: `src/rendering/gpu/GpuOverlayTypes.ts` only after RED is observed.

**Interfaces:**
- Later tasks produce `buildTrafficOverlayCommands`, `buildServiceOverlayCommands`, `buildTransitOverlayCommands`, `buildEconomyOverlayCommands`, `buildCadastralOverlayCommands`, and `buildZoningEnvelopeCommands`.
- Normalized commands are rendering semantics, not Pixi internals.

- [ ] **Step 1: Write failing tests using deterministic simulation fixtures**

The tests require normalized command shapes:

```ts
export type GpuOverlayCommand =
  | Readonly<{ kind: 'cell'; key: string; x: number; y: number; fill: string; alpha: number; label?: string }>
  | Readonly<{ kind: 'segment'; key: string; from: { x: number; y: number }; to: { x: number; y: number }; color: string; widthFactor: number; dash?: readonly number[] }>
  | Readonly<{ kind: 'ring'; key: string; points: readonly { x: number; y: number }[]; fill?: string; fillAlpha?: number; stroke?: string; strokeWidth: number }>
  | Readonly<{ kind: 'marker'; key: string; x: number; y: number; marker: 'stop' | 'metro-station' | 'gateway'; color: string }>
  | Readonly<{ kind: 'label'; key: string; x: number; y: number; text: string; minTileWidth: number }>;
```

Assert semantic parity:
- traffic bottleneck commands omit mapped values `<= 0`;
- traffic congestion/speed/volume preserve existing normalization direction and edge geometry;
- service commands contain mapper-provided cell labels;
- transit commands distinguish bus/BRT/tram/metro dash/color semantics and stops;
- economy freight routes carry dash `[7,4]` and gateways use diamond marker semantics;
- cadastre includes block/parcel/frontage/access commands with distinct styles;
- zoning envelope includes parcel/buildable rings and rounded max-height label.

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/gpu-overlay-parity.test.ts
```

Expected: FAIL because the command modules do not exist.

- [ ] **Step 3: Commit RED tests only**

```bash
git add tests/gpu-overlay-parity.test.ts
git commit -m "test: define GPU overlay parity contracts"
```

---

### Task 2: Pure mapper-to-command translation

**Files:**
- Create: `src/rendering/gpu/GpuOverlayTypes.ts`
- Create: `src/rendering/gpu/GpuOverlayCommands.ts`
- Test: `tests/gpu-overlay-parity.test.ts`

**Interfaces:**
- `buildTrafficOverlayCommands(core, mode)`.
- `buildServiceOverlayCommands(core, mode)`.
- `buildTransitOverlayCommands(core, mode)`.
- `buildEconomyOverlayCommands(core, mode)`.
- `buildCadastralOverlayCommands(core, selectedParcelId)`.
- `buildZoningEnvelopeCommands(core, selectedParcelId)`.

- [ ] **Step 1: Implement traffic translation**

Call `mapTrafficOverlay(core.transportationGraph, core.traffic.edgeMetrics, core.trafficSnapshot, mode)` and canonical graph reads. Preserve existing max-speed/max-volume normalization and the bottleneck style/inclusion rule from `OverlayRenderPass`.

- [ ] **Step 2: Implement service translation**

Call `mapServiceOverlay(core, mode)`. Emit cell commands with the existing green-to-red service hue semantics and label commands with `minTileWidth: 40`.

- [ ] **Step 3: Implement transit translation**

Call `mapTransitOverlay(core, mode)`. Preserve:

```ts
metro -> '#bb8cff', dash [12,4,3,4]
tram  -> '#ffb65f', dash [3,4]
brt   -> '#59d8c4', dash [9,4]
bus   -> '#68a8ff', dash []
```

Use canonical line stop IDs and stop coordinates. Emit wait labels at `minTileWidth: 40`.

- [ ] **Step 4: Implement economy translation**

Call `mapEconomyOverlay(core, mode)`. Preserve amber cell alpha `0.18 + clamp(value) * 0.5`, route width scaling from current route maximum, freight dashes `[7,4]`, and gateway marker commands.

- [ ] **Step 5: Implement cadastral/zoning translation**

Call `mapCadastralOverlay(core)` and `mapZoningEnvelope(core, selectedParcelId)`. Emit canonical meter-coordinate rings/segments; do not copy/store another cadastral graph. Preserve frontage/access styles and zoning fill/stroke colors from the Canvas reference pass.

- [ ] **Step 6: Run focused tests GREEN**

```bash
node --experimental-strip-types --test tests/gpu-overlay-parity.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/rendering/gpu/GpuOverlayTypes.ts src/rendering/gpu/GpuOverlayCommands.ts tests/gpu-overlay-parity.test.ts
git commit -m "feat: translate canonical overlays to GPU commands"
```

---

### Task 3: Shared retained GPU overlay primitives and coordinator

**Files:**
- Create: `src/rendering/gpu/GpuOverlayPrimitives.ts`
- Create: `src/rendering/gpu/GpuOverlayCoordinator.ts`
- Modify: `src/rendering/gpu/GpuWorldRenderer.ts`
- Modify: `tests/gpu-overlay-parity.test.ts`

**Interfaces:**
- `GpuOverlayCoordinator.sync(core, camera, modes, selectedParcelId, viewport)`.
- `GpuOverlayCoordinator.stats()` returns active/created/updated/recycled counts by family.
- Dedicated containers: traffic, service, transit, economy, cadastral, zoning-envelope.

- [ ] **Step 1: Add failing retained overlay tests**

Specify a pure/keyed synchronization model in tests so two identical command lists cause zero creation on the second sync; mode cycling keeps pools bounded; changing selected parcel only changes cadastral/zoning entries.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/gpu-overlay-parity.test.ts
```

- [ ] **Step 3: Implement projected primitives**

Provide functions that configure reusable Pixi `Graphics`/`Text` objects for:
- projected cell polygons from `camera.tilePolygon`;
- world/cell segment strokes;
- meter rings through `LEGACY_CELL_SIZE_METERS` and `camera.worldToCanvas`;
- deterministic dash segmentation along projected endpoints;
- stop/metro/gateway marker shapes;
- labels with stable styles.

Dashed segmentation must be deterministic for fixed endpoints and dash array; it is purely visual.

- [ ] **Step 4: Implement coordinator containers/pools**

Use retained keyed maps per family. Synchronize only active family commands and hide inactive family containers. Pool `Graphics` and `Text` with fixed maxima; no unbounded allocation across mode cycling.

- [ ] **Step 5: Replace `drawOverlayTint` in `GpuWorldRenderer`**

Route current traffic/service/transit/economy/urban-fabric modes to the coordinator. Leave land-housing or any unrelated already-existing UI overlay outside this phase unchanged. Ensure base retained scene methods are not called solely because an overlay mode changed.

- [ ] **Step 6: Run unit/typecheck GREEN**

```bash
node --experimental-strip-types --test tests/gpu-overlay-parity.test.ts tests/gpu-retained-scene.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/rendering/gpu/GpuOverlayPrimitives.ts src/rendering/gpu/GpuOverlayCoordinator.ts src/rendering/gpu/GpuWorldRenderer.ts tests/gpu-overlay-parity.test.ts
git commit -m "feat: render retained GPU analytical overlays"
```

---

### Task 4: Browser and visual parity coverage

**Files:**
- Create: `tests/smoke/gpu_overlay_parity_smoke.py`
- Modify: `tests/smoke/isometric_pass_a_smoke.py`
- Modify: `tests/smoke/isometric_visual_smoke.py`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Browser reads `GpuWorldRenderer.debugSceneStats()` and `debugOverlayStats()` only as presentation diagnostics.

- [ ] **Step 1: Add browser smoke mode cycling**

Seed deterministic scenarios, cycle every supported traffic/service/transit/economy/cadastre/zoning-envelope mode, and assert:
- no page/console errors;
- expected overlay command/object counts are non-zero for seeded applicable modes;
- labels respect tile-width threshold;
- base `staticCreated` counter remains unchanged through overlay-only cycling;
- repeated identical overlay draw does not increment overlay created count.

- [ ] **Step 2: Add representative visual scenes**

Capture deterministic reference scenes for:
- traffic congestion;
- service coverage;
- transit ridership/crowding;
- economy freight/gateway;
- cadastre frontage/access;
- zoning envelope.

Keep existing image-comparison thresholds; only update expected reference images for intentional reviewed output changes.

- [ ] **Step 3: Add the new smoke command to CI**

After Isometric Pass A browser smoke, run:

```bash
python tests/smoke/gpu_overlay_parity_smoke.py
```

- [ ] **Step 4: Run compiled verification**

```bash
npm run build
python tests/smoke/isometric_pass_a_smoke.py
python tests/smoke/gpu_overlay_parity_smoke.py
python tests/smoke/isometric_visual_smoke.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/gpu_overlay_parity_smoke.py tests/smoke/isometric_pass_a_smoke.py tests/smoke/isometric_visual_smoke.py .github/workflows/ci.yml
git commit -m "test: add GPU overlay browser parity gates"
```

---

### Task 5: Explicit legacy Canvas removal gate

**Files:**
- Potentially delete only after usage audit: `src/rendering/WorldRenderer.ts`, `src/rendering/passes/GroundRenderPass.ts`, `src/rendering/passes/ObjectRenderPass.ts`, `src/rendering/passes/OverlayRenderPass.ts`, `src/rendering/passes/SelectionRenderPass.ts`, Canvas-only painter/render facade files that have no remaining canonical use.
- Modify imports/tests/docs as proven safe by the audit.

**Interfaces:**
- Pure helpers (`VariantSelector`, `RoadAutotile`, `ConstructionVisuals`, `VehicleVisuals`, `RenderOrder`, overlay mapper modules, vehicle locator functions if reused by GPU) remain available even if Canvas facades are deleted.

- [ ] **Step 1: Run repository usage search before deletion**

Search for imports/references to `WorldRenderer`, `GroundRenderPass`, `ObjectRenderPass`, `OverlayRenderPass`, `SelectionRenderPass`, `SpritePainter`, and Canvas vehicle renderers. Classify each result as production, test, docs, or pure-helper dependency.

- [ ] **Step 2: Preserve canonical pure behavior**

If GPU code still imports pure locators from Canvas vehicle files, extract only those locator functions to a rendering-neutral presentation helper before deleting the Canvas class. Add focused tests proving returned positions are unchanged.

- [ ] **Step 3: Delete only files with zero required use**

Do not weaken tests to enable deletion. Production must continue to contain no Canvas2D path; all Phase 2 + Phase 3 tests must remain green.

- [ ] **Step 4: Run focused source search**

Assert no production path contains:

```text
getContext('2d')
CanvasRenderingContext2D
new WorldRenderer
```

If unrelated tooling/tests legitimately use Canvas APIs, document the scope instead of deleting them blindly.

- [ ] **Step 5: Commit cleanup**

```bash
git add -A src/rendering tests docs
git commit -m "refactor: retire legacy Canvas world rendering"
```

---

### Task 6: Phase 3 full verification and stacked draft PR

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/adr/0002-desktop-gpu-runtime.md`

**Interfaces:**
- Produces Phase 3 as a separately reviewable stacked PR based on the Phase 2 branch/head until Phase 2 is merged.

- [ ] **Step 1: Update architecture/runtime docs**

Document full GPU analytical overlays, retained containers/pools, and the actual status of legacy Canvas removal.

- [ ] **Step 2: Run full verification**

```bash
npm run verify
python tests/smoke/phase6_smoke.py
python tests/smoke/phase7_land_housing_smoke.py
python tests/smoke/urban_fabric_smoke.py
python tests/smoke/isometric_pass_a_smoke.py
python tests/smoke/gpu_overlay_parity_smoke.py
python tests/smoke/isometric_visual_smoke.py
```

Expected: every command PASS.

- [ ] **Step 3: Verify authority isolation**

Compare Phase 3 head against the Phase 2 head and assert no changed path begins with `src/simulation/`, `src/world/`, or `src/save/`.

- [ ] **Step 4: Commit docs**

```bash
git add README.md docs/ARCHITECTURE.md docs/adr/0002-desktop-gpu-runtime.md
git commit -m "docs: record full GPU overlay parity"
```

- [ ] **Step 5: Open stacked draft PR**

If Phase 2 is still unmerged, base Phase 3 PR on `feature/gpu-parity-retained-scene`; after Phase 2 merges it can be retargeted to `main`. Include RED evidence, final CI run/head SHA, overlay coverage, legacy removal status, and authority isolation.

- [ ] **Step 6: Do not merge**

Leave both PRs for the user's explicit integration decision.
