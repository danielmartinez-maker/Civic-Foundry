# Civic Foundry GPU Specialized Overlay Parity Design

**Status:** Approved design  
**Date:** 2026-08-27  
**Base:** accepted Phase 2 GPU visual/retained-scene head  
**Phase:** Desktop GPU migration follow-on 3

## Objective

Replace the temporary generic GPU overlay tint with full PixiJS/WebGL parity for the established traffic, service, transit, economy, cadastral, and zoning-envelope analytical overlays.

This phase consumes existing overlay mapper outputs and canonical cadastral/world read APIs. It does not create new analytical authority, rewrite simulation metrics, or alter persistence.

## Required outcomes

1. Every analytical overlay mode already exposed by the application has a dedicated GPU rendering path.
2. Existing mapper functions remain canonical for deriving presentation snapshots from simulation state.
3. Overlay switching updates/hides retained overlay containers rather than rebuilding the entire world scene.
4. Traffic, service, transit, economy, cadastre, and zoning-envelope semantics match the legacy Canvas pass.
5. Labels, line widths, dash semantics, heat scales, gateways, frontage/access distinctions, selected parcels, and zoning-envelope geometry retain the current interaction meaning.
6. No overlay writes simulation, world, cadastral, zoning, property, transportation, economy, or save state.
7. Existing camera/input and base-scene Phase 2 retained-rendering behavior remain unchanged.
8. Legacy Canvas rendering may be deleted only after this phase proves production parity and no remaining runtime/tests require it.

## Architecture

```text
SimulationCore / canonical read APIs
       |
       +--> mapTrafficOverlay --------------------+
       +--> mapServiceOverlay --------------------+
       +--> mapTransitOverlay --------------------+
       +--> mapEconomyOverlay --------------------+
       +--> mapCadastralOverlay ------------------+--> GpuOverlayCoordinator
       +--> mapZoningEnvelope --------------------+      |
                                                        +--> TrafficOverlayContainer
                                                        +--> ServiceOverlayContainer
                                                        +--> TransitOverlayContainer
                                                        +--> EconomyOverlayContainer
                                                        +--> CadastralOverlayContainer
                                                        +--> ZoningEnvelopeContainer
                                                              |
                                                              v
                                                        PixiJS WebGL stage
```

The coordinator is presentation-only. Existing mapper modules continue to define analytical values and labels. GPU modules translate those snapshots into retained Pixi primitives/text without recomputing simulation metrics.

## Overlay lifecycle

Each overlay family owns a dedicated retained container. Exactly the containers required by the current mode are visible.

Mode changes follow this sequence:

1. read the mapper snapshot for the requested mode;
2. compute presentation keys/fingerprints for overlay elements;
3. synchronize only that overlay family's retained primitives/text;
4. hide containers for inactive mutually exclusive analytical modes where current UI semantics require exclusivity;
5. leave base terrain/road/object/vehicle retained layers untouched.

A mode switch must not cause base-scene sprite recreation.

## Shared GPU overlay primitives

Create small rendering-domain helpers for:

- projected cell fill/outline;
- projected world segment stroke;
- meter-coordinate polygon fill/outline;
- dashed-line approximation where PixiJS does not natively match the required pattern;
- pooled labels anchored at projected cells/world points;
- gateway/stop markers;
- retained keyed Graphics/Text synchronization.

These helpers contain geometry/presentation logic only. They cannot call simulation mutation APIs.

## Traffic overlays

Canonical source: `mapTrafficOverlay(...)` plus existing transportation graph reads required to locate mapped edges.

Required modes:

- congestion;
- speed;
- volume;
- bottlenecks.

Parity requirements:

- edge color scale follows the current normalized green-to-red semantics;
- bottlenecks suppress non-positive entries and use the established alert styling;
- line width scales with camera tile width using the current visual relationship;
- graph edge geometry comes from canonical transportation nodes;
- no GPU overlay code recalculates traffic metrics differently from the mapper.

Retained key: edge ID + overlay mode. Fingerprint includes mapped value, resulting visual class/color/width, edge endpoints, and camera-sensitive projection inputs.

## Service overlays

Canonical source: `mapServiceOverlay(core, mode)`.

Required behavior:

- mapped cells use the established service heat scale;
- labels appear only at the current zoom threshold;
- label content is mapper-provided;
- switching service mode reuses compatible cell/label objects where possible.

Retained key: cell coordinate + mode. Labels use a bounded text pool.

## Transit overlays

Canonical source: `mapTransitOverlay(core, mode)` plus canonical line/stop reads for geometry.

Required modes/behavior:

- base route presentation;
- ridership;
- crowding;
- reliability;
- wait labels;
- mode-specific route appearance for bus, BRT, tram, and metro;
- stop markers and metro-station distinction;
- mapper-derived route values control normalized emphasis exactly as in the current presentation contract.

Dash styles for BRT/tram/metro must visually preserve their distinct semantics. If implemented through segmented GPU lines, segmentation is presentation-only and deterministic for fixed endpoints/camera.

Retained keys include line/segment identity, stop ID, overlay mode, and marker type.

## Economy overlays

Canonical source: `mapEconomyOverlay(core, mode)`.

Required behavior:

- mapped cells use the established amber intensity semantics;
- mapper labels respect the current zoom threshold;
- freight/route overlays traverse canonical edge IDs from mapper snapshots;
- route width scales from mapper value relative to the current route maximum;
- freight-route dash semantics are preserved;
- gateway markers retain the current diamond presentation and canonical coordinates.

No GPU code may derive firm, freight, employment, trade, or gateway outcomes independently.

## Cadastral overlay

Canonical source: `mapCadastralOverlay(core)` and canonical meter-coordinate geometry.

For `cadastre` mode render:

- block boundaries;
- parcel boundaries;
- selected parcel distinction;
- frontage segments;
- access segments with visually distinct styling.

Meter geometry is projected through `LEGACY_CELL_SIZE_METERS` and `IsometricCamera`, matching the established coordinate seam.

Retained keys are stable canonical block/parcel/segment identities or deterministic presentation keys derived from those identities. The renderer does not store a second cadastral graph.

## Zoning-envelope overlay

Canonical source: `mapZoningEnvelope(core, selectedParcelId)`.

Required behavior:

- selected parcel boundary fill/outline;
- buildable footprint fill/outline;
- max-height label at the established footprint center;
- selected parcel changes replace/synchronize only zoning-envelope presentation objects;
- missing/invalid selected parcel follows existing mapper/application error semantics and cannot fabricate geometry.

## Label system

Use PixiJS `Text` or equivalent GPU-backed text objects behind a small presentation wrapper.

Requirements:

- labels are pooled and reused;
- labels are hidden below the same zoom thresholds as the legacy overlay pass;
- label values come from mapper snapshots or established presentation calculations only;
- no per-frame unbounded `Text` creation;
- text style is stable and readable at current desktop zoom ranges.

## Retained synchronization and fingerprints

Overlay elements use stable keys and presentation fingerprints.

A second draw with unchanged core snapshot, overlay mode, camera, and selected parcel must not recreate overlay Graphics/Text objects.

A mapper value change updates the existing object's visual state. A mode change may recycle objects into bounded family pools.

Base-scene retained counters from Phase 2 must remain unchanged during analytical mode changes except where camera changes legitimately require projection updates.

## Camera and coordinate contract

All overlays project through `IsometricCamera` or shared helpers proven equivalent to it.

Must preserve:

- pan/zoom/rotation alignment with base-scene sprites;
- cell heatmaps exactly covering projected cells;
- road/transit/economy segments staying anchored to canonical endpoints;
- cadastral/zoning meter polygons staying aligned with parcels through all quarter turns;
- selected parcel/cell identity across mode changes.

## Error handling

If a mapper snapshot references an edge/line/stop/parcel that cannot be resolved by the corresponding canonical read API, the overlay skips that presentation element and emits a presentation diagnostic where the existing contract expects diagnostics. It must not synthesize replacement authoritative data.

A rendering failure may reset/rebuild the affected overlay container from the next canonical snapshot. It cannot mutate simulation or save state.

## Test strategy

### Mapper-to-GPU parity unit/contract tests

For deterministic fixtures, assert GPU presentation snapshots/commands preserve the same semantic outputs as the existing Canvas overlay pass:

- traffic edge inclusion, normalized visual direction, bottleneck suppression;
- service cell values/labels;
- transit mode strokes, route emphasis, stop types, wait labels;
- economy cell intensity, route inclusion, freight dash flag, gateways;
- cadastral block/parcel/frontage/access geometry;
- zoning-envelope parcel/buildable rings and max-height label.

Tests should compare normalized presentation descriptions rather than Pixi internal implementation details.

### Retained-scene tests

Prove:

- unchanged overlay draw does not recreate Graphics/Text entries;
- overlay mode changes do not recreate base-scene sprites;
- selected parcel changes update only cadastral/zoning presentation entries;
- label pools and line/marker pools remain bounded after repeated mode cycling.

### Browser functional

Extend compiled browser smoke to cycle every overlay mode and verify:

- no runtime errors or GPU diagnostics;
- expected mapper-backed visible element counts are non-zero for seeded scenarios;
- labels appear/disappear at expected zoom thresholds;
- cadastre and zoning envelope align with canonical selection after rotation;
- base retained-object creation counters do not climb during overlay-only changes.

### Visual smoke

Add deterministic visual scenes for representative modes rather than relying on one generic tint scene. At minimum cover:

- traffic congestion;
- service coverage;
- transit ridership/crowding representation;
- economy freight routes/gateways;
- cadastre with frontage/access;
- selected zoning envelope.

Reference updates require intentional visual review; thresholds cannot simply be widened to make regressions disappear.

## Legacy Canvas removal gate

After all Phase 3 acceptance tests are green, perform an explicit usage search before deleting legacy Canvas production/reference files.

Deletion is allowed only if:

1. `GameApp` and production entrypoints already use only GPU presentation;
2. no browser smoke or runtime test imports legacy `WorldRenderer` as required functionality;
3. all specialized overlay parity tests are green;
4. asset/sprite parity from Phase 2 remains green;
5. docs no longer describe Canvas2D as an active renderer;
6. removing legacy files does not force edits to authoritative simulation/world/save domains.

If legacy helpers contain still-canonical pure deterministic logic, move/reuse those helpers in rendering-neutral modules rather than deleting behavior with the Canvas facade.

## Repository boundaries

Expected changes remain under rendering/UI tests/docs and, if needed, presentation test fixtures. No direct edits are expected under:

- `src/simulation/`;
- `src/world/`;
- `src/save/`.

Authoritative-domain changes require a separate compatibility defect workflow.

## Non-goals

- new overlay metrics or simulation analytics;
- lane-level transportation replacement;
- GPU compute;
- save migration;
- native file-slot IPC;
- Windows installer/signing;
- WebGPU backend;
- redesigning the HUD/overlay controls.

## Acceptance gate

Phase 3 is complete only when:

1. every currently exposed specialized analytical overlay renders through PixiJS/WebGL with semantic parity;
2. generic whole-world tint is no longer the implementation for those modes;
3. overlay mode changes preserve retained base-scene identity;
4. pooling/reuse tests remain bounded;
5. camera/selection/cadastral alignment tests pass;
6. `npm run verify` passes;
7. all inherited and new browser/visual smoke suites pass;
8. branch diff confirms no unintended authoritative simulation/world/save changes;
9. legacy Canvas removal, if performed, clears the explicit removal gate;
10. the Phase 3 PR is reviewed before integration into `main`.
