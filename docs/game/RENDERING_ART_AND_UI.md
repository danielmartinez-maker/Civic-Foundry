# Civic Foundry — Rendering, Art & UI

## Status summary

- GPU world renderer with PixiJS/WebGL: **Implemented production path**.
- Electron Windows desktop host: **Implemented host**.
- Existing isometric camera projection/interaction contract: **Implemented**.
- Legacy Canvas2D world renderers/passes: **Transitional reference only** on the production path.
- Full miniature/tilt-shift presentation, richer 3D-feeling camera behavior and final art polish: **Target direction unless specifically verified in code**.

## Presentation architecture

Current production path:

```text
Simulation state / snapshots
→ GpuWorldRenderer
→ PixiJS 8 / WebGL
→ local built application
→ browser development target or Electron desktop host
```

The renderer owns GPU/presentation state. It does not own gameplay state or save authority.

## Renderer boundary

Presentation may:

- read authoritative state;
- derive meshes/sprites/visual geometry;
- interpolate movement visually;
- manage selection/highlights;
- show overlays;
- show placement previews;
- convert pointer/camera coordinates;
- emit player actions toward authoritative simulation APIs.

Presentation may not:

- create a building/parcel/vehicle that simulation later treats as canonical merely because it was drawn;
- update authoritative money/population/property state directly;
- maintain an independent authoritative history;
- fabricate simulation outcomes for visual convenience.

## Current GPU runtime — Implemented

The accepted production world path uses PixiJS 8 with WebGL selected for broad Windows compatibility.

The static build copies the pinned browser ESM runtime locally. Production startup does not depend on a CDN.

The same built application runs in browser development and in Electron, preserving one authoritative TypeScript simulation path.

## Desktop shell — Implemented

Electron is a hardened local host, not a game engine process.

Current security direction includes:

- local packaged content;
- Node integration disabled in renderer content;
- context isolation enabled;
- sandboxing enabled;
- unexpected navigation/window creation denied;
- no generic gameplay IPC bridge in the current tranche.

Simulation and save state stay in the application runtime rather than being split into Electron main-process authority.

## Camera

### Current contract — Implemented

The existing `IsometricCamera` supports the production interaction/projection seam, including:

- panning;
- anchored zoom;
- rotation;
- cell/world picking;
- world-to-canvas/canvas-to-world conversion.

New presentation work should preserve interaction correctness unless an explicitly accepted camera replacement changes the contract.

### Long-term camera feel — Target

The intended city experience benefits from fluid movement between metropolitan overview and parcel/building inspection. The desired feel is a freely inspectable model-city camera with strong orbit/zoom usability.

Where the current isometric projection cannot support a proposed true-3D behavior, treat that as a deliberate renderer/camera architecture change rather than quietly pretending current isometric rotation is full 3D orbit.

## Visual identity

Civic Foundry should be visually legible as a detailed miniature city model.

Target characteristics include:

- strong readable massing at city scale;
- believable but stylized material variation;
- clean silhouettes;
- dense small-scale motion that makes the city feel alive;
- clear road/parcel/building hierarchy;
- subtle depth-of-field/tilt-shift-inspired cues where technically appropriate;
- lighting and atmospheric treatment that preserve gameplay readability;
- coherent scale cues from vehicles, street furniture and buildings.

The miniature concept should make the city pleasant to watch without obscuring analytical information.

## Tilt-shift direction — Target unless verified

The aesthetic can emulate miniature photography through a controlled focus plane/band and depth treatment. Important constraints:

- gameplay selection and construction previews must remain sharp enough to use;
- analytical overlays should not become unreadable under depth effects;
- depth treatment should scale with zoom/camera angle;
- post-processing should be optional or degradable for performance/accessibility;
- simulation state must remain independent of visual focus/blur.

## Art production authority

See [`../art/ASSET_BIBLE.md`](../art/ASSET_BIBLE.md) for detailed asset-production rules.

This document owns product-level presentation intent; the asset bible owns implementation-level asset constraints and production standards.

## Asset principles

Across buildings, roads, terrain, vehicles and civic infrastructure:

- assets need clear categories and deterministic references;
- visual variants should avoid changing gameplay identity accidentally;
- physical footprint/massing should correspond to simulation geometry where geometry is authoritative;
- LOD/atlas generation may simplify presentation but not alter canonical parcel/building dimensions;
- generated runtime assets should be reproducible from accepted sources/tooling where the pipeline requires it.

## Urban Fabric presentation

**Implemented foundation** includes:

- cadastral parcel/frontage visualization;
- parcel selection/picking;
- zoning-envelope/development diagnostics;
- canonical parcel inspection;
- terrain/zoning/road/structure layers;
- tool previews and analytical overlays.

Overlays are read models. Selecting a parcel does not mutate cadastral state.

## Analytical overlays

Overlays are a core game language for explaining spatial systems.

Important families include current or future views for:

- zoning and cadastral parcels;
- accessibility/congestion;
- services;
- utilities;
- flood/environmental exposure;
- land/property values;
- development feasibility;
- population/economic conditions.

The interface should avoid activating incompatible analytical modes simultaneously when the resulting colors/legends would become ambiguous.

## UI hierarchy

The mature UI should support three simultaneous levels:

### 1. Action layer

Tools to build roads, change zoning, place public infrastructure, select policy and manage operations.

### 2. State layer

Citywide indicators, warnings, budgets and current operating conditions.

### 3. Explanation layer

Inspectors, overlays, charts and causality traces that explain why outcomes exist.

The player should not need to open a spreadsheet-style panel for every simple action, but deep information should be available when requested.

## Inspector principles

Entity inspectors should distinguish:

- canonical identity;
- physical/legal properties;
- current operating/economic state;
- historical state where available;
- causes/constraints relevant to player action.

For parcels/buildings, examples include zoning envelope, buildable area, use mix, condition, ownership/property state and redevelopment feasibility.

## Tool-preview principles

Before committing a construction or policy action, show what is knowable:

- geometry/footprint;
- validity;
- estimated cost;
- affected parcel/network entities;
- demolition/land implications;
- major capacity or service effects;
- invalid-reason feedback.

The preview is not the final authoritative transaction.

## Accessibility and clarity

Visual polish must preserve:

- readable contrast;
- non-color-only critical status cues where practical;
- scalable UI text;
- configurable/disableable expensive depth effects;
- clear selection state;
- stable icons and terminology.

## Performance

Rendering quality should scale independently from simulation correctness. If a visual effect exceeds frame budget, degrade the effect or LOD rather than skipping authoritative simulation work.

Rendering performance and simulation performance should be profiled separately so one is not used to hide the other.