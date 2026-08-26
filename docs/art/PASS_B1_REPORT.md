# Isometric Pass B1 — Building Depth & Mixed Use

## Status

**Implementation and acceptance verification are complete on the current green Urban Fabric 2.0 parent.**

Branch: `feature/isometric-pass-b1-urban-depth`

Pull request: #91, stacked on `feature/urban-fabric-2.0` / PR #63.

Verified implementation head: `1f758914af80a7777914d66486a6cfdd8f9fa269`.

Stacked parent: `16bfc6731b1ba9ead0aa093d8f132c6608aea790`.

No merge to `main` has been performed.

The approved Pass B1 scope is implemented without changing simulation authority or save semantics. Pass A remains an immutable compatibility baseline at 161 entries; Pass B1 adds 138 building presentation entries for a composed runtime total of 299 entries across 9 atlases.

## Delivered scope

### Mixed-use architecture

Pass B1 adds six deterministic mixed-use architectural families:

- `mix_mainstreet_corner_01`
- `mix_mainstreet_row_01`
- `mix_mainstreet_courtyard_01`
- `mix_podium_slab_01`
- `mix_podium_tower_01`
- `mix_podium_courtyard_01`

The three Main Street families serve `main_street_mixed_use`; the three podium families serve `podium_mixed_use`. Each family has five authored condition frames: `new`, `maintained`, `aging`, `neglected`, and `abandoned`.

### Existing-building condition depth

All 27 Pass A building families retain their existing maintained-state identity. Pass B1 adds four additional condition frames per family: `new`, `aging`, `neglected`, and `abandoned`.

This adds 108 condition sprites for existing families plus 30 mixed-use sprites, for **138 new Pass B1 entries**.

### Manifest composition

Pass A remains unchanged at **161** entries. Pass B1 is carried in a separate `PassB1AssetManifest` and combined by a manifest-composition layer into a **299-entry runtime manifest**. Atlas and asset identity collisions are rejected explicitly.

### Authoritative-state visual resolution

`BuildingVisualResolver` is presentation-only. It consumes canonical `BuildingV2` state and derives a visual condition from `lifecycle.exteriorCondition`, with authoritative `abandoned` status taking precedence.

Condition thresholds are:

- `new`: exterior condition >= 90
- `maintained`: >= 70
- `aging`: >= 45
- `neglected`: >= 20
- `abandoned`: < 20, or authoritative building status is `abandoned`

The resolver does not create simulation state, modify authoritative state, or alter save data.

### Pass A identity compatibility

A regression discovered during implementation showed that selecting legacy architectural families from the V2 building ID alone could change historical Pass A visual identity. The resolver was corrected to reuse Pass A's existing deterministic weighted selection key for legacy buildings.

The regression suite verifies exact Pass A family parity. Camera rotation is excluded from architectural identity selection, and lifecycle deterioration changes only the condition frame, not the selected architectural family.

### Asset pipeline

Pass B1 adds `urban_depth_buildings` as a ninth deterministic source atlas. It is generated through the existing procedural isometric art pipeline and rasterized by the existing atlas build tool. The eight Pass A atlas coordinate contracts remain unchanged.

### Rendering performance hardening

The first runtime integration called `BuildingSystem.getV2At()` once for every legacy building in the object-render loop. Because `getV2At()` spatially scans canonical buildings and tests polygon intersections, this repeated canonical reconciliation work could scale toward quadratic behavior as city building counts increased.

B1 now builds a read-only `CanonicalBuildingVisualIndex` once per object-render pass from authoritative canonical footprints, then performs constant-time keyed lookups by legacy cell while drawing buildings. The index is a presentation projection only: `BuildingV2` remains the simulation authority, and no save or simulation ownership semantics move into rendering.

The performance correction followed an explicit TDD sequence:

- RED `9fe422d`: canonical-index test committed before the module existed; targeted CI failed with `ERR_MODULE_NOT_FOUND`.
- mechanism GREEN `dc988cc`: positive-intersection, overlap-precedence, and input-order tests passed while the renderer integration guard intentionally remained red.
- integration GREEN `b7967a3`: `ObjectRenderPass` consumed the new index and the guard confirmed the per-building `.getV2At(` hot-loop path was removed.

Regression coverage locks positive footprint-intersection semantics, deterministic lowest-ID precedence when canonical footprints overlap a legacy cell, input-order independence, and renderer use of the index.

## Final verification evidence

### Dedicated Pass B1 gate

GitHub Actions run **32998569395** on verified implementation head `1f758914af80a7777914d66486a6cfdd8f9fa269` completed successfully.

It passed:

- **31/31** Pass A + Pass B1 focused tests
- B1 TypeScript diagnostic delta against the exact stacked parent
- repository-wide TypeScript typecheck
- lint
- validation of all **9** isometric atlas contracts and procedural source sheets
- production build and rasterization of all **9** PNG atlases
- existing Pass A interaction regression smoke
- Pass B1 browser visual smoke

The B1 visual smoke verifies mixed-use Main Street, podium mixed-use district, and building-condition progression scenes. It also verifies the 299-entry / 9-atlas runtime manifest and no asset diagnostics.

### Full repository gate

GitHub Actions run **32998569398** on the same B1 implementation head completed successfully.

The repository suite reported **580/580 tests passed** with **0 failures**, followed by successful:

- typecheck
- lint
- asset-source validation
- production build
- Phase 6 browser smoke
- Phase 7 browser smoke
- Pass A interaction/browser smoke
- Pass A eight-scene visual smoke

### Parent gate

Urban Fabric parent `16bfc6731b1ba9ead0aa093d8f132c6608aea790` passed its full repository CI in run **32998374761**. That parent includes the fix preserving multiple grandfathered legacy buildings when frontage cells share one cadastral parcel, clearing the inherited authority regression that previously blocked the stacked full suite.

There is therefore no outstanding inherited CI blocker in the accepted B1 baseline.

## RED/GREEN defects caught during implementation

The TDD cycle caught and corrected five material defects before acceptance:

1. `AssetRegistry` initially ignored `condition` and `qualityTier` query dimensions.
2. the Pass B1 atlas contract did not yet exist when first required by tests.
3. the first legacy visual resolver path could drift from Pass A deterministic building identity.
4. the first browser visual-smoke fixture depended on sparse cadastral reconstruction and lost one synthetic canonical building; the fixture was corrected to use explicit non-overlapping canonical V2 footprints rather than weakening the assertion.
5. the first runtime renderer path performed a canonical full scan for each legacy building; the presentation-only canonical visual index removed that hot-loop scaling defect while retaining deterministic spatial semantics.

## Compatibility and authority invariants

Pass B1 preserves the following invariants:

- Pass A remains a stable presentation baseline at 161 entries.
- no `Math.random()` or camera-dependent identity selection is introduced for persistent building art.
- `BuildingV2` remains authoritative for lifecycle and typology state.
- presentation code does not manufacture simulation outcomes.
- the canonical visual index is read-only and does not become a second land/building authority.
- construction buildings continue to use the existing construction-stage rendering path.
- no new save-state fields or save-version changes are introduced by Pass B1.
- the Urban Fabric parent remains the owner of cadastral/building authority work.

## Parent integration status

PR #91 is stacked on Urban Fabric head `16bfc6731b1ba9ead0aa093d8f132c6608aea790` without rewriting B1 history. Relative to that parent, the PR contains exactly the intended **21-file** Pass B1 rendering, asset, test, documentation, and branch-scoped CI delta. No `SimulationCore` or other Urban Fabric authority implementation file is part of the B1 PR delta.

Both the parent full CI and the B1 targeted/full CI baselines are green. Pass B1 is therefore implementation-complete and verification-complete on its current parent. PR #91 remains draft pending the repository's normal review/integration decision; no merge is implied by this report.

## Recommended next asset tranche

After B1 integration, the next asset-library tranche remains **Pass B2 — Parking & Public Realm**. Gameplay-linked parking presentation must stay subordinate to the authoritative parking model planned in the Civic Foundry 2.0 roadmap. B2 can begin with non-authoritative public-realm depth—sidewalk character, streetscape, parking-lot presentation, curb/public-space variants—without inventing parking supply, price, or occupancy in presentation state.
