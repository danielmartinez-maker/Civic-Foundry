# Civic Foundry — Semantic Urban Depth Pass B1 Design

## Status

Approved direction in chat on 2026-08-25.

This is an architectural tranche under the Civic Foundry 2.0 master design. It follows Isometric Tier 1 Asset Pass A and begins the authoritative Urban Fabric 2.0 migration without attempting the whole Phase 2R program at once.

The selected approach is the user's **B — full semantic art expansion**, interpreted as a simulation-first expansion: mixed use, building quality, condition, age/lifecycle, and private building parking become authoritative simulation state before presentation displays them. The renderer may never infer or manufacture these states from neighborhood color, rent, or visual heuristics.

## Product Goal

Make Civic Foundry's city fabric materially richer in both mechanics and appearance. A building should no longer be only a zone/intensity sprite. New development should be able to produce legitimate mixed-use projects, different quality tiers, explicit private parking supply, and buildings whose physical condition changes over time. Those states must affect real capacity/economics where specified, survive save/load exactly, and drive the isometric art system deterministically.

The result should make dense North American neighborhoods visibly and mechanically different without breaking V7 compatibility or turning the renderer into an independent simulation.

## Non-Negotiable Constraints

1. Preserve determinism: same seed + authoritative state + ordered commands produce the same future.
2. Preserve one authoritative owner per fact.
3. Presentation reads authoritative urban-fabric state; it never derives gameplay state from appearance.
4. Existing V7 saves migrate deliberately into V8.
5. No fabricated historical series. Migration may establish explicit baseline state at migration time but may not claim unknown past maintenance/condition history.
6. Existing single-use V7 buildings preserve their resident/job capacity, tax base, utility demand, and garbage demand immediately after migration.
7. Mixed-use floor share and capacities reconcile exactly.
8. Tax, housing, employment, service, and demand systems may not double-count mixed-use buildings.
9. Private parking in B1 is building/site inventory only. Curb parking, cruising, parking occupancy, lane removal, traffic-search behavior, and network parking effects remain Phase 3R.
10. Formal parks/recreation, parcel split/merge, irregular footprints, ownership, easements, and land assembly remain outside B1.
11. Existing `BuildingSystem` remains the compatibility owner for building existence, lot/cell placement, primary V7 definition, and base construction completion until the later Phase 2R replacement proves parity.
12. The new urban-fabric domain owns semantic attributes added in this tranche and may not duplicate ownership of the same fact.

## Scope

### In scope

- authoritative use components and mixed-use buildings;
- authoritative quality tiers;
- authoritative physical condition and condition bands;
- building lifecycle metadata and post-completion states;
- private on-site parking supply/profile;
- new mixed-use development prototypes;
- developer candidate evaluation across use mix, quality, and parking profile;
- renovation projects for deteriorated occupied buildings;
- derived capacity/tax/economic views consumed by existing systems;
- V8 persistence and V7 migration;
- inspector/overlay exposure of semantic building state;
- deterministic isometric visual composition for mixed use, quality, condition, parking, renovation, and abandonment;
- regression, migration, conservation, browser, and dense-city visual tests.

### Explicitly out of scope

- replacing tile lots with arbitrary parcel polygons;
- FAR/setback/height-envelope editing UI;
- player-authored mixed-use overlays;
- full parcel ownership or land assembly;
- curb parking and parking search;
- parking occupancy simulation;
- structured traffic effects from parking;
- public parks/recreation simulation;
- building-unit or suite micro-simulation;
- mortgages/property ownership ledger;
- historic districts;
- pedestrian simulation;
- night/weather presentation;
- demolition/renovation construction logistics beyond the existing development/freight abstractions.

## Architectural Boundary

### Existing compatibility owner: `BuildingSystem`

`BuildingSystem` continues to own:

- building identity;
- lot identity;
- cell placement;
- primary V7 zone;
- structural definition ID;
- base `construction` / `occupied` compatibility status;
- original construction start/completion ticks;
- developer/project award references used by V7.

It remains the source for existence and spatial placement during B1.

### New authoritative owner: `UrbanFabricDomain`

Introduce a focused domain under `src/simulation/urban/` that owns exactly the semantic state added by B1. It stores one `UrbanBuildingState` per BuildingSystem building ID.

Conceptual shape:

```ts
type UrbanUse = 'residential' | 'commercial' | 'industrial';
type BuildingQualityTier = 'economy' | 'standard' | 'premium' | 'luxury';
type BuildingConditionBand = 'new' | 'maintained' | 'aging' | 'neglected' | 'abandoned';
type PrivateParkingProfile = 'legacy-none' | 'reduced' | 'standard' | 'abundant' | 'structured';
type UrbanLifecycleState =
  | 'construction'
  | 'lease-up'
  | 'stabilized'
  | 'aging'
  | 'neglected'
  | 'renovating'
  | 'condemned'
  | 'abandoned';

type UrbanUseComponent = Readonly<{
  use: UrbanUse;
  areaShareBps: number;
  residentCapacity: number;
  jobCapacity: number;
  taxBase: number;
}>;

type UrbanBuildingState = Readonly<{
  buildingId: string;
  useComponents: readonly UrbanUseComponent[];
  qualityTier: BuildingQualityTier;
  conditionScore: number; // 0..100
  lifecycleState: UrbanLifecycleState;
  conditionEstablishedTick: number;
  lastConditionTick: number;
  renovationCount: number;
  parking: Readonly<{
    profile: PrivateParkingProfile;
    spaces: number;
  }>;
}>;
```

`UrbanFabricDomain` does not own coordinates, lot IDs, definition IDs, or base construction completion. It validates every semantic record against a live `BuildingSystem` building.

### Derived adapter: `UrbanBuildingView`

Introduce one read-model/adapter that combines the two owners into a canonical per-building simulation view. Existing systems that need capacity, tax base, use composition, quality, condition, parking, or effective occupancy eligibility consume this adapter rather than reading `BuildingDefinition.residentCapacity/jobCapacity/taxBase` directly.

The adapter is derived and rebuildable. It owns no state.

This prevents semantic capacity logic from being copied through Population, Employment, Housing, Tax, Services, Demand, Development, and UI code.

## Use Components and Mixed Use

### Conservation rule

Every urban building has one or more `UrbanUseComponent` records.

- `areaShareBps` values are integers and sum to exactly 10,000.
- Resident capacity is positive only on residential components.
- Job capacity is positive only on commercial or industrial components.
- Tax base is allocated across components and sums exactly to the building's effective total tax base.
- A single-use building has exactly one component with `areaShareBps = 10_000`.

Area share is a normalized structural allocation, not square meters. B1 does not claim exact floor area before Phase 2R geometry arrives.

### Existing V7 prototypes

The existing nine definitions remain legal single-use prototypes and keep their current total capacities/demands/economic baseline when quality is `standard` and parking is `legacy-none`.

### New mixed-use prototypes

Add four first-class North American mixed-use prototypes:

1. `residential_mainstreet_mixed` — medium residential-dominant, 75% residential / 25% commercial area share.
2. `residential_urban_mixed` — high residential-dominant, 65% residential / 35% commercial.
3. `commercial_mixed_block` — medium commercial-dominant, 60% commercial / 40% residential.
4. `commercial_mixed_tower` — high commercial-dominant, 55% commercial / 45% residential.

Industrial remains single-use in B1.

Each mixed-use definition declares explicit resident capacity, job capacity, tax-base allocation, utility demand, garbage demand, construction cost, rent assumptions, risk/complexity, and minimum access/service requirements. Capacity is not inferred by multiplying unlike resident/job units by an area percentage.

### Compatibility zoning envelope

B1 does not introduce a new player zoning UI. Existing zone remains the dominant-use legal envelope:

- low residential: single-use residential only;
- medium/high residential: residential single-use plus residential-dominant mixed-use prototype of equal intensity;
- low commercial: single-use commercial only;
- medium/high commercial: commercial single-use plus commercial-dominant mixed-use prototype of equal intensity;
- industrial: single-use industrial only.

This is a static compatibility rule in B1. Future Phase 2R zoning envelopes will replace it with explicit mixed-use permissions.

Existing V7 buildings never convert automatically merely because a mixed-use prototype becomes legal. Mixed use appears through new development or redevelopment awards.

## Quality Tiers

Quality is authoritative project state, selected during development rather than inferred afterward.

Initial economic profile multipliers are centralized as immutable data:

| Tier | Hard construction cost | Achievable rent | Operating expense | Condition resilience |
|---|---:|---:|---:|---:|
| economy | 0.90 | 0.90 | 0.95 | 0.85 |
| standard | 1.00 | 1.00 | 1.00 | 1.00 |
| premium | 1.18 | 1.16 | 1.05 | 1.15 |
| luxury | 1.40 | 1.32 | 1.10 | 1.25 |

Quality does not directly create demand. A higher tier must still clear the same legal/access/utility/service/developer-capital constraints and the developer's return hurdle after its higher costs.

Luxury also adds +0.10 to the definition's minimum person-access and service-quality thresholds, capped at 1. Premium adds +0.05. Economy and standard do not add threshold requirements.

Quality affects completed-building tax base through the same multiplier used for stabilized value, but component allocation proportions remain unchanged.

## Private Parking

Private parking is explicit project inventory with a profile and integer space count.

### Required-space baseline

For development evaluation only, compute a baseline demand proxy:

- residential: 0.20 spaces per resident capacity;
- commercial: 0.35 spaces per job capacity;
- industrial: 0.20 spaces per job capacity.

Round the summed baseline to the nearest non-negative integer using one documented deterministic rounding helper.

### Profiles

- `legacy-none`: migration-only profile, 0 spaces, no retroactive cost or feasibility penalty.
- `reduced`: 50% of baseline spaces.
- `standard`: 100% of baseline spaces.
- `abundant`: 150% of baseline spaces.
- `structured`: 100% of baseline spaces at higher construction cost but lower site-treatment penalty.

New development may evaluate reduced, standard, abundant, or structured parking. `legacy-none` is never a new-build candidate.

Parking adds explicit project cost. Reduced parking receives an accessibility-sensitive rent penalty when person accessibility is weak; strong accessibility reduces that penalty. Abundant parking has higher cost and provides no automatic traffic benefit. Structured parking has the highest per-space cost. Exact per-space dollar constants live in one balancing data module and are covered by monotonic tests: reduced < standard < abundant < structured at equal building capacity except where structured has fewer spaces than abundant.

B1 does not model parking occupancy, cruising, curb supply, parking-trip generation, or lane effects.

## Developer Candidate Model

Development candidates become semantic tuples rather than only structural definition IDs:

`definition × qualityTier × parkingProfile`

The definition itself carries the use-component mix. This keeps the search space bounded.

For every legal tuple, `DevelopmentFeasibilitySystem` computes:

- component-specific achievable revenue using the current market signal for each use;
- component-specific vacancy assumption;
- quality-adjusted construction cost, rent, operating expense, and access/service thresholds;
- parking construction cost and parking adequacy adjustment;
- component-allocated property tax;
- resulting NOI, stabilized value, yield/return, required equity, residual land value, and risk.

The feasibility result and development bid gain `qualityTier`, `parkingProfile`, `parkingSpaces`, and a stable `useMixKey`/semantic fingerprint. The awarded building's `UrbanBuildingState` is created from the winning tuple.

Tie-breaking remains deterministic and must not depend on iteration order.

### Market signals by use

The existing R/C/I demand and market context are reused as the use-level market signals. Mixed-use revenue evaluates residential and commercial components separately; it may not apply only the dominant zone's rent/vacancy multiplier to the entire project.

## Effective Capacity and Downstream Integration

`UrbanBuildingView` exposes at minimum:

- residential capacity;
- commercial job capacity;
- industrial job capacity;
- total job capacity;
- tax base by use;
- total utility and garbage demand;
- lifecycle occupancy eligibility;
- condition capacity multiplier;
- quality tier;
- private parking supply.

Existing systems are migrated to this read model where they currently consume building definition capacity or tax base directly.

### Condition capacity effects

- `new`, `maintained`, `aging`: 100% nominal capacity.
- `neglected`: 85% nominal resident/job capacity.
- `condemned`: 0% new occupancy or new firm placement; existing occupants must be reconciled before abandonment finalizes.
- `abandoned`: 0% resident/job capacity and 0 active occupancy.
- `renovating`: 50% nominal capacity during the project; existing housing/firm systems reconcile any displaced excess deterministically.

Capacity reduction uses deterministic rounding and must never produce negative capacity.

### Taxation

Tax revenue is calculated per use component using the corresponding residential/commercial/industrial tax rate. Component tax bases sum to the effective building tax base exactly. A mixed-use building therefore cannot be taxed twice on the same tax base.

### Housing

Housing tenure/choice/relocation consume only the residential component capacity of eligible urban buildings. A commercial-dominant mixed-use building can house residents only up to its explicit residential component capacity.

### Employment and firms

Employment/firm placement consume commercial/industrial component job capacity. Residential capacity is never treated as job capacity unless a future explicit home-business system adds that rule.

## Condition and Lifecycle

### Condition representation

`conditionScore` is authoritative in `[0, 100]`.

Band mapping:

- `new`: 90–100;
- `maintained`: 70–<90;
- `aging`: 50–<70;
- `neglected`: 25–<50;
- `abandoned`: 0–<25, but lifecycle may remain `condemned` until occupants are cleared.

The renderer reads the band derived from the authoritative score/lifecycle state; it does not choose a band independently.

### Cadence

Urban condition updates every 100 simulation ticks through one domain scheduler entry. The update is tick-based and frame-rate independent. Crossing multiple 100-tick boundaries in one headless step produces the same result as stepping one tick at a time.

### Maintenance adequacy

B1 does not invent an unledgered maintenance payment. Instead it models a bounded **maintenance adequacy index** derived from real current operating context:

- occupancy utilization;
- utility ratio;
- service/neighborhood quality;
- current market rent strength for the building's use components;
- firm distress where a non-residential building has an operating firm.

The index may slow or accelerate physical wear but cannot improve condition on its own. It is explicitly an adequacy proxy, not a booked cash transaction.

The formula is centralized, deterministic, clamped to `[0, 1]`, and exposed in inspection/causality output. Condition wear must be monotonic between explicit renovation completions.

Quality's `condition resilience` multiplier reduces or increases wear rate. It may not reverse wear.

### Initial completion

A newly completed building enters `lease-up` with condition 100. After its first successful occupancy/firm reconciliation cycle or after 300 ticks, whichever occurs first, it becomes `stabilized` unless another lifecycle condition supersedes it.

### Aging and neglect

Lifecycle follows the authoritative condition band once stabilized:

- score <70 -> `aging`;
- score <50 -> `neglected`;
- score <25 -> `condemned`.

`condemned` stops new placement and starts deterministic housing/firm reconciliation. Only when current residential allocations and firm occupancy are zero may the state become `abandoned`.

No occupant or firm reference may point to an abandoned building.

## Renovation

B1 adds one bounded project type: **building renovation**.

A building is renovation-eligible when:

- it is occupied/stabilized/aging/neglected rather than construction/abandoned;
- condition is below 70;
- it is not already committed to redevelopment or renovation;
- a renovation pro forma clears a deterministic return hurdle.

Renovation cost is a quality- and definition-adjusted fraction of replacement hard cost. The project does not change lot, definition, use mix, quality tier, or parking profile. It changes lifecycle to `renovating` for a deterministic duration and temporarily reduces effective capacity to 50%.

On completion:

- condition becomes 90;
- `renovationCount` increments;
- lifecycle becomes `lease-up` and then stabilizes normally;
- no fake historical renovation series is created.

Redevelopment remains the path for changing intensity/definition/use mix.

Renovation and redevelopment commitments are mutually exclusive for a building.

## Migration to V8

### Save envelope

Add `SaveV8` with:

- `saveVersion: 8`;
- `gameVersion: '0.8.0-urban-fabric'`;
- all V7 authoritative state;
- `urbanFabricState` containing semantic building records and active renovation commitments;
- any new developer-market semantic candidate/commitment fields required to restore in-flight projects exactly.

`serializeCore()` returns V8. `hydrateCore()` accepts V8 and delegates older inputs through the existing V7 migration path before establishing B1 state.

### V7 migration rules

For every existing V7 building:

- create a single-use component exactly matching its existing definition's zone, resident capacity, job capacity, and tax base;
- quality = `standard`;
- parking = `legacy-none`, 0 spaces;
- construction buildings map to lifecycle `construction`;
- occupied buildings map to `stabilized`;
- condition score = 80 (`maintained` baseline);
- `conditionEstablishedTick` and `lastConditionTick` = migration tick;
- `renovationCount = 0`.

The score 80 is explicitly a migration baseline, not reconstructed historical condition. No pre-V8 condition history is emitted.

Immediately after migration, `UrbanBuildingView` must reproduce the same nominal resident capacity, job capacity, tax base, utility demand, and garbage demand as V7 for every migrated building. The first condition update occurs only at the next 100-tick boundary after migration.

### Save validation

Hydration rejects:

- semantic records for nonexistent buildings;
- missing semantic records for live B1 buildings in a V8 save;
- duplicate building IDs;
- invalid area-share sums;
- negative/non-integer parking spaces;
- invalid quality/condition/lifecycle enums;
- condition outside `[0, 100]`;
- abandoned buildings with active housing/firm occupancy;
- conflicting renovation/redevelopment commitments.

## Presentation Contract

Pass A's isometric projection, camera, depth order, picking, culling, atlas registry, and deterministic variant selection remain authoritative presentation infrastructure.

### Building composition

All world art remains rasterized at build time, but B1 uses layered raster composition to prevent a combinatorial atlas explosion:

1. site/parking layer;
2. base building architectural sprite;
3. mixed-use frontage/podium details where applicable;
4. quality-specific material/detail layer or quality-specific base variant;
5. condition overlay;
6. renovation/condemnation props;
7. selection/analytical overlays above world objects as established in Pass A.

Every layer is selected from authoritative semantic state plus stable visual identity.

### Architectural diversity

For the general North American pack, B1 targets at least:

- five stable architectural base variants for each existing low/medium/high R/C/I structural family where silhouette permits;
- at least four variants for each of the four new mixed-use prototypes;
- explicit orientation frames for asymmetrical variants;
- restrained deterministic facade/material variation within each quality tier;
- no real brand logos.

The art generator and manifest validator enforce coverage rather than relying on manual file inspection.

### Quality presentation

Quality changes material/detail language, not hue alone:

- economy: simpler massing/details, economical cladding, restrained landscaping;
- standard: baseline North American material mix;
- premium: improved facade articulation, glazing, entry/site treatment;
- luxury: higher-detail facade/roof/landscape treatment without neon or exaggerated wealth caricature.

### Condition presentation

Condition overlays must be semantically restrained:

- maintained/aging: subtle wear, not disaster imagery;
- neglected: visibly deferred upkeep, reduced landscaping, modest grime/damage;
- condemned/abandoned: boarded/closed openings and inactive site cues;
- renovation: scaffolding/wrap/material staging tied to actual lifecycle state.

Condition art may not imply fire, flooding, crime, or structural collapse unless those systems provide that state.

### Parking presentation

Parking/site treatment reflects the authoritative parking profile/spaces:

- reduced: minimal visible on-site stalls;
- standard: normal small lot/drive or podium access treatment;
- abundant: visibly larger parking treatment within the existing tile/site abstraction;
- structured: garage/podium expression;
- legacy-none: no explicit parking treatment.

Because B1 lacks parcel geometry, parking art is an integral site composition inside the building's current logical footprint. It must not visually claim extra occupied cells.

## Inspector and Analytical UI

Building inspection adds:

- primary definition and dominant zone;
- explicit use mix percentages and capacities;
- quality tier;
- condition score/band;
- lifecycle state;
- building age in simulation ticks since completion;
- private parking spaces/profile;
- developer/project data already available;
- maintenance adequacy and main contributing inputs;
- active renovation/redevelopment status.

Add analytical modes for:

- building quality;
- condition;
- mixed-use intensity;
- private parking supply;
- renovation/abandonment status.

These overlays are derived strictly from `UrbanBuildingView` / `UrbanFabricDomain` snapshots.

## Determinism and Ordering

Semantic candidate enumeration uses a stable explicit order:

1. structural definition ID;
2. quality rank (`economy`, `standard`, `premium`, `luxury`);
3. parking rank (`reduced`, `standard`, `abundant`, `structured`);
4. developer ID / existing deterministic bid tiebreak.

Urban condition iteration sorts by building ID. Renovation candidate iteration sorts by building ID and developer ID. No map/object insertion order may decide outcomes.

Cosmetic architectural variant selection remains a stable hash of building identity/variant family and may not change because condition, quality, camera rotation, or runtime list order changes unless the relevant semantic layer itself changes.

## Performance

B1 adds no per-frame simulation work. Urban condition and renovation evaluation run on simulation cadence, not render cadence.

Targets:

- semantic lookup by building ID: O(1);
- derived per-building view construction: O(n) per scheduled refresh, cacheable until invalidated;
- renderer still culls before sprite painting;
- layered building composition must remain viable in the existing dense-city visual smoke scene;
- no new runtime npm dependencies.

The implementation plan must add a headless scale test with at least 10,000 synthetic urban-building semantic records for validation/snapshot operations and a dense rendered-city browser smoke based on the practical map size supported by the current game.

## Error Handling and Invariants

UrbanFabricDomain validates state on creation, restore, building replacement, renovation transitions, and removal.

Required invariants include:

- every semantic record references exactly one live building;
- every V8 live building has exactly one semantic record;
- use area shares sum to 10,000;
- capacities/tax bases are finite and non-negative;
- parking spaces are non-negative integers;
- condition is finite within bounds;
- lifecycle transitions follow the allowed graph;
- abandoned buildings have zero effective capacity and zero occupants/firms;
- one building cannot renovate and redevelop simultaneously;
- replacement removes old semantic state before installing replacement state under the stable building reference rules;
- bulldozing removes semantic state and any renovation commitment without leaving housing/service/firm references.

Debug builds/tests should fail loudly on invariant violations rather than silently repairing impossible B1 state. Migration sanitization is allowed only where the migration rule is explicit and deterministic.

## Testing Strategy

### Unit tests

- use-component conservation and validation;
- single-use V7 parity through `UrbanBuildingView`;
- mixed-use capacity and tax allocation;
- legal compatibility envelope for four mixed-use prototypes;
- quality multiplier monotonicity and access thresholds;
- parking baseline/profile/cost determinism;
- semantic development candidate stable ordering;
- mixed-use feasibility uses separate residential/commercial market signals;
- condition cadence equivalence for chunked vs single-tick stepping;
- condition monotonic wear between renovations;
- quality resilience directionality;
- condition band/lifecycle transitions;
- condemnation prevents new placement;
- abandonment requires zero occupancy;
- renovation eligibility, exclusivity, capacity reduction, and completion reset;
- stable visual variant identity across semantic overlays and rotations;
- manifest coverage for quality/condition/parking/mixed-use layers.

### Integration tests

- housing consumes only residential component capacity;
- employment/firms consume only job components;
- mixed-use tax base is allocated exactly once;
- utility/garbage demand remains conserved;
- redevelopment can replace single-use with legal mixed-use and vice versa where the compatibility envelope allows;
- housing displacement/reconciliation on neglected/renovating/condemned capacity changes;
- firm reconciliation on capacity loss/condemnation;
- bulldoze cleans semantic/renovation state;
- V8 save/load byte-equivalent authoritative state after fixed commands;
- V7 -> V8 migration preserves immediate V7 nominal capacity/tax/demand parity;
- no fabricated pre-V8 condition history.

### Browser/visual tests

- inspector exposes correct semantic fields;
- four new analytical overlays align under pan/zoom/four rotations;
- mixed-use buildings render the correct mixed-use family;
- each quality tier has materially distinct nonblank output;
- condition/renovation/abandonment layers appear only for matching authoritative states;
- parking profiles produce distinct site treatments without changing logical footprint;
- dense city with mixed semantic states has zero missing-asset diagnostics;
- eight-or-more deterministic visual scenes pass screenshot variance/coverage thresholds.

### Full regression gate

Every B1 PR head and final merge head must pass:

- all existing unit tests;
- new B1 unit/integration tests;
- typecheck;
- independent lint;
- asset-source validation;
- production atlas build;
- Phase 6 browser smoke;
- Phase 7 browser smoke;
- Pass A interaction smoke;
- Pass A visual smoke;
- new B1 semantic browser smoke;
- new B1 dense-city visual smoke;
- save migration regression suite.

## Implementation Decomposition

The later writing-plans phase should break B1 into reviewable commits in this order:

1. semantic types/data and `UrbanFabricDomain` invariants;
2. V7-parity `UrbanBuildingView` adapter;
3. use-component/mixed-use definitions and downstream capacity/tax integration;
4. quality and parking candidate economics;
5. condition scheduler/lifecycle;
6. renovation project path and reconciliation hooks;
7. V8 persistence/migration;
8. inspector/analytical overlays;
9. expanded layered raster art/manifest/generator;
10. browser/visual/scale verification and production report.

No implementation step may skip the V7 parity checks appropriate to the fields it replaces.

## Acceptance Criteria

Pass B1 is complete only when all of the following are true:

1. Mixed-use is first-class authoritative building state, not a renderer label.
2. Residential + commercial component capacity/tax accounting reconciles exactly.
3. Existing migrated V7 buildings reproduce their immediate nominal V7 capacity/tax/utility/garbage behavior.
4. New development can deterministically choose among legal single-use/mixed-use definitions, quality tiers, and private parking profiles based on real feasibility.
5. Quality is saved authoritative state and has monotonic economic/condition effects.
6. Condition is saved authoritative state, evolves deterministically on simulation cadence, and cannot improve without explicit renovation.
7. Condemnation/abandonment cannot leave occupants or firms in nonexistent capacity.
8. Renovation is an explicit mutually exclusive project path with deterministic cost/duration and capacity effects.
9. Private parking supply is saved authoritative project inventory and affects feasibility/cost without pretending B1 has curb/parking-search simulation.
10. V8 save/load is exact and V7 migration is deterministic and validated.
11. Presentation uses only authoritative semantic state and keeps Pass A camera/picking/depth contracts intact.
12. North American building visuals show materially greater architectural, mixed-use, quality, condition, and parking diversity with no missing-asset diagnostics.
13. The complete regression/build/browser/visual gate is green on the exact final head and again on the merged `main` head.

## Deferred Follow-On

After B1, the next urban-depth tranche may add the public realm and deeper Phase 2R/3R mechanics: explicit parcel geometry, formal parks/recreation, sidewalks/plazas as simulation entities, parking occupancy/curb supply, FAR/setbacks, ownership, land assembly, building units/suites, and richer renovation/redevelopment economics. Those features must use B1's semantic state rather than bypass it.
