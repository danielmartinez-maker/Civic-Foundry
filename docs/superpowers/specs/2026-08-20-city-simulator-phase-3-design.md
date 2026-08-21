# Civic Foundry Phase 3 — Traffic Design

## Status
Approved for design by the user after review of the Phase 3 architecture in chat. This specification is the written implementation contract for the next playable vertical slice.

## Goal
Turn the Phase 2 city-management loop into a transportation-aware simulation where actual road layout creates measurable consequences for travel time, congestion, accessibility, and development. Citizens must generate journeys, vehicles must traverse routed paths, intersections must create queues, and congestion must be computed from real weighted traffic flow rather than arbitrary penalties.

## Binding Scope
Phase 3 adds exactly the master prompt's Phase 3 systems:
- transportation graph
- citizens traveling
- vehicles
- congestion
- intersections
- route finding
- traffic overlays

The acceptance target is: **urban form creates meaningful transportation consequences.**

Phase 4 public-service fleets, Phase 5 public transport, Phase 6 freight/supply chains, parking simulation, full lane-level engineering, signal-timing editors, highways, grade-separated interchanges, induced demand, and later redevelopment/land-value mechanics remain out of scope except for stable interfaces required to avoid architectural dead ends.

## Existing Foundation to Preserve
The verified Phase 2 checkpoint provides:
- deterministic `SimulationCore`
- seeded terrain and spatial indexing
- road placement, demolition, road revisions, and road-connected components
- zoning, lots, construction, and occupied buildings
- population, employment, R/C/I demand, taxes, utilities, garbage, and recurring fiscal settlement
- V2 versioned save/load with V1 migration
- Canvas 2D world rendering, HUD, inspectors, tools, notifications, and debug overlays
- 81-test verified baseline

Phase 3 extends these systems incrementally. Existing road, economy, utility, and save behavior must remain functional.

## Architectural Approach
Use a hybrid mesoscopic traffic simulation.

The road network remains authoritative world state. Traffic derives a graph from it. Trips are generated from real occupied buildings and aggregate population/employment state. Active vehicle agents are explicit simulation objects, but each vehicle carries a `travelerWeight` so one vehicle can represent a deterministic cohort of similar trips at larger city scales.

This preserves visible, causal vehicle movement while keeping simulation cost bounded. It also keeps the later option to increase detail near the camera or aggregate farther away without changing traffic accounting semantics.

New modules:
- `TransportationGraph`: derives deterministic graph nodes/edges from roads and exposes graph revision.
- `PathfindingSystem`: A* routing, route-cost calculation, route cache, cache invalidation, diagnostics.
- `TripGenerationSystem`: deterministic demand for commute and shopping journeys from occupied buildings.
- `TrafficSystem`: owns active trips/vehicles, edge-flow accounting, movement, delays, completion metrics.
- `IntersectionSystem`: deterministic approach queues, intersection service capacity, queue delay, bottleneck metrics.
- `TrafficAnalytics`: computes citywide commute/accessibility/congestion snapshots for economy/UI consumers.

Presentation modules:
- `VehicleRenderer`: renders active vehicles only; never owns simulation state.
- `TrafficOverlayLayer`: renders congestion, speed, volume, and bottlenecks from traffic snapshots.

`SimulationCore` coordinates update order and exposes immutable traffic snapshots.

## Road Model Upgrade
Phase 3 introduces explicit road archetypes and intersection-capable geometry while preserving the existing grid-based road placement model.

Initial road classes:
- `local`: low construction cost, low free-flow speed, low capacity
- `collector`: moderate construction cost, speed, and capacity
- `arterial`: higher construction cost, speed, and capacity

Each road definition contains data-driven values:
- constructionCostPerCell
- freeFlowSpeedCellsPerSecond
- weightedVehicleCapacityPerMinute
- intersectionServiceRate
- renderWidth

Highways are not included in Phase 3.

### Road Connectivity and Intersections
The existing road placement rules are extended so roads can join and cross existing roads legally.

Valid intersections:
- endpoint joins
- T intersections
- four-way orthogonal intersections

Invalid overlap remains rejected when placement would duplicate an already occupied road corridor without changing topology.

The authoritative road grid remains cell-based. An intersection is a road cell whose cardinal road neighbors produce degree 3+ or a through crossing with distinct approach directions.

Road edits increment the existing road revision. Transportation graph and route caches react to this revision rather than polling/rebuilding every tick.

## Transportation Graph
The transportation graph is derived state; it is not an independent editable network.

### Nodes
Create graph nodes at:
- road endpoints
- intersections
- direction/topology changes where a corridor must be split for deterministic routing

Node IDs must be deterministic from canonical grid position/topology data.

### Edges
An edge represents a contiguous road corridor between nodes.

Each directed edge stores:
- edgeId
- fromNodeId
- toNodeId
- ordered road cells
- roadClass
- lengthCells
- freeFlowTravelTicks
- weightedCapacity
- currentWeightedVolume
- utilization
- averageSpeedCellsPerSecond
- congestionRatio
- currentTravelTicks
- queueContributionTicks

Roads are bidirectional in Phase 3 unless a later phase adds one-way configuration. Therefore each physical corridor normally creates two directed edges.

Graph rebuilding is deterministic and only occurs after road revision changes. Route/path caches are keyed by graph revision.

## Pathfinding
Use deterministic A* on the transportation graph.

### Generalized Cost
For Phase 3 private-vehicle routing:

`generalizedCostTicks = travelTimeTicks + congestionDelayTicks + intersectionDelayTicks`

The broader master formula includes tolls, parking, transit waiting, walking, and transfer penalties. Those terms are zero/not applicable in Phase 3 rather than implemented as fake systems.

### Route Cache
Cache route results by:
- graph revision
- origin access node
- destination access node
- mode (`private_vehicle`)
- traffic-cost epoch

Topology changes invalidate the cache immediately through graph revision.

Congestion does not need to invalidate all routes every traffic tick. Increment a coarser `trafficCostEpoch` on the traffic analytics cadence when meaningful edge-cost changes exceed a configurable threshold. This allows route reuse while still letting citizens adapt to persistent congestion.

Expose diagnostics:
- routeRequests
- cacheHits
- cacheMisses
- failedRoutes
- averageExpandedNodes
- route-compute duration

### Deterministic Ties
When candidate costs are equal within numeric tolerance, tie-break by stable node/edge ID. Same seed/state/commands must produce the same route.

### Pathfinding Failure
If no valid route exists:
- the trip is marked failed/unreachable
- no vehicle is spawned or an already-active vehicle transitions to failed safely
- diagnostics increment
- the failure feeds accessibility statistics
- no entity is left permanently queued

## Building Access to Roads
Occupied buildings use their road-frontage/access cell to attach to the graph.

If an occupied building has no currently routable road access because a player demolished its connection:
- it remains a valid building
- trip generation may create demand, but routes fail as unreachable
- accessibility drops
- service/utilities retain their own existing connectivity semantics

Buildings do not teleport to the nearest unrelated road.

## Trip Generation
Phase 3 keeps aggregate population/employment authoritative. It does not introduce a full persistent household/citizen-life simulation.

`TripGenerationSystem` creates deterministic weighted journeys from real occupied buildings.

### Journey Types
Phase 3 journey purposes:
- `commute_outbound`: residential -> occupied job building
- `commute_return`: job building -> residential
- `shopping_outbound`: residential -> occupied commercial building
- `shopping_return`: commercial building -> residential

Freight is deferred to Phase 6.

### Trip State
Each journey has:
- tripId
- purpose
- originBuildingId
- destinationBuildingId
- departureTick
- mode: `private_vehicle`
- travelerWeight
- expectedGeneralizedCostTicks
- routeEdgeIds
- status: `pending | active | completed | failed`
- actualTravelTicks
- accumulatedQueueTicks

### Weighted Agent Scaling
A vehicle represents one or more travelers.

Target active vehicle count is bounded by configurable population scaling. A deterministic cohort factor increases as represented population grows.

Traffic accounting uses `travelerWeight`, not raw rendered vehicle count. Therefore aggregation does not artificially lower congestion.

Trip generation must use a dedicated seeded RNG stream/fork so adding traffic cannot perturb terrain/building visual randomness or other established deterministic sequences.

### Destination Selection
Commute destinations are selected from occupied commercial/industrial job capacity. Selection should prefer actual available job distribution rather than arbitrary random map cells.

Shopping destinations are selected from occupied commercial buildings with weight derived from building capacity/tax-base proxy in the absence of detailed business sales state.

Tie/selection behavior is deterministic under the traffic RNG stream.

## Traffic System
`TrafficSystem` owns active private vehicles and edge flow.

### Vehicle State
Each active vehicle contains:
- vehicleId
- tripId
- travelerWeight
- routeEdgeIds
- routeIndex
- progressOnEdge 0..1
- speedCellsPerSecond
- desiredSpeedCellsPerSecond
- state: `moving | queued | completed | failed`
- accumulatedTravelTicks
- accumulatedQueueTicks

Vehicle position is authoritative enough to continue after save/load; rendering interpolates from the authoritative position but cannot change it.

### Edge Volume
For each edge:

`weightedVolume = sum(travelerWeight of active vehicles currently occupying/queued for edge)`

`utilization = weightedVolume / effectiveEdgeCapacity`

Congestion must derive from this utilization.

### Congestion Curve
Use a configurable BPR-style travel-time relationship:

`travelTime = freeFlowTime * (1 + alpha * utilization^beta)`

Initial defaults:
- alpha = 0.15
- beta = 4

Clamp extreme values to a documented maximum multiplier so pathological congestion does not produce infinities/NaNs.

`averageSpeed = length / travelTime`

The exact numeric capacity units are balance parameters, but tests must establish:
- zero volume -> free-flow travel time
- near-capacity volume -> measurable slowdown
- severe over-capacity -> substantial delay
- all outputs finite/non-negative

### Vehicle Movement
Movement is deterministic fixed-step simulation.

Vehicles:
1. accelerate toward edge's current desired speed
2. advance progress according to speed and tick duration
3. enter an intersection queue when the next node requires service
4. wait until `IntersectionSystem` grants passage
5. enter the next edge
6. complete when final destination access node is reached

No random lane wandering or decorative movement.

Phase 3 does not simulate lane-changing or detailed car-following. The mesoscopic capacity/queue model supplies interaction effects.

## Intersection System
Intersections own deterministic approach queues.

For every graph node with multiple approaches, track:
- per-incoming-edge queue
- weighted queue length
- service capacity per traffic update
- average queue delay
- maximum queue delay
- throughput

### Initial Control Model
Phase 3 uses automatic deterministic intersection service rather than exposing traffic-light editors.

At each service interval:
- available intersection service capacity derives from connected road definitions
- approaches receive deterministic fair service using stable rotation/round-robin order
- vehicles maintain FIFO within each incoming edge
- if demand exceeds service capacity, queue grows

This makes intersection bottlenecks real without prematurely implementing signal phases/lane arrows.

### Turning/Merging
A vehicle's next route edge defines its turn. Turn movement consumes intersection capacity. Conflicting lane-level movement groups are aggregated in Phase 3.

## Congestion Feedback and Traffic Analytics
`TrafficAnalytics` computes derived snapshots from actual trips, vehicles, queues, and graph edges.

Citywide metrics:
- activeVehicleCount
- representedActiveTravelers
- completedTripsWindow
- failedTripsWindow
- averageCommuteTicks
- averageTripTicks
- averageQueueTicks
- averageNetworkSpeed
- congestionIndex
- delayedTripRatio
- jobAccessibility
- commercialAccessibility
- worstBottleneckNodeIds

### Congestion Index
Population/trip-weighted average of bounded edge congestion:

`edgeCongestion = clamp01((travelTime / freeFlowTime - 1) / congestionReferenceMultiplier)`

Network congestion weights edges by recent represented trip volume so unused streets do not dominate the average.

### Job Accessibility
Measure the share/quality of job opportunities reachable from occupied residential buildings under reasonable travel cost.

For Phase 3, normalized accessibility can combine:
- route success ratio
- average commute relative to configured acceptable commute ticks

Example bounded formulation:

`commuteQuality = clamp01(1 - averageCommuteTicks / maxAcceptableCommuteTicks)`

`jobAccessibility = routeSuccessRatio * commuteQuality`

Commercial accessibility uses shopping-trip equivalents.

### Feedback into Phase 2 Demand
Traffic must affect the city loop in bounded, explainable form.

Residential demand adds a transportation modifier derived from job accessibility.
Commercial demand adds a modifier derived from customer/commercial accessibility.
Industrial demand is not modified by freight in Phase 3 because freight is not implemented yet; only generic labor accessibility may affect it if a real measured signal already exists.

Traffic modifiers are capped so they influence but do not completely replace employment, utilities, taxes, and existing demand fundamentals.

Migration attractiveness receives a bounded transportation quality contribution/penalty. Essential utility failure remains more severe than congestion.

The inspector/debug panel must expose the contributing traffic accessibility values so a demand change is understandable.

## Road Hierarchy Consequences
The three road classes must produce meaningful network differences through their actual speed/capacity values.

A road does not receive an arbitrary 'good hierarchy' bonus.

Instead:
- local streets carry lower capacity/slower speed
- collectors provide better movement between local networks
- arterials carry larger/faster flows

A city that funnels major commuting demand through one local street should congest because real weighted demand exceeds that road's capacity. Upgrading or adding a collector/arterial alternative improves the result through actual routing/capacity, not a hidden score.

This is the Phase 3 expression of the master prompt's local -> collector -> arterial -> highway hierarchy. Highway remains deferred.

## Player Road Tools
Extend the existing road tool with road-class selection.

Required player options:
- Local Street
- Collector
- Arterial

The preview shows:
- road class
- valid/invalid geometry
- construction cost
- connection/intersection result

Road class is persisted as authoritative road state.

Existing bulldoze behavior removes roads, increments network revision, invalidates traffic routes, and forces safe rerouting/failure as appropriate.

## Traffic Presentation
### Vehicle Renderer
Render active vehicles from traffic snapshots.

Visual requirements:
- vehicles visibly move along roads
- direction is readable
- avoid excessive detail at small zoom
- rendering may cap/aggregate visible vehicle sprites for performance but must not alter simulation counts/weights

### Traffic Overlays
Selectable overlays:
- congestion
- speed
- volume
- intersection bottlenecks

The master prompt also lists freight/public-transit usage overlays; these are deferred until those systems exist.

Overlay values come directly from TrafficSystem/TrafficAnalytics snapshots.

### Road Inspector
Inspecting a road exposes:
- road class
- free-flow speed
- capacity
- weighted traffic volume
- utilization
- average speed
- congestion ratio
- current travel time/delay

### Intersection Inspector
Expose:
- connected approaches
- approach weighted volumes
- current queue lengths
- average/max queue delay
- throughput

### HUD
Add compact traffic summary:
- congestion percentage/index
- average commute
- average network speed
- job accessibility
- active vehicles

### Explainable Alerts
Transition-based alerts:
- network becomes disconnected for significant trip demand
- congestion crosses severe threshold
- congestion later recovers

Do not spam every tick.

## Debug and Profiling
Extend developer diagnostics with:
- graph node count
- graph edge count
- graph revision
- active traffic agents
- represented travelers
- route requests
- pathfinding cache hits/misses
- failed routes
- traffic update duration
- pathfinding duration

Debug overlays:
- transportation nodes/edges
- active route for inspected vehicle/trip
- intersection queue values

These tools are diagnostic only and never required for normal gameplay.

## Save Format V3
Phase 3 advances the authoritative save envelope to `saveVersion: 3`.

Persist:
- road class for every road segment/cell as required by road schema
- traffic deterministic RNG state
- active trips
- active vehicle route/progress state
- intersection queue membership/order
- traffic cost epoch
- rolling traffic statistics required for deterministic continuation

Do not persist rebuildable derived data:
- transportation graph nodes/edges
- route cache
- overlay render state
- graph diagnostics that can be recomputed

### V2 Migration
A V2 save migrates by:
- mapping legacy roads to `local` road class
- starting with no active trips/vehicles
- initializing traffic RNG deterministically from the saved city seed/state
- empty queue/traffic windows
- graph rebuilt from migrated roads

V1 -> V2 -> V3 migration remains supported through existing migration chain.

### Safe Hydration
Hydration order:
1. validate/migrate authoritative world/economy state
2. restore roads/buildings/population/utilities
3. rebuild transportation graph
4. restore active traffic entities only after validating referenced buildings/edges can be resolved
5. gracefully fail/drop corrupt traffic entities rather than corrupting the city
6. rebuild route caches empty
7. recompute derived traffic snapshots without advancing simulation time

## Performance Architecture
Traffic is expected to become one of the largest simulation costs.

Phase 3 therefore requires:
- weighted trip cohorts rather than one persistent vehicle per citizen
- graph rebuild only on road revision
- cached routes
- coarser traffic-cost cache invalidation
- traffic updates at a configurable cadence distinct from long-horizon economy/demographics
- renderer sprite culling/capping independent of traffic accounting

Initial cadence proposal at 10 base ticks/second:
- vehicle/intersection movement: every base tick
- trip generation: every 10 ticks
- congestion/analytics: every 10 ticks
- route cost epoch evaluation: every 50 ticks
- existing economy/demand remains on its Phase 2 cadence

All cadences live in data/balance configuration.

### Performance Acceptance
Record, do not fabricate:
- traffic update duration
- pathfinding duration/request
- active agent count
- graph size
- route cache hit rate

Headless benchmarks include increasing weighted population/trip load. If a large test cannot literally run multi-year per-tick simulation economically, document the limit rather than claiming an unrun benchmark.

## Testing Strategy
Every traffic subsystem requires tests.

### Unit Tests
- deterministic road-class data and cost/capacity
- valid T/four-way intersections and invalid duplicate road placement
- graph node/edge derivation
- graph revision invalidation
- A* shortest/generalized-cost route
- deterministic tie breaking
- unreachable route fallback
- route cache hit/miss/invalidation
- volume/capacity congestion formula
- intersection FIFO/service behavior
- deterministic trip cohort generation
- vehicle edge progress and completion
- accessibility normalization

### Integration Tests
- residence -> job trip traverses actual roads
- road demolition invalidates/reroutes active route
- overloaded corridor develops greater delay than parallel-capacity alternative
- intersection queue grows when arrival demand exceeds service capacity
- high congestion lowers measured accessibility
- lower accessibility feeds Phase 2 demand
- fixing topology/capacity improves accessibility/demand
- V2 -> V3 migration
- V3 save/load deterministic traffic continuation

### Headless Simulation Tests
Create otherwise comparable cities with:
- efficient road hierarchy/capacity
- deliberately bottlenecked road topology

Verify the bottlenecked city has measurably:
- higher congestion
- longer average commute
- more intersection delay
- lower accessibility
- weaker development outcome over the test horizon

All numeric state must remain finite and deterministic.

### Browser Smoke Test
Real compiled browser scenario:
1. load Phase 3 game
2. build local/collector/arterial network
3. zone/place utilities to create residents and jobs
4. advance simulation until vehicles travel
5. activate traffic overlay
6. observe nonzero traffic metrics
7. create a capacity bottleneck or remove a connection
8. observe congestion/disconnection feedback
9. save V3
10. modify roads
11. load V3
12. verify roads/traffic continuation restore safely

## Documentation
Update:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/SIMULATION.md`
- `docs/SAVE_FORMAT.md`
- `docs/BALANCING.md`
- `docs/TESTING.md`
- `docs/DEVELOPMENT_LOG.md`

Document exact traffic formulas and configured default values after implementation.

## Acceptance Criteria
Phase 3 is complete only when all of the following are verified:
1. transportation graph is derived from actual roads and rebuilds only after road changes
2. occupied buildings generate deterministic routable journeys
3. active vehicles physically progress along routes in authoritative simulation state
4. intersections create deterministic queues/capacity delay
5. congestion derives from real weighted traffic volume versus capacity
6. A* route selection responds to generalized travel cost
7. road topology/capacity creates measurable commute differences
8. traffic accessibility feeds Phase 2 development demand
9. traffic overlays/inspectors explain volume, speed, congestion, and bottlenecks
10. V2 saves migrate and V3 traffic state continues deterministically after save/load
11. headless simulation proves good and poor road networks produce different outcomes
12. browser smoke test proves the playable end-to-end loop
13. full automated tests, typecheck, lint, and production build pass
14. traffic/pathfinding performance metrics are recorded
15. stable Phase 3 state is committed before Phase 4 begins

## Explicit Non-Goals
Do not claim or partially fake these in Phase 3:
- buses/trams/metro/rail/ferries
- freight/logistics traffic
- parking search
- bicycles/pedestrian routing as full simulation modes
- traffic-light timing editor
- lane-level turn-arrow editor
- reversible lanes
- grade-separated interchanges
- highways
- toll systems
- emergency vehicles
- service vehicle routing
- induced demand
- full microscopic car-following/lane-changing model

The architecture must leave extension points for them without implementing placeholders presented as finished systems.
