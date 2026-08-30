# Civic Foundry 3D Presentation & Asset Program — Architectural Design

**Status:** Approved design

**Date:** 2026-08-30

**Branch baseline:** `main@4e06d80561278e35d3868a37d41fa5c6e8d3537b`

## 1. Purpose

Civic Foundry is moving from its current PixiJS/WebGL presentation stack to a true 3D presentation architecture capable of supporting the project's intended metro-to-parcel player experience, free 3D orbit and zoom, miniature-model photography aesthetics, standards-based GLB content, deterministic visual state, and metropolitan-scale rendering.

This program is intentionally ambitious in rendering and content infrastructure while preserving the existing authority boundaries of the game. `SimulationCore`, `WorldFoundation`, `CadastralGraph`, canonical `BuildingV2`, transportation, economy, services, and Save V9 remain authoritative. The 3D renderer is a downstream, disposable projection of authoritative state.

The permanent target architecture is:

- Babylon.js as the 3D rendering engine;
- WebGPU as the preferred graphics backend with WebGL compatibility where required;
- a Civic Foundry-specific retained, streamed, virtualized metropolitan scene runtime above Babylon;
- standards-based GLB assets and manifests;
- Tauri 2 as the eventual Windows desktop host after renderer acceptance;
- deterministic build, asset, and presentation behavior;
- no simulation or save authority inside Babylon, GLB assets, or the desktop host.

The current Electron host is retained during the renderer migration so renderer and host replacement do not become one big-bang change.

## 2. Source-of-truth constraints

This design is governed by the accepted Civic Foundry architecture and the 2.5D Miniature GLB Asset Prompt Bible.

Key constraints:

1. The simulation owns game facts. The renderer consumes read-only presentation state.
2. Save V9 compatibility must be preserved unless a separate save migration is explicitly designed and approved.
3. `WorldFoundation` remains physical/geographic authority.
4. `CadastralGraph` remains legal-land/topology authority.
5. Canonical `BuildingV2` remains the authoritative building representation.
6. Asset state such as condition, occupancy appearance, power, construction, and night lighting must be derived from authoritative state and stable identities.
7. Presentation variation must be deterministic. Render-time randomness must not alter asset identity or state.
8. Runtime GLB content uses meters, `+Y` up, `-Z` project forward, ground at `Y = 0`, applied transforms, and a declared ground-level root convention.
9. GLB is a presentation resource only. It does not own parcels, roads, traffic, services, economy, occupancy, or other simulation facts.
10. Generated binary assets remain runtime outputs rather than arbitrary tracked source binaries unless a separately reviewed Git LFS policy is introduced.

## 3. Program decomposition

The program is implemented as independently reviewable tranches.

### 3.1 Tranche 1 — 3D Runtime Foundation + House A Calibration

Establish the permanent interfaces and prove them with the canonical House A asset.

Scope:

- Babylon.js scene/runtime introduced alongside the current Pixi renderer;
- WebGPU-first initialization with WebGL compatibility fallback;
- free 3D orbit, zoom, and miniature-camera controls;
- `AssetManifestV2` and a 3D asset catalog;
- deterministic source-to-GLB compiler path;
- async asset request broker, streaming manager, resource cache, and prototype cache;
- initial LOD and instancing architecture;
- read-only `WorldPresentationSnapshot` boundary;
- `BuildingVisualResolver` using canonical `BuildingV2` facts;
- House A LOD0/LOD1/LOD2, collision, sockets, materials, state channels, and deterministic review scenes;
- diagnostics and architecture tests;
- current Pixi renderer retained as a compatibility path.

This is the first implementation plan after this architecture is accepted.

### 3.2 Tranche 2 — Metropolitan Asset Streaming Runtime

Add spatial chunks, predictive loading, cancellation, residency, explicit CPU/GPU budgets, eviction, content hashes, and streaming telemetry.

### 3.3 Tranche 3 — GPU-Driven City Scene Architecture

Add large-scale instance groups, retained dirty-set updates, hierarchical visibility, specialized render paths for buildings/vegetation/vehicles, GPU-friendly overlays, and aggregate representations.

### 3.4 Tranche 4 — First Production Asset Wave

Produce and integrate the first 12 approved asset families:

1. House A
2. Deciduous Tree A
3. Compact Car A
4. Local Street Straight + Intersection
5. Corner Shop A
6. Fire Station A + third-bay module
7. Light Workshop A
8. Low-rise Apartment A
9. Bus Stop A
10. Construction Kit A
11. Condition Kit A
12. Pocket Park Kit A

### 3.5 Tranche 5 — Advanced World Presentation

Add continuous road/terrain presentation, day/night, weather-ready material channels, advanced lighting and post-processing, construction/deterioration presentation, animated traffic, 3D analytical overlays, and metro-to-parcel continuity.

### 3.6 Tranche 6 — Tauri 2 Desktop Migration

Replace Electron only after Babylon is the accepted production renderer and the 3D acceptance city and stress tests are green.

## 4. System architecture

The target data flow is:

```text
SimulationCore / WorldFoundation / Cadastre / Domain Systems
                         |
                         | immutable read-only render state
                         v
             PresentationSnapshotBuilder
                         |
                         v
              WorldPresentationSnapshot
                         |
                  revisions / dirty sets
                         v
                 CivicSceneRuntime
                 |      |      |
                 |      |      +-- Diagnostics
                 |      +--------- StateVisualResolver
                 +---------------- Spatial/Asset Runtime
                         |
                         v
                    Babylon.js
                  WebGPU / WebGL
                         |
                         v
               Electron -> Tauri 2
```

Babylon objects are never authoritative game objects. A rendered entity may stream out, be evicted, be destroyed due to device loss, and later be reconstructed without changing simulation state.

## 5. Presentation state boundary

### 5.1 WorldPresentationSnapshot

The renderer must not query many simulation subsystems ad hoc in the hot loop. Presentation receives a read-only snapshot with stable identities and domain revisions.

Conceptual structure:

```ts
interface WorldPresentationSnapshot {
  revision: PresentationRevision;
  buildings: readonly BuildingVisualState[];
  roads: readonly RoadVisualState[];
  vehicles: readonly VehicleVisualState[];
  facilities: readonly FacilityVisualState[];
  environment: EnvironmentVisualState;
  dirty: PresentationDirtySets;
}
```

The exact data shape belongs to implementation, but these invariants are fixed:

- snapshot construction is downstream from authoritative state;
- snapshots contain only presentation-required data;
- domain revisions are monotonic;
- dirty identity sets allow retained updates;
- a complete snapshot is sufficient to reconstruct the scene from scratch.

### 5.2 Stable presentation identities

Rendered entities use stable identities derived from canonical simulation IDs, not scene allocation order.

Examples:

```text
building:<BuildingId>
parcel:<ParcelId>
road:<RoadSegmentId>
vehicle:<VehicleId>
facility:<FacilityId>
```

These identities are used for deterministic visual variation, picking, dirty updates, streaming lifecycle, and scene reconstruction.

### 5.3 Deterministic visual variation

Cosmetic variation is seeded from stable inputs such as:

```text
stable entity ID + asset ID + visual channel
```

This may vary trim tint, shrub selection, curtain appearance, grass variation, or similarly non-authoritative details. It must remain stable across save/load, camera movement, streaming eviction, and scene reconstruction.

`Math.random()` or equivalent non-seeded render randomness is forbidden in authoritative visual resolution.

## 6. Building presentation

### 6.1 BuildingVisualResolver

A dedicated resolver maps canonical `BuildingV2` facts to presentation resources and state.

Conceptual output:

```ts
interface BuildingVisualState {
  presentationId: PresentationEntityId;
  assetId: AssetId;
  transform: {
    positionM: Vec3;
    rotationY: number;
    scale: Vec3;
  };
  state: {
    condition: VisualCondition;
    occupancy: VisualOccupancy;
    powered: boolean;
    construction: VisualConstructionState;
    nightLighting: boolean;
  };
  variationSeed: number;
}
```

The resolver may choose deterministic presentation details but may not invent gameplay facts that do not exist upstream.

### 6.2 Structural vs. appearance revisions

The renderer distinguishes two classes of update:

**Structural revision**

- asset family changes;
- footprint/massing changes;
- demolition;
- construction geometry stage changes;
- transform/topology changes requiring instance replacement.

**Appearance revision**

- condition material state;
- lights;
- occupancy appearance;
- non-geometric status channels;
- cosmetic overlays/attachments.

Appearance changes must update attributes, materials, or attachments without replacing the entire mesh whenever possible.

## 7. Asset Manifest V2

The existing sprite/atlas manifest remains a legacy compatibility surface. 3D assets use a separate manifest contract rather than forcing GLB semantics into sprite rectangles and anchors.

Conceptual entry:

```ts
interface AssetManifestV2Entry {
  assetId: AssetId;
  revision: number;
  category: AssetCategory;

  geometry: {
    lod0: ModelReference;
    lod1?: ModelReference;
    lod2?: ModelReference;
    impostor?: ModelReference;
    collision?: ModelReference;
  };

  dimensions: {
    widthM: number;
    depthM: number;
    heightM: number;
  };

  pivot: {
    convention: 'ground-center';
    forward: '-Z';
    up: '+Y';
  };

  placement: PlacementContract;
  sockets: AssetSocket[];
  materials: MaterialBinding[];
  stateChannels: StateChannelContract;

  runtime: {
    instancing: 'thin' | 'hardware' | 'unique';
    streamingClass: 'critical' | 'near' | 'normal' | 'background';
    memoryClass: 'tiny' | 'small' | 'medium' | 'large';
  };

  art: ArtContract;
}
```

The runtime catalog is versioned independently from legacy sprite manifests.

## 8. Repository asset layout

Tracked authoring source remains text-first and reviewable:

```text
assets/
  source/
    legacy-isometric/
    3d/
      buildings/
      vehicles/
      vegetation/
      infrastructure/
      civic/
      construction/
      condition/
      public-realm/
  manifests/
    v2/
  reviews/
```

Generated runtime outputs are written under `dist/`:

```text
dist/assets/
  models/
  collisions/
  textures/
  manifests/
  thumbnails/
  bundles/
```

This design intentionally preserves the current policy that generated binary outputs are not casually committed as source files.

## 9. CivicAssetCompiler

The first production assets are generated deterministically from committed source definitions and material parameters. The compiler is a production gate, not a convenience script.

Pipeline:

```text
source definitions
      |
      v
CivicAssetCompiler
      |
      +-- schema validation
      +-- geometry validation
      +-- coordinate normalization
      +-- material normalization
      +-- LOD validation
      +-- socket validation
      +-- collision validation
      +-- triangle/draw-call budget checks
      +-- deterministic hashing
      +-- GLB emission
      +-- manifest emission
      +-- deterministic review render inputs
      v
runtime GLBs + runtime catalog
```

The compiler rejects invalid production content.

Required failures include:

- invalid units/scale;
- wrong forward/up convention;
- undeclared or invalid root transform;
- geometry below the permitted ground convention without explicit reason;
- required LOD missing;
- LOD hierarchy that increases complexity unexpectedly;
- missing mandatory collision mesh;
- duplicate asset IDs;
- unsupported material configuration;
- external runtime texture URL;
- missing required sockets;
- triangle or draw-call budget violation;
- state topology that breaks the declared instancing strategy.

Later DCC-authored Blender/Maya assets may enter through an importer/normalizer but must satisfy the same runtime contract.

## 10. Runtime asset loading

City entities do not call Babylon's GLB loader directly.

The runtime path is:

```text
AssetCatalogV2
      |
      v
AssetRequestBroker
      |
      v
AssetStreamingManager
      |
      +-- priority queue
      +-- cancellation
      +-- retries/backoff
      +-- bandwidth / upload budgets
      v
GLBResourceCache
      |
      +-- CPU residency
      +-- GPU residency
      +-- reference counts
      +-- memory estimates
      +-- eviction score
      v
ScenePrototypeCache
      |
      v
InstanceManager
```

A loaded GLB becomes a reusable scene prototype. Repeated city objects share geometry and materials.

Instancing classes:

- thin instances for high-volume repeated objects;
- regular/hardware instances where per-instance scene behavior is required;
- unique meshes only for assets that genuinely require independent scene hierarchies.

## 11. House A calibration asset

House A is the first hard acceptance test for the full pipeline.

Canonical art direction:

- small detached suburban house;
- compact rectangular footprint around 9 m x 12 m;
- approximately 1.5 stories / 7.6 m height target;
- charcoal gable roof and chimney;
- warm cream stucco;
- muted green trim;
- centered dark front door and covered entry;
- pale blue glass;
- simple foundation/path/lawn;
- one deciduous tree socket/placement relationship;
- sparse shrubs/fence;
- no people, cars, text, or logos baked into the building asset.

Expected output family:

```text
cf_bld_res_detached_house_a_low_v01_lod0.glb
cf_bld_res_detached_house_a_low_v01_lod1.glb
cf_bld_res_detached_house_a_low_v01_lod2.glb
cf_bld_res_detached_house_a_low_v01_collision.glb
cf_bld_res_detached_house_a_low_v01_manifest.json
cf_bld_res_detached_house_a_low_v01_review.png
```

House A must prove:

- correct scale/pivot/axis convention;
- deterministic GLB compilation;
- LOD0/1/2;
- collision geometry;
- sockets including front entry, rear service, and exterior light contract;
- material loading;
- instancing;
- streaming in/out;
- deterministic cosmetic variants;
- condition state;
- occupancy/power/night state hooks;
- construction attachment compatibility;
- selection/picking;
- free orbit at close and distant scales;
- review scene generation;
- validator failure behavior.

House A is the calibration gate before the pipeline is scaled across the other 11 first-production asset families.

## 12. State channels and attachments

Full duplicate GLBs are not the default state mechanism.

A base asset may expose channels such as:

```text
condition
occupancy
power
construction
night
weathering
service/status attachment
```

Where possible, state is expressed through:

- material parameters;
- emissive masks;
- decals;
- lightweight attachment meshes;
- instance attributes;
- texture arrays/atlas selection.

Example:

```text
House A base geometry
  + condition material state
  + grime/decal attachment
  + board-up attachment for distress
  + emissive mask for powered occupied night state
  + construction scaffold attachment
```

State channels always reflect authoritative simulation state or deterministic presentation variation.

## 13. Metropolitan scene virtualization

The renderer manages representation density independently from simulation density.

A simulation entity may exist while having no detailed GPU representation.

### 13.1 Spatial hierarchy

The presentation world is divided into a loose hierarchy:

```text
Metropolitan Region
  -> Macro Region
    -> District
      -> Render Chunk
        -> Parcel / Building / Road / Props
```

Renderer residency is distinct from simulation existence.

Each chunk tracks bounds, revision, entity identities, and residency state.

### 13.2 Representation levels

The hierarchy extends beyond ordinary mesh LOD:

```text
LOD0      close inspection / hero detail
LOD1      neighborhood detail
LOD2      city detail
IMPOSTOR  distant asset representation
AGGREGATE district/urban mass representation
UNLOADED  no individual representation
```

At extreme zoom levels, the renderer may replace individual buildings and trees with district morphology, canopy, road corridor, and landmark aggregates while the simulation remains fully resolved.

### 13.3 Projected-importance LOD

LOD selection is not distance-only. It considers projected screen size, semantic importance, camera prediction, selection priority, asset complexity, and memory pressure.

Selected/inspected entities receive priority protection.

LOD transitions use hysteresis and, where practical, fade/dither or aggregate/detail overlap to avoid visible thrashing.

## 14. Predictive streaming

Streaming considers current and likely near-future camera demand.

Inputs include:

- camera position;
- camera velocity;
- heading;
- zoom velocity;
- orbit target;
- selected entity;
- active tool.

Priority classes:

```text
P0 selected / interaction-critical
P1 visible and missing required representation
P2 predicted near-future visible
P3 nearby prefetch
P4 background warm cache
```

No render frame should synchronously wait for a GLB. Missing detail resolves to a lower LOD, aggregate, or deterministic proxy until the preferred representation becomes resident.

## 15. CPU/GPU memory budgets

The runtime uses explicit budgets rather than assuming unlimited memory.

Budget classes include:

- decoded CPU geometry;
- GPU geometry;
- GPU textures;
- transient upload memory.

Resources track cost, last use, visibility, reuse, priority, and residency protection.

Eviction favors resources that are not visible, are far or predicted irrelevant, are expensive, and have low reuse. Critical/selected assets are protected.

Quality profiles may tune budgets but must share the same architecture.

## 16. Specialized render domains

### 16.1 Buildings and props

Use retained instance groups keyed by compatible prototype/material/state groups. Geometry and materials are shared. State changes only move or update instance metadata when necessary.

### 16.2 Vegetation

Vegetation receives a specialized strategy:

- close: full model;
- medium: simplified geometry;
- far: canopy/cross-plane/cluster representation;
- metro: aggregate canopy surface.

Wind is shader-driven rather than thousands of object animations.

### 16.3 Vehicles

Vehicles use a transient specialized runtime with transform interpolation, archetype instance groups, LOD, and pooling. Individual vehicles disappear at metro scale in favor of aggregate flow presentation.

Rendering interpolation never mutates authoritative transport state.

### 16.4 Roads and terrain

The initial street kit may use modular assets for art calibration, but long-term continuous roads and terrain are generated as chunk-local presentation geometry rather than thousands of repeated GLB fragments.

GLB is preferred for discrete authored content such as buildings, props, vehicles, transit furniture, civic structures, and vegetation prototypes.

Procedural chunk meshes are preferred for continuous terrain, roads, sidewalks, water, and large overlay surfaces.

## 17. Material strategy

The art direction benefits from coherent shared material families rather than unique photoreal materials for every object.

Common families include:

- stucco;
- brick;
- concrete;
- asphalt;
- glass;
- roofing;
- wood;
- metal;
- vegetation.

Variation should use texture arrays/atlases, instance parameters, deterministic tint ranges, masks, grime, and emissive channels where possible.

The objective is bounded material switches and draw groups at city scale.

## 18. GPU-friendly analytical overlays

Analytical modes such as zoning, land value, traffic, transit, pollution, services, development pressure, utilities, and parcel boundaries must not rebuild city geometry.

Preferred architecture:

```text
simulation overlay snapshot
        |
        v
compact GPU value buffer / lookup texture
        |
        v
overlay shader over retained geometry
```

Overlay switching becomes primarily data upload and shader state rather than full world reconstruction.

## 19. Frame scheduler

The scene runtime explicitly budgets non-render work per frame.

Frame work is ordered approximately as:

```text
snapshot ingest
critical scene changes
camera
visibility
LOD transitions
bounded streaming uploads
animation interpolation
render
optional background convergence
```

Heavy work such as GLB GPU uploads, chunk mesh rebuilds, and large LOD transitions must be bounded so rapid camera movement converges progressively rather than creating catastrophic frame spikes.

## 20. Diagnostics

Diagnostics are mandatory from the first tranche.

The scene runtime should expose at least:

- FPS;
- CPU frame time;
- GPU frame time when available;
- visible/resident/queued chunks;
- visible instances;
- scene nodes;
- draw groups/draw calls where observable;
- triangles where observable;
- GLB loads;
- cache hits/misses;
- CPU geometry memory estimate;
- GPU geometry memory estimate;
- GPU texture memory estimate;
- streaming queue depth;
- upload time;
- LOD transition counts;
- snapshot dirty counts;
- scene mutation counts;
- simulation entity count vs rendered entity count vs unique GPU resource count.

These counters are presentation diagnostics only.

## 21. Picking and inspection

Picking is an identity lookup, not a gameplay data lookup from Babylon objects.

```text
pointer input
  -> Babylon picking result
  -> PresentationEntityId
  -> canonical simulation ID
  -> existing inspector / UI read path
```

Selection highlighting remains presentation-only.

## 22. Loader state and failure handling

Asset requests move through explicit states:

```text
UNREQUESTED
QUEUED
FETCHING
DECODING
UPLOADING
RESIDENT
```

Failure/lifecycle states include:

```text
FAILED_TRANSIENT
FAILED_PERMANENT
INVALID_ASSET
CANCELLED
EVICTED
```

Transient failures may retry. Permanent/invalid assets must fail deterministically and surface diagnostics.

A missing detail asset may fall back only to a representation that preserves authoritative meaning at least at category, bounds, transform, orientation, height class, and identity level.

A renderer/asset failure must not crash or mutate the simulation loop.

## 23. GPU device-loss recovery

If WebGPU or the graphics device is lost:

1. simulation continues independently;
2. presentation may temporarily freeze or show a recovery state;
3. Babylon/device state is recreated;
4. GPU caches are invalidated;
5. the scene is reconstructed from the current authoritative presentation snapshot.

No simulation reload or save reload is required.

This is a hard proof of the disposable-renderer boundary.

## 24. First 12-asset acceptance neighborhood

The first production wave culminates in a permanent deterministic acceptance district containing all 12 asset families.

The district must support:

- free orbit and zoom;
- close facade inspection and district overview;
- picking and inspector identity parity;
- day/night;
- powered/unpowered visual behavior;
- multiple condition states;
- active construction state;
- moving and parked vehicles;
- streaming/LOD transitions during fast camera movement;
- deterministic restoration after streaming out and back in;
- coherent scale and art direction across all categories;
- miniature-camera controls including depth-of-field presentation without baked blur in assets.

This fixture is retained as a long-term acceptance scene rather than a disposable demo.

## 25. Testing strategy

### 25.1 Architecture firewall

Repository policy/tests must prevent Babylon/presentation dependencies from being imported by authoritative domains such as:

```text
src/simulation/
src/world/
src/save/
```

Allowed dependency direction is one-way:

```text
authoritative systems -> presentation snapshot -> renderer
```

### 25.2 Deterministic scene reconstruction

Given the same complete snapshot:

```text
buildScene(S)
destroyScene()
buildScene(S)
```

must resolve the same asset IDs, transforms, deterministic variants, state channels, and presentation identities. GPU allocation handles do not need to match.

### 25.3 Asset-resolution tests

Canonical `BuildingV2` inputs must resolve expected asset families and visual channels, closing the current class of legacy-building presentation mismatch.

### 25.4 Streaming tests

Required contracts include:

- duplicate requests collapse;
- cancelled requests do not instantiate;
- evicted resources release references;
- selected assets resist eviction;
- LOD downgrade uses hysteresis;
- failed assets resolve valid deterministic proxies;
- content hashes invalidate changed runtime resources;
- scene teardown leaves no authoritative state behind.

### 25.5 Structural performance regressions

CI should prefer deterministic structural bounds over fragile wall-clock thresholds.

For a known repeated scene, tests may assert bounds on:

- unique geometry prototypes;
- unique material families;
- scene nodes;
- instance groups;
- asset loads;
- retained object identity after unchanged frames.

Dedicated benchmark jobs may record CPU/GPU times and memory without making all CI correctness depend on machine-specific timing.

### 25.6 Deterministic visual review

Important assets and scenes use fixed review cameras with fixed environment, lighting, time of day, state, and resolution.

House A review cameras include at least:

- front three-quarter;
- rear three-quarter;
- top-oblique;
- street distance;
- neighborhood distance;
- night;
- worn/condition state;
- construction state.

## 26. Performance acceptance ladder

The renderer must be evaluated progressively:

```text
Calibration      1 House A
Block            ~100 buildings
Neighborhood     ~1,000 buildings plus vegetation/vehicles
District         10,000+ buildings
Large City       50,000+ building representations
Metro Stress     100,000+ authoritative buildings with hierarchical rendering
```

Exact FPS and hardware targets will be set by the implementation/benchmark tranche after profiling.

The architectural invariant is fixed now:

> Increasing authoritative city size must not force maximum-detail scene objects, draw calls, or GPU memory to scale linearly with the total simulated object count.

## 27. Migration strategy

`GameApp` temporarily supports two presentation backends:

```text
legacy-gpu -> current Pixi GpuWorldRenderer
civic-3d   -> Babylon CivicSceneRuntime
```

Migration sequence:

```text
Babylon foundation
  -> House A calibration
  -> 12-asset acceptance neighborhood
  -> canonical BuildingV2 coverage
  -> roads/terrain/vehicles/overlays
  -> interaction + visual parity
  -> performance acceptance
  -> Babylon becomes default
  -> legacy Pixi path removed
  -> Electron replaced by Tauri 2
```

No legacy renderer or host is removed before explicit retirement gates are met.

## 28. Pixi retirement gates

The current Pixi path may be removed only when:

1. Babylon is the accepted default renderer;
2. canonical buildings render correctly;
3. roads, terrain, vehicles, facilities, selection, and required overlays are covered;
4. browser/desktop smoke passes;
5. the 3D acceptance district passes;
6. agreed performance baselines pass;
7. Save V9 behavior is unchanged;
8. no presentation dependency leaks into simulation/world/save authority.

## 29. Tauri migration and Electron retirement

Tauri 2 migration starts after Babylon acceptance.

The host boundary changes while the accepted TypeScript simulation, Babylon presentation, asset compiler outputs, and save system remain stable.

Tauri native services may provide explicit interfaces for:

- filesystem/cache;
- asset-pack discovery;
- save directories;
- native dialogs;
- logging/crash information;
- future platform integrations such as Steam.

Tauri services remain infrastructure, not simulation authority.

Electron may be retired only after Tauri launches the accepted Babylon build, save/load parity passes, local asset streaming passes, Windows packaging passes, and the full smoke stack is green.

## 30. Non-goals

This program does not authorize unrelated rewrites of:

- `SimulationCore`;
- `WorldFoundation`;
- cadastral authority;
- Save V9 schema;
- transportation ownership;
- economy ownership;
- building simulation semantics;
- service simulation semantics.

Authoritative systems may expose cleaner read-only presentation data where necessary, but the 3D runtime remains a consumer.

This program also does not require a custom replacement for Babylon's general rendering engine. Civic Foundry-specific GPU/WebGPU techniques may be added above or below Babylon interfaces when profiling proves they are justified.

## 31. Implementation planning boundary

This document is the umbrella architecture for the complete 3D Presentation & Asset Program. It is intentionally larger than one implementation PR.

The next implementation plan covers only **Tranche 1 — 3D Runtime Foundation + House A Calibration**. Later tranches receive separate plans and review checkpoints against this architecture.

The first plan must preserve these mandatory boundaries:

- no Save V9 schema change;
- no simulation/world authority transfer;
- no Tauri migration yet;
- no Pixi deletion yet;
- no requirement to produce all 12 assets before House A passes calibration;
- text/source definitions remain the tracked source of first-party generated runtime binaries;
- House A is the first end-to-end acceptance gate;
- all new renderer functionality remains reconstructible from authoritative presentation snapshots.

## 32. Definition of architectural success

The program is successful when Civic Foundry can present a large, authoritative city as a coherent miniature 3D world from metro scale to parcel inspection while maintaining bounded render representation, deterministic visual identity, reusable standards-based assets, asynchronous content streaming, and strict separation between simulation facts and presentation resources.

The renderer must be powerful enough that future city scale increases require better representation/streaming policies rather than another wholesale presentation rewrite.
