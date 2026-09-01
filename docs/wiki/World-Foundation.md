# World Foundation

[← Wiki Home](Home.md)

**Status: Implemented — Phase 1R.**

`WorldFoundation` is the sole authority for physical geography and terrain.

## Geography hierarchy

```text
Region
→ Municipality
→ District
→ Neighborhood
→ Block
→ legal parcels (owned by CadastralGraph)
→ buildings
```

The physical hierarchy ends at block authority. Legal parcels belong to the cadastre, not the world foundation.

## Terrain model

Authoritative terrain can include elevation, slope, aspect, soil class, soil depth, bearing capacity, bedrock depth, groundwater depth, vegetation, contamination, and surface water.

Locked engineering soil classes are:

- rock
- gravel
- sand
- loam
- clay
- alluvium
- peat
- fill/disturbed

Terrain affects construction feasibility and preparation cost.

## Deterministic world generation

Current presets include plain, river valley, basin, rolling uplands, ridge edge, and coastal lowland. Generation uses namespaced deterministic RNG so topography, soils, groundwater, and vegetation do not accidentally perturb one another.

Scenario-authored overrides can replace generated values.

## Hydrology and flooding

World Foundation includes conditioned terrain, deterministic D8-style drainage, watershed assignment, flow accumulation, generated channels, flood susceptibility, spatial channel queries, deterministic design storms, infiltration, storage, outlet export, and water-balance accounting.

Ordinary city ticks should not silently mutate static physical geography. Explicit world events such as design storms may create authoritative environmental results.

## Compatibility boundary

Inherited systems consume a legacy terrain projection where needed, but `WorldFoundation` remains the sole physical source of truth. Urban Fabric occupies the same world coordinate system and does not duplicate physical geography.

## Persistence

Phase 1R introduced Save V8 for the complete World Foundation. Current Save V9 includes the inherited V8 world envelope before restoring Urban Fabric state.

See `docs/ARCHITECTURE.md` and `docs/SAVE_FORMAT.md` for implementation and hydration details.