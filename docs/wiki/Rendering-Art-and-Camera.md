# Rendering, Art & Camera

[← Wiki Home](Home.md)

## Production rendering

**Status: Implemented production path.**

Civic Foundry uses PixiJS 8/WebGL through `GpuWorldRenderer`. The browser build remains useful for development and smoke testing, while Electron hosts the same local built application for Windows desktop.

Legacy Canvas2D renderer/pass sources are migration references rather than the main production world path.

## Presentation boundary

The renderer reads simulation state and creates terrain visuals, zoning, roads, structures, vehicles/markers, overlays, selections, and tool previews. It cannot create authoritative simulation outcomes or persistent facts.

Selection and picking are presentation state until a typed authoritative command validates and commits a mutation.

## Camera

The current isometric camera contract supports panning, anchored zoom, rotation, world/canvas conversion, and picking. The long-term goal is fluid movement from metropolitan overview down to parcel/building scale.

## Miniature-metropolis aesthetic

The target art direction borrows from miniature model photography: controlled depth of field, strong but subtle scale cues, physical-material surfaces, readable toy-like motion, and a city-as-model-table relationship.

Tilt-shift/depth-of-field effects should remain configurable where they reduce readability or accessibility.

## Information design

The interface should support:

```text
overview
→ spatial pattern
→ selected entity
→ causal explanation
→ history
→ action
```

Important overlay families include cadastre, zoning/envelopes, redevelopment feasibility, traffic, accessibility, transit, services, flood exposure, utilities, property values, environment, and later social outcomes.

Critical meaning should not depend on hue alone. UI scaling, reduced motion, readable contrast, keyboard-friendly interaction, and redundant icon/text/pattern cues are product requirements.

## Performance direction

Representative cities need measurable frame-time targets. Optimization may use retained GPU objects, batching, atlases, level-of-detail, culling, revision-based rebuilds, reduced overlay geometry, and presentation interpolation without altering authoritative simulation state.