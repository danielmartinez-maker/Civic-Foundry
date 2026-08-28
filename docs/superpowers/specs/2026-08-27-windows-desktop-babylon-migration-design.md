# Civic Foundry — Windows Desktop + Babylon.js Migration Design

## Status

Approved in chat on 2026-08-27.

This specification inserts a dedicated desktop-platform migration between the accepted 2R Urban Fabric 2.0 baseline and the planned 3R Transportation Engine 2.0 replacement. The migration removes Canvas2D as the production world renderer, packages Civic Foundry as a Windows desktop application, and preserves the existing deterministic simulation and Save V9 authority model.

The implementation sequence is D0 → D1 → D2 → D3 → D4. Canvas2D may exist temporarily only as a non-shipping parity oracle while Babylon.js reaches functional parity. At D4 completion no supported production world-rendering path may depend on Canvas2D.

## Product Goal

Civic Foundry becomes a full Windows desktop city simulator that launches as a packaged `.exe`, renders the city as a GPU-driven 3D world through Babylon.js, preserves the current deterministic city simulation, and exposes the existing gameplay systems through a desktop-quality interface.

This is a platform and presentation replacement. It does not authorize redesign of transportation, households, economics, politics, or other simulation domains that already have separate roadmap ownership.

## Locked Runtime Stack

The approved and self-review-locked runtime stack is:

- Electron desktop shell;
- TypeScript throughout the existing simulation and presentation code;
- Babylon.js for all production world rendering;
- WebGL2 as the required rendering baseline;
- optional Babylon WebGPU support later as an acceleration path, never as the minimum launch requirement;
- HTML/CSS for dense city-management UI surfaces inside the Electron renderer process;
- `electron-vite` for Electron main/preload/renderer development and production bundling;
- `electron-builder` for Windows packaging, with NSIS as the initial installer target;
- existing deterministic simulation, save serializers, and compatibility migrations preserved unless a desktop-specific defect requires a narrowly scoped fix.

The build tool choice intentionally avoids depending on Electron Forge's currently experimental Vite integration. Tool versions are pinned through the lockfile during implementation.

## Strategic Placement in the Roadmap

```text
0A  Kernel Skeleton                    COMPLETE
1R  World Foundation 2.0               COMPLETE
2R  Urban Fabric 2.0                   COMPLETE

D0  Windows Desktop Foundation
D1  Babylon 3D Vertical Slice
D2  Gameplay Presentation Parity
D3  3D Asset / Visual Pipeline
D4  Canvas2D & Browser Runtime Removal

3R  Transportation Engine 2.0
4R+ Remaining Civic Foundry 2.0 systems
```

D0–D4 must complete before 3R begins. This prevents a rendering-platform migration from being mixed with a simultaneous transfer of transportation authority.

## Non-Negotiable Invariants

1. `SimulationKernel` remains the deterministic scheduler and time authority.
2. `SimulationCore` remains the public compatibility gameplay facade during the migration.
3. `WorldFoundation` remains the sole physical/geographic authority.
4. `CadastralGraph` remains the sole legal-land/topology authority.
5. Babylon.js owns presentation state only. Babylon meshes, materials, transforms, interpolation, effects, cameras, lights, and highlights are never authoritative simulation state.
6. Presentation reads typed snapshots and emits typed commands. It may not manufacture simulation outcomes.
7. Save V9 remains the default authoritative save schema unless an actual new persistence requirement emerges.
8. The existing V3–V9 hydration chain remains supported.
9. Simulation cadence remains independent from display frame rate.
10. D0–D4 may add presentation read models and commands but may not quietly assume ownership over later simulation domains.
11. A failed or slow renderer may degrade visual fidelity before it is allowed to alter simulation determinism.
12. No production world renderer may use Canvas2D after D4.
13. `HTMLCanvasElement` remains permitted strictly as a GPU surface for Babylon/WebGL/WebGPU; requesting a `2d` context is forbidden in production world-rendering code after D4.

## Current Baseline and Replacement Boundary

The current production path is browser-native:

```text
GameApp
  → SimulationCore
  → WorldRenderer
  → IsometricCamera
  → CanvasRenderingContext2D render passes
```

`WorldRenderer` currently owns the HTML canvas, the 2D drawing context, isometric projection, generated sprite-atlas presentation, overlays, selection rendering, and vehicle presentation. `GameApp` also couples browser DOM orchestration, browser storage, input, the frame loop, and the Canvas renderer.

The desktop migration replaces this presentation stack without rewriting the simulation owners behind `SimulationCore`.

## Target Runtime Architecture

```text
Electron Main Process
        │
        ├── process/window lifecycle
        ├── packaged asset paths
        ├── native save storage
        └── narrow IPC services
        │
Electron Preload Bridge
        │
        └── typed, allow-listed desktop API
        │
Electron Renderer Process
        │
        ├── DesktopApp
        ├── HTML/CSS management UI
        ├── InputController
        └── Babylon.js viewport
                │
                ├── CityScene
                ├── SceneSynchronizer
                ├── EntityVisualRegistry
                ├── camera/picking
                ├── terrain/parcels/roads/buildings
                ├── vehicles
                └── analytical overlays
                        │
                        ▼
              CityPresentationSnapshot
                        │
                        ▼
              SimulationCore / Kernel
```

Recommended source organization:

```text
src/
  desktop/
    main/
      ElectronMain.ts
      WindowManager.ts
      NativeStorage.ts
    preload/
      preload.ts
      DesktopBridge.ts
    renderer/
      DesktopApp.ts
      GameViewport.ts
      InputController.ts

  presentation/
    snapshot/
      CityPresentationSnapshot.ts
      PresentationSnapshotBuilder.ts
      PresentationDelta.ts
    scene/
      CityScene.ts
      SceneSynchronizer.ts
      EntityVisualRegistry.ts
    camera/
      CityCamera.ts
      CameraController.ts
    terrain/
    parcels/
    roads/
    buildings/
    vehicles/
    services/
    transit/
    overlays/
    selection/

  simulation/
    ...existing authoritative simulation...

  save/
    ...existing Save V3–V9 stack...
```

Exact filenames may change during implementation if repository conventions require it, but the authority boundaries above are mandatory.

## Presentation Snapshot Boundary

Babylon.js must not traverse arbitrary mutable internals of `SimulationCore` every frame. The migration introduces a typed renderer-facing read model:

```text
SimulationCore / SimulationKernel
        │
        └── PresentationSnapshotBuilder
                    │
                    ▼
            CityPresentationSnapshot
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
SceneSynchronizer          Desktop UI
        │                       │
        ▼                       ▼
Babylon scene          HUD / panels / inspector
```

`CityPresentationSnapshot` contains stable IDs and renderer-oriented immutable data. It contains no Babylon classes, DOM nodes, mutable simulation owners, or native filesystem handles.

The snapshot covers, as needed by the migrated presentation:

- world bounds and coordinate scale;
- terrain elevation and physical visualization inputs;
- hydrology and flood visualization state;
- cadastral parcel polygons, zoning, frontage, access, ownership/read-only diagnostics, and selected-state metadata;
- canonical `BuildingV2` footprint, height, floors, use mix, quality, condition, lifecycle, project/construction state, and visual classification;
- existing transportation nodes/edges and presentation metrics;
- active traffic vehicles;
- transit vehicles, stops, stations, and lines;
- service facilities and active service vehicles;
- freight vehicles and trade-flow presentation data;
- active overlay metric values;
- simulation clock, speed, treasury/population/employment and selected HUD values;
- inspection identifiers and read-only diagnostic summaries.

Collections whose order can affect deltas or tests must use deterministic ordering.

## Scene Synchronization

`SceneSynchronizer` owns the disposable mapping between authoritative entity IDs and Babylon visuals:

```text
simulation entity ID → visual instance
```

Examples:

```text
building:bld-482   → BuildingVisual
parcel:parcel-117  → ParcelVisual
vehicle:veh-9184   → VehicleVisual
```

Synchronization uses create/update/remove deltas rather than rebuilding the whole scene every frame. Terrain, unchanged parcel geometry, stable roads, and unchanged buildings are cached and invalidated only when their source snapshot data changes.

### Interpolation

Moving visuals may interpolate between authoritative snapshots for smooth rendering:

```text
authoritative vehicle progress = 0.4375
visual interpolation frames    = 0.4512, 0.4648, ...
next authoritative progress    = 0.4781
```

Interpolation is presentation-only and is never saved, replayed as authoritative history, or fed back into the simulation.

## World Coordinate System

The new renderer abandons the visual assumption that one logical cell must correspond to one isometric diamond tile.

Babylon world coordinates use physical-style world units:

```text
X = east/west
Y = elevation
Z = north/south
```

World/cadastral geometry is projected from the existing simulation coordinate system into this 3D coordinate system through explicit conversion helpers. No duplicate geography authority is introduced.

### Terrain

`WorldFoundation` terrain becomes a real 3D height field or chunked equivalent. Terrain rendering may initially use a moderate-resolution mesh derived from authoritative terrain samples, with later visual refinement permitted only as non-authoritative presentation.

### Parcels

Cadastral polygons are triangulated for selectable/overlay surfaces. Parcel presentation preserves canonical parcel IDs and never substitutes legacy lot IDs as canonical land identity.

### Buildings

`BuildingV2` drives procedural or authored 3D representation through its canonical footprint and physical attributes. Building meshes are derived presentation artifacts. Demolition, redevelopment, renovation, and construction visuals follow authoritative lifecycle/project state.

## Camera and Navigation

The default camera is a free city-builder orbit camera rather than a four-quarter-turn isometric camera.

Required controls:

- mouse-wheel zoom;
- middle-mouse drag pan;
- WASD keyboard pan;
- Q/E rotation;
- pitch limits appropriate for city-builder readability;
- click selection;
- focus selected entity;
- world-space ray picking;
- controls that remain usable from neighborhood to full-city scale.

A high-altitude orthographic-like mode may be added later, but it is not required for D0–D4 acceptance.

## Input and Command Flow

```text
mouse / keyboard input
→ Babylon pick or UI intent
→ world-space hit / selected entity
→ PresentationSelectionResolver
→ canonical target
→ typed gameplay command
→ simulation validation
→ authoritative mutation
→ next presentation snapshot
→ updated visual
```

Legacy cell-based tools may temporarily receive a derived cell coordinate where compatibility still requires it. Newer parcel/world-coordinate tools should operate directly on canonical world or parcel identity.

The renderer may show provisional road/zoning/building previews, but preview state never becomes authoritative until the simulation accepts the corresponding command.

## Desktop UI Strategy

Babylon owns the world viewport. HTML/CSS remains the preferred technology for dense management interfaces.

The shell provides:

- central 3D city viewport;
- persistent top HUD for treasury, population, simulation time/speed, and core status;
- build/tool palette;
- contextual inspector;
- expandable management panels for taxes, services, transit, economy, zoning, Urban Fabric, and diagnostics;
- mutually exclusive analytical overlay selection where current semantics require it;
- save/load/import surfaces backed by the desktop storage service.

A full visual redesign of every panel is outside this migration unless required for desktop usability or removal of Canvas assumptions.

## Windows Persistence

Save schema remains Save V9 during D0–D4.

Desktop storage root:

```text
%APPDATA%\Civic Foundry\
  saves\
  autosaves\
  settings.json
  logs\
```

Save extension:

```text
*.cfsave
```

A `.cfsave` contains the validated Save V9 JSON envelope. The extension is a desktop file convention, not a new save schema.

### Save Guarantees

Manual and autosave writes use an atomic pattern:

1. serialize authoritative state;
2. write a temporary file in the target directory;
3. flush and close the temporary file;
4. preserve/rotate the previous known-good save when applicable;
5. atomically rename the temporary file into place.

A corrupt or unsupported save is rejected through existing hydration/validation logic. Partial state must not be loaded.

### Compatibility

Existing V9 JSON can be imported into the desktop save flow. Older supported save versions continue through the existing V3–V9 migration chain. D0–D4 does not create Save V10 merely to change storage location.

### Autosaves

Desktop baseline includes three rotating autosave slots. Default cadence is every five real-time minutes while a city is loaded and has authoritative changes since the previous save. Autosave is suppressed while the simulation is in an invalid/load-transition state. Autosave cadence may later become user-configurable.

## Electron Process and Security Model

The Electron renderer process does not receive general Node.js authority.

Required defaults:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- renderer sandbox enabled where compatible;
- narrowly typed preload bridge;
- no arbitrary filesystem API exposed to renderer code;
- no arbitrary process/shell execution from renderer code;
- deny untrusted navigation and popups;
- restrictive Content Security Policy for packaged renderer resources;
- validate IPC payloads in the main process before performing native operations.

Expected bridge shape:

```text
renderer
  → window.civicDesktop.saveGame(...)
  → preload allow-list
  → validated IPC
  → Electron main
  → NativeStorage
```

The main process owns native persistence and platform integration. Babylon and management UI code remain renderer-side.

## Build and Packaging

The canonical desktop toolchain is:

```text
electron-vite  → development + main/preload/renderer bundles
electron-builder → packaged Windows application + NSIS installer
```

Required developer commands converge on:

```text
npm run desktop:dev
npm run desktop:build
npm run desktop:package
npm run desktop:test
```

The repository remains on Node 22, but desktop CI must pin a Node 22 release that satisfies all selected packaging-tool minimums. A production build must yield both an unpacked launchable Windows application for smoke testing and an NSIS installer artifact.

## Babylon Rendering Baseline

WebGL2 is the required compatibility renderer. WebGPU may be detected and enabled later if it produces clear value without creating divergent simulation behavior.

Required rendering domains by D4:

- terrain;
- water/hydrology/flood visualization needed for current gameplay;
- roads and intersections at current-authority fidelity;
- cadastral parcels;
- canonical buildings;
- service facilities;
- traffic vehicles;
- service vehicles;
- transit vehicles and infrastructure;
- freight vehicles;
- zoning and Urban Fabric overlays;
- traffic/service/transit/economy overlays;
- selection, hover, placement previews, construction feedback, and invalid-placement feedback.

## Asset Pipeline

The current procedural isometric sprite-atlas runtime pipeline is retired by D4.

Target asset flow:

```text
source art / procedural definitions
        ↓
asset build / validation
        ↓
GLB + compressed textures + metadata
        ↓
validated runtime manifest
        ↓
Babylon asset containers / instancing pools
```

Asset rules:

- engine-ready runtime assets are referenced through manifests rather than ad hoc paths;
- repeated assets use instancing/thin instances where appropriate;
- texture memory is budgeted explicitly;
- authored models use GLB/glTF as the preferred runtime format;
- raw production source art is not committed as runtime content; only repository-policy-approved source definitions and optimized engine-ready outputs are tracked;
- asset validation rejects missing runtime references before packaging.

### Procedural Building Strategy

Initial desktop buildings favor modular procedural 3D driven by `BuildingV2`:

- footprint;
- floor count / height;
- use mix;
- quality;
- condition;
- lifecycle state;
- construction/redevelopment state.

This provides immediate visual diversity from the canonical Urban Fabric model without requiring hundreds of bespoke assets before D1 can become playable. Authored landmarks and richer modular kits can replace or augment procedural visuals incrementally.

## Visual Direction

The target presentation is readable stylized realism with a miniature-city sensibility:

- clean silhouettes;
- physical depth;
- restrained PBR materials;
- soft shadows;
- readable zoning/service/traffic overlays;
- modest variation across repeated buildings;
- clear construction and lifecycle cues;
- optional tilt-shift-like depth-of-field treatment at appropriate zoom levels.

Tilt-shift depth of field is a GPU post-process and must be configurable or disableable because aggressive blur can reduce build/inspection readability.

## Performance Contract

### Reference Hardware

Desktop rendering acceptance is measured on a Windows 11 x64 machine with, at minimum:

- 6 physical CPU cores from a broadly 2020-or-newer desktop-class processor;
- 16 GB system RAM;
- NVIDIA GTX 1660 Super / AMD RX 5600 XT class GPU or better;
- current vendor graphics driver;
- 1920×1080 output resolution.

This is a migration baseline, not the final minimum-spec promise for a commercial release.

### Reference Scene

The committed renderer-performance fixture uses a presentation snapshot containing approximately:

- 2,000 visible buildings;
- 1,000 active moving vehicles across traffic/transit/service/freight categories;
- 5,000 repeated props/roadside instances;
- parcel and road geometry sufficient to exercise normal city-scale culling and overlay paths;
- one representative analytical overlay active.

Target: 60 FPS at 1920×1080 on reference hardware after a 10-second warmup, measured over the next 30 seconds. The median frame rate must be at least 60 FPS and the 1% low must be at least 45 FPS.

### Stress Scene

The committed stress fixture uses a synthetic read-only presentation snapshot containing approximately:

- 5,000 visible buildings;
- 2,000 active moving vehicles;
- 20,000 repeated props/roadside instances;
- full parcel/road geometry and one analytical overlay.

The fixture is synthetic presentation data so renderer stress coverage does not require simulation systems to manufacture an unnaturally large city.

Acceptance floor: median frame rate at least 30 FPS and 1% low at least 22 FPS at 1920×1080 on reference hardware after warmup.

### Rendering Rules

- no full scene rebuild every frame;
- no one-unique-mesh-per-repeated-prop architecture at city scale;
- use instancing/thin instances or equivalent batching for repeated props and suitable building components;
- chunk terrain and other large static geometry;
- use frustum culling and LODs for large cities;
- pool moving-agent visual instances where practical;
- update analytical overlays only when source data invalidates;
- maintain explicit snapshot-build and snapshot-sync timing telemetry;
- degrade visual density/LOD before blocking simulation progress;
- frame-rate variation must not change deterministic simulation outcomes.

### Telemetry

Desktop development telemetry exposes at least:

- renderer FPS/frame time;
- CPU presentation sync time;
- simulation tick duration;
- active meshes/instances;
- draw-call count where available;
- snapshot entity counts;
- asset/memory diagnostics where practical.

## Migration Tranches

### D0 — Windows Desktop Foundation

Purpose: create the secure desktop runtime while leaving simulation behavior unchanged.

Required outcomes:

- Electron main/preload/renderer process structure;
- `electron-vite` desktop dev/build workflow;
- launchable Windows development build;
- `electron-builder` unpacked package and NSIS artifact;
- secure preload bridge;
- native settings/save storage service;
- Save V9 manual save/load using filesystem storage;
- three-slot rotating autosave infrastructure;
- preserved Node simulation test workflow;
- no simulation-domain authority changes.

D0 may temporarily host a minimal placeholder renderer while D1 is being built, but the shipping target remains Babylon only.

### D1 — Babylon 3D Vertical Slice

Purpose: establish the first actually playable GPU-rendered desktop city.

Required outcomes:

- Babylon engine/scene bootstrap;
- WebGL2 compatibility path;
- terrain visualization;
- cadastral parcel visualization;
- canonical `BuildingV2` visualization;
- existing roads rendered from current transportation state;
- GPU ray picking;
- free orbit/pan/zoom camera;
- inspect/select;
- pause/simulation speed controls;
- minimum road/zoning interaction required for a playable city slice;
- manual save/load through desktop storage;
- no Canvas2D renderer executed by the D1 desktop entry point.

D1 hard gate: Civic Foundry launches as a Windows desktop game and the playable vertical slice runs through Babylon without invoking Canvas2D world rendering.

### D2 — Gameplay Presentation Parity

Purpose: migrate the complete currently supported player-facing presentation and interaction layer.

Required outcomes include:

- road construction/bulldoze previews and feedback;
- zoning interactions;
- utility/service placement;
- HUD parity;
- inspector parity for relevant current entities;
- traffic overlays;
- service overlays;
- transit overlays and transit management controls;
- economy/freight overlays and management surfaces;
- Urban Fabric parcel/envelope/development overlays;
- moving traffic vehicles;
- service vehicles;
- transit vehicles;
- freight vehicles;
- notifications and diagnostics;
- existing tax and service-budget controls;
- save/load/import workflows.

The old browser/Canvas renderer remains only as a temporary reference for parity testing during this tranche.

### D3 — 3D Asset and Visual Pipeline

Purpose: replace temporary primitive visuals and isometric sprite dependencies with the long-term 3D runtime asset system.

Required outcomes:

- validated GLB/glTF runtime pipeline;
- optimized texture/runtime manifest pipeline;
- procedural modular `BuildingV2` visuals mature enough for gameplay readability;
- production vehicle/facility/road/terrain visual assets at the agreed baseline;
- instancing/LOD/culling rules applied;
- asset policy updated for desktop runtime artifacts;
- old atlas dependencies removed from desktop build.

### D4 — Canvas2D and Browser Runtime Removal

Purpose: make the desktop Babylon runtime the only supported production game path.

Required outcomes:

- remove `WorldRenderer` Canvas2D implementation;
- remove Canvas render passes and Canvas-specific vehicle renderers;
- remove `IsometricCamera` if no non-Canvas tooling still requires it;
- remove production dependencies on `CanvasRenderingContext2D` and `getContext('2d')`;
- remove generated isometric atlas runtime build requirements;
- retire browser `index.html` as a supported game entry point;
- retire Canvas/browser smoke tests superseded by desktop tests;
- add architecture/static policy preventing reintroduction of Canvas2D world rendering;
- update README/architecture/testing/build documentation to declare desktop Babylon as canonical;
- prove packaged Windows launch/save/load/gameplay parity;
- pass defined performance gates.

D4 completion unlocks 3R.

## Player-Facing Completion Criteria

Before D4 is complete, the packaged Windows build must allow the player to:

- create a deterministic new city;
- pan, orbit, zoom, and inspect the 3D city;
- construct and bulldoze roads;
- apply residential, commercial, and industrial zoning through existing compatibility gameplay;
- place current utilities and municipal services;
- pause and run at supported simulation speeds;
- observe simulation-driven building development;
- observe traffic, freight, service, and transit vehicles moving in 3D;
- use current transit controls;
- change tax rates and service budgets;
- activate current traffic, service, transit, economy, and Urban Fabric overlays;
- inspect cells/compatibility targets, parcels, buildings, transit, and relevant diagnostics;
- save to named desktop save files;
- recover from rotating autosaves;
- load Save V9 desktop files;
- import older supported saves through the existing migration path;
- quit and relaunch without losing valid saved state.

## Explicitly Out of Scope

D0–D4 do not authorize major redesigns of:

- 3R lane-level transportation authority;
- final road geometry/turn/signal/parking/crash simulation;
- household/demographic replacement;
- politics/elections replacement;
- new macroeconomic simulation;
- multiplayer;
- modding APIs;
- procedural region expansion;
- major weather-system expansion;
- a new save schema solely for desktop packaging;
- broad gameplay rebalance unrelated to migration defects;
- a complete management-UI art redesign unrelated to desktop usability.

If migration reveals a true simulation compatibility bug, fix it narrowly with tests. Do not use the migration as a vehicle for unrelated system replacement.

## Testing and CI Contract

Required CI layers by D4:

1. formatting and linting;
2. architecture/repository policy;
3. strict TypeScript checks;
4. all deterministic Node simulation tests;
5. Save V3–V9 migration and round-trip tests;
6. presentation snapshot determinism/validation tests;
7. Babylon `NullEngine` scene/synchronizer tests where practical;
8. asset manifest/build validation;
9. Electron process/IPC tests;
10. packaged Electron smoke test;
11. Windows gameplay smoke covering launch → create/new/load → build road → zone → tick → save → quit → relaunch → load;
12. architecture/static test proving no production Canvas2D world-rendering path exists after D4;
13. reference/stress renderer telemetry gate;
14. Windows unpacked application and NSIS installer artifact generation.

A presentation test may verify scene mappings, transforms, visible classifications, and snapshot-delta behavior. Babylon output never becomes part of authoritative simulation determinism. Authoritative equivalence continues to be asserted through simulation/save state.

## Error Handling

### Renderer failure

A Babylon initialization failure produces a clear desktop error state and diagnostics rather than silently falling back to the old Canvas renderer after D4.

### Asset failure

Missing required packaged assets fail validation in build/CI. Optional runtime assets may fall back to an explicit placeholder visual, but diagnostics identify the missing asset.

### Save failure

Save write failures leave the previous valid save intact. The UI surfaces a recoverable error. Autosave failure does not crash the simulation.

### Load failure

Invalid/corrupt/incompatible saves are rejected before replacing the active authoritative core. Where practical, the current city remains active if a user-selected load fails.

### IPC failure

Desktop IPC operations return typed failures. Renderer code does not assume native writes succeeded until the main process confirms completion.

## Documentation Updates Required During Implementation

D0–D4 progressively update:

- `README.md`;
- `docs/ARCHITECTURE.md`;
- `docs/TESTING.md`;
- `docs/SAVE_FORMAT.md` where desktop file conventions need documentation;
- `docs/ENGINEERING_STANDARDS.md`;
- relevant ADRs for Electron/Babylon and renderer authority boundaries;
- asset documentation replacing isometric runtime atlas assumptions.

Final D4 documentation must not describe the browser Canvas renderer as canonical.

## Acceptance Definition

The Windows desktop migration is complete when all of the following are true:

1. Civic Foundry launches from a packaged Windows desktop artifact.
2. The production city world is rendered entirely through Babylon.js/GPU APIs and no Canvas2D world renderer remains supported.
3. The existing deterministic simulation remains authoritative and passes its inherited verification suite.
4. Save V9 and older supported migration inputs remain valid through the desktop save/import path.
5. Current player-facing city-building, management, overlay, inspection, traffic/transit/service/freight presentation, and save/load workflows have reached desktop parity.
6. Scene synchronization is snapshot-driven and Babylon state is non-authoritative.
7. Electron renderer privileges are restricted through a narrow preload/IPC boundary.
8. Desktop saves use atomic filesystem writes with three-slot rotating autosave recovery.
9. The committed reference and stress fixtures satisfy the performance thresholds defined in this spec.
10. Isometric sprite-atlas generation is no longer required by the canonical desktop build.
11. CI generates and smoke-tests the Windows package and NSIS installer artifact.
12. D4 documentation and architecture policy declare desktop Babylon as the canonical runtime.

Only after these criteria pass should Civic Foundry resume the 3R Transportation Engine 2.0 replacement program.
