# Civic Foundry Desktop GPU Runtime Design

**Status:** Approved direction, implementation tranche 1  
**Date:** 2026-08-27  
**Base:** `main` at the post–Urban Fabric 2.0 integration baseline

## Objective

Move Civic Foundry off its browser-native Canvas2D production renderer and establish a Windows-desktop-capable GPU runtime without rewriting authoritative simulation systems.

This tranche preserves the existing TypeScript simulation, save schema, player tools, camera semantics, UI controllers, and presentation-only authority boundary. The production world renderer becomes PixiJS/WebGL. Electron supplies the Windows desktop shell. Legacy Canvas2D renderer files may remain temporarily as non-production migration references, but the production entry path must not instantiate or call them.

## Decisions

1. **Simulation stays authoritative.** `SimulationCore`, `WorldFoundation`, cadastral systems, transportation, economy, saves, and deterministic stepping are unchanged by this renderer migration.
2. **GPU renderer:** PixiJS 8, explicitly initialized with `preference: 'webgl'` and `powerPreference: 'high-performance'`. WebGL is chosen for broad Windows GPU compatibility; WebGPU can be evaluated later behind the same presentation contract.
3. **Desktop shell:** Electron, loading only packaged local application content. Renderer windows use `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
4. **Compatibility facade:** the GPU renderer preserves the interaction-facing `WorldRenderer` API used by `GameApp` and Urban Fabric UI: pan, zoom, rotate, coordinate conversion, selection, draw, and cadastral overlay selection.
5. **Incremental visual parity:** tranche 1 renders the complete playable base scene with terrain, zoning, roads, buildings, civic/service facilities, utilities, active traffic/service/transit/freight markers, selection, road preview, and high-level overlay tinting. Atlas/sprite parity and specialized overlay fidelity migrate in later GPU passes.
6. **No presentation authority:** the GPU renderer consumes `SimulationCore` state but cannot mutate simulation outcomes. Input mutations continue through `GameApp`/`ToolController` into simulation APIs.
7. **No Canvas2D in the production path:** `GameApp` imports the GPU renderer facade. Production code must not call `getContext('2d')` during normal startup or frame rendering.
8. **Existing browser build remains a supported development target** because Electron packages the same local renderer bundle. Windows desktop is the distribution target.

## Runtime Architecture

```text
Electron Main Process
  -> local packaged index.html
     -> src/main.ts
        -> GameApp
           -> SimulationCore (authoritative)
           -> GpuWorldRenderer / PixiJS WebGL (read-only presentation)
           -> existing DOM HUD / inspector / tools
```

The Electron process does not own simulation state. It is a secure host only. No generic IPC surface is introduced in this tranche.

## Renderer Contract

`GpuWorldRenderer` exposes the operational API currently consumed by application/UI code:

- `canvas: HTMLCanvasElement`
- `cellSize`, `tileWidth`, `tileHeight`, `zoom`, `quarterTurns`
- `setUrbanFabricOverlay(mode, selectedParcelId?)`
- `pan(dx, dy)`
- `zoomBy(factor, anchorX, anchorY)`
- `rotate(direction)`
- `worldToCanvas(x, y, core)`
- `worldMetersToCanvas(point, core)`
- `canvasToCell(clientX, clientY, core)`
- `tilePolygon(x, y, core)`
- `draw(core, overlays..., selection, previewPath...)`

Initialization is asynchronous internally. Calls made before PixiJS is ready are safe no-ops for drawing while camera/input transforms remain available synchronously.

## GPU Scene

The first GPU pass uses persistent PixiJS `Graphics` objects grouped into ordered containers:

1. terrain
2. zoning
3. roads
4. objects
5. vehicles
6. overlays
7. selection / preview

Geometry is rebuilt from authoritative snapshots only when `draw()` is called. This is deliberately simple for the first cutover. Follow-up optimization will use retained scene objects and dirty-region updates after parity is established.

### Base visual mapping

- terrain biome -> stable biome color; water/non-buildable terrain visually distinct
- zoning -> translucent zone diamonds
- road class -> class-specific road diamonds/center strokes
- buildings -> extruded isometric blocks sized by building intensity/status
- service/utility facilities -> distinct isometric blocks/markers
- traffic/service/transit/freight -> small GPU markers projected through `IsometricCamera`
- selected cell and preview path -> GPU outlines/fills
- active overlays -> presentation-only tint/markers from existing overlay mapper outputs where practical

## Desktop Packaging

Tranche 1 adds an Electron entrypoint and package metadata sufficient to launch the built game as a Windows desktop app in development/CI-compatible environments. Packaging configuration targets Windows x64. Installer signing is explicitly out of scope for this tranche.

The desktop window:

- loads only the repository's built `dist/index.html`
- uses no remote URL
- disables Node integration in the renderer
- enables context isolation and sandboxing
- denies unexpected navigation/window creation

## Build Strategy

The current static TypeScript build cannot directly ship bare npm package imports such as `pixi.js`. Introduce Vite as the renderer bundler while preserving the existing generated-asset pipeline and `dist/` output contract.

- `npm run build` produces renderer assets in `dist/`
- atlas generation remains part of the build/verification pipeline
- `npm run dev` runs the Vite development server
- `npm run desktop` launches Electron against the built local renderer
- `npm run desktop:pack` creates a Windows package

Existing deterministic/unit tests continue to run with Node's TypeScript stripping. New runtime contract tests inspect the desktop/GPU integration without requiring a graphical CI session.

## Test / Acceptance Gates

1. Contract test proves the production `GameApp` imports the GPU renderer and the GPU renderer has no Canvas2D context acquisition.
2. Renderer camera/input contract remains covered by existing isometric tests.
3. Desktop contract test proves Electron security settings and local-file loading.
4. Build contract test proves package scripts/dependencies and Vite/Electron entry points are present.
5. `npm run typecheck`, `npm test`, architecture policy, asset checks, and production build pass.
6. No save-version change and no authoritative simulation module modified.

## Non-goals for Tranche 1

- rewriting simulation systems for a native engine
- save-format migration
- multiplayer/networking
- GPU compute simulation
- perfect sprite-atlas parity with every Canvas pass
- installer code signing / auto-update infrastructure
- deleting all legacy Canvas renderer source before equivalent GPU passes exist

## Follow-on Tranches

1. GPU sprite/atlas parity and retained-scene optimization.
2. Full specialized traffic/service/transit/economy/cadastral overlay parity.
3. Native desktop save-file slots and settings through a minimal validated preload bridge.
4. Windows installer/release workflow and GPU compatibility telemetry.
5. Optional WebGPU backend evaluation behind the same renderer contract.
