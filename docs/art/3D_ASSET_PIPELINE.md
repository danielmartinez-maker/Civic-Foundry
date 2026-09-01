# Civic Foundry 3D Asset Pipeline

This document is the operational contract for Civic Foundry's accepted House A calibration path and Stack 3 production 3D asset scale-up. Tracked source recipes are authoritative for art inputs; generated GLB files, browser screenshots, Babylon nodes, and presentation caches are build/runtime outputs only and never simulation or persistence authority.

## Source policy

3D source assets are tracked as deterministic JSON recipes under `assets/source/3d/`. `tools/3d/CivicAssetCompiler.mjs` owns conversion from those text recipes into runtime GLBs, collision GLBs, and Asset Manifest V2 catalog entries. First-party generated binaries remain under `dist/` and are not committed as source.

A production source recipe must declare all data required to validate and reconstruct its runtime presentation contract:

- stable revisioned `assetId`;
- category and `semanticFamily`;
- meter-scale dimensions;
- canonical pivot/orientation;
- placement compatibility;
- materials and optional sockets;
- presentation-only state channels;
- `lod0`, `lod1`, and `lod2` with monotonic triangle budgets;
- collision geometry where required;
- runtime instancing/streaming/memory class;
- positive `estimatedCpuGeometryBytes`, `estimatedGpuGeometryBytes`, and `estimatedGpuMaterialBytes`;
- miniature art-family metadata.

The compiler and Manifest V2 validator reject missing/invalid production metadata instead of silently inferring it.

## Coordinate and pivot contract

All dimensions and positions are meters. Production geometry uses:

- `+Y` up;
- `-Z` forward/front;
- origin at ground-plane center (`ground-center`);
- positive ground-space `X` to the right when viewed from the front.

The compiler validates bounds and ground clearance. Runtime placement derives from presentation state built from canonical gameplay/world data. A mesh transform, imported GLB node, socket, collision node, or Babylon metadata object must never become a gameplay coordinate authority.

## Asset naming

Asset IDs are stable and revisioned. Generated files use the asset ID verbatim:

```text
dist/assets/models/<assetId>_lod0.glb
dist/assets/models/<assetId>_lod1.glb
dist/assets/models/<assetId>_lod2.glb
dist/assets/collisions/<assetId>_collision.glb
dist/assets/manifests/catalog-v2.json
```

House A remains the accepted calibration asset:

```text
cf_bld_res_detached_house_a_low_v01
```

Stack 3's controlled first production wave contains exactly these 14 assets:

```text
cf_bld_res_detached_house_a_low_v01
cf_bld_res_rowhouse_a_med_v01
cf_bld_com_corner_shop_a_low_v01
cf_bld_mix_mainstreet_a_med_v01
cf_bld_ind_light_workshop_a_low_v01
cf_fac_fire_station_a_v01
cf_prop_street_furniture_a_v01
cf_veh_compact_car_a_v01
cf_transit_bus_stop_a_v01
cf_veg_deciduous_tree_a_v01
cf_prop_pocket_park_a_v01
cf_construction_basic_kit_a_v01
cf_condition_basic_kit_a_v01
cf_landmark_water_tower_a_v01
```

The wave deliberately spans residential, commercial, mixed-use, industrial, civic/facility, public-realm, vehicle, transit, vegetation, construction/condition, and landmark visual families without adding new gameplay authority categories.

## Compiler and validation commands

Validate every tracked recipe without accepting stale generated outputs:

```bash
npm run assets:3d:check
```

Compile the runtime catalog and GLBs:

```bash
npm run assets:3d:build
```

The production build also compiles 3D assets:

```bash
npm run build
```

Repository asset policy remains mandatory:

```bash
npm run assets:policy
```

## Asset Manifest V2 production contract

Each catalog entry contains stable identity, revision/category, `semanticFamily`, relative LOD/collision URLs, dimensions/pivot, placement, sockets, materials, state channels, runtime hints/budgets, and art metadata.

`AssetCatalogV2` validates the catalog and keeps deterministic asset-ID ordering. `listBySemanticFamily(family)` returns candidates sorted by asset ID. Runtime asset selection uses `selectProductionAssetId(...)`, which sorts candidates before applying the existing stable visual hash. Persistent selection and reconstruction may not use `Math.random()`.

The same canonical inputs therefore produce the same semantic candidate ordering and selected asset identity regardless of source enumeration order.

## LOD, collision, and budget requirements

Every Stack 3 production recipe provides LOD0/LOD1/LOD2. Triangle budgets must not increase at lower-detail levels. Collision geometry and declared dimensions/pivot are compiler-validated.

Runtime LOD selection is deterministic from camera distance and the manifest's available LODs. The generic production scene layer and `Civic3DProductionRuntime` use the shared `selectProductionLod(...)` decision, preventing the streaming path and retained-scene path from disagreeing about the required prototype.

Budget accounting is prototype-based rather than instance-based. For representative fixtures, CPU/GPU estimates sum each active asset prototype once, not once per retained presentation entity. When a retained entity changes LOD, the runtime creates/replaces the instance first, then releases and evicts obsolete zero-reference prototypes so camera cycling cannot accumulate stale LOD residency without bound.

## Runtime presentation path

The accepted 3D path remains opt-in through `?renderer=civic-3d` and uses Babylon.js WebGPU-first initialization with WebGL fallback.

The House A compatibility path remains available through `Civic3DBuildingRuntime`. Stack 3 adds a generic production presentation seam composed of:

```text
canonical simulation/world/save state
  -> presentation-only ProductionVisualState
  -> deterministic semantic asset selection
  -> AssetCatalogV2
  -> AssetStreamingManager / BabylonGlbPrototypeLoader
  -> ProductionSceneLayer
  -> BabylonProductionSceneAdapter
  -> Babylon scene
```

`ProductionSceneLayer` retains handles by stable production presentation ID. An identical reconciliation does not recreate geometry. Asset, structural fingerprint, canonical identity, or LOD changes replace the retained handle; appearance-only changes update in place. `reconstructionDigest()` serializes stable presentation identity/asset/LOD/transform/variation state for deterministic teardown/rebuild acceptance.

`BabylonProductionSceneAdapter` owns presentation-only Babylon roots and imported GLB instances. Pick metadata maps a rendered node back to stable presentation/canonical identity. Picking never reads gameplay facts out of Babylon to manufacture simulation state.

`Civic3DProductionRuntime.apply(...)` waits for Babylon scene/material readiness before the caller captures an accepted frame, so a structurally complete asset load is not mistaken for a visually complete frame.

## Presentation state and Save V9

Simulation remains authoritative. Stack 3 presentation state contains stable IDs, transform, deterministic variation seed, structural fingerprint, and appearance fingerprint. Those values control visual reconstruction only.

The following are explicitly non-persistent presentation state:

- Babylon nodes/meshes/material instances;
- prototype leases/caches;
- LOD residency;
- pick metadata;
- review-camera state;
- acceptance-fixture IDs;
- reconstruction digests;
- screenshots and review evidence.

Save V9 semantics are unchanged. Stack 3 browser acceptance serializes before/after camera, visual-time, teardown, and reconstruction operations and requires byte-identical Save V9 output with no Babylon/presentation metadata.

## Representative acceptance fixtures

`src/rendering/3d/presentation/Stack3AcceptanceDistrict.ts` provides deterministic presentation-only fixtures:

- `block`: 112 entities (8 repetitions × all 14 production assets);
- `neighborhood`: 1008 entities (72 repetitions × all 14 production assets).

The fixtures use stable IDs, deterministic grid transforms, deterministic rotations/fingerprints, and `visualSeed(...)`. They do not create gameplay entities and are not serialized.

`tests/stack3_scene_budget.test.ts` proves fixture size, deterministic reconstruction inputs, 14-prototype bounds, and unique-prototype memory accounting.

## Browser/visual acceptance

After a production build, the Stack 3 Chromium gate is:

```bash
npm run test:smoke:3d:stack3
```

The smoke requires generated LOD0/1/2 GLBs for all 14 assets and verifies:

- the 112-entity representative district and 14 unique prototypes;
- bounded declared GPU memory;
- 112 unique stable presentation and canonical identities;
- non-uniform rendered evidence;
- unchanged second reconciliation creates/removes/replaces nothing;
- deterministic reconstruction digest and pick identities;
- responsive orbit/zoom and explicit review-camera restoration;
- top and night presentation modes;
- byte-identical Save V9 before/after presentation operations;
- teardown/recreate returns the same digest, identities, and structural counts.

Browser evidence is emitted under:

```text
test-artifacts/civic-3d-stack3/district.png
test-artifacts/civic-3d-stack3/front.png
test-artifacts/civic-3d-stack3/top.png
test-artifacts/civic-3d-stack3/night.png
```

These PNGs are diagnostic/acceptance artifacts only.

The accepted House A regression remains mandatory:

```bash
npm run test:smoke:3d-house
npm run review:3d-house
```

Stack 3 may not weaken or replace House A acceptance.

## Adding a production family

1. Add one revisioned source recipe under the appropriate `assets/source/3d/<category>/` directory.
2. Declare `semanticFamily`, canonical meter-scale pivot/axes, dimensions, placement, materials, sockets/state channels, runtime byte estimates, all three LODs, and collision geometry as applicable.
3. Add source/manifest contract tests before production behavior.
4. Run `npm run assets:3d:check` and focused compiler/manifest tests.
5. Run `npm run build` and inspect generated GLBs/catalog locally or in CI artifacts.
6. Add presentation selection/state tests if the semantic family or state mapping is new.
7. Add representative browser evidence only when the family has an explicit acceptance requirement.
8. Commit tracked text source and tests only; leave generated first-party binaries and review PNGs in ignored build/artifact outputs.

## Authority rule

The asset pipeline describes presentation, not gameplay truth. `SimulationCore`, `WorldFoundation`, `CadastralGraph`, canonical buildings, transportation/economy/service owners, and Save V9 remain authoritative. Asset metadata, semantic-family selection, retained handles, GLB prototypes, collision presentation geometry, picking metadata, runtime budgets, fixtures, and review cameras may consume authoritative state but may not write or redefine it.
