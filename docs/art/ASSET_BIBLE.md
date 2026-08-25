# Civic Foundry Isometric Asset Bible

## Scope

This document is the production contract for Civic Foundry world art beginning with **Isometric Pass A**. It governs raster world assets, their source art, atlas layout, camera compatibility, scale, lighting, naming, transparency, deterministic variant selection, and QA.

The authoritative simulation remains grid-based and deterministic. Art communicates simulation state; it does not create gameplay state.

## Projection

- Projection: fixed **2:1 isometric**.
- Logical gameplay tile at zoom 1: **64×32 px**.
- Ground source-art tile: **128×64 px**.
- Authoritative building footprint in V7: **1 simulation cell**.
- Camera orientations: **0, 1, 2, 3 quarter turns**.
- World coordinates are rotated before projection. Whole-canvas bitmap rotation is prohibited.
- `IsometricCamera` is the single source of truth for world→canvas, canvas→cell, tile centers, tile polygons, pan, zoom, and camera rotation.
- `worldToCanvas()` returns the **center of the authoritative cell diamond**.

## Scale

At source resolution:

- Ground tile: 128×64 px.
- Building floor rhythm: approximately 20–24 source px before high-rise compression.
- Passenger vehicles: approximately 28–34 source px long.
- Buses/trucks: approximately 34–48 source px long.
- Incidental pedestrians, when introduced later: approximately 8–12 source px tall.
- Mature street trees: approximately 32–50 source px tall.

At zoom 1, source world art is displayed at approximately 50% scale. Sprite overhang is visual only and never expands the V7 gameplay footprint.

## Camera and interaction

- Supported zoom range: **0.45×–2.5×**.
- Zoom remains cursor-centered.
- Pan is screen-space translation only.
- Picking uses inverse isometric projection plus diamond containment.
- Player tools target authoritative simulation cells, never visible sprite pixels.
- Road dragging remains the existing authoritative Manhattan path.

## Lighting

Use one shared daylight setup:

- Sun direction: upper-left / northwest in screen space.
- Cast shadows: lower-right / southeast.
- Shadow edges: moderately soft.
- Ambient occlusion: restrained.
- No asset family may introduce a conflicting sun direction.

Night variants may be added later but must preserve the same material and geometric identity.

## Geographic baseline

Pass A uses a restrained **general North American metropolitan** visual language:

- wood/siding detached housing;
- brick and masonry urban residential forms;
- postwar and contemporary multifamily buildings;
- contemporary mid-rise infill;
- masonry and curtain-wall commercial buildings;
- tilt-up/metal warehouses and logistics buildings;
- steel/concrete industrial plants;
- familiar North American road markings;
- recognizable but fictional civic and utility architecture.

Regional packs may be added later. They must form coherent clusters rather than random single-building style changes.

## Materials

Preferred simplified materials:

- brick;
- concrete;
- glass;
- painted metal;
- asphalt;
- stone;
- wood/siding;
- roof membrane;
- vegetation.

Material texture must remain subordinate to silhouette and simulation readability. Avoid microscopic noise, moiré-producing window grids, and high-frequency facade detail that disappears at normal zoom.

## Windows

- Use grouped facade rhythms.
- Towers may use stronger facade bands and grouped glazing.
- Avoid hundreds of individually emphasized panes.
- Window patterns must remain coherent when sprites are reduced to normal gameplay scale.

## Color system

Current Pass A guidance is encoded by `PASS_A_ART_BIBLE` in `src/rendering/assets/PassAAssetManifest.ts`.

Core philosophy:

- terrain: muted / low contrast;
- architecture: moderate saturation;
- infrastructure: darker and visually stable;
- overlays/status information: higher informational contrast.

Reference values in Pass A include grass `#7f956e`, forest ground `#647d59`, rock `#7d7f7d`, water `#5f88a4`, asphalt `#3f454a`, sidewalk `#b9b1a5`, lane white `#e3e0d5`, and lane yellow `#d9be69`.

## Wealth and condition

When later passes add wealth/condition states, communicate them through:

- material quality;
- maintenance;
- facade complexity;
- landscaping;
- parking treatment;
- setbacks and public realm quality.

Do not represent lower-value districts as generalized ruin. Do not use random hue shifts as the primary wealth or condition signal.

## Signage and originality

- Fictional/generic signage only.
- No real brand logos.
- No copied city-simulator assets.
- No identifiable copyrighted landmark recreation.
- No generated tiny text intended to be readable.
- Avoid distinctive proprietary UI/icon silhouettes.

All Pass A world geometry is generated from source-controlled original vector instructions in `tools/isometric_art.py` and rasterized into runtime atlases.

## Transparency

World sprites require:

- transparent background outside intended geometry;
- clean alpha edges;
- no white halo;
- no checkerboard baked into art;
- no exterior UI border.

Ground tiles use transparent pixels outside the isometric diamond where applicable.

## Atlas pipeline

Source contracts live in:

- `assets/source/terrain.svg`
- `assets/source/roads.svg`
- `assets/source/buildings.svg`
- `assets/source/construction.svg`
- `assets/source/civic.svg`
- `assets/source/utilities.svg`
- `assets/source/vegetation.svg`
- `assets/source/vehicles.svg`

The checked-in SVG files define sheet dimensions/contracts. Original vector geometry is generated deterministically by `tools/isometric_art.py`. `tools/render_isometric_atlases.py` validates the contracts and uses Playwright/Chromium to rasterize exact-size PNG atlases into:

`dist/assets/atlases/`

Runtime atlas images are generated build outputs and are not authoritative source art.

## Manifest contract

`src/rendering/assets/PassAAssetManifest.ts` is authoritative for presentation metadata only.

Each entry supplies:

- `assetId`;
- stable `variantKey`;
- `atlasId`;
- source rectangle;
- footprint;
- anchor;
- category/subcategory;
- zone/intensity where relevant;
- construction stage where relevant;
- orientation;
- weight;
- optional tags/forward-compatible presentation metadata.

Manifest metadata must never change capacity, rent, cost, speed, service coverage, employment, demand, zoning legality, or any simulation outcome.

## Variant identity

Persistent visual variation is deterministic.

- Select a stable `variantKey` from stable entity/cell identity.
- Camera orientation is **excluded** from the variant-family selection key.
- Resolve the orientation frame only after `variantKey` selection.
- Rotating the camera may change the viewed orientation frame; it must not turn a building or vehicle into a different authored design.
- Browser `Math.random()` is prohibited for persistent world-art selection.

## Roads

Current classes:

- local;
- collector;
- arterial.

Each class owns all 16 four-bit cardinal connectivity masks. Mask bits represent north/east/south/west topology. Camera rotation rotates the presentation mask only; it never changes authoritative road connectivity.

Approximate carriageway occupancy of the source diamond:

- local: 55%;
- collector: 68%;
- arterial: 82%.

Curbs, sidewalks and markings must not imply a connection that does not exist in the mask.

## Building families

Pass A provides at least three materially distinct variants for each current zone × intensity combination:

- residential low / medium / high;
- commercial low / medium / high;
- industrial low / medium / high.

Variation must come from architectural form, roofline, facade rhythm and site treatment rather than color substitution alone.

## Construction

Construction art is derived from existing authoritative construction timing.

Presentation stages:

1. `site` — 0–15%;
2. `foundation` — 15–35%;
3. `structure` — 35–70%;
4. `facade` — 70–100%;
5. `complete` — occupied building art.

These stages are presentation-only and are never persisted as new simulation state.

## Vehicles

Pass A vehicle families include private cars/SUVs, delivery/box/freight trucks, bus/BRT/tram, fire, police, ambulance and garbage vehicles.

- Four orientation frames are provided for each vehicle family.
- Orientation follows actual world travel delta after camera rotation.
- Vehicle design selection remains stable by vehicle identity.
- Underground metro remains route/station representation rather than a surface vehicle sprite.

## Performance rules

- Load each atlas once per registry preload cycle.
- Never construct images per frame.
- Cache manifest indexes and queries.
- Use atlas regions instead of one network request per sprite.
- Cull off-screen ground/object sprites conservatively.
- Avoid per-frame full-manifest scans per entity.
- Draw order must be deterministic.
- Rendering must never affect simulation tick order or RNG consumption.

## Fallback behavior

Asset failure must not crash the city loop.

- Missing entry: diagnostic fallback.
- Invalid manifest entry: diagnostic fallback.
- Failed atlas: diagnostic fallback.
- Normal asynchronous atlas loading: temporary fallback is allowed but is **not** recorded as a persistent error.
- Missing asymmetric orientation: fallback unless the asset is explicitly symmetric.

Fallback primitives are resilience/debugging only and are not acceptable substitutes for required Tier 1 production coverage.

## QA checklist

Every world-art production batch must verify:

- 2:1 projection consistency;
- correct source dimensions;
- clean alpha;
- correct anchor;
- correct gameplay footprint;
- shared scale;
- shared lighting direction;
- normal-zoom readability;
- zoomed-out readability;
- no malformed geometry;
- no proprietary logos/text;
- no unwanted generated text;
- no obvious repetition every few parcels;
- compatibility across all four camera orientations;
- no simulation-state changes introduced by presentation code.

## Pass A source of truth

Detailed approved design:

`docs/superpowers/specs/2026-08-24-isometric-tier1-asset-pass-a-design.md`

Implementation plan:

`docs/superpowers/plans/2026-08-24-isometric-tier1-asset-pass-a.md`
