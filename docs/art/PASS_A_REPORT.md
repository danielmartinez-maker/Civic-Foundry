# Civic Foundry Isometric Pass A Report

## Status

Implementation branch: `feature/isometric-pass-a`

Draft pull request: #24

**Pass A is implementation-complete and execution-verified.**

Verified implementation head: `34606505729f444429194cf1a85a793f7231ee4e`

GitHub Actions verification run: `32797828280`

That run completed successfully with all required gates green:

- **349 / 349** Node/TypeScript unit tests passed;
- TypeScript typecheck passed;
- lint gate passed;
- all 8 isometric source/atlas contracts validated;
- the production build rendered all 8 PNG atlases successfully;
- Phase 6 browser regression smoke passed;
- Phase 7 browser regression smoke passed;
- Isometric Pass A interaction smoke passed;
- Isometric Pass A eight-scene visual smoke passed.

The implementation remains presentation-only relative to authoritative game state: no simulation, save-schema, economy, zoning-state, road-state, or world-state ownership was moved into rendering.

## Assets created

Source-contract sheets:

- `assets/source/terrain.svg`
- `assets/source/roads.svg`
- `assets/source/buildings.svg`
- `assets/source/construction.svg`
- `assets/source/civic.svg`
- `assets/source/utilities.svg`
- `assets/source/vegetation.svg`
- `assets/source/vehicles.svg`

Original deterministic vector source generation:

- `tools/isometric_art.py`

Raster build pipeline:

- `tools/render_isometric_atlases.py`

Generated runtime atlases:

- `dist/assets/atlases/terrain.png`
- `dist/assets/atlases/roads.png`
- `dist/assets/atlases/buildings.png`
- `dist/assets/atlases/construction.png`
- `dist/assets/atlases/civic.png`
- `dist/assets/atlases/utilities.png`
- `dist/assets/atlases/vegetation.png`
- `dist/assets/atlases/vehicles.png`

Presentation manifest:

- `src/rendering/assets/PassAAssetManifest.ts`

### Manifest counts

The Pass A manifest contains **161 presentation entries**:

| Family | Entries |
|---|---:|
| Terrain | 8 |
| Road autotiles | 48 |
| Completed building variants | 27 |
| Construction stages | 12 |
| Civic/service facilities | 6 |
| Utilities | 3 |
| Vegetation | 9 |
| Vehicle orientation frames | 48 |
| **Total** | **161** |

Road coverage is 16 cardinal masks for each of local, collector and arterial classes.

Completed building coverage is 3 authored variant families for each of the 9 zone × intensity combinations, yielding 27 completed core designs before later quality/condition expansions.

Vehicle coverage is 12 families × 4 orientation frames.

## Gameplay systems supported

Pass A provides visual support for the existing authoritative systems without changing their state ownership:

- terrain and biomes;
- zoning underlay;
- local / collector / arterial road topology;
- residential / commercial / industrial buildings;
- low / medium / high building intensity;
- building construction progress;
- current public-service facilities;
- current utility facilities;
- forest/vegetation presentation;
- private road traffic;
- freight vehicles;
- service vehicles;
- surface transit vehicles;
- traffic overlays;
- public-service overlays;
- transit overlays;
- economy/freight overlays;
- land/housing overlays;
- cell selection;
- road placement preview;
- pan / zoom / four-quarter-turn rotation;
- save/load interaction through the unchanged authoritative simulation.

Underground metro vehicles intentionally remain represented through route/station presentation rather than surface vehicle sprites.

## Variant library

### Buildings

Residential:

- low: 3 detached/suburban variants;
- medium: rowhouse, walk-up, courtyard variants;
- high: slab, podium, tower variants.

Commercial:

- low: corner retail, strip retail, small office;
- medium: urban block, office, hotel;
- high: office tower, hotel tower, corporate tower.

Industrial:

- low: workshop, repair, warehouse;
- medium: distribution, logistics, factory;
- high: plant, processing, manufacturing.

### Construction

For each low / medium / high intensity:

- site;
- foundation;
- structure;
- facade.

Completed development resolves to the normal completed building variant.

### Civic and utilities

Civic/service:

- fire station;
- police station;
- clinic;
- elementary school;
- landfill;
- recycling center.

Utilities:

- power;
- water;
- legacy landfill utility family.

### Vegetation

- 2 young street trees;
- 2 mature street trees;
- 3 large park/forest trees;
- 2 shrub variants.

### Vehicles

- sedan;
- SUV/pickup;
- delivery van;
- box truck;
- freight truck;
- bus;
- BRT;
- tram;
- fire engine;
- police vehicle;
- ambulance;
- garbage truck.

Each vehicle family has four orientation frames.

## Integration

### Projection and camera

- `src/rendering/isometric/IsometricProjection.ts`
- `src/rendering/isometric/IsometricCamera.ts`

The simulation continues to own `(x,y)` grid coordinates. The presentation layer rotates coordinates and projects them to a 2:1 diamond. Picking applies the inverse transform and diamond containment back to the same authoritative simulation cells.

Rotation preserves the visible viewport focus for rectangular worlds, preventing the map from jumping off-canvas when changing quarter-turn orientation.

### Assets

- `src/rendering/assets/AssetTypes.ts`
- `src/rendering/assets/AssetManifestValidation.ts`
- `src/rendering/assets/AssetRegistry.ts`
- `src/rendering/assets/VariantSelector.ts`
- `src/rendering/assets/RoadAutotile.ts`
- `src/rendering/assets/ConstructionVisuals.ts`
- `src/rendering/assets/VehicleVisuals.ts`
- `src/rendering/assets/SpritePainter.ts`

Persistent visual identity uses stable `variantKey` selection. Camera orientation is resolved after family selection, so rotation does not replace a building or vehicle with a different visual family.

### Render passes

- `src/rendering/passes/GroundRenderPass.ts`
- `src/rendering/passes/ObjectRenderPass.ts`
- `src/rendering/passes/OverlayRenderPass.ts`
- `src/rendering/passes/SelectionRenderPass.ts`
- `src/rendering/passes/RenderOrder.ts`

The compositor order is explicitly tested. Moving vehicles render above world objects, analytical overlays render above vehicles, and selection/preview information remains topmost.

`WorldRenderer` is now an orchestration/camera facade rather than a monolithic primitive city painter.

### Moving agents

Existing authoritative interpolation remains unchanged. Final paint is rasterized through:

- `src/rendering/VehicleRenderer.ts`
- `src/rendering/ServiceVehicleRenderer.ts`
- `src/rendering/TransitVehicleRenderer.ts`
- `src/rendering/FreightVehicleRenderer.ts`

### Land/housing overlay

`src/ui/LandHousingUiController.ts` now paints projected isometric diamonds through the same renderer coordinate contract rather than square cells.

## Testing and execution evidence

### Unit coverage

Added or expanded:

- `tests/isometric-projection.test.ts`
- `tests/isometric-road-autotile.test.ts`
- `tests/isometric-assets.test.ts`
- `tests/isometric-variant-selection.test.ts`
- `tests/isometric-render-order.test.ts`
- `tests/isometric-construction-visuals.test.ts`
- `tests/isometric-strip-types-compat.test.ts`

Coverage includes projection/inverse projection, all four rotations, focus-preserving rotation, picking, all 16 road masks, deterministic depth order, compositor order, manifest validation, asset-family counts, deterministic variant selection, rotation-stable visual identity, construction progress stages, atlas preload diagnostics, and Node 22 strip-types compatibility.

### Browser interaction smoke

- `tests/smoke/isometric_pass_a_smoke.py`

Verified:

1. all eight generated atlases exist;
2. renderer loads without browser errors;
3. 64×32 metrics at zoom 1;
4. asset diagnostics are clean after preload;
5. click-to-zone targets the intended authoritative cell;
6. rotated click-to-zone targets the same intended authoritative cell;
7. road drag preserves the existing Manhattan-path semantics;
8. pan changes only presentation;
9. zoom remains bounded;
10. overlays switch without browser errors;
11. save→mutate→load restores authoritative state.

Result in run `32797828280`: **PASS**.

### Visual smoke

- `tests/smoke/isometric_visual_smoke.py`

Deterministic screenshot scenes:

- `suburban_edge.png`
- `urban_mixed_density.png`
- `dense_core.png`
- `industrial_logistics.png`
- `civic_cluster.png`
- `construction.png`
- `traffic_freight.png`
- `overlay.png`

Visual QC uses Playwright canvas screenshots analyzed off-canvas with pinned Pillow, avoiding browser canvas-origin taint while retaining strict nonblank/variation checks. Every scene must exceed the screenshot-size floor, contain more than 100 visible samples, exceed a 30-point luminance range, and contain more than 20 sampled RGB colors.

Result in run `32797828280`: **PASS, 8 / 8 scenes**.

### Verified command gate

All commands below exited successfully in GitHub Actions run `32797828280`:

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:isometric
python tests/smoke/isometric_visual_smoke.py
```

## Problems discovered and fixed during execution

### Node 22 strip-types compatibility

The repository executes TypeScript tests directly through Node's strip-types mode, which rejects constructor parameter properties even when ordinary TypeScript compilation accepts them.

A RED regression test identified eight renderer offenders. All were converted to erasable TypeScript syntax, and the compatibility regression now passes.

### Compositor ordering

The initial cutover painted analytical overlays before moving vehicles and did not assign explicit overlay/selection layer ranks.

A regression test exposed the error. `RenderOrder` and `WorldRenderer` now enforce the intended world → vehicles → overlays → selection order.

### Strict optional typing

`GroundRenderPass` exposed an `exactOptionalPropertyTypes` error from indexed string access. The label generation was corrected without weakening compiler settings.

### Phase 6 browser regression drift

The legacy Phase 6 browser smoke still asserted a V6 save envelope while the repository's default serializer is V7. The smoke was corrected to validate the current V7 envelope without changing save logic or the compatibility storage key.

### Rotation on a rectangular world

The first rotated browser interaction test exposed a real camera bug: changing quarter-turns reanchored the rectangular map to a new logical origin, moving the target off-canvas.

A camera-level RED regression test was added. Rotation now preserves the world point under the visible canvas focus, and rotated interaction smoke passes.

### Tainted-canvas visual QC

Raster atlas images make direct `getImageData()` inspection unsafe under the test harness's routed browser origin. The visual smoke itself—not the renderer—failed with a browser `SecurityError`.

The QC path was changed to analyze Playwright screenshot bytes with Pillow. This preserves strict visual variance testing without requiring unsafe live-canvas pixel reads.

## Remaining gaps

Intentionally deferred to later passes:

- mixed-use art families;
- multi-cell authoritative building footprints;
- economy/standard/premium/luxury quality tiers;
- maintained/aging/neglected/abandoned condition variants;
- full parking visual system;
- richer sidewalks/public realm;
- parks and recreation depth;
- highways/ramps/bridges/tunnels;
- expanded rail/metro infrastructure;
- full UI/status icon replacement;
- professional overlay legend redesign;
- pedestrians;
- nighttime variants;
- weather and environmental effects;
- landmark program;
- regional art packs.

## Recommended next batch

Proceed next to **Pass B — Urban Depth**:

- mixed-use presentation;
- quality and condition tiers;
- parking/public realm;
- parks;
- deeper industrial specialization;
- richer redevelopment/developer-economics visual states;
- additional architectural/site variants where repetition testing shows the highest need.

## Acceptance criteria

| # | Criterion | Result |
|---:|---|---|
| 1 | Normal gameplay uses isometric world presentation | **PASS** |
| 2 | Terrain/roads/buildings/facilities/vehicles use raster assets or deliberate fallback | **PASS** |
| 3 | 16 road masks × 3 classes across 4 camera orientations | **PASS** |
| 4 | R/C/I low-medium-high visually distinguishable | **PASS** |
| 5 | 3 variants per zone × intensity, 27+ total | **PASS — 27** |
| 6 | Four construction stages plus completion | **PASS** |
| 7 | Player tools mutate the same authoritative cells | **PASS** |
| 8 | Rotation/zoom/pan/path preview remain correct | **PASS** |
| 9 | Existing overlays remain aligned/usable | **PASS** |
| 10 | V7 simulation/save regression remains unchanged | **PASS** |
| 11 | Asset-load failure has readable fallback | **PASS** |
| 12 | Dense repetition is controlled by stable variant selection | **PASS for Pass A target** |
| 13 | Production assets follow projection/scale/light/alpha/originality contract | **PASS for Pass A source pipeline** |
| 14 | Browser smoke exercises isometric interaction path | **PASS** |
| 15 | Renderer remains presentation-only | **PASS** |

**Pass A acceptance status: ACCEPTED.**
