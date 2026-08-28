# ADR 0002: Desktop GPU Runtime

- Status: Accepted
- Date: 2026-08-27

## Context

Civic Foundry's authoritative simulation, persistence, world, cadastral, transportation, economy, and municipal systems are implemented in deterministic TypeScript and already have substantial regression coverage. The production presentation path, however, remained tied to browser Canvas2D even though the project now targets a full Windows desktop city-builder experience with a freely orbitable/zoomable isometric presentation and substantially richer rendering requirements.

A clean-slate engine rewrite would put validated simulation/save authority at unnecessary risk. The existing static TypeScript build also deliberately avoids a general-purpose bundler, so introducing a GPU library must preserve browser-native ES-module development and the repository's deterministic build shape.

## Decision

Civic Foundry adopts the following presentation/runtime architecture for the first desktop migration tranche:

1. `SimulationCore`, `WorldFoundation`, `CadastralGraph`, persistence, and all other authoritative gameplay domains remain unchanged by the renderer migration.
2. `GpuWorldRenderer` is the production world-rendering facade and uses PixiJS 8 with WebGL selected explicitly through `preference: 'webgl'` and `powerPreference: 'high-performance'`.
3. The renderer remains a read-only presentation consumer. Gameplay mutations continue to enter through application/tool boundaries and authoritative simulation APIs.
4. `IsometricCamera` remains the projection/input contract so pan, anchored zoom, rotation, world/canvas conversion, and cell picking are preserved across the renderer cutover.
5. Electron is the Windows desktop host. It loads only the built local `dist/index.html`, uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`, and exposes no generic IPC bridge in this tranche.
6. Civic Foundry continues to compile browser-native ES modules with the existing TypeScript/static-copy pipeline. PixiJS's browser ESM distribution is copied into `dist/vendor/pixi.mjs` and the bare `pixi.js` specifier is resolved through a local HTML import map.
7. No CDN runtime dependency is introduced. No TypeScript `paths` alias is introduced.
8. Existing Canvas2D renderer files may remain temporarily as migration references, but the production `GameApp` path does not instantiate them.
9. Save V9 and all authoritative identity/ownership rules remain unchanged.
10. Signed installer packaging, auto-update infrastructure, full sprite-atlas parity, retained-scene optimization, and optional WebGPU evaluation are separate follow-on decisions/tranches.

## Consequences

Civic Foundry can now run the same authoritative TypeScript game inside a GPU-rendered browser development target and a hardened local Electron desktop window. The migration avoids a simulation rewrite and keeps save compatibility intact while creating a presentation boundary that can support richer city-scale rendering.

The static build now has one approved import-map dependency-resolution seam and must vendor the exact PixiJS browser module declared by the committed lockfile. Any additional import-map entries should remain narrow, local, version-pinned dependencies rather than becoming an unreviewed substitute for a package/build architecture.

Renderer initialization is asynchronous, so presentation startup must tolerate the GPU application becoming ready after `GameApp` construction. Browser and visual smoke coverage remain required because type/unit tests alone cannot prove WebGL runtime behavior.

Legacy Canvas2D presentation code is technical migration debt until equivalent GPU passes exist or the legacy sources are deleted. Specialized overlay fidelity, sprite/atlas parity, performance optimization, Windows installer/signing, and WebGPU remain intentionally deferred.

## Follow-on status: GPU Presentation Phase 2

The retained-scene follow-on implements the sprite/atlas portion that item 10 originally deferred without changing the accepted authority boundaries above.

- `PASS_A_ASSET_MANIFEST` is the production base-scene asset identity authority.
- `GpuAssetRegistry` loads the deterministic atlases once and exposes cached Pixi subtextures and diagnostics.
- terrain, roads, buildings, construction, civic facilities, utilities, vegetation, and surface vehicles render as Pixi sprites derived from canonical deterministic presentation helpers;
- static display objects are retained by stable presentation key and updated in place when fingerprints change;
- moving private, service, transit, and freight sprites use bounded reusable pools rather than per-frame allocation;
- camera pan/zoom and unchanged redraws update transforms without replacing static sprite identity;
- zoning, selection/tool previews, and the existing generic analytical-overlay seam remain vector presentation layers pending the specialized overlay parity tranche;
- `debugSceneStats()` is presentation-only instrumentation and owns no simulation or persistence state.

The Phase 2 regression gate explicitly verifies retained identity in the compiled browser runtime and keeps the inherited Phase 6, Phase 7, Urban Fabric, isometric browser, and isometric visual gates intact. Legacy Canvas2D sources remain migration references until specialized GPU overlay parity and the explicit zero-use removal audit are complete.
