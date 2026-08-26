# Isometric Pass B1 — Building Depth & Mixed Use Implementation Plan

> **Execution status: COMPLETE against frozen Urban Fabric checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44`.** Final acceptance evidence is recorded in `docs/art/PASS_B1_REPORT.md`.

**Goal:** Add 138 condition-aware and mixed-use building presentation entries so the composed Civic Foundry isometric library reaches 299 entries without changing Pass A or authoritative simulation state.

**Final verified re-stack head:** `6adbd53767a831534fd891af19396e2f4270f3bd`

**Verified/frozen parent checkpoint:** `1c1479bdad0a7be6db16263128f5aee38dccdc44`

**Spec:** `docs/superpowers/specs/2026-08-25-isometric-pass-b1-urban-depth-design.md`

## Completed tasks

- [x] **Task 1 — B1 test gate and asset-query dimensions.** Added branch-scoped CI plus `condition` and `qualityTier` query/cache support.
- [x] **Task 2 — Manifest composition and B1 library contract.** Preserved Pass A at 161 entries, added B1 at 138, composed runtime at 299, and enforced unique atlas/asset identity.
- [x] **Task 3 — Building visual resolver.** Added lifecycle-condition mapping, six mixed-use families, abandoned-state precedence, camera-independent identity, and exact Pass A deterministic weighted-family parity.
- [x] **Task 4 — Deterministic atlas pipeline.** Added `urban_depth_buildings`, deterministic source generation, 138 authored frames, source validation, and ninth-atlas rasterization.
- [x] **Task 5 — Runtime integration.** Switched runtime rendering to the composed manifest and canonical `BuildingV2` visual state without changing construction rendering, simulation authority, or saves.
- [x] **Task 6 — Visual smoke and acceptance documentation.** Added deterministic Main Street, podium, and condition-progression browser scenes plus runtime manifest/diagnostic checks.
- [x] **Task 7 — Renderer scalability hardening.** Replaced per-building `getV2At()` spatial scans with one read-only `CanonicalBuildingVisualIndex` build per render pass and keyed legacy-cell lookups.

## TDD / defect record

The implementation was driven through explicit RED/GREEN cycles. Material defects caught before acceptance included ignored query dimensions, missing atlas contract/source, Pass A identity drift, an invalid sparse-cadastre visual fixture, and the renderer's repeated canonical spatial scan. The performance sequence was RED `9fe422d`, mechanism GREEN `dc988cc`, integration GREEN `b7967a3`.

## Frozen-parent integration

The final parent checkpoint contains later Save V9, cadastral-overlay/parcel-inspector, property-market, and UI work. The only B1 production overlap was `src/rendering/WorldRenderer.ts`.

The merge preserves the parent's meter-space helpers, cadastral overlay state/API, selected-parcel behavior, and extended overlay draw arguments. B1 changes only the asset registry source to `RUNTIME_ASSET_MANIFEST`.

Relative to checkpoint `1c1479b`, the B1 re-stack contains exactly **21 intended rendering/asset/test/documentation/CI files** and no Save V9, property-market, UI-controller, `SimulationCore`, or other Urban Fabric authority implementation files.

## Final verification record

- [x] **Parent workflow `33010729268`** — success on `1c1479bdad0a7be6db16263128f5aee38dccdc44`; direct log evidence: **601/601 tests passed, 0 failed**, followed by successful typecheck, lint, asset validation, build, Phase 6/7 browser smoke, Pass A browser smoke, and Pass A visual smoke.
- [x] **Dedicated B1 workflow `33011045261`** — success on `6adbd53767a831534fd891af19396e2f4270f3bd`; all focused tests, exact-parent typecheck delta, repository typecheck, lint, nine-atlas validation/build, Pass A interaction smoke, and B1 visual smoke passed.
- [x] **Full repository workflow `33011045312`** — success on the same B1 head; full test step, typecheck, lint, asset validation, build, Phase 6/7 smoke, Pass A browser smoke, and Pass A eight-scene visual smoke passed.
- [x] `main` remains untouched and PR #91 remains draft.

## Integration freshness rule

Pass B1 is implementation-complete and verification-complete against frozen parent checkpoint `1c1479b`. If PR #63 advances before actual integration, perform the normal final re-stack and rerun the acceptance gates against that newer parent. That is an integration-freshness check, not unfinished B1 implementation.
