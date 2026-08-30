# Civic Foundry — Controls, Accessibility & Settings

## Status summary

- Current isometric camera interaction and tool input: **Implemented in the current UI/runtime; verify exact bindings in code**.
- Final settings, rebinding and accessibility suite: **Target unless specifically present and verified**.

## Interaction goal

The player should be able to move between city overview, diagnosis and precise construction without fighting the camera or UI.

Core interactions should prioritize mouse/keyboard desktop play because Windows desktop is the current production target.

## Camera interaction

Current camera architecture supports panning, anchored zoom, rotation and coordinate picking.

The intended control feel should provide:

- smooth pan;
- zoom centered around useful pointer/focus behavior;
- predictable rotation;
- rapid reset/orientation recovery;
- precise parcel/road/building selection;
- stable tool previews while the camera moves.

Exact shortcuts should be documented from implementation rather than invented in design docs.

## Construction tools

Tools should support a consistent interaction grammar:

1. choose tool;
2. preview geometry/action;
3. show validity/cost/reason for rejection;
4. confirm authoritative action;
5. allow cancel/escape without side effects.

Road/network drawing should provide clear snapping and topology feedback. Parcel/zoning operations should expose affected legal land rather than only cell graphics where canonical parcels matter.

## Selection

Selection should remain visually obvious at all supported zoom levels.

Where entities overlap, the UI should prioritize meaningful canonical entities and offer a predictable way to inspect alternatives rather than silently selecting a derived compatibility object.

## Keyboard and mouse — Target quality bar

The mature control scheme should provide:

- keyboard shortcuts for major tools and time controls;
- mouse-wheel or equivalent zoom;
- camera pan and rotation shortcuts;
- escape/back semantics consistent across tools/panels;
- optional key rebinding where practical;
- sensible behavior on high-DPI displays.

## Accessibility principles

### Information cannot rely on color alone

Critical warnings and overlay states should combine color with one or more of:

- icon;
- pattern;
- label;
- shape;
- tooltip/value.

### UI scaling

Target settings should support text/UI scaling appropriate for different resolutions and viewing distances.

### Motion and depth effects

Potential tilt-shift, blur, camera easing and other post-processing should be configurable. Players who experience discomfort or need maximum clarity should be able to reduce/disable nonessential effects.

### Contrast

Selection, invalid placement, warnings and important overlays require strong contrast across common display conditions.

### Audio redundancy

Important alerts must have a visual equivalent. See [`AUDIO_AND_ATMOSPHERE.md`](AUDIO_AND_ATMOSPHERE.md).

## Simulation-speed controls

The player should have clear controls for:

- pause;
- normal speed;
- accelerated speeds appropriate to long-term simulation.

Changing player-selected speed must change how quickly simulation time advances, not the deterministic rules themselves.

## Settings categories — Target

A mature settings surface should likely separate:

### Graphics

- resolution/window mode where supported;
- render scale/quality;
- post-processing/tilt-shift depth effects;
- visual density/LOD options;
- shadows/lighting options if introduced;
- frame-rate/vsync controls where platform integration supports them.

### Interface

- UI scale;
- tooltip/detail behavior;
- overlay clarity options;
- unit/display preferences where appropriate.

### Controls

- key bindings;
- camera sensitivity/speed;
- zoom/rotation preferences;
- edge scrolling if implemented.

### Audio

- master/music/ambience/effects levels.

### Gameplay

Only settings that affect presentation/convenience should be freely adjustable without save implications. Simulation-rule options used for scenarios/difficulty should be explicit game/scenario configuration, not hidden visual settings.

## Input authority

Input handlers and UI tools may request an action. They do not own the resulting city state.

Pattern:

```text
player input
→ tool/UI validation + preview
→ typed simulation command/service request
→ authoritative domain validation/mutation
→ updated snapshot
→ renderer feedback
```

Avoid direct mutation of simulation internals from pointer handlers.

## Localization readiness

Even before full localization exists, UI architecture should avoid assumptions that every label has English-like length. Important interface text should come from stable labels/resources where feasible instead of being embedded throughout simulation code.

Localization is a Target product capability unless separately implemented.

## Controller support

No controller/console commitment should be inferred from this document. If controller support is pursued later, it should be designed around precise city-building interactions rather than mapping a mouse interface mechanically.

## Principle

Controls should make the simulator feel precise and immediate while accessibility/settings allow the player to reduce visual, audio and interaction friction without changing authoritative simulation truth.