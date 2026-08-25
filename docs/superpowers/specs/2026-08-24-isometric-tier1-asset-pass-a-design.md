# Civic Foundry — Isometric Tier 1 Asset Pass A Design

## Status

Approved in chat on 2026-08-24.

This specification defines **Pass A — Isometric Foundation + Tier 1 North American Asset Pack** for Civic Foundry. It is intentionally presentation-first. The authoritative simulation, V7 save format, deterministic economics, routing, zoning, housing, redevelopment, transit, services and freight behavior remain unchanged.

The pass establishes the rendering and asset contracts required for later visual-production passes. Later passes may expand asset breadth, district identity, nighttime rendering, weather, pedestrians, richer infrastructure and analytical UI art, but they must conform to the contracts defined here unless a separately reviewed migration explicitly replaces them.

## Product Goal

Replace Civic Foundry's current primitive top-down Canvas city representation with a coherent, production-ready **all-raster 2D isometric city renderer** using original North American metropolitan art.

The player should be able to read the city visually at normal gameplay zoom and distinguish:

- residential, commercial and industrial land uses;
- low, medium and high development intensity;
- roads and road hierarchy;
- active construction;
- civic and utility facilities;
- vegetation and basic public realm;
- passenger, freight, transit and service traffic;
- zoning and analytical overlays;
- redevelopment and physical urban growth.

The visual layer must support the simulation rather than manufacture simulation outcomes.

## Scope Boundary

### In scope

- true 2:1 isometric projection;
- four camera orientations;
- isometric world-to-screen and screen-to-world picking;
- depth-sorted raster composition;
- raster atlas loading and caching;
- machine-readable presentation asset manifest;
- deterministic visual-variant selection;
- terrain tile family;
- zoning visualization compatible with isometric projection;
- local, collector and arterial road autotile families;
- residential/commercial/industrial low-, medium- and high-intensity building families;
- baseline construction-stage visuals;
- baseline civic/service and utility visuals;
- baseline vegetation;
- baseline passenger, commercial/freight, transit and emergency/service vehicles;
- fallback/debug rendering for missing or invalid assets;
- asset validation tests;
- visual smoke scenes and repetition checks;
- preservation of current gameplay and save semantics.

### Out of scope for Pass A

- new simulation systems;
- new building gameplay categories beyond those already represented by authoritative state;
- mixed-use simulation changes;
- new road classes beyond local/collector/arterial;
- highways, bridges, tunnels, ramps and lane-aware geometry;
- full parking simulation visuals;
- full pedestrian system;
- nighttime production variants beyond manifest support;
- weather effects;
- large landmark program;
- regional architectural packs beyond the first North American baseline;
- full SVG UI icon replacement;
- full professional overlay redesign;
- high-volume decorative prop production.

Those belong to later passes unless a small supporting asset is required to make Pass A visually coherent.

## Existing Repository Constraints

The current production renderer is browser-native Canvas 2D and uses a 24 px orthographic square-cell projection. Terrain, roads, buildings and facilities are currently drawn with primitive fills and strokes. There is no existing image/sprite asset pipeline.

Current authoritative gameplay state already includes:

- grid terrain;
- local, collector and arterial roads;
- residential, commercial and industrial zoning;
- low/medium/high building variants per zone;
- building construction state;
- utilities and public services;
- traffic vehicles, service vehicles, transit vehicles and freight vehicles;
- traffic, service, transit, economy, land and housing overlays;
- four-way renderer rotation;
- click selection, zoning/building tools, bulldozing and Manhattan road drag placement.

Pass A must preserve these mechanics and their current deterministic state ownership.

## Architecture Decision

Civic Foundry will use an **all-raster isometric world asset system**.

Terrain, roads, buildings, infrastructure-facing structures, vehicles, vegetation, construction stages and world props are rendered from transparent raster sprites or sprite-atlas regions.

Canvas remains the runtime compositor responsible for:

- camera transforms;
- sprite placement;
- depth sorting;
- zoom and pan;
- selection highlights;
- analytical overlays;
- debug/fallback drawing.

Canvas primitives are no longer the intended production representation for normal city assets after Pass A, but they remain a safe fallback path.

## Projection Contract

### Logical tile geometry

Use a fixed **2:1 isometric diamond**.

At 1× display scale:

- logical tile width: **64 px**;
- logical tile height: **32 px**.

Source ground art is authored at **128×64 px** and displayed at 50% scale at 1× gameplay zoom. This gives headroom for high-DPI displays and controlled zoom without forcing oversized runtime tiles.

### World projection

For an unrotated world cell `(x, y)`:

- screen X is proportional to `(x - y) * tileWidth / 2`;
- screen Y is proportional to `(x + y) * tileHeight / 2`.

The camera layer owns pan and zoom after projection.

The projection utility must be the single source of truth used by world rendering, overlays, path previews, selection and hit-testing.

### Camera rotation

The existing four quarter-turn orientations remain supported.

Rotation transforms world coordinates before isometric projection. The simulation coordinate system remains unchanged.

Symmetric sprites may reuse artwork when visually valid. Asymmetric assets must expose explicit orientation frames in the manifest.

### Picking

Screen-to-world picking must use the inverse isometric transform plus a diamond containment check. It must resolve to the same authoritative cell used by the existing tools.

Selection, inspection, zoning, service placement, utility placement, bulldozing, transit-stop placement and road dragging must continue to target simulation cells, not approximate screen-space sprites.

### Pan and zoom

The current approximate zoom range, **0.45× to 2.5×**, remains supported.

Zoom anchoring must remain cursor-centered. Pan behavior remains screen-space translation.

## Depth and Draw Order

The scene is rendered in deterministic ordered layers.

Recommended layer order:

1. terrain ground;
2. terrain-edge/water-edge details where present;
3. zoning underlay;
4. road and sidewalk ground tiles;
5. parcel-ground details;
6. low props and road furniture;
7. buildings, facilities and vegetation;
8. moving vehicles;
9. construction overlays/equipment where stage requires them;
10. analytical overlays;
11. path preview, hover and selection;
12. debug fallback information.

Within elevated world-object layers, primary depth key is rotated-world `x + y`. Secondary keys are layer/elevation metadata and deterministic entity identity.

No ordering rule may depend on frame timing or nondeterministic collection traversal.

## Asset Bible

### Geographic baseline

Pass A uses a **general North American metropolitan** visual language.

Representative forms include:

- detached wood/siding suburban housing;
- brick and masonry townhouses/rowhouse-adjacent forms;
- walk-up and postwar multifamily forms;
- contemporary mid-rise infill;
- curtain-wall and masonry commercial towers;
- tilt-up and metal logistics/warehouse forms;
- steel/concrete industrial plants;
- recognizable but fictional municipal and utility architecture;
- familiar North American road markings and streetscape conventions.

No real-world logos, brands or identifiable copyrighted buildings are used.

### Scale

- ground source tile: 128×64 px;
- displayed ground tile at 1×: 64×32 px;
- approximate floor height: 20–24 source pixels before high-rise vertical compression;
- passenger vehicles: roughly 28–34 source pixels long;
- buses/trucks: roughly 34–48 source pixels long;
- pedestrians, if used as incidental source elements in Pass A: 8–12 source pixels tall;
- mature street trees: roughly 32–50 source pixels tall.

Scale is judged by consistency across families, not by photogrammetric precision.

### Lighting

Use one shared daylight condition:

- sun from upper-left / northwest in screen space;
- cast shadows to lower-right / southeast;
- moderate-soft shadow edges;
- restrained ambient occlusion;
- no asset-local conflicting light direction.

### Materials

Use simplified, physically believable rendering of:

- brick;
- concrete;
- glass;
- painted metal;
- asphalt;
- stone;
- wood/siding;
- roofing membrane;
- vegetation.

Texture detail must remain subordinate to silhouette, land-use readability and density recognition.

### Windows

Windows are represented as grouped facade rhythms rather than high-frequency microscopic panes. Towers may use stronger light/dark facade bands, but avoid moire-producing detail at normal zoom.

### Palette

- terrain: muted and low-contrast;
- architecture: slightly stronger but restrained saturation;
- roads/infrastructure: darker and visually stable;
- zoning/diagnostic overlays: higher informational contrast;
- status warnings: high visibility without oversized symbols.

### Wealth and condition

Wealth and condition are communicated through material quality, facade complexity, landscaping, maintenance, parking treatment and public-realm quality.

Lower-value districts must not be represented as generic ruin. Hue shifting alone is insufficient to communicate wealth or condition.

### Signage

Signage is fictional, generic and sparse. Tiny unreadable generated text is prohibited.

## Asset Manifest

Introduce a machine-readable presentation manifest. The exact serialization may be JSON or typed TypeScript data, but it must be generated/loaded through one normalized runtime interface.

Each sprite entry supports at least:

```ts
type AssetManifestEntry = Readonly<{
  assetId: string;
  atlasId: string;
  sourceRect: { x: number; y: number; width: number; height: number };
  footprint: { width: number; height: number };
  anchor: { x: number; y: number };
  category: string;
  subcategory?: string;
  zone?: 'residential' | 'commercial' | 'industrial';
  intensity?: 'low' | 'medium' | 'high';
  qualityTier?: 'economy' | 'standard' | 'premium' | 'luxury';
  condition?: 'new' | 'maintained' | 'aging' | 'neglected' | 'abandoned';
  constructionStage?: string;
  orientation?: 0 | 1 | 2 | 3;
  animation?: { frames: number; frameTicks: number };
  nightVariantAssetId?: string;
  weight?: number;
  tags?: readonly string[];
}>;
```

Pass A may omit optional dimensions that are not yet consumed, but the normalized schema must preserve forward compatibility for later passes.

The manifest is authoritative only for presentation. It cannot change capacity, cost, rent, tax base, service radius, road speed, vehicle behavior or any other gameplay property.

## Asset Directory Contract

Follow the existing repository structure without unrelated reorganization. Introduce a dedicated world-art hierarchy under a single asset root, for example:

```text
assets/
  atlases/
    terrain/
    roads/
    buildings/
    civic/
    utilities/
    vehicles/
    vegetation/
    construction/
  manifests/
```

If build-tool constraints make a `src/assets/` or other colocated root materially simpler, the implementation plan may choose that location, but the hierarchy and naming rules must remain consistent.

### Naming

Use descriptive machine-readable IDs and filenames, for example:

```text
terrain_grass_01
road_local_mask_05
res_low_detached_01
res_mid_walkup_02
res_high_tower_01
com_low_corner_01
ind_mid_warehouse_01
civic_fire_station_01
vehicle_sedan_01
construction_structure_mid_01
```

Avoid generic names such as `building1`, `final2`, `thing` or `newasset`.

## Atlas Loader and Runtime Registry

Introduce one focused asset-loading subsystem responsible for:

- loading atlas images once;
- validating dimensions and manifest rectangles;
- resolving asset IDs;
- caching image handles;
- returning immutable sprite metadata;
- exposing readiness/failure state;
- supplying fallback sprites when assets are missing or invalid.

Rendering code must not scatter raw file-path strings throughout `WorldRenderer`.

Asset load failure must not crash the simulation loop.

## Deterministic Variant Selection

Visual variation must be stable across frames and save/load without becoming new authoritative simulation state.

Variant selection should derive from stable inputs such as:

- building ID or lot ID;
- zone;
- building definition ID/intensity;
- cell coordinates;
- current orientation;
- presentation manifest weights.

A stable hash selects among eligible variants. Random browser RNG is prohibited for persistent visual choice.

If authoritative building identity is replaced by redevelopment, the resulting visual family may change according to the new building definition and current stable identity.

## Terrain System

Pass A creates a minimum terrain atlas for currently supported biomes:

- grass;
- forest ground;
- rock;
- water.

Terrain must tile seamlessly in normal maps.

Forest and rock may use restrained overlays or edge details, but the pass should not over-invest in decorative terrain before building and road readability is complete.

Water must remain visibly distinct without excessive animated noise.

## Road Autotile System

Roads use **4-bit cardinal connectivity masks** derived from north/east/south/west same-network connectivity.

The raster family must support the logical cases represented by the 16 masks:

- isolated;
- end caps;
- straight;
- corners;
- T junctions;
- four-way intersections.

Each current road class has its own family:

- local;
- collector;
- arterial.

Road hierarchy should be visually obvious through carriageway width, markings, curb/sidewalk treatment and median/edge treatment where appropriate.

At source scale, approximate carriageway occupancy of the tile diamond is:

- local: ~55%;
- collector: ~68%;
- arterial: ~82%.

The implementation may normalize masks across camera rotation to reduce duplicated atlas regions where the artwork is rotationally equivalent.

Road visuals must be selected from current topology only. Rendering must not alter graph connectivity.

## Sidewalk and Ground-Edge Treatment

Pass A uses integrated road-edge and parcel-edge treatment rather than a fully independent sidewalk-placement system.

Road sprites should provide coherent curb/sidewalk interfaces where the road class implies them. Building sprites must not bake large incompatible sidewalk slabs into every footprint.

The contract should allow a later dedicated public-realm system without forcing Pass A atlas replacement.

## Building Families

Pass A maps the nine current gameplay building definitions to broader visual families.

### Residential

Low intensity:
- detached/suburban houses;
- modest older urban houses;
- duplex-adjacent variants where footprint permits.

Medium intensity:
- rowhouse/townhouse-like urban fabric;
- walk-up apartment blocks;
- compact multifamily forms.

High intensity:
- mid/high-rise apartment buildings;
- residential tower/podium forms;
- restrained postwar/contemporary tower variation.

### Commercial

Low intensity:
- corner retail;
- neighborhood shops;
- small office/service buildings.

Medium intensity:
- mixed commercial blocks visually compatible with current commercial-only simulation state;
- office blocks;
- small hotels/retail complexes.

High intensity:
- office towers;
- hotel/financial-tower forms;
- generic corporate high-rise forms.

### Industrial

Low intensity:
- workshops;
- repair/light-industrial buildings;
- small warehouses.

Medium intensity:
- distribution warehouses;
- logistics buildings;
- medium manufacturing forms.

High intensity:
- larger plants;
- processing/manufacturing campuses represented within current single-cell gameplay limits;
- denser industrial structures with rooftop/yard equipment.

### Variation target

Pass A should target at least **3 materially distinct variants per zone × intensity family** where production capacity permits, for a practical minimum of 27 core building sprites before orientation variants.

Variation must come from architecture, facade, roofline and site treatment rather than hue shifts alone.

## Footprints and Current Grid Compatibility

Current V7 building gameplay is cell-based. Pass A must not fake multi-cell authoritative footprints that the simulation does not own.

Building sprites may visually project above or slightly beyond the diamond for architectural massing, but clickable/authoritative footprint remains the existing cell.

The manifest includes footprint fields now so future 2.0 parcel/building geometry can adopt multi-tile assets without redesigning the presentation contract.

## Construction Visuals

Current authoritative building state distinguishes construction from complete operation. Pass A maps construction to a small reusable stage family.

Minimum visual states:

- prepared/site-cleared ground;
- foundation/early structure;
- structural frame;
- facade/nearing completion;
- completed building.

Where current gameplay exposes only a binary construction status plus remaining time, the renderer derives a visual stage from normalized construction progress without creating new authoritative state.

Construction stage art may be shared across compatible zone/intensity families where necessary, but low-, medium- and high-intensity massing must remain readable.

Baseline props may include fencing, scaffolding, material stacks and one crane family.

## Civic and Utility Assets

Replace current letter/emoji facility markers with raster world assets for currently placeable facilities.

Minimum service/utility families:

- power facility;
- water facility;
- landfill / waste facility;
- fire station;
- police station;
- clinic;
- elementary school;
- recycling center.

Each must remain recognizable at normal zoom without oversized floating icons.

Gameplay tool names and service mechanics remain unchanged.

## Vegetation

Pass A includes a compact vegetation family:

- young street tree;
- mature street tree;
- large park/forest tree;
- shrubs/low greenery where useful.

Vegetation must obey the shared lighting direction and must not obscure critical building/road readability.

Forest terrain may place deterministic vegetation sprites derived from cell coordinate and terrain biome.

## Vehicle Assets

Replace primitive vehicle rendering with raster sprites while preserving current movement and routing.

Minimum families:

Passenger/commercial:
- compact/sedan;
- SUV/pickup;
- delivery van;
- box truck;
- semi/freight truck.

Transit:
- bus;
- BRT vehicle;
- tram vehicle representation where current route renderer supports it;
- metro may remain represented by station/route UI if underground in the current view.

Public/service:
- fire engine;
- police vehicle;
- ambulance;
- garbage truck.

Vehicle orientation must follow edge travel direction and camera rotation.

Visual variants may be deterministic per vehicle identity.

## Zoning and Analytical Overlays

Pass A does not redesign the analytical model. It reprojects existing overlays into isometric space.

Zoning becomes transparent diamond/parcel coloration under buildings where possible, preserving current zone differentiation.

Traffic, service, transit, economy, land and housing overlays must continue to use their existing authoritative/derived snapshots.

Overlay geometry must align with isometric tiles and road centers.

The overlay must never hide the city completely; opacity should preserve enough underlying structure to interpret location and urban form.

## Selection, Preview and Tool Feedback

Replace square selection and path-preview primitives with isometric equivalents.

Required states:

- selected cell diamond;
- road drag preview along projected cell diamonds;
- build/placement feedback aligned to the authoritative target cell;
- overlay interactions remain pointer-transparent where currently designed that way.

No tool should require the player to click visible sprite pixels. Gameplay remains cell-driven.

## Fallback Renderer

The runtime must include a deliberate fallback path.

If an atlas fails to load, a manifest entry is missing, or a sprite region is invalid:

- simulation continues;
- the affected entity is rendered using a simple diagnostic isometric primitive or clearly marked fallback tile;
- a development diagnostic is surfaced without flooding the console each frame.

This prevents a single bad art file from making the city unusable.

## Performance Strategy

The city may contain thousands of visible entities. Pass A must avoid per-frame asset allocation and repeated image decoding.

Required practices:

- preload/cached atlas images;
- atlas related assets instead of one network request per sprite;
- no per-frame `Image` construction;
- precomputed or cached source rectangles;
- deterministic visible-order arrays with bounded allocations;
- view culling where practical;
- no full-manifest parsing every frame;
- no frame-rate-dependent simulation behavior;
- preserve existing device-pixel-ratio-aware Canvas rendering.

Pass A should prefer several coherent atlases over one enormous monolithic texture if browser texture/memory behavior benefits from separation.

## Originality and Asset QA

All world artwork must be original.

Prohibited:

- copied Cities: Skylines, SimCity or other game assets;
- recognizable proprietary buildings;
- real brand logos;
- malformed perspective;
- inconsistent suns;
- warped windows;
- malformed vehicles;
- unreadable generated signage;
- baked checkerboards or opaque backgrounds on transparent sprites;
- visible white halos;
- arbitrary perspective changes between families.

Each production atlas must be reviewed for:

- projection consistency;
- alpha cleanliness;
- scale consistency;
- lighting consistency;
- anchor correctness;
- normal-zoom readability;
- zoomed-out readability;
- repetition under dense placement.

## Testing Strategy

### Unit tests

Add focused tests for:

- world-to-isometric projection;
- inverse projection;
- rotation mapping;
- diamond hit-testing at edges/corners;
- road connectivity masks;
- mask rotation/normalization;
- deterministic variant selection;
- manifest validation;
- invalid/missing asset fallback resolution;
- deterministic depth-order ties.

### Regression tests

Existing deterministic simulation tests must remain green.

Pass A may not change expected V7 authoritative snapshot digests solely to satisfy presentation work.

### Browser smoke tests

Expand browser smoke coverage to verify:

- game loads with asset atlases;
- canvas draws without uncaught errors;
- clicking a visible isometric tile selects the correct world cell;
- zoning still applies to the intended cell;
- road drag builds the intended Manhattan path;
- Q/E rotation preserves interaction correctness;
- zoom/pan remain usable;
- overlays render aligned to the isometric city;
- save/load continues to restore authoritative state.

### Visual smoke scenes

Create deterministic authored/debug scenarios showing:

- sparse suburban edge;
- mixed low/medium urban district;
- dense high-intensity core;
- industrial/logistics cluster;
- civic/service cluster;
- active construction;
- traffic and freight activity;
- at least one analytical overlay.

These scenes should be usable for manual screenshot comparison and future visual-regression tooling.

### Repetition test

Populate a dense area with repeated eligible buildings and verify that obvious repeating patterns are not visible every few parcels.

If repetition is excessive, add materially different variants or improve deterministic combination logic. Random hue shifting alone is not an acceptable fix.

## Integration Boundaries

Expected code boundaries for implementation planning:

- projection/camera utilities under `src/rendering/`;
- asset-manifest and atlas registry under `src/rendering/` or a focused `src/assets/` module;
- `WorldRenderer` refactored into smaller render passes rather than expanding the current ~20k-byte file further;
- vehicle renderers adapted to sprite output while retaining authoritative movement inputs;
- overlay layers updated to consume shared isometric projection helpers;
- `GameApp` input flow preserved except where it calls new projection/picking APIs;
- no direct writes from renderer into simulation state.

The implementation plan should split the current renderer before isometric complexity makes it a new monolith.

## Error Handling

- malformed manifest: reject invalid entry and use fallback, do not crash city loop;
- atlas load failure: mark atlas unavailable, fall back for dependent assets;
- missing orientation: use explicitly allowed symmetric/default orientation or fallback;
- invalid source rectangle: fail validation before normal rendering;
- projection/picking invalid numeric input: return null selection rather than mutate a wrong cell;
- unsupported future asset tag: ignore unless marked required by schema version.

## Migration Strategy

Pass A is a renderer migration, not a save migration.

Authoritative world state remains V7-compatible. No visual asset ID needs to be persisted.

On load:

1. hydrate authoritative simulation as today;
2. initialize presentation asset registry;
3. derive compatible sprite IDs from current authoritative/derived state;
4. render the city isometrically.

Older V5/V6/V7 compatibility remains unaffected because presentation is reconstructed from hydrated state.

## Production Deliverables

At the end of Pass A, the production report must list:

### Assets created

Exact atlas and manifest files plus asset counts by family.

### Gameplay systems supported

Which existing systems now have production visuals.

### Variants

Variant counts by zone/intensity, road class, vehicle class, facility and terrain family.

### Integration

Exact renderer/registry modules connected to those assets.

### Testing

Unit, regression, browser smoke and visual-scene results.

### Problems discovered

Projection, repetition, atlas, readability, performance or integration problems.

### Remaining gaps

The highest-value missing visual systems.

### Recommended next batch

Normally Pass B — Urban Depth — unless testing reveals a more urgent renderer/asset dependency.

## Pass A Acceptance Criteria

Pass A is complete only when all of the following hold:

1. Normal gameplay no longer relies on square top-down world rendering.
2. Terrain, roads, buildings, current facilities and current moving vehicle classes render through raster isometric assets or deliberate diagnostic fallback.
3. Current road networks select correct isometric autotiles for all 16 cardinal masks across all four camera orientations.
4. Low/medium/high residential, commercial and industrial intensity is visually distinguishable at normal zoom.
5. At least three materially distinct core variants exist per zone × intensity family where production scope permits, targeting 27+ core building sprites before orientation variants.
6. Construction is visually distinct from completed development and shows at least four derived progress stages plus completion.
7. Current player tools still select and mutate the same authoritative cells after projection migration.
8. Q/E rotation, zoom, pan and path preview remain correct.
9. Existing analytical overlays remain aligned and usable.
10. V7 simulation/save regression tests remain unchanged and green.
11. Asset-load failure degrades to readable fallback rendering without crashing the game.
12. Dense-city repetition testing does not reveal obvious same-sprite repetition every few parcels.
13. No production asset violates shared projection, scale, lighting, alpha or originality rules.
14. Browser smoke tests exercise the isometric interaction path.
15. The renderer remains presentation-only and does not manufacture simulation outcomes.

## Later Production Passes

After Pass A is accepted, the broader master prompt is decomposed as follows:

### Pass B — Urban Depth

- mixed-use presentation families;
- larger/future footprints;
- economy/standard/premium/luxury quality tiers;
- building condition;
- parking;
- sidewalks/public realm;
- parks;
- deeper industrial specialization;
- richer redevelopment and developer-economics states.

### Pass C — Mobility and Infrastructure

- expanded transit stations and infrastructure;
- highways/ramps/bridges;
- rail;
- freight yards;
- power/water network assets;
- richer vehicle families.

### Pass D — Analytical and UI Art

- standardized zoning and simulation overlays;
- professional legend/gradient system;
- SVG UI/status icon library;
- economic and developer pro-forma UI language.

### Pass E — Presentation Polish

- nighttime variants;
- pedestrians;
- animations;
- weather;
- effects;
- landmarks;
- district identity packs;
- final repetition reduction and long-run city visual validation.

## Final Design Principle

The isometric asset system must make the physical city a legible representation of the underlying simulation. Density, land use, road hierarchy, construction, industrial activity and redevelopment should be visible without opening a panel, while analytical overlays remain available for exact diagnosis.

The renderer may become substantially richer, but authoritative outcomes continue to come from Civic Foundry's simulation domains.