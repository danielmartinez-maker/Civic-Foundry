# Civic Foundry GPU Visual Parity & Retained Scene Design

**Status:** Approved design  
**Date:** 2026-08-27  
**Base:** `main` at `c2e7befd9174b65dadc90e1e381d892accf780c6`  
**Phase:** Desktop GPU migration follow-on 2

## Objective

Replace the temporary geometry-first PixiJS presentation with the established deterministic isometric atlas art pipeline while introducing retained GPU scene objects that avoid recreating unchanged presentation state every frame.

This phase preserves every authoritative simulation, world, cadastral, transportation, economy, persistence, and tool boundary. It is a presentation migration only.

## Required outcomes

1. The production renderer continues to be `GpuWorldRenderer` using PixiJS/WebGL.
2. Terrain, roads, buildings, construction stages, civic facilities, utilities, vegetation, and vehicles use the existing `PASS_A_ASSET_MANIFEST` identities and deterministic selection rules.
3. The GPU renderer does not create a second asset manifest, variant system, road mask system, construction stage system, or depth-order authority.
4. Static presentation objects are retained and reused across draws when their presentation fingerprints are unchanged.
5. Dynamic vehicle presentation uses bounded pooling/reuse rather than unconditional object destruction and recreation.
6. Camera transforms, selection, tool previews, rotation, and input picking remain compatible with the current `IsometricCamera` contract.
7. No Canvas2D context is acquired on the production path.
8. Existing browser and visual smoke suites remain valid acceptance gates; GPU-specific parity/performance contracts are additive.

## Architecture

```text
SimulationCore / canonical systems (read only)
        |
        v
GpuWorldRenderer
  -> GpuAssetRegistry
     -> PASS_A_ASSET_MANIFEST
     -> PixiJS atlas textures / subtextures
  -> RetainedGroundLayer
  -> RetainedObjectLayer
  -> RetainedVehicleLayer
  -> Overlay layer seam (Phase 3)
  -> Selection / preview layer
        |
        v
PixiJS WebGL renderer
```

`GpuWorldRenderer` remains the application-facing facade. New GPU helpers are rendering-domain modules only and may depend on simulation/world read interfaces; authoritative domains may not depend on them.

## Asset authority

### Canonical source

`PASS_A_ASSET_MANIFEST` remains the only asset identity/atlas-layout contract for this tranche. Existing helper logic remains canonical where already defined:

- `VariantSelector` for stable building/coordinate/orientation selection;
- `RoadAutotile` for connectivity masks and camera-rotation masks;
- `ConstructionVisuals` for stage selection;
- `RenderOrder` for deterministic object depth ordering;
- existing vehicle-family selection rules.

The GPU layer may adapt the loaded representation to PixiJS textures, but it must not fork those rules.

### `GpuAssetRegistry`

A Pixi-specific registry will:

- validate the existing manifest through the established validator;
- load each manifest atlas once through PixiJS assets/textures;
- derive subtextures from manifest `sourceRect` values;
- cache subtextures by `assetId`;
- expose deterministic query/resolve operations with equivalent diagnostics semantics;
- provide a presentation fallback when an atlas or entry cannot resolve;
- never mutate the manifest or authoritative game state.

The existing Canvas `AssetRegistry` remains available only to legacy/reference rendering until final GPU parity cleanup.

## Retained scene model

### Identity

Every retained object has a stable presentation key. Examples:

- terrain: `terrain:x,y`;
- zoning: `zone:x,y`;
- road: `road:x,y`;
- building: canonical or legacy building ID currently used by the presentation source;
- service/utility facility: facility ID;
- vegetation: deterministic coordinate identity;
- traffic/service/transit/freight vehicle: vehicle ID.

The key is presentation identity only. It cannot become simulation identity authority.

### Presentation fingerprint

Each retained entry stores a compact fingerprint of fields that affect rendering. The exact representation may be a stable string or structured comparison, but it must include only presentation-relevant state.

Examples:

- terrain: biome/buildability/water + camera orientation where relevant;
- road: type + connectivity mask + camera quarter-turn;
- building: definition/zone/status/construction stage/selected variant/orientation;
- facility: type/variant/orientation;
- vehicle: family/orientation plus its current projected position.

If identity and fingerprint are unchanged, the existing Pixi display object is reused.

### Static layers

Terrain, zoning, roads, buildings, facilities, utilities, and deterministic vegetation are retained by keyed maps. A synchronization pass performs three operations:

1. create display objects for new keys;
2. update only entries whose fingerprints or projected transforms changed;
3. remove entries whose keys disappeared.

Camera pan/zoom may update container transforms or projected transforms without rebuilding textures or replacing display-object identity. Quarter-turn rotation may invalidate orientation-sensitive fingerprints.

### Dynamic layers

Vehicle layers use object pools keyed by vehicle identity while active. When a vehicle disappears, its sprite is returned to a bounded reusable pool by presentation family. Reappearing/new vehicles reuse compatible pooled sprites where possible.

No vehicle renderer may write route progress, queue state, trip state, service state, or any simulation field.

## Visual parity requirements

### Terrain

- same deterministic terrain variant family/coordinate selection as the legacy pass;
- correct atlas subtexture and anchor;
- non-buildable non-water treatment preserved as a GPU overlay effect;
- viewport culling prevents off-screen terrain sprites from being needlessly visible/rendered.

### Roads

- same road connectivity mask calculation;
- same quarter-turn mask rotation;
- same road class asset IDs;
- no replacement with generic colored diamonds once parity is active;
- high-zoom road edge treatment may remain a lightweight GPU vector overlay if it matches current behavior.

### Buildings and construction

- same stable building variant selection;
- same construction stage calculation from building state and clock tick;
- same orientation selection rules;
- deterministic depth ordering through existing `RenderOrder` semantics;
- construction-to-complete state changes update the retained entry rather than creating parallel presentation authorities.

### Civic, utilities, vegetation

- same manifest categories/subcategories and deterministic stable/coordinate selection;
- forest vegetation is suppressed on occupied building/facility/utility/road cells exactly as in the legacy object pass;
- object ordering remains deterministic after camera rotation.

### Vehicles

- traffic, service, transit, and freight use existing vehicle-family assets and orientation rules;
- projected interpolation remains derived from existing graph/edge progress data;
- metro handling remains consistent with the current visual contract;
- sprites are pooled/reused without changing simulation identity or timing.

## Camera and transforms

`IsometricCamera` remains the sole projection/camera semantic source.

The retained renderer must preserve:

- pan delta behavior;
- anchored zoom behavior;
- center-anchored quarter-turn rotation;
- world-to-canvas and meter-to-canvas mapping;
- canvas-to-cell picking;
- selected-cell identity across zoom/rotation.

The implementation may use a Pixi container transform only if tests prove it is mathematically equivalent to the established camera contract. Otherwise display-object positions are updated from `IsometricCamera` projections.

## Culling

Use the existing isometric culling semantics where practical. Culling must be presentation-only and deterministic for a fixed camera/viewport.

At minimum:

- off-screen terrain/road cells are not visible;
- off-screen object sprites are not visible;
- culling cannot delete or mutate authoritative objects;
- returning an item to view reuses or restores the correct retained presentation object.

## Diagnostics

GPU asset diagnostics must surface:

- manifest validation errors;
- atlas load failures;
- missing asset IDs;
- invalid source rectangles or failed texture resolution.

Diagnostics are presentation diagnostics and do not enter saves or simulation determinism.

## Performance contract

This phase establishes structural performance invariants rather than a hardware-specific FPS promise.

For an unchanged deterministic scene and unchanged camera:

- a second `draw()` must not recreate retained terrain/road/building/facility/vegetation display objects;
- atlas textures/subtextures are reused;
- vehicle sprites with unchanged identity are reused;
- the number of retained display objects remains bounded by the visible/present scene plus defined pools;
- no unbounded per-frame cache growth is permitted.

Tests may expose debug counters/snapshots from the renderer, but those counters must be presentation-only and unavailable to simulation code.

## Error handling

Asset load/texture failures must not crash authoritative simulation. The renderer should use deterministic fallback presentation and report diagnostics. Initialization rejection must be observable to tests rather than causing an infinite wait loop.

A failed GPU presentation synchronization must not partially mutate simulation or save state. Renderer-owned caches may be reset and rebuilt safely from canonical read state.

## Test strategy

### Contract/unit

Add tests proving:

- production `GameApp` still resolves only `GpuWorldRenderer`;
- no production GPU module acquires a Canvas2D context;
- GPU asset resolution uses `PASS_A_ASSET_MANIFEST` rather than a duplicate manifest;
- road mask/orientation asset selection matches existing helpers;
- building/construction/vegetation variant selection matches existing helpers;
- retained identity is stable across unchanged draws;
- fingerprint changes update the existing retained object rather than duplicating it;
- removals clean keyed entries and vehicle pooling remains bounded.

### Browser functional

Extend compiled browser coverage to prove:

- atlases preload with no diagnostics;
- terrain, roads, buildings, facilities, trees, and vehicles resolve to GPU sprites;
- zoom/pan/rotate/picking remain correct;
- construction stage transitions update visuals;
- repeated unchanged draws do not increase retained-object creation counters.

### Visual

Keep the established deterministic isometric visual smoke gate. Update reference expectations only for intentional GPU parity changes, never to hide a regression.

## Repository boundaries

Expected production changes are confined to presentation/assets/tests/docs/build metadata where necessary. No direct edits are expected under:

- `src/simulation/`;
- `src/world/`;
- `src/save/`.

If an unavoidable compatibility defect is discovered in an authoritative domain, implementation stops and the defect is handled separately rather than silently expanding this phase.

## Non-goals

- specialized analytical overlay parity beyond the existing basic seam; that is Phase 3;
- save-format changes;
- simulation GPU compute;
- WebGPU backend;
- signed Windows packaging;
- renderer-driven gameplay state;
- deleting all legacy Canvas rendering files before Phase 3 parity is accepted.

## Acceptance gate

Phase 2 is complete only when:

1. the production world presentation uses deterministic atlas sprites for all listed base-scene categories;
2. retained-scene reuse tests pass;
3. asset diagnostics are clean in compiled browser smoke;
4. camera/input contracts pass;
5. `npm run verify` passes;
6. all inherited browser and visual smoke suites pass;
7. branch diff confirms no unintended authoritative simulation/world/save changes;
8. the PR is reviewed before integration into `main`.
