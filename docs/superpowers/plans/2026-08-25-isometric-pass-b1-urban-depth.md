# Isometric Pass B1 — Building Depth & Mixed Use Implementation Plan

> **Execution status: COMPLETE.** This plan was implemented task-by-task with Superpowers TDD/systematic-debugging discipline. Final implementation verification is recorded in `docs/art/PASS_B1_REPORT.md`.

**Goal:** Add 138 condition-aware and mixed-use building presentation entries so the composed Civic Foundry isometric library reaches 299 entries without changing Pass A or authoritative simulation state.

**Architecture:** Keep Pass A immutable and layer B1 through a separate manifest plus a manifest composer. A presentation-only resolver maps authoritative `BuildingV2` typology/lifecycle/status into stable architectural family + condition frame. The deterministic source-art pipeline gains one new building atlas while existing atlas coordinates remain untouched. A read-only canonical visual index prevents repeated spatial scans in the renderer without becoming a simulation authority.

**Tech Stack:** TypeScript 5.8, Node 22 built-in test runner with strip-types, Python deterministic SVG generation, Playwright/Chromium atlas rasterization, Pillow visual smoke.

**Spec:** `docs/superpowers/specs/2026-08-25-isometric-pass-b1-urban-depth-design.md`

**Final verified implementation head:** `1f758914af80a7777914d66486a6cfdd8f9fa269`

**Final stacked parent:** `16bfc6731b1ba9ead0aa093d8f132c6608aea790`

## Global Constraints

- `PASS_A_ASSET_MANIFEST` remains exactly 161 entries.
- Pass B1 adds exactly 138 entries; composed runtime manifest contains exactly 299.
- No save-format, simulation ownership, capacity, rent, cost, use, zoning, or lifecycle mutation changes.
- Existing Pass A asset IDs, variant keys, atlas coordinates, camera semantics, and deterministic selection remain stable.
- New source geometry is deterministic and source-controlled.
- Production code followed RED → GREEN → REFACTOR; new behavior was proven by failing tests before implementation.
- The branch-scoped B1 verification workflow remains as dedicated acceptance evidence. The current Urban Fabric parent and both B1 gates are green.

---

### Task 1: Independent B1 test gate and query dimensions — COMPLETE

**Files:**
- Created: `.github/workflows/isometric-b1.yml`
- Modified: `tests/isometric-assets.test.ts`
- Modified: `src/rendering/assets/AssetTypes.ts`
- Modified: `src/rendering/assets/AssetRegistry.ts`

**Interfaces:**
- Consumes: existing `AssetQuery`, `AssetRegistry.query()`.
- Produces: `AssetQuery.qualityTier`, `AssetQuery.condition` filtering and cache-key support.

- [x] **Step 1: Write failing query tests**
- [x] **Step 2: Run targeted test and verify RED** — registry initially ignored both dimensions.
- [x] **Step 3: Implement minimal query support**
- [x] **Step 4: Verify GREEN**
- [x] **Step 5: Commit** — query behavior committed and retained in final branch history.

### Task 2: Manifest composition and B1 library contract — COMPLETE

**Files:**
- Created: `src/rendering/assets/AssetManifestComposer.ts`
- Created: `src/rendering/assets/PassB1AssetManifest.ts`
- Created: `tests/isometric-b1-manifest.test.ts`

**Interfaces:**
- Produces: `composeAssetManifests(...manifests: readonly AssetManifest[]): AssetManifest`.
- Produces: `PASS_B1_ASSET_MANIFEST`, `PASS_B1_COMPOSED_ASSET_MANIFEST`, `PASS_B1_MIXED_USE_FAMILIES`.

- [x] **Step 1: Write RED contract tests** — Pass A 161, B1 138, composed 299, uniqueness and family/frame counts.
- [x] **Step 2: Verify RED** — B1 modules absent at test introduction.
- [x] **Step 3: Add minimal composer and manifest declarations** — duplicate atlas/asset identity rejection included.
- [x] **Step 4: Verify GREEN and refactor**
- [x] **Step 5: Commit**

### Task 3: Building condition and mixed-use resolver — COMPLETE

**Files:**
- Created: `src/rendering/assets/BuildingVisualResolver.ts`
- Created: `tests/isometric-b1-building-visuals.test.ts`
- Read-only dependencies: `src/simulation/buildings/BuildingTypes.ts`, `src/data/buildingTypologies.ts`

**Interfaces:**
- Produces: `buildingConditionFor(...)`.
- Produces: deterministic mixed-use/legacy `buildingVisualFamily(...)` behavior.
- Produces: stable condition-aware building variant keys and sprite selection.

- [x] **Step 1: Write RED threshold and identity tests** — exact 90/70/45/20 bands, abandoned precedence, mixed-use families, stable architecture, camera independence.
- [x] **Step 2: Verify RED** — resolver module/API absent at test introduction.
- [x] **Step 3: Implement minimum deterministic resolver**
- [x] **Step 4: Verify GREEN**
- [x] **Step 5: Add Pass A exact-identity regression after discovering ID-only selection drift** — reused historical Pass A weighted selection key.
- [x] **Step 6: Verify exact Pass A deterministic parity**

### Task 4: Deterministic source art and atlas pipeline — COMPLETE

**Files:**
- Created: `assets/source/urban_depth_buildings.svg`
- Modified: `tools/isometric_art.py`
- Existing rasterizer contract consumed by: `tools/render_isometric_atlases.py`
- Modified: `tests/isometric-b1-manifest.test.ts`

**Interfaces:**
- Produces deterministic `urban_depth_buildings` source geometry at 2048×1728.
- Produces 138 128×192 source frames and runtime atlas `dist/assets/atlases/urban_depth_buildings.png`.

- [x] **Step 1: Add RED source-contract assertions**
- [x] **Step 2: Verify RED** — source sheet/art contract missing before implementation.
- [x] **Step 3: Implement deterministic B1 art generation**
- [x] **Step 4: Verify GREEN** — all nine atlas contracts validate and all nine PNG atlases rasterize.
- [x] **Step 5: Commit**

### Task 5: Runtime integration — COMPLETE

**Files:**
- Created: `src/rendering/assets/RuntimeAssetManifest.ts`
- Modified: `src/rendering/WorldRenderer.ts`
- Modified: `src/rendering/passes/ObjectRenderPass.ts`
- Created: `tests/isometric-b1-runtime.test.ts`

**Interfaces:**
- Runtime registry consumes the composed 299-entry manifest.
- Eligible occupied buildings resolve presentation from canonical `BuildingV2` state without mutation.
- Construction rendering remains on the existing construction-stage path.

- [x] **Step 1: Write RED integration test**
- [x] **Step 2: Verify RED** — runtime still used Pass A-only assets.
- [x] **Step 3: Implement minimal composed-manifest and canonical-state integration**
- [x] **Step 4: Verify GREEN**
- [x] **Step 5: Commit**

### Task 6: Visual smoke, documentation, and verification — COMPLETE

**Files:**
- Created: `tests/smoke/isometric_b1_visual_smoke.py`
- Modified: `.github/workflows/isometric-b1.yml`
- Created/finalized: `docs/art/PASS_B1_REPORT.md`

**Interfaces:**
- Visual smoke validates deterministic scenes for mixed-use Main Street, podium district, and condition progression.

- [x] **Step 1: Add RED visual-smoke expectations**
- [x] **Step 2: Verify RED** — first fixture failed because sparse cadastral reconstruction lost one synthetic canonical building.
- [x] **Step 3: Correct fixture without weakening assertions** — explicit non-overlapping canonical V2 footprints.
- [x] **Step 4: Complete smoke harness and report**
- [x] **Step 5: Run final B1 gate** — targeted CI, full repository CI, and parent CI all green.

### Task 7: Renderer scalability hardening — COMPLETE

**Files:**
- Created: `src/rendering/assets/CanonicalBuildingVisualIndex.ts`
- Created: `tests/isometric-b1-canonical-index.test.ts`
- Modified: `src/rendering/passes/ObjectRenderPass.ts`

**Problem:** Runtime integration initially called `BuildingSystem.getV2At()` for every legacy building in the render hot loop. Because `getV2At()` scans canonical buildings spatially, rendering could repeat O(N) canonical lookup work per rendered building.

- [x] **Step 1: Write RED canonical-index and renderer-integration tests** — commit `9fe422d`; CI confirmed `ERR_MODULE_NOT_FOUND` with the new module absent.
- [x] **Step 2: Implement index mechanism only** — commit `dc988cc`; index semantics green while renderer guard intentionally remained red.
- [x] **Step 3: Integrate index into `ObjectRenderPass`** — commit `b7967a3`; one presentation-index build per pass, keyed lookup per legacy cell.
- [x] **Step 4: Lock semantics** — positive footprint intersection, deterministic lowest-ID overlap precedence, input-order independence, and no per-building `.getV2At(` renderer path.
- [x] **Step 5: Re-run B1 and repository gates after latest Urban Fabric re-stack**

## Final Verification Record

- [x] Dedicated B1 workflow run `32998569395`: success; 31/31 focused tests plus typecheck delta, full typecheck, lint, asset validation, production build, Pass A interaction smoke, and B1 visual smoke.
- [x] Full repository workflow run `32998569398`: success; 580/580 tests, 0 failures, typecheck, lint, asset validation, build, Phase 6/7 browser smoke, Pass A interaction smoke, and Pass A eight-scene visual smoke.
- [x] Parent workflow run `32998374761` on `16bfc6731b1ba9ead0aa093d8f132c6608aea790`: success.
- [x] Final parent→B1 comparison contains exactly 21 B1 rendering/asset/test/documentation/CI files and no Urban Fabric authority implementation files.
- [x] `main` remains untouched; PR #91 remains draft pending explicit integration approval.

## Self-Review

Spec coverage is complete: immutable Pass A, exact 138/299 counts, mixed-use families, lifecycle condition bands, deterministic identity, query dimensions, separate atlas, runtime composition, visual smoke, renderer scalability, and clean parent integration all have implemented and verified coverage. No placeholder implementation steps remain.
