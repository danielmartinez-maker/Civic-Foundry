# Stack 3 — 3D Presentation & Asset Scale-Up Completion Report

## Status

**Implementation status:** functionally accepted on the exact code checkpoint below; documentation-complete branch remains subject to the same exact-head CI gate before merge.

**PR:** #114 — `Stack 3 — 3D Presentation & Asset Scale-Up`

**PR state:** draft, open, unmerged.

**Base:** `design/3d-presentation-asset-program@4393521b5f1345ab7873cdce7f3b3dd75e4d1632`

**Feature branch:** `feature/stack-3-3d-presentation-asset-scaleup`

**Exact functional acceptance checkpoint:** `d9260a82068673eeb830725fd49d35067dbcb0a5`

That checkpoint is the first Stack 3 head where repository verification, every inherited browser/visual smoke, accepted House A Chromium smoke, and the new Stack 3 production-district Chromium smoke all passed together. This report is itself a later documentation commit, so Git cannot self-record its own eventual commit SHA; the final PR head and its exact-head CI result are reported in the handoff/PR evidence after this document is committed.

## Outcome

Stack 3 scales the accepted House A Babylon vertical slice into a controlled 14-family production 3D presentation wave without changing simulation, world, cadastral, transportation, economy, service, or Save V9 authority.

The implementation adds:

- production asset metadata and explicit runtime byte estimates;
- 13 new source recipes plus accepted House A for a 14-family first wave;
- deterministic semantic-family catalog lookup and asset selection;
- generic retained production scene reconciliation;
- generic Babylon GLB instancing and stable pick identity;
- deterministic 112-entity block and 1008-entity neighborhood fixtures;
- unique-prototype structural CPU/GPU budget accounting;
- bounded LOD prototype release/eviction;
- compiled Chromium representative-district visual acceptance;
- a stricter save-to-rendering architecture firewall;
- updated architecture, testing, and asset-pipeline documentation.

No test was weakened to obtain acceptance.

## Changed files

### CI/build/package

- `.github/workflows/ci.yml`
- `.github/workflows/stack3.yml`
- `package.json`

### Production asset sources

- `assets/source/3d/buildings/cf_bld_res_detached_house_a_low_v01.asset.json`
- `assets/source/3d/buildings/cf_bld_res_rowhouse_a_med_v01.asset.json`
- `assets/source/3d/buildings/cf_bld_com_corner_shop_a_low_v01.asset.json`
- `assets/source/3d/buildings/cf_bld_mix_mainstreet_a_med_v01.asset.json`
- `assets/source/3d/industrial/cf_bld_ind_light_workshop_a_low_v01.asset.json`
- `assets/source/3d/civic/cf_fac_fire_station_a_v01.asset.json`
- `assets/source/3d/civic/cf_landmark_water_tower_a_v01.asset.json`
- `assets/source/3d/public-realm/cf_prop_street_furniture_a_v01.asset.json`
- `assets/source/3d/public-realm/cf_prop_pocket_park_a_v01.asset.json`
- `assets/source/3d/vehicles/cf_veh_compact_car_a_v01.asset.json`
- `assets/source/3d/transit/cf_transit_bus_stop_a_v01.asset.json`
- `assets/source/3d/vegetation/cf_veg_deciduous_tree_a_v01.asset.json`
- `assets/source/3d/construction/cf_construction_basic_kit_a_v01.asset.json`
- `assets/source/3d/condition/cf_condition_basic_kit_a_v01.asset.json`

### Asset compiler/catalog contract

- `tools/3d/asset-source-schema.mjs`
- `tools/3d/CivicAssetCompiler.mjs`
- `src/rendering/3d/assets/AssetManifestV2.ts`
- `src/rendering/3d/assets/AssetManifestV2Validation.ts`
- `src/rendering/3d/assets/AssetCatalogV2.ts`

### Production presentation/runtime

- `src/rendering/3d/presentation/PresentationTypes.ts`
- `src/rendering/3d/presentation/ProductionAssetSelector.ts`
- `src/rendering/3d/presentation/Stack3AcceptanceDistrict.ts`
- `src/rendering/3d/scene/ProductionSceneLayer.ts`
- `src/rendering/3d/scene/BabylonProductionSceneAdapter.ts`
- `src/rendering/3d/scene/Civic3DProductionRuntime.ts`
- `src/rendering/3d/Civic3DWorldRenderer.ts`

### Architecture policy

- `scripts/check-architecture.mjs`
- `tests/architecture_policy.test.ts`

### Tests and fixtures

- `tests/stack3_asset_contract.test.ts`
- `tests/stack3_asset_wave.test.ts`
- `tests/stack3_asset_selection.test.ts`
- `tests/stack3_production_scene_layer.test.ts`
- `tests/stack3_picking_reconstruction.test.ts`
- `tests/stack3_scene_budget.test.ts`
- `tests/smoke/civic_3d_stack3_smoke.py`
- `tests/asset_compiler.test.ts`
- `tests/asset_manifest_v2.test.ts`
- `tests/asset_streaming_3d.test.ts`
- `tests/asset_streaming_cancellation_race_3d.test.ts`
- `tests/civic_3d_building_runtime.test.ts`

### Design/plan/documentation

- `docs/superpowers/specs/2026-08-31-stack-3-3d-presentation-asset-scaleup-design.md`
- `docs/superpowers/plans/2026-08-31-stack-3-3d-presentation-asset-scaleup.md`
- `docs/art/3D_ASSET_PIPELINE.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTING.md`
- `docs/art/STACK_3_3D_PRESENTATION_ASSET_SCALEUP_REPORT.md`

## Task-by-task completion

### Task 1 — Production metadata contract

Added required `semanticFamily` to source and Manifest V2 entries plus positive integer runtime estimates:

- `estimatedCpuGeometryBytes`
- `estimatedGpuGeometryBytes`
- `estimatedGpuMaterialBytes`

The compiler emits the metadata, Manifest V2 validation enforces it, and existing test fixtures were migrated without changing persistence/gameplay semantics.

### Task 2 — Controlled 14-family source wave

Added the approved 13 lightweight deterministic miniature recipes around the accepted House A asset. All 14 use the common meter-scale, `ground-center`, `-Z` forward, `+Y` up contract and provide LOD0/LOD1/LOD2 plus required production metadata/collision/state information.

Generated GLBs remain `dist/` outputs; source authority remains text-first.

### Task 3 — Deterministic semantic catalog selection

`AssetCatalogV2` now keeps deterministic entry order and semantic-family indexes. `selectProductionAssetId(...)` sorts candidates before hashing with the existing visual determinism helper. Empty families return no selection; persistent selection uses no `Math.random()`.

### Task 4 — Generic retained production scene

`ProductionSceneLayer` retains handles by stable presentation ID and records deterministic mutation counters/budgets. Identical state creates no new handle. Appearance-only changes update in place; structural fingerprint, asset, canonical identity, or LOD change replaces the handle.

`reconstructionDigest()` provides deterministic teardown/rebuild evidence.

### Task 5 — Babylon production adapter and picking

`BabylonProductionSceneAdapter` instantiates accepted GLB prototypes under retained roots, applies deterministic transforms, and binds frozen presentation/canonical identity through the node hierarchy. Pick resolution returns the stable presentation identity without reading gameplay facts from Babylon.

### Task 6 — Representative structural fixtures

`Stack3AcceptanceDistrict` produces deterministic fixtures:

- block: **112** presentation entities;
- neighborhood: **1008** presentation entities;
- unique production wave: **14** assets/prototypes at a fixed LOD set.

Budget summaries count prototype geometry/material memory once per unique asset rather than once per instance.

### Task 7 — Browser/visual acceptance

Added `npm run test:smoke:3d:stack3` and CI integration. The Chromium smoke verifies generated artifacts, 112 retained entities, 14 prototypes, memory bound, stable identities, visible rendered variance, zero-churn identical reconciliation, deterministic digest/picks, orbit/zoom/review cameras, night mode, teardown/reconstruction, and byte-identical Save V9.

Evidence files:

- `district.png`
- `front.png`
- `top.png`
- `night.png`

CI uploads them from `test-artifacts/civic-3d-stack3/`.

### Task 8 — Architecture firewall/documentation/full acceptance

Added a RED architecture-policy assertion proving Save cannot import the 3D rendering tree, then added the broader `save-no-rendering` production rule. Simulation and world already had stronger rendering bans, while all authoritative roots already rejected Babylon/glTF Transform packages.

Asset-pipeline, architecture, testing, plan, and completion-report documentation were updated. Exact documentation-complete head CI is required before the draft PR can be considered ready for a separate merge authorization.

## Defects discovered and fixed

### 1. Temporary metadata patch workflow was not idempotent

An early Task 1 patch mechanism could duplicate validation loops when reapplied. The temporary mechanism was removed after the production changes were committed and the implementation was made direct/idempotent.

### 2. Existing manifest fixtures became stale under the stricter contract

The new required semantic family/runtime estimates exposed inherited in-memory fixtures that no longer represented a valid Manifest V2 entry. Only fixture metadata was updated; runtime tests and validation were not weakened.

### 3. First Stack 3 browser render was structurally loaded but visually blank

The deliberate browser acceptance reached all structural assertions: 112 active retained entities and 14 prototypes existed, but `district.png` was a uniform 960 x 680 clear-color frame. The captured artifact had a sampled luminance span of 0 and one sampled color.

Root cause was the acceptance seam returning after structural GLB instantiation before the Babylon scene/material effects were ready for the first captured frame. `Civic3DProductionRuntime.apply(...)` now waits for `scene.whenReadyAsync()` after reconciliation and before the caller's accepted render/capture. The visual-variance assertion remained unchanged.

Validated result at `d9260a82068673eeb830725fd49d35067dbcb0a5`: Stack 3 production district Chromium smoke passed.

### 4. Obsolete LOD prototypes could remain resident after release

`AssetStreamingManager` intentionally keeps zero-reference resources resident until explicit eviction/disposal. A production camera cycling through LODs could therefore accumulate old prototypes. The production runtime now releases and explicitly evicts obsolete zero-reference `asset@lod` entries after retained handle replacement. Acquisition-failure cleanup also releases/evicts newly acquired unused entries.

Ordering is deliberate: replacement/destroy occurs before old prototype eviction so live instances do not lose shared materials/geometry.

### 5. Canonical identity could become stale under a stable presentation ID

The original structural-change predicate did not include `canonicalId`. If fingerprints stayed unchanged while the source canonical identity changed, retained pick metadata could remain stale. Canonical identity is now structural and forces replacement. A dedicated test locks this invariant.

### 6. Task 8 exposed an incomplete Save architecture boundary

Simulation and world already forbade rendering imports; Save only forbade app/UI plus direct Babylon/glTF Transform packages. A new RED test required Save -> `src/rendering/3d` to fail. The production policy now forbids all Save -> `src/rendering/` imports via `save-no-rendering`.

### 7. New canonical-identity regression initially had a lint-only regex defect

The first version escaped quote characters unnecessarily inside a regular expression, causing four `no-useless-escape` errors. The test was corrected to parse the reconstruction digest and assert the canonical ID directly. This was a test-code quality defect, not a weakened assertion.

## RED/GREEN evidence

### Task 7 deliberate browser RED

At deliberate browser RED head `144ab9342fbeb9a69eeda61f9a12fdd6438bf101`, inherited browser smokes remained green while the new Stack 3 smoke failed because the production runtime/browser seam had not been implemented.

A later integrated head `689b49ed93805974a8288683884ee48102cf1391` reached the new runtime seam but failed the first screenshot variance assertion with a uniform clear-color `district.png`. That failure isolated the first-frame visual-readiness defect rather than fixture construction or canonical authority.

### Task 7 GREEN checkpoint

Exact functional acceptance checkpoint:

```text
d9260a82068673eeb830725fd49d35067dbcb0a5
```

GitHub Actions at that head:

- **Civic Foundry CI** run `33469538565` — success;
- **Civic Foundry TDD Fast** run `33469538410` — success;
- **Stack 3 3D Presentation Scale-Up** run `33469538433` — success.

Within Civic Foundry CI, the following all completed successfully together:

- core `npm run verify`;
- Phase 6 browser smoke;
- Phase 7 browser smoke;
- Urban Fabric browser smoke;
- Isometric Pass A browser smoke;
- Isometric Pass A visual smoke;
- Civic 3D House A browser smoke;
- Stack 3 production district browser smoke.

### Task 8 firewall RED/GREEN

RED test commit:

```text
a7114798d978e8643bbd9ccb49faec45fef355aa
```

The new architecture test expected `save-no-rendering` for Save -> `src/rendering/3d`, while the then-current policy returned no violation.

GREEN production rule commit:

```text
96a600fcb985ed66ee24ae50c592799f1988175d
```

The architecture policy now contains the explicit broader Save -> rendering boundary. Subsequent full functional acceptance at `d9260a...` included `npm run architecture:check` through `npm run verify`.

## Exact verification commands

The acceptance set is:

```bash
npm run format:check
npm run lint
npm run policy:check
npm run architecture:check
npm run typecheck
npm test
npm run assets:policy
npm run assets:3d:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
npm run test:smoke:3d-house
npm run test:smoke:3d:stack3
```

The permanent `.github/workflows/stack3.yml` also runs the focused Stack 3 suites, typecheck, asset policy/compiler check, build, and a full repository gate.

## Historical PR donor audit

Older presentation PRs were audited as semantic donors only; none was wholesale merged.

### PR #91 — Isometric B1

Retained/adapted concepts: architectural family semantics, mixed-use/lifecycle/condition semantics, deterministic weighted visual choice, and read-only consumption of canonical building identity. Sprite-atlas/Pixi-specific implementation was not imported into the Babylon production scene.

### PR #96 — Isometric B2

Retained/adapted concepts: public-realm context profiles, deterministic context resolution, revision/fingerprint caching concepts, and presentation-only parking/public-realm semantics. Sprite-command implementation was superseded by retained Babylon handles.

### PR #99 — GPU Phase 2

Retained/adapted concepts: retained identity, bounded allocation/prototype reuse, unchanged-frame no-recreation behavior, and diagnostics. Pixi sprite implementation was not merged.

### PR #103 — GPU Phase 3

Retained concept: semantic overlays/canonical metric ownership remain presentation consumers. 3D overlay specialization is deferred unless a later stack requires it.

## Performance/memory position

Stack 3 does not claim a synthetic universal frame-time number from Node tests. It establishes structural performance invariants that prevent the primary known scale-up regressions:

- 112- and 1008-entity deterministic fixtures;
- retained reconciliation instead of full-world recreation;
- no creates on an identical second apply;
- unique-prototype memory estimates rather than per-instance multiplication;
- at most the fixed 14-family prototype set for the controlled wave at one active LOD selection per asset;
- explicit zero-reference obsolete LOD eviction;
- browser acceptance on the representative block fixture.

Platform-specific GPU timing/profiling can extend this contract later without changing authority or persistence.

## Remaining risks

1. `Civic3DProductionRuntime` uses a separate instance of the existing streaming manager/loader from `Civic3DBuildingRuntime`. If both runtimes actively load the same asset/LOD in a future integrated world, presentation cache residency can be duplicated. The Stack 3 acceptance path keeps the House A building runtime idle, so this is a future cache-consolidation optimization rather than an acceptance blocker.
2. Runtime byte estimates are declared/validated structural budgets, not hardware-measured VRAM counters. They are intentionally conservative contract inputs.
3. The representative production district is presentation-only. Gameplay-wide semantic mapping from every canonical domain entity into these families can expand in later stacks without making the fixture authoritative.
4. Generated GLBs are deterministic compiler outputs, but final art production can increase geometry/material complexity. Future family revisions must preserve the same validation/budget gates.

## Authority statement

Stack 3 introduces **no new simulation or persistence authority**.

The following remain canonical in their existing domains:

- `SimulationCore` / `SimulationKernel`;
- `WorldFoundation`;
- `CadastralGraph` and cadastral runtime mutation boundary;
- canonical `BuildingV2` and property/zoning owners;
- transportation, traffic, economy, freight, utility, and public-service systems;
- Save V9.

The following are presentation-only:

- `semanticFamily` asset classification and deterministic asset choice;
- production GLB prototypes/LOD residency;
- retained Babylon handles and materials;
- presentation/canonical pick metadata;
- reconstruction digests and runtime diagnostics;
- Stack 3 block/neighborhood fixtures;
- camera/review state and visual time;
- screenshots/CI visual evidence.

Rendering may derive from canonical state. It may not manufacture, mutate, serialize, or supersede canonical gameplay facts.

## Merge status

PR #114 must remain draft/unmerged until the documentation-complete exact branch head passes the same required CI. Even after that gate is green, merge requires separate explicit user authorization.
