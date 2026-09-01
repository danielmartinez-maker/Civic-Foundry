# Stack 3 — 3D Presentation & Asset Scale-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale the accepted House A Babylon vertical slice into a deterministic 14-family production asset wave with retained scene reconstruction, stable picking, bounded structural memory/allocation diagnostics, and representative city-scene acceptance.

**Architecture:** Extend the existing Asset Manifest V2/compiler/catalog and retained Babylon scene seams rather than introducing parallel authority or a second asset system. Production assets remain text-first source recipes compiled deterministically to GLB; generic production presentation entities are retained by stable IDs, use the existing streaming/prototype caches, and are reconstructible from complete presentation fixtures.

**Tech Stack:** TypeScript, Node 22 test runner, Babylon.js, glTF Transform, Python Playwright/Pillow browser smoke, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-31-stack-3-3d-presentation-asset-scaleup-design.md`

## Global Constraints

- Base all implementation work on `design/3d-presentation-asset-program@4393521b5f1345ab7873cdce7f3b3dd75e4d1632` through `feature/stack-3-3d-presentation-asset-scaleup`.
- Preserve Save V9 semantics exactly.
- Do not move authority from `SimulationCore`, `WorldFoundation`, `CadastralGraph`, canonical `BuildingV2`, transportation, economy, or services into presentation.
- Do not merge PR #91, #96, #99, or #103 wholesale; port semantic concepts only.
- Keep first-party generated runtime binaries under `dist/`; tracked sources remain text-first.
- No production behavior without a failing regression/contract first.
- No `Math.random()` in persistent asset selection or scene reconstruction.
- No per-frame full-world reconstruction or uncontrolled object allocation.
- Preserve the existing House A browser and visual acceptance gates.

---

### Task 1: Production Asset Metadata Contract

**Files:**
- Modify: `tools/3d/asset-source-schema.mjs`
- Modify: `tools/3d/CivicAssetCompiler.mjs`
- Modify: `src/rendering/3d/assets/AssetManifestV2.ts`
- Modify: `src/rendering/3d/assets/AssetManifestV2Validation.ts`
- Test: `tests/stack3_asset_contract.test.ts`

**Interfaces:**
- Produces `semanticFamily: string` on each manifest entry.
- Produces `runtime.estimatedCpuGeometryBytes`, `runtime.estimatedGpuGeometryBytes`, and `runtime.estimatedGpuMaterialBytes` as positive integers.
- Compiler emits the same metadata from source recipes into `catalog-v2.json`.

- [ ] **Step 1: Write RED contract tests** proving source validation rejects missing/invalid `semanticFamily` and runtime estimates, and manifest validation rejects invalid runtime budgets.
- [ ] **Step 2: Run the focused Node test in CI and verify failure is caused by the missing production metadata contract.**
- [ ] **Step 3: Extend source schema, manifest types/validation, and compiler manifest emission minimally.**
- [ ] **Step 4: Run focused tests and existing asset/compiler tests to GREEN.**
- [ ] **Step 5: Commit the production metadata contract.**

### Task 2: Controlled 14-Family Production Source Wave

**Files:**
- Create 13 `.asset.json` recipes beneath the existing category directories under `assets/source/3d/`.
- Modify existing House A source to add Stack 3 metadata only; preserve its geometry/art calibration.
- Test: `tests/stack3_asset_wave.test.ts`

**Interfaces:**
- Produces exactly 14 first-wave source asset IDs from the Stack 3 spec.
- Every recipe contains LOD0/LOD1/LOD2, canonical pivot/axes, materials, sockets/state channels as appropriate, runtime budgets, and deterministic compiler output.

- [ ] **Step 1: Write RED wave tests** that require all 14 IDs, category coverage, canonical pivot, three LODs, valid budgets, and deterministic two-pass compiler hashes.
- [ ] **Step 2: Verify RED against the current single-House-A source tree.**
- [ ] **Step 3: Add the 13 lightweight miniature-style source recipes and House A metadata.**
- [ ] **Step 4: Run `npm run assets:3d:check`, the wave tests, compiler tests, and build output checks to GREEN.**
- [ ] **Step 5: Commit the first production asset wave.**

### Task 3: Deterministic Semantic Catalog Selection

**Files:**
- Modify: `src/rendering/3d/assets/AssetCatalogV2.ts`
- Create: `src/rendering/3d/presentation/ProductionAssetSelector.ts`
- Test: `tests/stack3_asset_selection.test.ts`

**Interfaces:**
- `AssetCatalogV2.listBySemanticFamily(family: string): readonly AssetManifestV2Entry[]` returns asset-ID-sorted entries.
- `selectProductionAssetId(stableEntityId, semanticFamily, candidates, visualChannel): AssetId | null` is stable, input-order independent, and uses no runtime randomness.

- [ ] **Step 1: Write RED tests** for family query ordering, input-order independence, stable selection, and empty-family behavior.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement semantic family indexing and deterministic selection using the existing stable hash/determinism helpers.**
- [ ] **Step 4: Run focused tests and existing House A building-resolution tests to GREEN.**
- [ ] **Step 5: Commit deterministic production selection.**

### Task 4: Generic Retained Production Scene Layer

**Files:**
- Extend: `src/rendering/3d/presentation/PresentationTypes.ts`
- Create: `src/rendering/3d/scene/ProductionSceneLayer.ts`
- Test: `tests/stack3_production_scene_layer.test.ts`

**Interfaces:**
- `ProductionVisualState` carries stable `presentationId`, `canonicalId`, `assetId`, transform, variation seed, structural fingerprint, and appearance fingerprint.
- `ProductionSceneLayer.apply(states, cameraPositionM)` retains unchanged instances, replaces only structural/LOD changes, and reports deterministic mutation counters.
- `debugStats()` returns active/create/update/remove/unchanged counts plus prototype-budget estimates.
- `reconstructionDigest()` returns a stable canonical digest of retained presentation identity/asset/LOD/transform/variation state.

- [ ] **Step 1: Write RED tests** for zero-create second reconciliation, structural-only replacement, appearance-only update, deterministic teardown/rebuild digest, and bounded prototype counts.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the generic layer by adapting the accepted BuildingSceneLayer retention/lease pattern without duplicating authority.**
- [ ] **Step 4: Run focused tests plus BuildingSceneLayer regressions to GREEN.**
- [ ] **Step 5: Commit retained production scene scale-up.**

### Task 5: Babylon Generic Instance Adapter and Picking Stability

**Files:**
- Create: `src/rendering/3d/scene/BabylonProductionSceneAdapter.ts`
- Modify: `src/rendering/3d/Civic3DWorldRenderer.ts`
- Test: `tests/stack3_picking_reconstruction.test.ts`

**Interfaces:**
- Generic Babylon handles bind `metadata.presentationEntityId` and preserve it across LOD/prototype replacement.
- Renderer can resolve a picked mesh/node to `PresentationEntityId` without reading gameplay facts from Babylon.
- Appearance-only changes do not replace geometry handles.

- [ ] **Step 1: Write RED tests** proving identity metadata survives LOD replacement and reconstruction and that pick resolution returns the stable presentation ID.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the generic adapter and identity lookup seam using existing House A/Babylon conventions.**
- [ ] **Step 4: Run focused tests, House A picking tests, and renderer contracts to GREEN.**
- [ ] **Step 5: Commit stable generic picking.**

### Task 6: Representative Block/Neighborhood Structural Performance Fixtures

**Files:**
- Create: `src/rendering/3d/presentation/Stack3AcceptanceDistrict.ts`
- Test: `tests/stack3_scene_budget.test.ts`

**Interfaces:**
- `buildStack3AcceptanceDistrict(scale: 'block' | 'neighborhood')` returns deterministic `ProductionVisualState[]`.
- Block fixture contains at least 100 entities and all 14 families.
- Neighborhood fixture contains at least 1,000 entities.
- `summarizeProductionBudget(states, catalog)` returns entity count, unique prototypes, and explicit CPU/GPU estimate totals.

- [ ] **Step 1: Write RED tests** for fixture size/category coverage, identical fixture digest across builds, prototype count <= 14, and memory totals derived from unique prototypes rather than instance count.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement deterministic fixture generation and structural budget summary.**
- [ ] **Step 4: Run focused performance contracts to GREEN.**
- [ ] **Step 5: Commit representative-scene budgets.**

### Task 7: Stack 3 Browser/Visual Acceptance

**Files:**
- Create: `tests/smoke/civic_3d_stack3_smoke.py`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Test artifacts: `test-artifacts/civic-3d-stack3/`

**Interfaces:**
- `npm run test:smoke:3d:stack3` runs the deterministic representative district in Chromium.
- Smoke captures fixed-camera front/district/top/night-or-condition evidence where runtime hooks permit.
- Smoke asserts camera orbit/zoom remains responsive, pick identity is stable, repeated unchanged reconciliation creates no new retained instances, and budget diagnostics remain bounded.

- [ ] **Step 1: Add RED browser smoke entry and assertions before the representative-scene browser hook exists.**
- [ ] **Step 2: Verify expected browser-smoke failure in CI.**
- [ ] **Step 3: Add only the minimum runtime debug/fixture hook needed by the smoke; do not create simulation authority.**
- [ ] **Step 4: Run Stack 3 smoke plus House A regression smoke to GREEN and preserve artifacts.**
- [ ] **Step 5: Commit browser/visual acceptance.**

### Task 8: Architecture Firewall, Report, and Full Acceptance

**Files:**
- Modify: `scripts/check-architecture.mjs` only if the existing firewall does not already cover new modules.
- Modify: `tests/architecture_policy.test.ts` only with stricter coverage, never weaker assertions.
- Create: `docs/art/STACK_3_3D_PRESENTATION_ASSET_SCALEUP_REPORT.md`
- Modify: `docs/art/3D_ASSET_PIPELINE.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Completion report records exact head SHA, changed files, RED/GREEN defects, tests, verification, CI, risks, and authority statement.

- [ ] **Step 1: Add/extend firewall tests proving authoritative directories do not import `src/rendering/3d` or asset-runtime modules.**
- [ ] **Step 2: Run focused architecture/policy tests to GREEN.**
- [ ] **Step 3: Run repository-wide verification: `npm test`, `npm run typecheck`, `npm run format:check`, `npm run assets:policy`, `npm run assets:3d:check`, `npm run build`, inherited browser/visual smoke, House A smoke, and Stack 3 smoke.**
- [ ] **Step 4: Record exact acceptance evidence and remaining risks in the Stack 3 report.**
- [ ] **Step 5: Confirm CI success on the exact final head and leave the PR draft/unmerged unless separately authorized.**
