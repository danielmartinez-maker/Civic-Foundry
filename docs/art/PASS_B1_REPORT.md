# Isometric Pass B1 — Building Depth & Mixed Use

## Status

**Implementation and acceptance verification are complete against the frozen Urban Fabric 2.0 checkpoint below.**

- Branch: `feature/isometric-pass-b1-urban-depth`
- Pull request: #91, stacked on `feature/urban-fabric-2.0` / PR #63
- Verified B1 implementation/re-stack head: `6adbd53767a831534fd891af19396e2f4270f3bd`
- Verified Urban Fabric checkpoint: `1c1479bdad0a7be6db16263128f5aee38dccdc44`
- No merge to `main` has been performed.

This report deliberately freezes acceptance to `1c1479b` rather than treating the moving parent branch tip as immutable. If PR #63 advances again before B1 integration, perform the normal final re-stack and revalidation against that newer parent.

Pass A remains an immutable compatibility baseline at 161 entries. Pass B1 adds 138 building presentation entries, producing a composed runtime manifest of **299 entries across 9 atlases** without changing simulation authority or save semantics.

## Delivered scope

### Mixed-use architecture

Pass B1 adds six deterministic mixed-use architectural families:

- `mix_mainstreet_corner_01`
- `mix_mainstreet_row_01`
- `mix_mainstreet_courtyard_01`
- `mix_podium_slab_01`
- `mix_podium_tower_01`
- `mix_podium_courtyard_01`

The first three serve `main_street_mixed_use`; the latter three serve `podium_mixed_use`. Every family has five authored condition frames: `new`, `maintained`, `aging`, `neglected`, and `abandoned`.

### Existing-building condition depth

All 27 Pass A building families retain their existing maintained-state identity. Pass B1 adds four additional condition frames per family: `new`, `aging`, `neglected`, and `abandoned`.

That contributes 108 existing-family condition sprites plus 30 mixed-use sprites = **138 new Pass B1 entries**.

### Manifest composition

Pass A remains exactly **161 entries**. B1 is carried in a separate `PassB1AssetManifest` and composed by `AssetManifestComposer` into the **299-entry runtime manifest**. Duplicate atlas IDs and asset IDs are rejected explicitly.

### Authoritative-state visual resolution

`BuildingVisualResolver` is presentation-only. It consumes canonical `BuildingV2` state and derives visual condition from `lifecycle.exteriorCondition`, with authoritative `abandoned` status taking precedence.

Condition thresholds:

- `new`: exterior condition >= 90
- `maintained`: >= 70
- `aging`: >= 45
- `neglected`: >= 20
- `abandoned`: < 20, or authoritative status is `abandoned`

The resolver does not create or mutate simulation state and adds no save-state fields.

### Pass A deterministic identity compatibility

During implementation, a regression showed that selecting a legacy architectural family from the V2 building ID alone could change historical Pass A art identity. The resolver was corrected to reuse Pass A's existing deterministic weighted selection key for legacy buildings.

Regression coverage verifies exact Pass A family parity, stable architectural identity through lifecycle deterioration, and camera-rotation independence.

### Asset query and atlas pipeline

`AssetQuery` now exposes `condition` and `qualityTier`, and `AssetRegistry` includes both dimensions in filtering and cache identity.

B1 adds `urban_depth_buildings` as a ninth deterministic source atlas. It is generated through the existing procedural isometric art pipeline and rasterized by the existing build tool. The eight Pass A atlas coordinate contracts remain unchanged.

### Rendering performance hardening

The first B1 runtime integration called `BuildingSystem.getV2At()` once for every legacy building inside `ObjectRenderPass`. Since `getV2At()` spatially scans canonical buildings and tests polygon intersections, this repeated reconciliation work could trend toward quadratic render cost as city building counts grew.

B1 now builds a read-only `CanonicalBuildingVisualIndex` once per object-render pass from authoritative canonical footprints, then performs keyed legacy-cell lookups during drawing. This is a presentation projection only: `BuildingV2` remains authoritative and no save or simulation ownership semantics move into rendering.

Performance-fix TDD sequence:

- RED `9fe422d`: canonical-index tests were committed before the production module existed; targeted CI failed with `ERR_MODULE_NOT_FOUND`.
- mechanism GREEN `dc988cc`: positive-intersection, overlap-precedence, and input-order tests passed while the renderer integration guard intentionally remained red.
- integration GREEN `b7967a3`: `ObjectRenderPass` consumed the index and the regression guard confirmed the per-building `.getV2At(` hot-loop path was removed.

Coverage locks positive footprint-intersection semantics, deterministic lowest-ID precedence when canonical footprints overlap a legacy cell, input-order independence, and renderer use of the index.

## Frozen-parent integration

Urban Fabric checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44` includes later Save V9, cadastral-overlay/parcel-inspector, property-market, and UI work.

Only one B1 production file overlapped that parent tranche: `src/rendering/WorldRenderer.ts`. The merge resolution preserves the parent's meter-space helpers, cadastral overlay state/API, selected-parcel behavior, and extended overlay draw arguments. B1 changes only the asset source from the Pass A manifest to `RUNTIME_ASSET_MANIFEST`.

Relative to checkpoint `1c1479b`, B1 head `6adbd53` contains exactly **21 files**, all within the intended B1 rendering, assets, tests, documentation, and branch-scoped CI surface. No Save V9, property-market, UI-controller, `SimulationCore`, or other Urban Fabric authority implementation file is part of the B1 delta.

## Verification evidence

### Urban Fabric checkpoint

GitHub Actions run **33010729268** on parent checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44` completed successfully.

Direct job-log evidence reports **601/601 tests passed, 0 failed**, followed by successful typecheck, lint, asset validation, build, Phase 6/7 browser smoke, Pass A interaction/browser smoke, and Pass A visual smoke.

### Dedicated Pass B1 gate

GitHub Actions run **33011045261** on B1 re-stack head `6adbd53767a831534fd891af19396e2f4270f3bd` completed successfully.

It passed:

- all focused Pass A + Pass B1 unit tests
- B1 TypeScript diagnostic delta against the exact stacked parent
- repository-wide TypeScript typecheck
- lint
- validation of all 9 isometric atlas contracts and procedural source sheets
- production build/rasterization
- Pass A interaction regression smoke
- Pass B1 browser visual smoke

The B1 visual smoke covers mixed-use Main Street, podium mixed-use district, condition progression, the 299-entry / 9-atlas runtime manifest, and empty asset diagnostics.

### Full repository gate

GitHub Actions run **33011045312** on the same B1 re-stack head completed successfully.

The full repository test step passed, followed by successful typecheck, lint, asset-source validation, production build, Phase 6 browser smoke, Phase 7 browser smoke, Pass A browser smoke, and Pass A eight-scene visual smoke.

Because the current full-job log is too large for reliable connector extraction of the aggregate test count, this report intentionally records the verified pass result without inventing a numeric count.

## RED/GREEN defects caught before acceptance

The TDD cycle caught and corrected five material defects:

1. `AssetRegistry` initially ignored `condition` and `qualityTier` query dimensions.
2. the B1 atlas contract did not yet exist when first required by tests.
3. the first legacy visual resolver path could drift from Pass A deterministic building identity.
4. the first browser visual-smoke fixture depended on sparse cadastral reconstruction and lost one synthetic canonical building; the fixture was corrected to use explicit canonical V2 footprints rather than weakening the smoke assertion.
5. the first renderer path performed a canonical spatial scan for each legacy building; `CanonicalBuildingVisualIndex` removed that hot-loop scaling defect while retaining deterministic spatial semantics.

## Preserved invariants

- Pass A remains a stable 161-entry presentation baseline.
- Persistent building art uses no `Math.random()` or camera-dependent identity selection.
- `BuildingV2` remains authoritative for typology/lifecycle/status.
- presentation does not manufacture simulation outcomes.
- the canonical visual index is read-only and is not a second cadastral/building authority.
- construction buildings retain the existing construction-stage rendering path.
- B1 introduces no save-version or save-state changes.
- Urban Fabric remains owner of cadastral/building/property authority.

## Acceptance state

Pass B1 is **implementation-complete and verification-complete against frozen parent checkpoint `1c1479b`**. PR #91 remains draft. No merge to `main` is implied or authorized by this report.

If the Urban Fabric parent advances before integration, re-stack B1 onto that newer parent and rerun the final gates. That is an integration freshness check, not unfinished B1 implementation.

## Recommended next asset tranche

After B1 integration, the next asset-library tranche remains **Pass B2 — Parking & Public Realm**. Gameplay-linked parking presentation must stay subordinate to the authoritative parking model in the Civic Foundry 2.0 roadmap. B2 can begin with non-authoritative public-realm depth—sidewalk character, streetscape, parking-lot presentation, curb/public-space variants—without inventing parking supply, price, or occupancy in presentation state.
