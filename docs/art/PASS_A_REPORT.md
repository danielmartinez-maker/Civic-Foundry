# Civic Foundry Isometric Pass A Report

## Status

Implementation branch: `feature/isometric-pass-a`

Draft pull request: #24

Pass A code and production assets are implemented on the branch. The repository-level execution gate is still required before this report may be treated as a final acceptance certificate. The report deliberately distinguishes implemented coverage from executed verification evidence.

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

Completed building coverage is exactly 3 authored variant families for each of the 9 zone × intensity combinations, yielding 27 core completed designs before later quality/condition expansions.

Vehicle coverage is 12 families × 4 orientation frames.

## Gameplay systems supported

Pass A provides presentation support for existing authoritative systems without changing their state ownership:

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

## Variants

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

### Assets

- `src/rendering/assets/AssetTypes.ts`
- `src/rendering/assets/AssetManifestValidation.ts`
- `src/rendering/assets/AssetRegistry.ts`
- `src/rendering/assets/VariantSelector.ts`
- `src/rendering/assets/RoadAutotile.ts`
- `src/rendering/assets/ConstructionVisuals.ts`
- `src/rendering/assets/VehicleVisuals.ts`
- `src/rendering/assets/SpritePainter.ts`

Persistent visual identity uses stable `variantKey` selection. Camera orientation is resolved after family selection, so rotation does not replace a building/vehicle with a different design.

### Render passes

- `src/rendering/passes/GroundRenderPass.ts`
- `src/rendering/passes/ObjectRenderPass.ts`
- `src/rendering/passes/OverlayRenderPass.ts`
- `src/rendering/passes/SelectionRenderPass.ts`
- `src/rendering/passes/RenderOrder.ts`

`WorldRenderer` is now an orchestration/camera facade rather than a monolithic primitive city painter.

### Moving agents

The existing interpolation logic remains authoritative. Final paint is rasterized through:

- `src/rendering/VehicleRenderer.ts`
- `src/rendering/ServiceVehicleRenderer.ts`
- `src/rendering/TransitVehicleRenderer.ts`
- `src/rendering/FreightVehicleRenderer.ts`

### Land/housing overlay

`src/ui/LandHousingUiController.ts` now paints projected isometric diamonds through the same renderer coordinate contract rather than square cells.

## Testing

### Added unit tests

- `tests/isometric-projection.test.ts`
- `tests/isometric-road-autotile.test.ts`
- `tests/isometric-assets.test.ts`
- `tests/isometric-variant-selection.test.ts`
- `tests/isometric-render-order.test.ts`
- `tests/isometric-construction-visuals.test.ts`

Coverage includes projection/inverse projection, four rotations, picking, all 16 road masks, deterministic depth order, manifest validation, asset-family counts, deterministic variant selection, rotation-stable variant identity, construction progress stages, and transient preload diagnostic behavior.

### Added browser smoke

- `tests/smoke/isometric_pass_a_smoke.py`

The smoke test checks:

1. all eight generated atlases exist;
2. renderer loads without browser errors;
3. 64×32 metrics at zoom 1;
4. asset diagnostics are clean after preload;
5. click-to-zone targets the intended cell;
6. rotated click-to-zone still targets the intended authoritative cell;
7. road drag produces the existing horizontal-then-vertical Manhattan path;
8. pan moves presentation without changing roads/zoning;
9. zoom remains within 0.45–2.5;
10. traffic/economy/land-housing overlays can be switched without errors;
11. save→mutate→load restores authoritative state.

### Added visual smoke

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

The script samples rendered canvas pixels and rejects blank/near-uniform scenes. Screenshots are written under ignored `test-artifacts/isometric-pass-a/`.

### Required execution gate

The following commands must all exit 0 before Pass A is accepted:

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

At the time this report was first written, command execution evidence had not yet been obtained from the connected GitHub environment. Do not interpret implementation presence alone as a passing verification result.

## Problems discovered

### Transient preload diagnostics

The first runtime audit found that normal frames rendered before atlas preload completion could permanently record `atlas not ready` messages. That made a healthy build appear broken after assets loaded.

A regression test was added first. `AssetRegistry` now treats normal in-progress atlas loading as a temporary fallback without persisting an error; genuinely missing, invalid or failed assets still produce diagnostics.

### CI execution availability

The connected GitHub API accepted commits and exposed PR state, but did not initially surface workflow runs for connector-authored feature-branch commits. Verification therefore cannot be inferred from the absence of CI failures.

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

After Pass A verification is green, proceed to **Pass B — Urban Depth**:

- mixed-use presentation;
- quality and condition tiers;
- parking/public realm;
- parks;
- deeper industrial specialization;
- richer redevelopment/developer-economics visual states;
- additional architectural/site variants where repetition testing shows the highest need.

## Acceptance criteria

| # | Criterion | Implementation state | Execution evidence |
|---:|---|---|---|
| 1 | Normal gameplay uses isometric world presentation | Implemented | Pending full gate |
| 2 | Terrain/roads/buildings/facilities/vehicles use raster assets or deliberate fallback | Implemented | Pending full gate |
| 3 | 16 road masks × 3 classes across 4 camera orientations | Implemented | Pending full gate |
| 4 | R/C/I low-medium-high visually distinguishable | Implemented | Pending visual gate |
| 5 | 3 variants per zone × intensity, 27+ total | Implemented: 27 | Manifest test pending execution |
| 6 | Four construction stages plus completion | Implemented | Test pending execution |
| 7 | Player tools mutate the same authoritative cells | Implemented | Browser smoke pending execution |
| 8 | Rotation/zoom/pan/path preview remain correct | Implemented | Browser smoke pending execution |
| 9 | Existing overlays remain aligned/usable | Implemented | Browser smoke pending execution |
| 10 | V7 simulation/save regression remains unchanged | No simulation/save code intentionally changed | Full regression pending execution |
| 11 | Asset-load failure has readable fallback | Implemented | Unit/browser evidence pending execution |
| 12 | Dense repetition is controlled | Stable 3-family selection implemented | Visual/repetition evidence pending execution |
| 13 | Production assets follow projection/scale/light/alpha/originality contract | Implemented source pipeline | Visual review pending |
| 14 | Browser smoke exercises isometric interaction path | Test authored | Pending execution |
| 15 | Renderer remains presentation-only | Implemented architecture | Full regression pending execution |

Pass A should only be marked **accepted** after the execution-evidence column is updated from actual successful runs.
