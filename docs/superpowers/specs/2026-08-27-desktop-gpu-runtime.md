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
8. **Existing browser build remains a supported development target** because Electron hosts the same local renderer output. Windows desktop is the distribution target.
9. **Preserve the dependency-minimal build shape.** Do not introduce a bundler in tranche 1. The existing TypeScript compiler remains the source compiler; the build copies PixiJS's browser ESM distribution to `dist/vendor/` and resolves the bare `pixi.js` import through an import map.

## Runtime Architecture

```text
Electron Main Process
  -> local built dist/index.html
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

## Desktop Runtime

Tranche 1 adds an Electron entrypoint and package metadata sufficient to launch the built game as a native Windows desktop window. Creating a signed installer is a later release-engineering tranche; this tranche establishes the actual desktop runtime.

The desktop window:

- loads only the repository's built `dist/index.html`
- uses no remote URL
- disables Node integration in the renderer
- enables context isolation and sandboxing
- denies unexpected navigation/window creation
- targets current 64-bit Windows supported by Electron 44

## Build Strategy

Keep the existing `tsc` + static-copy pipeline. Extend it to copy `node_modules/pixi.js/dist/pixi.mjs` into `dist/vendor/pixi.mjs`. `index.html` receives an import map mapping `pixi.js` to `./vendor/pixi.mjs`.

- `npm run build` compiles TypeScript, copies static files/vendor ESM, and runs atlas generation
- `npm run dev` continues serving `dist/` for browser development
- `npm run desktop` builds then launches Electron against the local `dist/` output
- Windows packaging/signing is not part of tranche 1

Existing deterministic/unit tests continue to run with Node's TypeScript stripping. New runtime contract tests inspect desktop/GPU integration without requiring a graphical CI session.

## Test / Acceptance Gates

1. Contract test proves the production `GameApp` imports the GPU renderer and the GPU renderer has no Canvas2D context acquisition.
2. Renderer camera/input contract remains covered by existing isometric tests.
3. Desktop contract test proves Electron security settings and local-file loading.
4. Build contract test proves package scripts/dependencies, import map, Pixi vendor copying, and Electron entry point are present.
5. `npm run typecheck`, `npm test`, architecture policy, asset checks, and production build pass.
6. No save-version change and no authoritative simulation module modified.

## Non-goals for Tranche 1

- rewriting simulation systems for a native engine
- save-format migration
- multiplayer/networking
- GPU compute simulation
- perfect sprite-atlas parity with every Canvas pass
- signed Windows installer / auto-update infrastructure
- deleting all legacy Canvas renderer source before equivalent GPU passes exist

## Follow-on Tranches

1. GPU sprite/atlas parity and retained-scene optimization.
2. Full specialized traffic/service/transit/economy/cadastral overlay parity.
3. Native desktop save-file slots and settings through a minimal validated preload bridge.
4. Windows installer/release workflow and GPU compatibility telemetry.
5. Optional WebGPU backend evaluation behind the same renderer contract.
