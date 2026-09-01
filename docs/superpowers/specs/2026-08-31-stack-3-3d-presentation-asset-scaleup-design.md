# Stack 3 — 3D Presentation & Asset Scale-Up Design

**Status:** Approved for implementation

**Date:** 2026-08-31

**Repository:** `danielmartinez-maker/Civic-Foundry`

**Implementation baseline:** `design/3d-presentation-asset-program@4393521b5f1345ab7873cdce7f3b3dd75e4d1632`

**Implementation branch:** `feature/stack-3-3d-presentation-asset-scaleup`

**Parent architecture:** `docs/superpowers/specs/2026-08-30-3d-presentation-asset-program-design.md`

## 1. Purpose

Scale the accepted House A vertical slice into the first production Civic Foundry 3D asset program while preserving the disposable-renderer boundary. The implementation must prove that multiple asset categories can share one deterministic compiler, one versioned catalog, one retained/streamed Babylon scene model, one picking identity seam, and one bounded performance model.

No asset, manifest, Babylon object, cache, renderer diagnostic, or visual resolver may become simulation authority. Save V9 semantics remain unchanged.

## 2. Current-state audit

The accepted House A runtime is already implemented on `design/3d-presentation-asset-program` and verified by the repository CI. The branch contains:

- Babylon WebGPU-first/WebGL-compatible engine setup;
- free orbit/zoom miniature camera controls;
- `AssetManifestV2` and catalog validation;
- deterministic text-source-to-GLB compilation;
- request broker, streaming manager, GLB cache, prototype cache;
- `WorldPresentationSnapshot` and deterministic building resolution;
- retained building scene reconciliation;
- identity-based picking;
- House A LOD0/LOD1/LOD2, collision, state channels, and review acceptance.

Current `main` is a separate line and does not yet contain this accepted 3D program. Stack 3 therefore builds on the accepted 3D branch instead of duplicating the House A foundation on `main`.

## 3. Older presentation branch classification

The following draft PRs are semantic donors only. They are not merged wholesale.

### PR #91 — Isometric Pass B1

**Retain/adapt:**
- architectural-family semantics;
- mixed-use identity;
- lifecycle/condition presentation;
- deterministic weighted selection;
- read-only canonical building indexing concepts.

**Supersede:**
- sprite atlas representation;
- Canvas/Pixi-specific draw ordering and atlas composition.

### PR #96 — Isometric Pass B2

**Retain/adapt:**
- public-realm context profiles;
- deterministic context-derived visual resolution;
- revision fingerprints/presentation caching;
- presentation-only decorative parking firewall.

**Supersede:**
- sprite command buffer and 2D atlas implementation.

### PR #99 — GPU Presentation Phase 2

**Retain/adapt:**
- retained identity;
- bounded pooling/allocation rules;
- unchanged-frame no-recreation invariant;
- presentation allocation diagnostics.

**Supersede:**
- Pixi sprite implementation.

### PR #103 — GPU Presentation Phase 3

**Retain/adapt:**
- canonical analytical mapper ownership;
- semantic overlay categories;
- no independent simulation metric derivation in renderer code.

**Defer:**
- full 3D overlay implementation remains a later advanced-world-presentation tranche unless required by Stack 3 acceptance.

## 4. Production asset wave

Stack 3 uses a controlled first production wave. House A remains the canonical calibration asset. Thirteen additional families are added so every prescribed category is exercised without attempting hundreds of assets.

1. `cf_bld_res_detached_house_a_low_v01` — existing residential calibration asset.
2. `cf_bld_res_rowhouse_a_med_v01` — residential.
3. `cf_bld_com_corner_shop_a_low_v01` — commercial.
4. `cf_bld_mix_mainstreet_a_med_v01` — mixed-use.
5. `cf_bld_ind_light_workshop_a_low_v01` — industrial/logistics.
6. `cf_fac_fire_station_a_v01` — civic/service.
7. `cf_prop_street_furniture_a_v01` — road furniture/public realm.
8. `cf_veh_compact_car_a_v01` — vehicle.
9. `cf_transit_bus_stop_a_v01` — transit stop.
10. `cf_veg_deciduous_tree_a_v01` — vegetation.
11. `cf_prop_pocket_park_a_v01` — terrain/public-realm prop kit.
12. `cf_construction_basic_kit_a_v01` — construction presentation.
13. `cf_condition_basic_kit_a_v01` — condition/state attachment kit.
14. `cf_landmark_water_tower_a_v01` — landmark/special structure.

The exact geometry remains deliberately stylized and lightweight. Acceptance is about production contracts, deterministic integration, coherent scale, state/picking behavior, and bounded runtime cost—not final art-detail volume.

## 5. Canonical asset contract

Every production family must define and validate:

- canonical asset ID and category;
- dimensions in meters;
- `ground-center` pivot;
- `+Y` up and `-Z` project forward;
- LOD0/LOD1/LOD2 unless a category-specific contract explicitly permits fewer;
- collision/picking proxy where the category is pickable;
- shared material-family bindings;
- state channels appropriate to the category;
- placement/snap contract;
- deterministic variation inputs;
- instancing class;
- streaming class;
- memory class;
- triangle budget;
- estimated GPU geometry/material cost used by structural acceptance.

Runtime binaries continue to be generated into `dist/`; tracked first-party source remains text-first.

## 6. Runtime catalog and family resolution

`AssetCatalogV2` remains the only 3D asset identity catalog. Stack 3 extends catalog metadata so production families can be queried by category, semantic family, placement compatibility, and memory class without introducing a second catalog.

Deterministic visual selection uses stable inputs only:

```text
canonical entity ID + semantic family + visual channel + stable asset candidates
```

Camera state, scene allocation order, streaming order, or `Math.random()` must never change persistent visual identity.

Building-family selection remains downstream from canonical `BuildingV2` facts. It may map typology/use/density to presentation families but may not invent authoritative building use, condition, occupancy, construction, or service state.

## 7. Retained scene scale-up

The House A retained reconciliation path is generalized to support multiple production asset families.

Required invariants:

- unchanged complete snapshots do not recreate retained scene instances;
- structural revisions replace only affected instances;
- appearance revisions update lightweight state without replacing geometry when possible;
- streaming eviction destroys only presentation state;
- reconstructing from the same complete snapshot resolves the same presentation IDs, asset IDs, transforms, state channels, and deterministic variation seeds;
- missing detail uses deterministic semantic proxies rather than blocking the render frame.

## 8. Picking

All pickable production instances bind `PresentationEntityId` metadata at the retained scene boundary.

Picking flow remains:

```text
Babylon pick -> PresentationEntityId -> canonical ID -> existing inspector/read path
```

Picking must remain stable across:

- camera movement;
- LOD changes;
- asset eviction and reload;
- scene teardown/reconstruction;
- appearance-only state changes.

## 9. Performance budgets and diagnostics

Stack 3 adds structural diagnostics suitable for CI and browser acceptance:

- resident asset count;
- unique prototype count;
- retained instance count;
- scene mutation count;
- prototype creation/destruction count;
- estimated resident CPU geometry bytes;
- estimated resident GPU geometry bytes;
- estimated resident GPU material/texture bytes;
- streaming queue depth;
- per-reconciliation created/updated/removed/unchanged counts.

Correctness CI uses deterministic structural bounds rather than hardware-specific FPS thresholds.

Representative-scene budgets:

### Block fixture

- at least 100 placed production entities;
- no more than 14 unique production prototypes for the first wave;
- second identical reconciliation creates zero new retained instances;
- deterministic reconstruction digest stable across teardown/rebuild.

### Neighborhood fixture

- at least 1,000 placed presentation entities using repeated families;
- unique prototypes remain bounded by the production catalog, not entity count;
- estimated resident GPU geometry/material memory remains bounded by explicit catalog estimates;
- no full-world scene replacement on unchanged frame;
- no unbounded per-frame object allocation.

Wall-clock frame-time measurements may be recorded in browser evidence but are not used as fragile machine-independent correctness thresholds.

## 10. Representative acceptance district

Add a deterministic production-wave acceptance district containing every asset family and multiple repeated instances. It must exercise:

- residential/commercial/mixed-use/industrial/civic scale relationships;
- public realm, vegetation, vehicles, transit, construction, condition attachments, and landmark context;
- fixed review camera positions;
- free orbit and zoom;
- stable picking;
- deterministic reconstruction;
- LOD/streaming churn;
- miniature render pipeline;
- day/night/state hooks where supported.

Visual regression coverage uses fixed environment, camera, seed, and viewport settings.

## 11. Testing strategy

All production behavior follows RED -> GREEN -> refactor.

Required focused contracts:

1. production source schema rejects invalid category/LOD/pivot/budget metadata;
2. all first-wave sources compile deterministically;
3. runtime catalog contains exactly one entry per asset ID and stable content hashes;
4. semantic family queries return stable sorted candidates;
5. deterministic selection is input-order independent;
6. same snapshot reconstructs identical scene digest;
7. unchanged reconciliation performs zero create/remove operations;
8. appearance-only updates avoid geometry replacement;
9. picking identity survives LOD/reload/reconstruction;
10. block and neighborhood structural budgets remain bounded;
11. architecture firewall prevents `src/simulation`, `src/world`, and `src/save` from importing 3D presentation modules;
12. browser smoke and fixed-camera visual evidence cover the representative district.

Repository-wide verification remains mandatory after focused tests.

## 12. CI gate

The Stack 3 branch adds a dedicated targeted workflow or extends the existing fast workflow with the following checks:

```text
focused Stack 3 tests
repository unit tests
typecheck
format/lint policy
asset source policy
3D deterministic compiler check
production build
House A regression smoke
Stack 3 representative-scene browser smoke
full inherited Civic Foundry browser/visual gates
```

Artifacts from the representative-scene smoke are preserved for review.

## 13. Authority and persistence firewall

Stack 3 must not change:

- Save V9 schema or semantics;
- `SimulationCore` ownership;
- `WorldFoundation` ownership;
- `CadastralGraph` ownership;
- transportation ownership;
- economy ownership;
- service ownership;
- canonical `BuildingV2` authority.

Presentation metadata is downstream and disposable. No simulation tick reads renderer state.

## 14. Completion evidence

Completion requires the implementation report to state:

- exact head SHA;
- changed files;
- defects fixed during RED/GREEN execution;
- tests added;
- exact verification commands/workflows;
- CI run/result;
- remaining risks;
- explicit statement that authority did or did not change.

The stack is accepted only when deterministic reconstruction, stable picking, acceptable camera behavior, bounded structural GPU memory, bounded scene-update work, no per-frame full-world reconstruction, no uncontrolled object allocation, and full representative visual regression coverage are demonstrated.