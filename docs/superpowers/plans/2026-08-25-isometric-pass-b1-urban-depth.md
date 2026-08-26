# Isometric Pass B1 — Building Depth & Mixed Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 138 condition-aware and mixed-use building presentation entries so the composed Civic Foundry isometric library reaches 299 entries without changing Pass A or authoritative simulation state.

**Architecture:** Keep Pass A immutable and layer B1 through a separate manifest plus a manifest composer. A presentation-only resolver maps authoritative BuildingV2 typology/lifecycle/status into stable architectural family + condition frame. The deterministic source-art pipeline gains one new building atlas while existing atlas coordinates remain untouched.

**Tech Stack:** TypeScript 5.8, Node 22 built-in test runner with strip-types, Python deterministic SVG generation, Playwright/Chromium atlas rasterization, Pillow visual smoke.

**Spec:** `docs/superpowers/specs/2026-08-25-isometric-pass-b1-urban-depth-design.md`

## Global Constraints

- `PASS_A_ASSET_MANIFEST` remains exactly 161 entries.
- Pass B1 adds exactly 138 entries; composed runtime manifest contains exactly 299.
- No save-format, simulation ownership, capacity, rent, cost, use, zoning, or lifecycle mutation changes.
- Existing Pass A asset IDs, variant keys, atlas coordinates, camera semantics, and deterministic selection remain stable.
- New source geometry is deterministic and source-controlled.
- Production code follows RED → GREEN → REFACTOR; every new behavior is proven by a failing test first.
- Because the parent `feature/urban-fabric-2.0` branch is currently red in unrelated tests, B1 uses a temporary/branch-scoped targeted verification workflow to isolate B1 evidence until the parent is green again.

---

### Task 1: Independent B1 test gate and query dimensions

**Files:**
- Create: `.github/workflows/isometric-b1.yml`
- Modify: `tests/isometric-assets.test.ts`
- Modify: `src/rendering/assets/AssetTypes.ts`
- Modify: `src/rendering/assets/AssetRegistry.ts`

**Interfaces:**
- Consumes: existing `AssetQuery`, `AssetRegistry.query()`.
- Produces: `AssetQuery.qualityTier`, `AssetQuery.condition` filtering and cache-key support.

- [ ] **Step 1: Write failing query tests**

Add a manifest with otherwise-identical entries that differ only by `condition` and `qualityTier`, then assert `AssetRegistry.query({ condition: 'aging' })` and `query({ qualityTier: 'premium' })` return only matching entries.

- [ ] **Step 2: Run targeted test and verify RED**

Run `node --experimental-strip-types --test tests/isometric-assets.test.ts` in the B1 workflow. Expected: assertion failure because `AssetRegistry.query()` currently ignores both dimensions.

- [ ] **Step 3: Implement minimal query support**

Add optional `qualityTier` and `condition` to `AssetQuery`; include both in the registry cache key and filter predicate.

- [ ] **Step 4: Verify GREEN**

Run the targeted asset test; expected PASS.

- [ ] **Step 5: Commit**

Commit as `feat(assets): query building condition metadata`.

### Task 2: Manifest composition and B1 library contract

**Files:**
- Create: `src/rendering/assets/AssetManifestComposer.ts`
- Create: `src/rendering/assets/PassB1AssetManifest.ts`
- Create: `tests/isometric-b1-manifest.test.ts`

**Interfaces:**
- Produces: `composeAssetManifests(...manifests: readonly AssetManifest[]): AssetManifest`.
- Produces: `PASS_B1_ASSET_MANIFEST`, `PASS_B1_COMPOSED_ASSET_MANIFEST`, `PASS_B1_MIXED_USE_FAMILIES`.

- [ ] **Step 1: Write RED contract tests**

Assert module availability, Pass A count 161, B1 count 138, composed count 299, valid manifests, unique atlas/asset IDs, 27 legacy families × 4 added condition frames, and 6 mixed-use families × 5 frames.

- [ ] **Step 2: Verify RED**

Run only `tests/isometric-b1-manifest.test.ts`; expected assertion failure because B1 modules do not yet exist.

- [ ] **Step 3: Add minimal composer and manifest declarations**

Create the composer with duplicate rejection. Build B1 entry declarations in stable order using a single `urban_depth_buildings` atlas and 128×192 frames.

- [ ] **Step 4: Verify GREEN and refactor**

Run B1 manifest tests plus existing Pass A asset tests; both must pass.

- [ ] **Step 5: Commit**

Commit as `feat(assets): add Pass B1 manifest composition`.

### Task 3: Building condition and mixed-use resolver

**Files:**
- Create: `src/rendering/assets/BuildingVisualResolver.ts`
- Create: `tests/isometric-b1-building-visuals.test.ts`
- Read-only dependency: `src/simulation/buildings/BuildingTypes.ts`
- Read-only dependency: `src/data/buildingTypologies.ts`

**Interfaces:**
- Produces: `buildingConditionFor(building: Pick<BuildingV2, 'status' | 'lifecycle'>): AssetManifestEntry['condition']`.
- Produces: `buildingVisualFamily(building: Pick<BuildingV2, 'id' | 'typologyId'>): string`.
- Produces: `buildingVariantKey(building: Pick<BuildingV2, 'id' | 'typologyId' | 'status' | 'lifecycle'>): string`.

- [ ] **Step 1: Write RED threshold and identity tests**

Test exact thresholds 90/70/45/20, abandoned status precedence, deterministic selection for both mixed-use typologies, same architectural family after condition change, and camera-independent family selection.

- [ ] **Step 2: Verify RED**

Run the new resolver test; expected failure because resolver module/API is absent.

- [ ] **Step 3: Implement minimum deterministic resolver**

Use stable string hashing of building ID to choose among the eligible three mixed-use families. Keep legacy R/C/I selection mapping compatible with Pass A and append condition suffix only for non-maintained legacy states.

- [ ] **Step 4: Verify GREEN**

Run resolver, manifest, and existing variant-selection tests.

- [ ] **Step 5: Commit**

Commit as `feat(rendering): resolve building depth visuals`.

### Task 4: Deterministic source art and atlas pipeline

**Files:**
- Create: `assets/source/urban_depth_buildings.svg`
- Modify: `tools/isometric_art.py`
- Modify: `tools/render_isometric_atlases.py`
- Modify: `tests/isometric-b1-manifest.test.ts`

**Interfaces:**
- Produces source sheet dimensions sufficient for 138 128×192 slots.
- Produces runtime atlas `dist/assets/atlases/urban_depth_buildings.png`.

- [ ] **Step 1: Add RED source-contract assertions**

Assert the new source contract exists in the renderer's expected-sheet map, exact dimensions match the B1 manifest atlas descriptor, and all source rectangles stay in bounds.

- [ ] **Step 2: Verify RED**

Run `npm run assets:check`; expected failure because the new sheet contract/art is missing.

- [ ] **Step 3: Implement deterministic B1 art generation**

Generate recognizable mixed-use silhouettes and condition transformations while preserving the 2:1 projection, northwest lighting, clean alpha, and fixed 128×192 frame contract.

- [ ] **Step 4: Verify GREEN**

Run `npm run assets:check` and `npm run build`; expected successful validation and rasterization of nine total atlases.

- [ ] **Step 5: Commit**

Commit as `feat(art): generate urban depth building atlas`.

### Task 5: Runtime integration

**Files:**
- Modify: runtime asset-registry construction call site discovered in `src/rendering/WorldRenderer.ts` / `src/app/GameApp.ts`.
- Modify: `src/rendering/passes/ObjectRenderPass.ts` only if required to consume BuildingV2 presentation state.
- Create or modify: focused B1 runtime integration test.

**Interfaces:**
- Runtime registry consumes `PASS_B1_COMPOSED_ASSET_MANIFEST`.
- Building painting uses the B1 resolver only for presentation selection and does not mutate BuildingV2.

- [ ] **Step 1: Write RED integration test**

Assert runtime registry includes the B1 atlas/entries and that mixed-use/condition state resolves to a sprite candidate without altering authoritative building state.

- [ ] **Step 2: Verify RED**

Run the focused integration test; expected assertion failure because runtime still uses Pass A-only assets.

- [ ] **Step 3: Implement minimal integration**

Swap the presentation registry to the composed manifest and route eligible BuildingV2 rendering through `BuildingVisualResolver`, leaving all simulation state untouched.

- [ ] **Step 4: Verify GREEN**

Run B1 tests plus existing isometric presentation tests.

- [ ] **Step 5: Commit**

Commit as `feat(rendering): integrate Pass B1 building assets`.

### Task 6: Visual smoke, documentation, and verification

**Files:**
- Create: `tests/smoke/isometric_b1_visual_smoke.py`
- Modify: `.github/workflows/isometric-b1.yml`
- Create: `docs/art/PASS_B1_REPORT.md`

**Interfaces:**
- Visual smoke writes/validates deterministic scenes: mixed-use main street, podium district, condition progression.

- [ ] **Step 1: Add RED visual-smoke expectations**

Require three nonblank, varied screenshots with B1 atlas loaded and no browser errors.

- [ ] **Step 2: Verify RED**

Run the B1 visual smoke; expected failure until runtime/source integration is complete.

- [ ] **Step 3: Complete smoke harness and report**

Document exact manifest counts, atlas counts, inherited parent CI status, B1 targeted gate results, and any deviations.

- [ ] **Step 4: Run final B1 gate**

Run targeted unit tests, typecheck, lint, asset check, build, existing isometric smoke, and B1 visual smoke. The parent full suite may remain red only for the pre-existing PR #63 failure; B1-specific checks must be green.

- [ ] **Step 5: Commit**

Commit as `test(assets): verify Pass B1 urban depth`.

## Self-Review

Spec coverage is complete: immutable Pass A, exact 138/299 counts, mixed-use families, lifecycle condition bands, deterministic identity, query dimensions, separate atlas, runtime composition, visual smoke, and parent-failure isolation all have explicit tasks. No placeholder implementation steps remain, and interface names are consistent across tasks.
