# Stack 4 — Native Presentation Platform & Final Cutover — Implementation Status

**Stack ID:** `STACK_4_CPP_NATIVE_PRESENTATION_PLATFORM_AND_FINAL_CUTOVER`

**Branch:** `feature/stack-4-cpp-native-presentation-cutover`  
**PR:** #123 — Stack 4 — Native Presentation Platform & Cutover Gate  
**Status vocabulary:** **Implemented** = present on this branch and covered by branch verification; **Transitional** = presentation implementation exists but authoritative domain/query integration remains gated; **Blocked** = the Stack 4 stop conditions prohibit finalization until upstream native authority is consolidated.

This document records repository truth for the Stack 4 branch. It does not advance save version, declare Prism authority, or retire the TypeScript/Electron compatibility runtime.

## Authority precondition

The current Stack 4 base still reports the native gameplay domains as unowned. `docs/cpp/NATIVE_ENGINE.md` states that TypeScript remains authoritative and that native `world`, `cadastre`, `buildings`, `transportation`, `population`, `economy`, and `services` domain hashes remain `unowned` until later authority transfers are consolidated.

Therefore:

- Electron/Pixi/DOM production retirement remains blocked.
- Native management commands remain typed command contracts and do not mutate a second simulation authority.
- Native management/analytics panels must not fabricate domain query data.
- The repository must not declare `Prism Engine — Implemented native authoritative runtime` yet.

## Task-by-task audit

| Task | Status | Branch evidence / remaining condition |
|---|---|---|
| 1 — Native Presentation API | **Implemented** | `Presentation.hpp` defines `FrameSnapshot`, `CameraState`, `SelectionState`, `ToolPreviewState`, `RenderRevision`, `PresentationSettings` as presentation DTOs. |
| 2 — Native Window/Input | **Implemented** | Win32 shell, DPI, pointer/keyboard/wheel/focus/resize/close/frame events. Accepted ADR explicitly supersedes SDL3 default while keeping the presentation contract platform-neutral. Lost focus/pointer cancellation clears drag state. |
| 3 — GPU Backend Abstraction | **Implemented** | Narrow GPU device/swapchain/buffer/texture/pipeline/submission/fence abstractions; backend objects stay presentation-side. |
| 4 — D3D12 Bootstrap | **Implemented** | D3D12 adapter/device/swapchain/queue/list/heaps/fences/debug/resize/device-loss path plus blank-frame smoke executable. |
| 5 — Isometric Camera Parity | **Implemented** | C++ camera matches shared TypeScript camera fixture for projection, anchored zoom, rotation and continuous picking. |
| 6 — Retained Scene | **Implemented** | Per-domain revision maps, rebuild counters, no-op GPU upload suppression and snapshot-revision fast path. Aggregate scene geometry remains one presentation upload cache; this document does not claim per-layer GPU buffers. |
| 7 — Terrain Rendering | **Implemented** | Native terrain presentation covers soil/biome categories including rock, water/flood state and viewport culling. |
| 8 — Road Rendering | **Implemented** | Hierarchy, condition, direction and zoom-dependent lane/one-way detail derive from road snapshot records. |
| 9 — Canonical BuildingV2 Rendering | **Implemented** | Footprint extrusion uses canonical footprint/floors/height/use/condition/construction progress; no legacy one-cell footprint invention in native geometry. |
| 10 — Vehicle & Transit Rendering | **Implemented** | Traffic/service/freight/transit kinds, stops/stations and intentional metro/rail representation; snapshot interpolation is presentation-only. |
| 11 — Spatial Analytical Overlays | **Implemented presentation contract** | Spatial samples preserve metric/value/position and render metric-distinguishable geometry with accessible legend metadata. Authoritative sample population for every domain remains dependent on the corresponding consolidated domain snapshot. |
| 12 — Selection & Picking | **Implemented** | Camera projection → read-only picking index → typed entity ID; selection does not mutate simulation. |
| 13 — Native Asset Registry | **Implemented** | Stable IDs, deterministic/offline manifest policy, missing-reference validation. |
| 14 — GLB / 2.5D Loading | **Implemented** | GLB primitives/materials/textures/transforms, stable-ID GPU cache, LOD metadata path and diagnostic placeholder for broken assets. |
| 15 — Miniature / Tilt-Shift | **Implemented** | Configurable focal treatment, scale cues and camera smoothing; reduced-motion/visual-effects controls suppress treatment while overlays stay crisp. |
| 16 — Native UI Framework | **Implemented** | ImGui Win32/D3D12 runtime, explicit lifecycle, DPI/UI scale, input capture and dockable panel model. |
| 17 — HUD & Core Tools | **Implemented presentation-side / authority gated** | HUD, speed controls, inspect, road, zoning, facility, utility, service, transit-stop/metro-station, transit and bulldoze workflows. Utility/service/transit-stop/bulldoze previews and Alpha management actions are typed commands. Gated sink prevents authority mutation until upstream consolidation. |
| 18 — Inspectors & Panels | **Transitional** | Inspector and management panel surfaces exist for Urban Fabric, transportation/transit, economy/housing, services/utilities/government. Authoritative management query adapters cannot be bound while those native domains remain unowned. |
| 19 — Charts & “Why?” UI | **Transitional** | Panel model/rendering supports current value, trend, history plots and causal contributors. Real causality/analytics feeds remain gated on consolidated native authoritative query snapshots. |
| 20 — Accessibility | **Implemented** | UI scale, UI input capture, color-independent cues, reduced motion, effects controls, alert severity, contrast and input sensitivity. |
| 21 — Native Settings Persistence | **Implemented** | Settings JSON is separate from deterministic city save and persists audio/UI/camera/effects/accessibility/keybindings. |
| 22 — Native Audio | **Implemented presentation-side** | Snapshot-derived native audio planner/runtime plus XAudio2 output. Audio is read-only relative to simulation. |
| 23 — Native Save UX | **Implemented workflow / authority transitional** | C++ Save V9 invocation, explicit failure reporting, durable temp write + flush + atomic replace, validated backup recovery. Final authority remains tied to native domain consolidation. |
| 24 — Desktop Packaging | **Implemented package path** | Windows executable, runtime dependencies/assets, version metadata/symbols and ZIP packaging. Package-boundary gate rejects Electron/Node/Pixi artifacts and requires offline runtime manifest. Final shipping designation remains blocked by authority cutover. |
| 25 — Browser/WASM Reference | **Implemented** | Pinned Emscripten path executes the shared deterministic native fixture; browser remains reference/development surface. |
| 26 — Performance Consolidation | **Implemented for Stack 4 presentation scope** | Large-city benchmark records retained updates, packet/geometry build and authoritative hash equality. Viewport culling and unchanged-revision retained fast path were implemented from measured evidence. Future domain data-layout work belongs with authoritative domain consolidation/profiling. |
| 27 — Long-Horizon Soak | **Transitional** | Deterministic raw-tick soak gates exist at 1, 1,000, 10,000 and 50,000 ticks under sanitizer-capable CI. The current clock contract has no authoritative calendar duration per tick, so naming those runs “1 day / month / year / 10 years / 50 years” would invent semantics. Calendar-horizon gates must be bound after the authoritative time model defines that mapping. |
| 28 — Native Visual Acceptance | **Implemented** | Ten required scenarios generate production-scene reference geometry/SVG review artifacts: empty terrain, developed neighborhood, dense mixed use, industrial/freight, congestion, transit, flood, cadastre/zoning, selection, miniature effect. |
| 29 — Electron/Pixi/DOM Retirement | **Blocked** | Explicit Stack 4 stop condition: Alpha-authoritative domains are still TypeScript-owned on the current base. Compatibility production runtime must remain until consolidated native authority passes final gate. |
| 30 — Prism Authority Declaration | **Blocked** | Forbidden until native kernel/world/cadastre/urban/transport/personhood/economy/persistence/client authority is factual and verified with no TypeScript authoritative simulation state. |

## Verification evidence

The dedicated `C++ Native Presentation` workflow covers:

- Clang C++23 build;
- ASan/UBSan-enabled native tests;
- native visual-reference generation;
- large-city presentation benchmark;
- WASM reference fixture;
- MSVC Debug + Release native client build;
- CTest contract/invariant suite;
- Windows package staging and reproducible ZIP generation;
- package-boundary checks forbidding Electron/Node/Pixi artifacts;
- offline asset-manifest and PDB/symbol checks.

A verified green baseline after the Alpha placement-tool completion is workflow run `33667627970`. A subsequent viewport-culling tranche produced 110/110 passing Clang tests in run `33668510710`, including `SceneGeometry.GeometryOutsideThePixelViewportIsCulledBeforeGpuUpload`, all native visual scenarios, soak tests and the presentation benchmark contract.

The final branch head must still be re-verified after later Stack 4 improvements before this document is treated as release evidence.

## Measured presentation optimization evidence

Before the retained-snapshot fast path, sanitizer benchmark run `33668510710` measured a 9,216-cell / 768-road / 1,400-building / 6,000-vehicle scene and reported:

- initial retained apply: `290648 µs`;
- unchanged retained apply: `190861 µs` despite `0` rebuilt objects;
- one-building delta retained apply: `190517 µs`;
- packet build: `27462 µs`;
- geometry build: `26688 µs`;
- authoritative kernel hash equality: `true`.

The branch now short-circuits an already-applied snapshot revision before walking all retained records. The latest CI benchmark is the required after-measurement.

## Final cutover gate

Stack 4 should only advance Tasks 29–30 after all of the following are evidenced on one consolidated branch:

1. native world/cadastre/urban authority;
2. native transportation authority;
3. native Personhood authority;
4. native economy/freight authority;
5. native services and all remaining Alpha-authoritative domains;
6. deterministic current-save continuation and replay;
7. authoritative single-thread/multi-thread hash equality where applicable;
8. native query snapshots feeding required HUD/management/analytics panels;
9. native package passes feature, visual, accessibility, performance and soak gates;
10. no shipping dependency on Electron, Node, Pixi or DOM UI.

Until then, the correct repository status is **native presentation implemented; final authority cutover blocked**.
