# Isometric Pass B1 — Building Depth & Mixed Use

## Status

**Implementation complete on the Pass B1 child branch; re-stack verification pending against the latest Urban Fabric 2.0 parent head.**

Branch: `feature/isometric-pass-b1-urban-depth`

Pull request: #91, stacked on `feature/urban-fabric-2.0` / PR #63.

The original approved Pass B1 scope is implemented without changing simulation authority or save semantics. Pass A remains an immutable compatibility baseline at 161 entries; Pass B1 adds 138 building presentation entries for a composed runtime total of 299 entries across 9 atlases.

## Delivered scope

### Mixed-use architecture

Pass B1 adds six deterministic mixed-use architectural families:

- three Main Street mixed-use families for `main_street_mixed_use`
- three podium mixed-use families for `podium_mixed_use`

Each family has five authored condition frames: `new`, `maintained`, `aging`, `neglected`, and `abandoned`.

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

A regression discovered during implementation showed that selecting legacy architectural families from the V2 building ID alone could change historical Pass A visual identity. The resolver was corrected to reuse Pass A's existing deterministic selection key and weighted-family behavior for legacy buildings.

The resulting regression test verifies exact Pass A family parity. Camera rotation is excluded from architectural identity selection, and lifecycle deterioration changes only the condition frame, not the selected architectural family.

### Asset pipeline

Pass B1 adds `urban_depth_buildings` as a ninth deterministic source atlas. It is generated through the existing procedural isometric art pipeline and rasterized by the existing atlas build tool. The eight Pass A atlas coordinate contracts remain unchanged.

## Verification evidence

The latest fully isolated Pass B1 head verification before parent re-stack was GitHub Actions run **32924247866**.

That run passed:

- 27/27 targeted Pass A + Pass B1 unit tests
- TypeScript typecheck
- lint
- validation of all 9 isometric atlas contracts and procedural source sheets
- production build and rasterization of all 9 PNG atlases
- existing Pass A interaction regression smoke
- Pass B1 browser visual smoke

The Pass B1 browser smoke verified three presentation scenes:

1. mixed-use Main Street
2. podium mixed-use district
3. building-condition progression

It also verified at runtime that the composed manifest contains 299 entries and 9 atlases with no asset diagnostics.

## RED/GREEN defects caught during implementation

The TDD cycle caught and corrected several defects before acceptance:

1. `AssetRegistry` initially ignored `condition` and `qualityTier` query dimensions.
2. the Pass B1 atlas contract did not yet exist when first required by tests.
3. the first legacy visual resolver path could drift from Pass A deterministic building identity.
4. the first browser visual-smoke fixture depended on sparse cadastral reconstruction and lost one synthetic canonical building; the fixture was corrected to use explicit non-overlapping canonical V2 footprints rather than weakening the smoke assertion.

## Compatibility and authority invariants

Pass B1 preserves the following invariants:

- Pass A remains a stable presentation baseline.
- no `Math.random()` or camera-dependent identity selection is introduced for persistent building art.
- `BuildingV2` remains authoritative for lifecycle and typology state.
- presentation code does not manufacture simulation outcomes.
- construction buildings continue to use the existing construction-stage rendering path.
- no new save-state fields or save-version changes are introduced by Pass B1.
- the Urban Fabric parent remains the owner of cadastral/building authority work.

## Parent integration status

During Pass B1 implementation, PR #63 advanced beyond the original stack base. PR #91 is therefore being re-stacked onto the latest `feature/urban-fabric-2.0` head before it can be marked ready for review.

The acceptance criterion after re-stack is the same: the B1 targeted gate must remain green, and the repository-wide PR workflow must be evaluated against the updated parent rather than the stale merge base.

## Recommended next asset tranche

After B1 is integrated, the next asset-library tranche remains **Pass B2 — Parking & Public Realm**, but gameplay-linked parking presentation should stay subordinate to the authoritative parking model planned in the Civic Foundry 2.0 roadmap. B2 can begin with non-authoritative public-realm depth—sidewalk character, streetscape, parking-lot presentation, curb/public-space variants—while avoiding presentation state that invents parking supply, price, or occupancy.
