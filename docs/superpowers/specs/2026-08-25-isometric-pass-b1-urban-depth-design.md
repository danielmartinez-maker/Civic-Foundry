# Civic Foundry — Isometric Pass B1: Building Depth & Mixed Use

## Status

Approved in chat on 2026-08-25. This specification defines the first Urban Depth asset tranche after accepted Isometric Pass A.

Pass B1 is presentation-only. It may consume authoritative Urban Fabric 2.0 building state but may not own, persist, or mutate simulation outcomes.

## Goal

Expand the isometric asset library from Pass A's 161 presentation entries to 299 cumulative entries by adding mixed-use architecture and condition-aware building art while preserving Pass A assets and all authoritative simulation contracts.

## Branching

Implementation branch: `feature/isometric-pass-b1-urban-depth`.

The branch is stacked on `feature/urban-fabric-2.0` so it can consume BuildingV2 typology, lifecycle, status, and project state without duplicating them.

## Scope

### Existing Pass A invariants

- `PASS_A_ASSET_MANIFEST` remains unchanged at 161 entries.
- Existing atlas coordinates and variant keys remain stable.
- Camera rotation cannot change authored building identity.
- Persistent visual selection remains deterministic.
- Rendering remains presentation-only.
- No save-format changes.

### New mixed-use families

Add six authored building families:

- `mix_mainstreet_corner_01`
- `mix_mainstreet_row_01`
- `mix_mainstreet_courtyard_01`
- `mix_podium_slab_01`
- `mix_podium_tower_01`
- `mix_podium_courtyard_01`

The first three map to `main_street_mixed_use`; the latter three map to `podium_mixed_use`.

Each family receives five condition frames:

- `new`
- `maintained`
- `aging`
- `neglected`
- `abandoned`

This produces 30 mixed-use entries.

### Existing Pass A building condition expansion

Pass A's 27 completed building families remain the maintained baseline. Pass B1 adds four additional condition frames for each family:

- `new`
- `aging`
- `neglected`
- `abandoned`

This produces 108 new entries without duplicating the existing maintained Pass A entries.

### Total library size

- Pass A: 161 entries.
- Pass B1 delta: 138 entries.
- Composed runtime manifest: 299 entries.

## Asset layout

Create one new deterministic source sheet and runtime atlas:

- `assets/source/urban_depth_buildings.svg`
- `dist/assets/atlases/urban_depth_buildings.png`

Pass B1 must never shift existing Pass A atlas rectangles.

The new atlas contains all 138 B1 frames in stable declaration order. Each frame uses a 128×192 source rectangle and the same building anchor contract as Pass A.

## Manifest composition

Create:

- `src/rendering/assets/PassB1AssetManifest.ts`
- `src/rendering/assets/AssetManifestComposer.ts`

`PASS_B1_ASSET_MANIFEST` owns only the new atlas descriptor and 138 B1 entries.

`composeAssetManifests(PASS_A_ASSET_MANIFEST, PASS_B1_ASSET_MANIFEST)` returns the runtime manifest with deduplicated atlas IDs and asset IDs and preserves source manifest order.

Export `PASS_B1_COMPOSED_ASSET_MANIFEST` as the 299-entry runtime contract.

## Condition resolution

Create `src/rendering/assets/BuildingVisualResolver.ts`.

It derives presentation state from authoritative BuildingV2 data.

Condition bands:

- `abandoned` status always resolves to `abandoned`.
- exteriorCondition >= 90 → `new`.
- exteriorCondition >= 70 → `maintained`.
- exteriorCondition >= 45 → `aging`.
- exteriorCondition >= 20 → `neglected`.
- exteriorCondition < 20 → `abandoned`.

For legacy Pass A building families, maintained resolves to the existing Pass A variant key. Other condition bands resolve to B1 condition variants.

For mixed-use typologies, all five conditions resolve to B1 variants.

Building identity is selected before condition framing. Changing condition or camera orientation must not select a different architectural family.

## Typology mapping

- `main_street_mixed_use` → one of three `mix_mainstreet_*` families.
- `podium_mixed_use` → one of three `mix_podium_*` families.
- Legacy R/C/I typologies continue to use existing Pass A families.

Selection is deterministic from stable building identity and the eligible family set.

## Asset queries

Extend `AssetQuery` and `AssetRegistry.query()` so `qualityTier` and `condition` are real query dimensions. Query-cache keys must include both fields.

Pass B1 does not introduce authoritative quality tiers; `qualityTier` support is completed now because the metadata already exists and the registry must not silently ignore it.

## Art direction

Condition communicates maintenance and lifecycle rather than generalized ruin:

- `new`: crisp roof/facade treatment, complete landscaping, fresh paving.
- `maintained`: Pass A baseline visual identity.
- `aging`: restrained weathering and older roof/material treatment.
- `neglected`: visible maintenance backlog, sparse landscaping, worn site treatment.
- `abandoned`: boarded/dark openings, overgrowth, visibly inactive site, but intact recognizable architecture.

No condition state may change footprint, capacity, use, rent, cost, or any simulation property.

## Verification

### Unit tests

Cover:

- Pass A remains exactly 161 entries.
- Pass B1 contains exactly 138 entries.
- composed manifest contains exactly 299 entries.
- all manifests validate.
- no duplicate asset IDs or atlas IDs.
- all 27 Pass A building families receive four new B1 condition frames.
- all six mixed-use families receive five frames.
- registry condition and qualityTier filters work.
- condition threshold boundaries are exact.
- abandoned status precedence.
- deterministic mixed-use family selection.
- stable architectural identity across condition changes.
- stable architectural identity across camera orientation.

### Asset pipeline

`tools/isometric_art.py` generates the new source geometry deterministically.

`tools/render_isometric_atlases.py` validates and rasterizes the new source sheet along with the existing eight Pass A sheets.

### Visual smoke

Add three deterministic scenes:

- mixed-use main street;
- podium mixed-use district;
- building condition progression.

### Acceptance gate

Pass B1 is complete only when its targeted verification is green and the inherited parent failure is clearly separated from B1 results. When PR #63 returns green, run the normal full repository gate before merge.
