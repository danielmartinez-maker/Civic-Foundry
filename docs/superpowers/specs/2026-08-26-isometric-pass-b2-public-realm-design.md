# Civic Foundry — Isometric Pass B2: Parking & Public Realm

## Status

Approved in chat on 2026-08-26. This specification defines Isometric Pass B2 after accepted Pass A and verified Pass B1.

Pass B2 is an architectural presentation tranche. It expands the visible city fabric around roads, parcels, and buildings while preserving simulation authority boundaries. B2 may read authoritative state, but it may not own, persist, or mutate transportation, parking, zoning, land, building, economic, or save-game outcomes.

## Goal

Make Civic Foundry streets and development sites read as coherent urban places rather than isolated roads and buildings by adding deterministic sidewalks, curbs, access treatments, vegetation, street furniture, plazas, parking-form dressing, and related public-realm presentation.

The pass must create a visually richer city now without pre-implementing the parking simulation reserved for Transportation 3R.6.

## Branching and integration baseline

Implementation branch: `feature/isometric-pass-b2-public-realm`.

The branch is created from verified Pass B1 head `ea294c07b1bf3d0f3b324c48499915f3883c4c6e` so B2 can compose directly with the B1 runtime asset manifest and building visual resolver.

At design time, the latest observed Urban Fabric parent head was `552156b6eb8d477a03f9d26dd9d401bebcea0466`. B1 was verified against its own frozen parent checkpoint `1c1479bdad0a7be6db16263128f5aee38dccdc44`; later parent movement is an integration-freshness issue, not unfinished B1 work.

Before B2 production implementation begins, the implementation plan must pin a frozen parent checkpoint and decide whether a controlled B1 restack is required for compatibility. No history rewriting or restack is performed merely to chase moving parent commits.

`main` remains untouched. No B2 merge is authorized by this specification.

## Existing invariants

Pass B2 preserves all of the following:

- `PASS_A_ASSET_MANIFEST` remains exactly 161 entries.
- Pass B1 remains exactly 138 additional entries.
- Existing Pass A and B1 asset IDs, variant keys, atlas rectangles, building-family selection, condition framing, and camera-orientation behavior remain stable.
- `WorldFoundation` and the cadastral model remain authoritative for physical/geographic state.
- Buildings, roads, zoning, transport, traffic, economy, services, utilities, and saves remain authoritative in their existing simulation owners.
- Presentation cannot manufacture simulation outcomes.
- Rendering cannot affect simulation RNG.
- No save-format change is introduced by B2.
- No parking capacity, occupancy, price, legality, availability, cruising penalty, or generalized-cost effect is introduced by B2.

## Authority boundary

### Presentation-only contract

B2 consumes authoritative inputs and emits ephemeral visual descriptors.

Conceptual data flow:

```text
authoritative simulation state
  roads + parcels + buildings + zoning + terrain + stable IDs
                |
                v
      PublicRealmContextIndex
                |
                v
     PublicRealmVisualResolver
                |
                v
  deterministic visual descriptors
                |
        +-------+-------+
        |               |
        v               v
  surface commands   vertical sprite commands
        |               |
        v               v
   ground rendering   shared scene depth sort
```

No B2 descriptor is persisted as authoritative gameplay state. All B2 outputs must be reconstructible from current authoritative state and deterministic selection rules.

### Parking firewall

Transportation 3R.6 is reserved to own:

- curb spaces;
- private spaces;
- parking lots;
- parking garages;
- parking prices;
- occupancy;
- cruising penalties;
- parking contribution to generalized travel cost.

B2 may visually communicate parking form, but not parking truth.

Allowed qualitative parking presentation classes are:

- `none`;
- `driveway`;
- `surface-lot-edge`;
- `garage-entry`;
- `curbside-dressing`.

A B2 surface-lot treatment means only that a site visually reads as auto-oriented. It does not imply a space count. A garage entrance does not imply garage capacity. A decorative parked-car sprite does not imply occupancy, legality, demand, or availability.

Rendered decorative vehicle count is an art-density choice only. It must never be exposed through UI as parking data, persisted, queried by simulation systems, or fed back into transportation logic.

When 3R.6 becomes authoritative, its parking descriptors must be able to replace the parking-related resolver inputs without requiring the asset taxonomy or renderer architecture to be redesigned.

## Public-realm profiles

Every eligible frontage/site context resolves to one of six presentation profiles.

### Urban core

Characteristics:

- continuous hardscape;
- tighter tree pits;
- frequent pedestrian lamps;
- benches and planters;
- minimal visible surface-parking treatment;
- garage access only where context supports it.

### Main street

Characteristics:

- storefront-oriented sidewalks;
- curb furnishing;
- street trees;
- planter/cafe/market dressing;
- occasional parking access;
- moderate curbside parking dressing where visually compatible.

### Residential green

Characteristics:

- grass verge or planted setback;
- conventional sidewalk;
- mature street trees;
- simple pedestrian lighting;
- driveway cuts where access geometry supports them.

### Suburban auto-oriented

Characteristics:

- wider apparent setbacks;
- driveways;
- landscaped parking edges;
- larger surface-lot treatments;
- lower furnishing density.

### Industrial/logistics

Characteristics:

- heavier curb/apron treatment;
- loading/service access presentation;
- sparse vegetation;
- utilitarian lighting;
- restrained pedestrian furniture.

### Civic/public space

Characteristics:

- plaza or formal paving;
- benches;
- planters;
- trees;
- bollards;
- civic forecourts;
- generic fountain/sculpture-plinth accents where appropriate.

B2 does not convert arbitrary undeveloped land into implied public property. Civic plazas and forecourts require a defensible civic, frontage, setback, or public-realm context.

## Profile-resolution precedence

The resolver uses authoritative use, typology, intensity, parcel geometry, frontage/access information, road class, and terrain compatibility. It does not infer simulation values that do not exist.

Precedence is deterministic:

1. Civic/public use resolves to `civic-public-space`.
2. Industrial, logistics, or heavy-industrial use resolves to `industrial-logistics`.
3. Retail or mixed-use frontage with medium/high intensity resolves to `main-street`.
4. High-FAR/high-story office, residential, hospitality, or mixed-use context resolves to `urban-core`.
5. Low-rise residential frontage resolves to `residential-green`.
6. Low-coverage commercial/residential context with larger apparent setbacks resolves to `suburban-auto-oriented`.
7. Ambiguous contexts fall back to the least-assumptive compatible profile rather than fabricating a stronger urban condition.

The exact thresholds used for terms such as high-FAR, high-story, low-rise, and low-coverage must be derived in the implementation plan from existing authoritative zoning/building conventions. They must be fixed constants with tests, not tunable runtime simulation variables.

## Deterministic visual channels

A public-realm profile does not map to one monolithic sprite. The resolver independently selects visual channels so future additions do not reshuffle unrelated presentation.

Channels are:

- surface treatment;
- curb/access treatment;
- vegetation;
- furniture;
- parking-form dressing;
- accent objects.

Each channel uses its own stable selection key derived from authoritative identity, for example:

```text
parcelId|frontageEdgeId|surface
parcelId|frontageEdgeId|trees
parcelId|frontageEdgeId|furniture
parcelId|frontageEdgeId|parking
```

Changing one asset family therefore cannot silently reselect trees, furniture, or parking dressing in another channel.

Input ordering must not affect selection. Camera rotation may change orientation resolution only; it may not select a different semantic profile or visual family.

## Asset taxonomy

B2 adds the following approved families.

### Sidewalk and hardscape

- concrete sidewalk;
- brick/paver sidewalk;
- plaza stone;
- plaza concrete;
- permeable pavers;
- grass verge.

### Curbs and access

- standard curb;
- curb ramp;
- driveway cut;
- service apron;
- loading apron;
- parking-lot entrance.

### Street furniture

- bench;
- pedestrian lamp;
- roadway lamp;
- bollards;
- planter;
- litter/recycling bin;
- hydrant.

### Vegetation

- street-tree pit;
- young street tree;
- mature street tree;
- ornamental tree;
- hedge/low planting;
- median planting.

### Parking presentation

- open surface-lot treatment;
- landscaped surface-lot edge;
- structured-garage entrance;
- podium-garage entrance;
- curbside parking dressing.

### Public-space features

- pocket plaza;
- civic forecourt;
- commercial forecourt;
- small square;
- cafe/market dressing;
- fictional generic fountain/sculpture plinth.

The expected B2 art budget is approximately 70–90 authored manifest entries. This range is a production budget, not an acceptance count. B2 correctness is coverage-driven: every approved family and required orientation must exist, while redundant symmetric frames must not be created merely to hit a numeric target.

## Atlas and manifest structure

Create one B2 source sheet and runtime atlas:

- `assets/source/public_realm.svg`;
- `dist/assets/atlases/public_realm.png`.

Create a dedicated manifest module:

- `src/rendering/assets/PassB2AssetManifest.ts`.

`PASS_B2_ASSET_MANIFEST` owns only the B2 atlas descriptor and B2 entries.

The runtime manifest composes Pass A + Pass B1 + Pass B2 through the existing manifest-composition seam. B2 must not modify Pass A/B1 atlas coordinates or declaration order.

With the expected budget, the runtime library will be approximately 369–389 entries across ten atlases. That cumulative number is informational only; exact B2 count is recorded in the final report.

Orientation is authored only when silhouette or geometry materially changes. Symmetric paving, furniture, and vegetation must not receive redundant four-way frames. Directional driveway cuts, curb treatments, garage entrances, or parking edges may receive directional variants where required.

## Context indexing

Create a presentation-only context index, conceptually `PublicRealmContextIndex`, that provides efficient read access to relevant authoritative relationships.

It may cache/index:

- road cells and road class by location/reference;
- cadastral parcels by ID;
- parcel frontage/access edges;
- building-to-parcel relationships;
- building use/typology/intensity/lifecycle presentation inputs;
- zoning district/envelope inputs needed only for visual classification;
- terrain/buildability context;
- stable IDs used for deterministic selection.

The index must rebuild only when relevant authoritative revisions change. It must not become a second source of truth.

No render loop may perform a whole-city parcel/building scan independently for every frontage or decoration.

## Parking-form derivation

B2 may use only authoritative form/context inputs such as:

- parcel frontage/access geometry;
- building coverage;
- building stories/height;
- building use/typology;
- road class;
- deterministic stable identity.

Examples:

- a low-coverage suburban commercial context may receive a landscaped `surface-lot-edge` presentation;
- a dense mixed-use or office building may receive a `garage-entry` treatment;
- a low-rise residential parcel with access may receive `driveway` presentation;
- compatible urban/main-street frontage may receive sparse `curbside-dressing`.

B2 must not derive exact parking-space quantities from lot area, stall dimensions, zoning, building floor area, or any hidden ratio. Such calculations would cross the 3R.6 authority boundary.

Curbside parked-car dressing must be suppressed at incompatible access points, obvious intersections, civic forecourts, service/loading aprons, and other contexts where decoration would visually contradict authoritative geometry.

## Render architecture

### Existing layer contract

The semantic layer order remains:

```text
terrain
roads
low-props
objects
vehicles
construction
overlays
selection
```

B2 uses the existing `low-props` concept and introduces one targeted renderer improvement so dimensional public-realm props depth-sort correctly with buildings.

### Surface rendering

Flat treatments render before dimensional scene objects:

- sidewalks;
- plaza paving;
- grass verges;
- parking-lot surfaces;
- curb markings;
- driveway/service/loading aprons;
- other ground-aligned B2 treatments.

These are collected by a dedicated public-realm pass, conceptually `PublicRealmRenderPass.collectSurfaceCommands()`.

### Shared vertical scene command buffer

Buildings, civic/utility structures, construction sprites, and vertical B2 props contribute to one deterministic scene command buffer.

Conceptual contributors include:

- existing object/building commands;
- B2 trees;
- lamps;
- benches;
- bollards;
- planters;
- decorative parked vehicles;
- garage entrances;
- other dimensional public-realm props.

A focused shared type, conceptually `SceneSpriteCommand`, carries the existing depth key plus sprite resolution information. The final buffer is sorted once with the existing `RenderOrder` contract.

This allows foreground trees or lamps to occlude buildings correctly while props behind buildings remain hidden. B2 must not implement special-case z-index hacks for individual asset families.

### WorldRenderer order

The intended high-level frame flow is:

```text
GroundRenderPass
PublicRealm surface commands
Shared SceneSpriteCommandBuffer collection
  <- existing object/building commands
  <- B2 vertical public-realm commands
one deterministic depth sort + paint
vehicles
overlays
selection
```

This is a targeted renderer seam, not a generalized renderer rewrite.

## Performance requirements

B2 must preserve the performance lessons from B1.

Required constraints:

- atlases load once through `AssetRegistry`;
- manifest lookups use cached/indexed queries;
- no per-entity full-manifest scan;
- no per-decoration full cadastral scan;
- relevant context indexes rebuild only on authoritative revision changes;
- visible cells/frontages are culled before expensive sprite resolution where feasible;
- vertical world sprites perform one deterministic scene sort per frame;
- presentation code never advances or consumes simulation RNG.

The implementation plan must define a measurable regression test that catches reintroduction of O(N^2)-style public-realm resolution in normal rendering paths.

## Compatibility guarantees

### Pass A

- exactly 161 entries remain unchanged;
- interaction smoke remains green;
- existing road/terrain/building presentation remains stable unless B2 adds a separate non-destructive adjacent layer.

### Pass B1

- exactly 138 B1 entries remain unchanged;
- all existing building families and mixed-use families remain stable;
- condition states remain stable;
- canonical-building visual mapping remains intact;
- B2 cannot use public-realm context to reselect building architecture.

### Urban Fabric 2.0

B2 does not modify:

- cadastral ownership;
- parcel IDs or lineage;
- building authority;
- zoning legality;
- property-market state;
- Save V9 semantics;
- urban-fabric overlays.

### Transportation 3R.6

B2 does not create a competing parking model. Parking-form presentation is deliberately replaceable by future authoritative parking descriptors.

## Testing strategy

### Resolver unit tests

Cover:

- deterministic output for identical state;
- input-order independence;
- camera rotation changes orientation only;
- all six profile precedence rules;
- ambiguous fallback behavior;
- stable independent channel selection;
- semantic profile does not change because an unrelated asset family is added;
- parking form never exposes capacity/occupancy/pricing fields.

### Authority-firewall tests

Capture authoritative state before and after B2 resolution/render collection and verify no mutation of:

- SimulationCore-owned state;
- roads;
- cadastre;
- zoning;
- buildings;
- treasury;
- transportation/traffic;
- services/utilities/economy;
- save snapshots.

Presentation tests must continue to prove that authoritative HUD/inspector/overlay values originate from simulation owners rather than art descriptors.

### Render-order tests

Cover:

- flat public-realm surfaces render before vertical sprites;
- buildings and B2 vertical props share deterministic depth ordering;
- foreground tree/lamp can sort in front of a building;
- rear tree/lamp can sort behind a building;
- rotation preserves stable identity;
- shuffled contributor input order produces the same command order.

### Manifest and asset tests

Cover:

- Pass A remains exactly 161 entries;
- Pass B1 remains exactly 138 entries;
- every B2 asset ID is unique;
- every B2 variant key/orientation group is valid;
- every source rectangle lies inside the B2 atlas;
- all required approved families exist;
- all manifests validate independently and when composed;
- B2 composition does not mutate Pass A or B1 manifests.

### Visual smoke

Create a deterministic B2 fixture that visibly includes all six profiles and representative examples of:

- sidewalk/hardscape;
- curb/access treatment;
- vegetation;
- furniture;
- public-space treatment;
- qualitative parking presentation.

Capture multiple camera rotations to expose anchoring, orientation, and occlusion defects.

The smoke must not assert simulated parking occupancy or capacity because B2 does not own those values.

## CI strategy

Create a B2-targeted workflow following the established B1 pattern.

Required stages:

1. B2 unit tests plus inherited isometric asset regressions.
2. TypeScript diagnostic delta against the pinned stacked parent.
3. Repository typecheck status.
4. Lint.
5. Asset source validation.
6. Production smoke build using the established parent-compiler baseline handling where needed.
7. Pass A interaction regression smoke.
8. Pass B1 visual/regression smoke.
9. Pass B2 visual smoke.
10. Full repository CI against the frozen integration checkpoint before B2 is considered complete.

Inherited parent diagnostics must be separated from B2-introduced diagnostics; B2 may not hide or broaden the inherited baseline.

## Completion criteria

Pass B2 is complete only when all of the following hold:

1. The B2 public-realm atlas and manifest are generated and validated.
2. All six approved public-realm profiles are represented.
3. Every approved asset family is represented at the orientation coverage it actually requires.
4. Context resolution is deterministic and tested.
5. The parking authority firewall is enforced by types/tests and no authoritative parking data originates in B2.
6. Surface and vertical draw ordering works across camera rotations.
7. The shared scene command seam does not regress existing B1 building rendering.
8. No O(N^2)-style presentation hot path is introduced.
9. Pass A and B1 targeted regressions remain green.
10. B2 targeted CI is green.
11. Full repository CI is green against the selected frozen integration checkpoint.
12. The final branch-to-parent diff contains only intended B2 rendering, art, test, workflow, and documentation changes.
13. `docs/art/PASS_B2_REPORT.md` records exact B2 asset count, cumulative runtime count, atlas count, frozen parent SHA, final B2 head SHA, CI run IDs/results, and deferred 3R.6 parking work.
14. The B2 PR remains draft/unmerged unless the user explicitly authorizes integration.

## Explicit non-goals

B2 does not implement:

- parking demand;
- parking search/cruising;
- parking prices;
- parking occupancy;
- parking capacity;
- parking zoning requirements;
- curb regulation;
- loading regulation;
- parking revenue;
- generalized-cost effects;
- pedestrian simulation;
- public-space simulation;
- a new land-use model;
- a new save version;
- a general renderer rewrite.

## Deferred handoff

Transportation 3R.6 will later replace qualitative parking-form inputs with authoritative parking state. B2 deliberately leaves that seam open.

Future public-space systems may also replace deterministic public-realm profile derivation with explicit authoritative entities. Until then, B2 provides a deterministic visual interpretation of the authoritative city geometry without creating new gameplay state.
