# Civic Foundry Architecture — Urban Fabric + Production 3D Presentation

## Runtime boundary

Civic Foundry uses progressive replacement rather than a clean-slate rewrite. Authoritative gameplay/world/persistence systems remain independent of presentation, while rendering stacks consume deterministic projections of that state.

Current high-level authority path:

```text
Electron desktop host (optional local shell)
  -> GameApp
    -> SimulationCore facade
      -> SimulationKernel                deterministic tick authority
      -> WorldFoundation                 physical/geographic authority
      -> CadastralGraph                  legal-land authority
      -> CadastralRuntimeMutationService cross-domain land transaction boundary
      -> canonical BuildingV2/property/zoning systems
      -> transportation/economy/services and legacy compatibility domains
    -> presentation renderer
       -> GpuWorldRenderer / PixiJS       default read-only presentation
       -> Civic3DWorldRenderer / Babylon  opt-in read-only 3D presentation
```

`SimulationCore` remains the public gameplay facade. `SimulationKernel` owns deterministic tick execution. `WorldFoundation` remains the sole physical/geographic authority. `CadastralGraph` owns legal parcel topology. Canonical building/property/zoning, transportation, economy, and service owners keep their existing authority. Save V9 remains the current persistence envelope.

The 3D renderer does not retire the default GPU renderer and does not move any of those responsibilities into Babylon, GLB metadata, asset recipes, presentation fixtures, or camera state.

## Authority matrix

### World Foundation

`WorldFoundation` owns world seed/configuration, terrain/engineering properties, geography hierarchy, hydrology/drainage/flood susceptibility, spatial indexing, and the terrain compatibility projection consumed by inherited systems. It does not own parcels, zoning entitlements, buildings, property ownership, roads/transport operations, firms, households, or municipal finance.

### Cadastral authority

`CadastralGraph` owns canonical legal parcels, shared boundaries, block membership, parcel polygons/area/centroid/frontage/access/zoning/owner identity, easements, and split/assembly/right-of-way lineage.

Legacy `LotSystem` records remain a derived compatibility projection. The cadastre decides what land exists; the lot facade decides how older cell-oriented systems address compatible frontage cells.

`CadastralRuntimeMutationService` is the public cross-domain transaction boundary for split, assembly, right-of-way, and easement operations. It stages and validates dependent rewrites, commits participating owners in deterministic order, and restores authoritative snapshots if a live commit stage fails. Presentation code is not part of that transaction.

### Canonical buildings and property

`BuildingSystem` deliberately separates inherited legacy building storage from canonical `BuildingV2` records. `BuildingV2` retains canonical parcel identity, footprint/massing/floor allocation, entitlement, lifecycle, and project metadata. Canonical reads are deterministic and isolated.

`PropertyMarketSystem` owns current parcel holdings and recorded transactions. Current references must point to live parcels; historical transaction rows can reference retired parcels only when persisted cadastral lineage recognizes them.

### Transportation/economy/services

Transportation, economy, freight/firms, utilities, public services, and related systems retain their own simulation authority. Cadastral frontage and presentation assets may reference their canonical outputs, but neither legal-land code nor renderer assets manufacture transportation/economic/service outcomes.

## Save V9

Current default persistence remains:

```ts
saveVersion: 9
gameVersion: '0.9.0-urban-fabric'
```

Save V9 extends the V8 world envelope with Urban Fabric cadastral/zoning/building/property state. Hydration restores the world candidate first, then canonical cadastre and dependent owners, rebuilding legacy lots as a derived projection.

Stack 3 changes **no Save V9 schema or semantics**. The following production-3D state is intentionally not serialized:

- asset semantic-family selection caches;
- Babylon scenes/nodes/meshes/material instances;
- GLB prototype leases and LOD residency;
- presentation/canonical pick metadata;
- reconstruction digests;
- review camera state;
- Stack 3 acceptance fixtures;
- visual screenshots or browser evidence.

The Stack 3 Chromium smoke serializes Save V9 around camera, visual-time, reconstruction, and teardown/recreate operations and requires byte-identical persistence output with no Babylon/presentation fields.

## Presentation boundary

Rendering remains a read-only consumer of authoritative state.

The default production world renderer remains `GpuWorldRenderer` backed by PixiJS/WebGL. The accepted 3D path is opt-in through `?renderer=civic-3d`, which constructs `Civic3DWorldRenderer` with Babylon.js WebGPU-first initialization and deterministic WebGL fallback.

The accepted House A vertical slice remains supported by `Civic3DBuildingRuntime`. Stack 3 extends that foundation through the existing Asset Manifest V2/compiler/catalog/streaming seams rather than introducing another asset authority.

### Stack 3 production path

```text
canonical simulation/world data
  -> presentation-only state / stable entity identity
  -> deterministic semantic-family asset candidate set
  -> ProductionAssetSelector
  -> AssetCatalogV2
  -> AssetStreamingManager
  -> BabylonGlbPrototypeLoader
  -> ProductionSceneLayer
  -> BabylonProductionSceneAdapter
  -> Civic3DWorldRenderer / Babylon scene
```

`AssetCatalogV2` stores entries in deterministic asset-ID order and indexes `semanticFamily`. `selectProductionAssetId(...)` sorts candidates and uses the existing deterministic visual hash; it never uses `Math.random()`.

`ProductionVisualState` is a presentation record containing stable `presentationId`, source `canonicalId`, selected `assetId`, transform, deterministic variation seed, structural fingerprint, and appearance fingerprint. It does not own the source gameplay fact.

`ProductionSceneLayer` retains presentation entities by stable presentation ID. Identical reconciliation creates no new handles. Asset, canonical identity, structural fingerprint, or selected LOD change causes structural replacement; appearance-only changes update in place. A deterministic `reconstructionDigest()` proves equivalent teardown/rebuild state.

`BabylonProductionSceneAdapter` creates retained roots and GLB instances, applies transforms, and binds frozen presentation/canonical pick identity through descendants. Pick resolution maps a rendered node back to the presentation identity; Babylon metadata is never used to write simulation state.

`Civic3DProductionRuntime` reuses the existing catalog/streaming/GLB-loader classes. It computes required `asset@lod` prototype keys deterministically, acquires missing leases, applies the retained layer, then releases and evicts obsolete zero-reference LOD prototypes after scene replacement. This keeps LOD cycling structurally bounded. The runtime waits for Babylon scene/material readiness before an accepted apply returns to the browser capture path.

The production runtime currently owns its own instance of the existing streaming manager rather than sharing the House A runtime's manager. This does not create a new format or authority, but if both runtimes actively load the same prototype in future gameplay integration they can duplicate presentation cache residency. The Stack 3 acceptance fixture keeps the legacy building runtime idle; shared-cache consolidation is a later optimization, not an authority change.

## Stack 3 controlled asset wave

Stack 3 scales House A into a controlled 14-family first production wave covering detached residential, rowhouse, corner commercial, mixed-use main street, light industrial, fire facility, street furniture, compact car, transit stop, deciduous tree, pocket park, construction kit, condition kit, and water-tower landmark.

Every source recipe retains the common meter-scale ground-center/-Z-forward/+Y-up contract, three LODs, deterministic compilation, materials/state channels as applicable, collision representation, and explicit CPU/GPU runtime estimates. Generated GLBs remain build outputs under `dist/`.

Semantic-family/category metadata exists solely to select/organize presentation assets. It does not create new zoning, building, vehicle, transit, vegetation, construction, or landmark gameplay authority.

## Representative presentation fixtures

`Stack3AcceptanceDistrict` creates deterministic presentation-only fixtures for structural acceptance:

- `block`: 112 retained presentation entities, all 14 assets;
- `neighborhood`: 1008 entities, all 14 assets.

Stable IDs, transforms, rotations, seeds, and fingerprints derive from fixture inputs. These fixtures are not gameplay entities and never enter Save V9.

Memory diagnostics are based on unique active prototypes rather than multiplying prototype geometry/material cost by instance count. This is a structural budget contract, not a replacement for platform-specific GPU profilers.

## Camera, visual style, and picking

`MiniatureCameraController` remains the camera-state seam for target/radius/orbit/zoom. Stack 3 preserves the miniature/tilt-shift visual identity and the accepted House A renderer path.

Camera orbit/zoom/review-state changes are presentation-only. The Stack 3 browser acceptance verifies that camera movement and day/night presentation do not mutate Save V9.

Stable picking is keyed to presentation identity with canonical identity retained as metadata for the caller. Identity changes are treated as structural so a retained handle cannot silently expose stale canonical metadata.

## Architecture firewall

`scripts/check-architecture.mjs` enforces import direction. Authoritative roots are:

```text
src/simulation/
src/world/
src/save/
```

The enforced rules include:

- simulation -> rendering: forbidden;
- world -> rendering: forbidden;
- save -> rendering: forbidden;
- authoritative roots -> `@babylonjs/*`: forbidden;
- authoritative roots -> `@gltf-transform/*`: forbidden;
- rendering -> app/ui: forbidden under the existing renderer boundary rules.

The Save-to-rendering rule was made explicit in Stack 3 so all three authoritative directories are protected from `src/rendering/3d` and the broader rendering tree. Tests may tighten this firewall but may not weaken it to make a visual feature pass.

## Desktop/module boundary

Electron remains an optional hardened local host for the same built application. It owns window lifecycle only and exposes no generic simulation-state IPC authority. Browser and desktop targets execute the same authoritative TypeScript simulation.

The renderer build remains browser-native ESM. First-party generated 3D files and vendor/runtime dependencies are served from built local paths; presentation startup does not require a CDN authority.

## Determinism invariants

Civic Foundry keeps these cross-stack invariants:

- identical authoritative input and mutation order produce identical simulation/world results;
- world/cadastre/building/property/transport/economy/service owners remain authoritative in their domains;
- failed authoritative transactions cannot escape partial state;
- Save V9 round-trip/continuation preserve canonical identity;
- presentation does not manufacture simulation outcomes;
- production asset selection is input-order independent and deterministic;
- identical production presentation state/camera/catalog selects identical LOD/identity state;
- unchanged retained reconciliation does not recreate the world;
- teardown/rebuild returns the same production reconstruction digest;
- picking remains stable across retained reconstruction/LOD replacement;
- obsolete LOD prototype residency is released/evicted after replacement;
- browser camera/time/reconstruction operations leave Save V9 byte-identical.

## Verification boundary

Repository acceptance combines authoritative simulation/world/save suites with rendering-specific gates. Stack 3 adds focused asset-contract/wave/selection/retained-scene/picking/budget tests and a compiled Chromium production-district smoke while retaining all inherited browser gates and the House A 3D smoke.

A Stack 3 feature head is accepted only when its exact GitHub Actions head passes repository-wide verification, inherited browser/visual smokes, House A smoke, and the Stack 3 smoke. Visual artifacts are evidence, not authority. PR #114 remains draft/unmerged until that exact-head evidence is green and merge is separately authorized.
