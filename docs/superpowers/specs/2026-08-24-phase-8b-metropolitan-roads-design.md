# Phase 8B — Metropolitan Roads Design

## Status

Approved architectural direction for the second Phase 8 — Metropolitan Infrastructure slice.

Phase 8B begins only after Phase 8A utility networks are implemented and merged. It extends Civic Foundry from a surface-road city network into a metropolitan road system with limited-access expressways/highways, explicit access connectors, lane/capacity upgrades, freight advantages, induced demand and development/land-value consequences.

The design intentionally keeps the mature Phase 3 road/traffic stack intact for local, collector and arterial streets. Limited-access roads are introduced as a separate authoritative layer and composed into the existing transportation graph.

## Goals

Phase 8B must make metropolitan road investment materially different from simply drawing a faster arterial.

The player must be able to build a corridor that:

- moves long-distance traffic faster at high capacity
- does not create direct building frontage or arbitrary local intersections
- requires explicit ramps/interchanges to enter or leave
- can cross ordinary surface roads without automatically connecting
- benefits freight and regional accessibility
- can become congested and induce additional discretionary travel
- produces measurable local nuisance around the corridor while improving broader accessibility
- can be upgraded at significant capital and operating cost

## Non-goals

Phase 8B does not add:

- full lane-by-lane microsimulation
- signal timing plans for freeway ramps
- HOV/HOT lanes, dynamic toll pricing or congestion pricing
- parking supply/price
- road maintenance deterioration; later municipal-finance/resilience phases may deepen this
- bridges/tunnels across currently unbuildable terrain as a full megaproject system; Phase 13 owns major-project complexity
- highway-to-highway multi-level stack interchanges with arbitrary geometric engineering
- regional off-map cities; Phase 14 owns regional simulation

## Existing baseline and compatibility constraints

The V7/Phase 8A baseline has a mature `RoadSystem` for `local | collector | arterial`, a `TransportationGraph` derived from cardinal road adjacency, deterministic A* pathfinding, traffic edge load, intersection queues, transit surface vehicles, freight trucks, service vehicles, accessibility metrics and development/property-market feedback.

Existing buildings and lots require surface-road frontage. Those rules remain.

Phase 8B must not turn limited-access highways into frontage roads, must not silently connect every adjacent surface road, and must keep all existing surface-road tests valid except where save-version/type unions explicitly expand.

## Architectural decision

### 1. Separate `HighwaySystem`

Do not overload `RoadSystem` with limited-access semantics.

Introduce `HighwaySystem` as an authoritative spatial layer owning:

- limited-access corridor cells
- class: `expressway | highway`
- upgrade tier `1 | 2 | 3`
- stable segment/cell IDs
- ramp/interchange connectors
- topology revision
- construction/removal/upgrades
- persistence snapshot/restore

A highway cell may coexist with a surface-road cell at the same world coordinate because the systems represent different vertical/access layers. Co-location does not imply a connection.

`RoadSystem` continues to own only local/collector/arterial surface streets.

### 2. Reuse the Phase 8A `InfrastructureGraph`

`HighwaySystem` reuses the minimal `InfrastructureGraph` introduced in Phase 8A for deterministic limited-access topology construction, stable adjacency ordering and capacity metadata.

It does **not** use utility max-flow semantics for traffic. The shared graph is only the common topology/capacity substrate. Highway traffic remains authoritative in `TransportationGraph` + `TrafficSystem`.

This preserves the approved shared-infrastructure architecture without turning one generic graph into a domain-god object.

### 3. Transportation graph composition

`TransportationGraph` remains the canonical graph consumed by pathfinding, traffic, service vehicles, mobility and freight.

Its build step is extended to compose:

- surface-road nodes/edges from `RoadSystem`
- limited-access nodes/edges derived by `HighwaySystem`
- explicit connector edges from ramps/interchanges

Use distinct stable IDs:

- surface node: existing `n:x,y`
- highway node: `h:x,y`
- surface edge: existing `e:...`
- highway edge: `he:...`
- connector edge: `hc:<connectorId>:<direction>`

A surface and highway node can occupy the same coordinate and remain disconnected unless an authoritative connector exists.

Topology cache invalidation depends on both road revision and highway revision.

### 4. Highway classes

Initial base definitions:

| Class | Free-flow speed | Weighted capacity/min | Access |
| --- | ---: | ---: | --- |
| expressway | 6 cells/s | 420 | limited |
| highway | 8 cells/s | 720 | limited |

Construction and operating cost constants live in data definitions. They are balance constants rather than architectural constants, but must satisfy these required relationships:

- expressway construction cost/cell > arterial construction cost/cell
- highway construction cost/cell > expressway construction cost/cell
- Tier 2/3 upgrade cost is positive and less than rebuilding the same corridor from scratch
- highway operating cost/cell > expressway operating cost/cell > 0
- a metropolitan corridor must be material relative to the starting treasury and therefore cannot be spam-built without fiscal consequence

Both classes are limited access:

- no building frontage
- no lot generation
- no automatic adjacency connection to surface streets
- no at-grade ordinary intersection service

Contiguous cardinal highway cells connect automatically to one another within the limited-access layer.

### 5. Upgrade tiers

Every highway cell has tier `1 | 2 | 3`.

Capacity multipliers:

- Tier 1: `1.0x`
- Tier 2: `1.5x`
- Tier 3: `2.0x`

Free-flow speed does not double with capacity. Speed multipliers are deliberately modest:

- Tier 1: `1.00x`
- Tier 2: `1.05x`
- Tier 3: `1.10x`

This makes widening primarily a throughput investment rather than a magical speed increase.

Upgrade construction cost charges only the delta from the current tier. Operating cost rises by tier and corridor length.

No downgrade in Phase 8B.

### 6. Ramps and interchanges

Access is explicit.

Two connector types:

#### Ramp

A ramp connects one highway node to one cardinally adjacent or co-located eligible surface-road node.

Eligible surface road:

- collector
- arterial

Local roads cannot connect directly to a highway ramp in Phase 8B.

Initial ramp transport characteristics:

- weighted rated capacity: `180/min`
- fixed connector free-flow delay: `3 ticks`
- bidirectional in the first implementation

#### Interchange

An interchange is a higher-capacity access connector between a limited-access node and an arterial surface node. It represents a larger grade-separated junction and supports greater connector throughput with lower per-vehicle connector delay than a simple ramp, at much higher construction/operating cost.

Initial interchange transport characteristics:

- weighted rated capacity: `360/min`
- fixed connector free-flow delay: `1 tick`
- bidirectional in the first implementation

Phase 8B does not model arbitrary multi-level highway-over-highway geometry. Contiguous/branching highway corridors already connect in the limited-access layer; explicit interchange objects in this slice primarily model high-capacity highway-to-surface access.

A highway passing over a surface road without a ramp/interchange has zero graph connection.

### 7. Routing and generalized cost

Existing A* remains the route engine. It receives composed graph edges with class-specific travel time/capacity.

Cars, service vehicles, transit surface vehicles and freight may use highway edges when they can reach them through connectors, subject to existing route eligibility.

No arbitrary highway preference bonus is added. Highway use emerges from lower generalized travel cost and capacity.

Freight naturally benefits because:

- highway/expressway free-flow travel time is lower
- weighted capacity is much higher
- highway nodes avoid ordinary surface intersection queues

If freight and car routes have equal generalized cost, existing stable edge-ID tie breaking remains deterministic.

### 8. Traffic and congestion

Highway edges enter the authoritative `TrafficSystem` like other transportation edges but use highway capacity/free-flow definitions.

Rated capacity is a congestion threshold, not a hard cap on instantaneous weighted demand. Highway/connector utilization may exceed `1.0`, and that overload must increase experienced travel time/queueing through the existing traffic mechanics.

Limited-access edges do not use ordinary intersection service at every cell. Queue/service delay applies at explicit connector edges and at genuine limited-access merge/branch points only.

The first implementation treats a simple contiguous highway node as unconstrained through-movement except for edge congestion capacity. Ramps/interchanges have explicit connector service capacity and can queue traffic.

Traffic analytics must include highway edges in:

- travel time
- congestion
- average speed
- accessibility
- route outcomes

Overlay/inspection must distinguish surface and limited-access congestion.

### 9. Induced demand

Phase 8B models induced travel through measured accessibility, not a flat road-building bonus.

Mandatory commute cohort weight remains population/employment driven and is not directly inflated by highway construction.

Discretionary/shopping trip generation receives a bounded accessibility elasticity using the existing authoritative person-accessibility signal:

`discretionaryTripMultiplier = clamp(0.85 + 0.30 * personAccessibility, 0.85, 1.15)`

This means improved metropolitan accessibility can generate up to 15% more discretionary weighted travel from the same population; poor accessibility suppresses it by up to 15%.

Because the multiplier is recomputed from current measured accessibility, congestion can erode the initial highway benefit and reduce the induced increment. The causal loop is:

`capacity/speed → lower experienced travel cost → higher accessibility → more discretionary trips → more traffic → new experienced travel cost`.

No additional induced-demand state needs persistence.

Freight does not receive a separate artificial multiplier. Better logistics already increases firm competitiveness/output through the Phase 6 economy, which can organically create more freight orders.

### 10. Surface access and land-development consequences

Highways do not create frontage and therefore do not create `LotSystem` development access.

A parcel's positive accessibility benefit must come through the existing measured person/freight accessibility channels after a usable surface-road/ramp path exists.

Do not add a flat land-value bonus merely for being near a highway.

Add a bounded local corridor-nuisance diagnostic to represent noise/severance before the later environmental phase:

- residential/commercial cells at Manhattan distance `1` from an expressway/highway cell receive the maximum local nuisance penalty
- nuisance decays linearly to zero at Manhattan distance `3`
- maximum nuisance score at distance `1` is `0.12` for highway and `0.08` for expressway
- at distance `2`, the score is half the maximum
- at distance `3` or greater, the score is zero
- industrial parcels receive no nuisance penalty in Phase 8B

The nuisance score feeds existing neighborhood/property-market quality channels as a bounded negative modifier. It must never bypass utility/service/accessibility calculations.

This creates the intended spatial trade-off: a neighborhood can gain metropolitan access through a nearby interchange while immediate corridor-adjacent parcels bear a local penalty.

### 11. Freight corridor behavior

Phase 8B does not introduce a separate freight-road designation system.

A highway becomes a freight corridor when its actual generalized cost makes freight routing prefer it. The freight system consumes the same composed transportation graph and real traffic travel times.

Acceptance tests must prove a heavy freight route switches to a highway when it reduces generalized cost and can switch back when connector/highway congestion makes the surface route cheaper.

### 12. Construction and treasury semantics

Player mutations route through typed `SimulationCore` APIs.

Likely operations:

- build expressway/highway path
- place ramp
- place interchange
- upgrade highway path
- bulldoze connector/highway path

All placement is atomic:

- validate terrain/path/connectors first
- calculate exact cost
- debit treasury once
- commit topology only after successful debit

Highway paths may use buildable terrain and may coexist with surface roads. They may not use water/unbuildable terrain in Phase 8B; bridges/tunnels are deferred.

Connector placement validates both referenced layers and does not silently create missing roads.

Demolition immediately invalidates affected graph routes. Active vehicles use the existing reroute/failure behavior and may not retain stale connector/highway edge references.

### 13. Simulation ordering

Relevant order remains:

1. topology mutation
2. transportation graph rebuild on road/highway revision
3. pathfinding/routing
4. vehicle/traffic advancement
5. traffic analytics/accessibility
6. trip generation/mode choice on scheduled cadence
7. services/economy/property market/development consume measured accessibility and logistics outcomes

Induced discretionary demand uses the prior/current stable accessibility snapshot on the existing trip-generation cadence rather than recursively generating additional trips inside the same tick.

### 14. Persistence — Save V8 extension

Phase 8B extends the Phase 8A Save V8 envelope rather than introducing V9.

Add optional `highwayInfrastructure` for backward compatibility with Phase 8A-only V8 saves.

Persist:

- highway cells/class/tier
- connectors/type/endpoints
- deterministic next IDs
- highway topology revision/cursors only where exact continuation requires them

Do not persist:

- composed transportation graph
- path cache
- current accessibility metrics
- corridor nuisance maps
- derived congestion overlays

Those are rebuilt from authoritative road/highway/traffic state.

Loading V7 through V8 migration creates no highway topology. Loading an 8A-only V8 save initializes an empty highway state.

Hydration validates:

- in-bounds/buildable highway cells
- valid class/tier
- connector endpoint existence
- connector surface-road eligibility
- no duplicate connector identity
- active traffic route references after graph reconstruction

### 15. UI and player controls

Add metropolitan-road tools to the Infrastructure surface:

- draw expressway
- draw highway
- place ramp
- place interchange
- upgrade selected corridor
- remove corridor/connector

Presentation:

- total expressway/highway length by tier
- corridor weighted capacity
- highway vehicle load
- connector utilization
- average highway speed
- top bottleneck connectors/segments
- metropolitan-road operating cost

Overlays:

- highway congestion/utilization
- connector bottlenecks
- metropolitan accessibility
- corridor nuisance

Inspector:

- class
- tier
- free-flow speed
- current speed
- rated capacity
- current weighted load/utilization, including values above `1.0`
- connector status
- operating cost
- nearby nuisance contribution

The main world renderer visually differentiates limited-access infrastructure from ordinary roads and renders it as a separate layer. It must not imply an intersection where the graph has none.

### 16. Public API direction

Likely seams:

- `SimulationCore.buildHighwayPath(...)`
- `SimulationCore.placeHighwayConnector(...)`
- `SimulationCore.upgradeHighwayPath(...)`
- `SimulationCore.removeHighwayAt(...)`
- `HighwaySystem.snapshotState()` / `restoreState()`
- `TransportationGraph.rebuildIfNeeded(roads, highways)` or an equivalent composed-source interface

Exact naming may vary during implementation only if ownership and typed-mutation boundaries remain unchanged.

### 17. Error handling and invariants

Required invariants:

- surface/highway co-location creates no implicit graph connection
- every connector references existing valid nodes
- local roads cannot directly host highway access connectors
- highway cells never produce building frontage/lots
- edge load/utilization is finite and non-negative
- rated capacity is finite and positive; traffic utilization may exceed `1.0` and must remain observable rather than clipped away
- connector queue service never emits more weighted traffic per service interval than the connector's service capacity permits
- topology revision invalidates routes/cache deterministically
- demolition cannot leave stale active route references
- identical topology/state yields identical routes and graph ordering independent of input iteration

### 18. Tests and acceptance criteria

TDD coverage must prove at minimum:

1. an expressway/highway can coexist spatially with a surface road without connecting
2. a route cannot enter the limited-access layer without a ramp/interchange
3. a ramp makes the route available and reduces generalized travel cost when the highway is objectively faster
4. local roads cannot receive direct highway ramps
5. highways create no frontage lots or direct building access
6. highway/expressway definitions provide greater speed/capacity and greater cost than arterials
7. Tier 2/3 upgrades raise capacity by exactly the specified multipliers
8. connector demand can exceed rated capacity, creating utilization above `1.0` and queueing while the mainline remains uncongested
9. freight prefers the highway when generalized freight cost is lower
10. congestion can reverse that freight route decision
11. improved person accessibility increases discretionary trip weight but never above the 1.15 cap
12. mandatory commute weight is unchanged by the induced-demand multiplier
13. corridor nuisance is strongest at distance 1, half-strength at distance 2 and zero by distance 3
14. industrial parcels receive zero nuisance penalty
15. positive land/development effects arise through measured access rather than raw proximity
16. removing a highway/connector invalidates or reroutes active users safely
17. Save V8 round-trips highway topology/connectors/upgrades and continues deterministically
18. an 8A-only V8 save loads with empty highway state
19. long-run traffic remains finite with high highway loads and connector queues
20. Chromium smoke builds a corridor + connector, demonstrates a real route/accessibility change and inspects authoritative congestion data

Full pre-merge verification remains:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Phase 8B Chromium smoke
- exact-head PR CI
- review/comment/thread check

## Phase boundary

Phase 8B is complete when metropolitan limited-access roads operate as a distinct access-controlled network integrated into real routing/congestion/freight/development outcomes, induced discretionary demand responds to measured accessibility, and the entire highway topology persists within Save V8.

At that point Phase 8 — Metropolitan Infrastructure is complete: explicit utility networks constrain urban development, and metropolitan road investment changes regional movement without collapsing back into ordinary surface-road behavior.