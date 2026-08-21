# Civic Foundry Phase 4 — Public Services Design

## Status
Approved for design by the user after review of the Phase 4 architecture in chat. This specification is the written implementation contract for the next playable vertical slice.

## Goal
Turn the Phase 3 transportation-aware city into a service-dependent city where fire protection, policing, healthcare, education, and garbage collection are constrained by real capacity, funding, staffing, road accessibility, traffic, and dispatched service vehicles. Neighborhood quality must respond to measured service outcomes rather than circular-radius coverage or arbitrary happiness modifiers.

## Binding Scope
Phase 4 adds exactly the master prompt's Phase 4 systems:
- fire
- police
- healthcare
- education
- garbage expansion
- service vehicles

The acceptance target is: **neighborhood quality depends on infrastructure and accessibility.**

Phase 5 public transport, Phase 6 freight/supply chains and labor skill depth, Phase 7 districts/land value/redevelopment, Phase 9 full pollution/environment/disaster systems, and advanced emergency-lane/signal-control tools remain out of scope except for stable interfaces required by Phase 4.

## Existing Foundation to Preserve
The verified Phase 3 checkpoint provides:
- deterministic `SimulationCore`
- terrain, spatial grid, zoning, lots, buildings, population, employment, R/C/I demand, taxes, utilities, garbage backlog, and fiscal settlement
- local/collector/arterial roads with intersections and road revisions
- deterministic transportation graph and congestion-aware A* routing
- weighted trip cohorts, moving vehicles, intersection queues, congestion, traffic analytics, and traffic feedback into development demand
- V3 save/load with migration from earlier saves
- Canvas 2D rendering, traffic overlays, HUD, inspectors, notifications, and debug diagnostics
- verified Phase 3 acceptance coverage and deterministic state continuation

Phase 4 extends these systems incrementally. Existing traffic, economy, utility, zoning, save, and rendering behavior must remain functional.

## Architectural Approach
Use a hybrid service-demand + dispatched-response simulation.

Long-horizon service demand is aggregated from authoritative city state. Facility capacity, budgets, staffing, incidents/jobs, service vehicles, routing, response time, collection work, and local service outcomes are explicit simulation state. This avoids both unsupported individual-citizen simulation and fake circular-radius service coverage.

New authoritative modules:
- `ServiceFacilitySystem` — owns public-service facilities, department budgets, effective staffing/capacity, and attached vehicle fleets.
- `ServiceDemandSystem` — derives fire risk, police demand, healthcare demand, education demand, and collectible waste from real city conditions.
- `ServiceAccessibilitySystem` — calculates network-reachable service capacity and estimated response/access time using the Phase 3 transportation graph and current travel costs.
- `ServiceDispatchSystem` — creates service jobs/incidents, selects eligible facilities/vehicles by travel-time-aware cost, and owns assignment state.
- `ServiceVehicleSystem` — routes and advances emergency/collection vehicles through the transportation graph.
- `NeighborhoodQualitySystem` — calculates per-building and citywide service quality from capacity, accessibility, response, unresolved demand, and cleanliness.

Existing systems extended:
- `TrafficSystem` / `IntersectionSystem` support `service` vehicle class and emergency priority.
- `GarbageSystem` becomes the compatibility aggregate over detailed collectible waste and processing capacity.
- `DemandSystem` and `PopulationSystem` consume neighborhood/service quality only through explicit snapshots.
- `TreasurySystem` settles service construction and recurring operating costs.
- `SimulationCore` owns deterministic update ordering and exposes immutable public-service snapshots.

Presentation modules:
- `ServiceVehicleRenderer` renders emergency and garbage vehicles from authoritative service-vehicle state.
- `ServiceOverlayLayer` renders fire, police, healthcare, education, and garbage accessibility/quality from snapshots.

## Data-Driven Service Definitions
Service content must be defined in data rather than scattered magic numbers.

### Initial Facility Archetypes
Phase 4 ships these initial archetypes:

#### Fire Station
- department: `fire`
- vehicleType: `fire_engine`
- baseVehicleCount: 2
- baseIncidentCapacity: 2 concurrent incidents
- constructionCost
- monthlyOperatingCost
- staffingRequired
- dispatchTurnaroundTicks

#### Police Station
- department: `police`
- vehicleType: `patrol_car`
- baseVehicleCount: 2
- baseIncidentCapacity: 3 concurrent jobs
- constructionCost
- monthlyOperatingCost
- staffingRequired
- dispatchTurnaroundTicks

#### Clinic
- department: `healthcare`
- vehicleType: `ambulance`
- baseVehicleCount: 1
- treatmentCapacity
- constructionCost
- monthlyOperatingCost
- staffingRequired
- dispatchTurnaroundTicks

#### Elementary School
- department: `education`
- vehicleType: none in Phase 4
- studentCapacity
- constructionCost
- monthlyOperatingCost
- staffingRequired

#### Landfill
The existing Phase 2 landfill is upgraded to a Phase 4 service facility:
- department: `garbage`
- vehicleType: `garbage_truck`
- processingCapacity
- baseVehicleCount
- constructionCost
- monthlyOperatingCost
- staffingRequired

#### Recycling Center
Adds a second garbage-processing option:
- department: `garbage`
- vehicleType: `garbage_truck`
- lower raw disposal capacity than landfill
- configurable processing/recovery efficiency
- constructionCost
- monthlyOperatingCost
- staffingRequired

Transfer station, incineration, and advanced waste processing remain compatible future definitions but are not required for the Phase 4 playable slice.

## Facility Placement
Public-service facilities use the existing command/treasury/world-placement architecture.

Placement validates before mutation:
- buildable terrain
- in-bounds footprint
- no conflicting road/building/facility occupancy
- required road frontage
- sufficient treasury funds

Placement is atomic. Failed placement changes neither treasury nor world state. Undo restores the prior world and treasury state when the construction action is still undo-eligible.

Facility IDs are deterministic from the authoritative entity sequence. Facility definitions are immutable data; runtime facility state contains staffing, budget effectiveness, vehicle ownership, active jobs, and utilization.

## Department Budgets
Each department has a configurable funding percentage:
- fire
- police
- healthcare
- education
- garbage

Allowed player range: `50%..150%`.

Default: `100%`.

Funding affects real operational quantities:
- effective staffing
- active vehicle count
- usable facility capacity
- dispatch turnaround
- service throughput

Funding does **not** directly add or subtract happiness.

Recommended Phase 4 funding effectiveness curve:

`fundingEffectiveness = clamp(0.5, 1.25, 0.35 + 0.65 * fundingRatio)`

Where `fundingRatio = fundingPercent / 100`.

Values above 100% improve resilience/throughput but have diminishing returns. Values below 100% reduce effective capacity and can deactivate vehicles when staffing becomes insufficient.

Recurring department cost:

`actualOperatingCost = baseMonthlyOperatingCost * fundingRatio`

Costs settle through the existing fiscal loop. Unpaid obligations remain explicit rather than silently disappearing.

## Service Demand System
Every demand statistic derives from authoritative city state.

### Fire Risk
Each occupied building receives a deterministic fire-risk load derived from:
- building archetype base risk
- occupancy/density factor
- industrial-use factor
- recent unresolved fire exposure
- measured fire-service accessibility

No arbitrary citywide fire-risk randomizer is permitted.

Phase 4 risk accumulation may create incidents using seeded randomness only after deterministic risk exposure has been calculated. Higher risk increases incident probability; randomness chooses *when* an exposed risk materializes, not whether the underlying risk exists.

### Police Demand
Police service demand derives from:
- occupied population
- commercial activity
- unemployment pressure
- unresolved recent police jobs
- measured police accessibility

Phase 4 exposes a derived safety score. It does not pretend to simulate individual criminal behavior.

### Healthcare Demand
Healthcare demand derives from:
- population
- essential utility service quality, especially water
- uncollected garbage exposure
- unresolved recent medical incidents
- measured healthcare accessibility

Age-specific disease or pollution-driven health mechanics remain out of scope until those authoritative systems exist.

### Education Demand
Phase 4 uses an aggregate school-age share because individual age cohorts are not authoritative yet.

Configurable default:
- `schoolAgeShare = 0.18`

`eligibleStudents = round(population * schoolAgeShare)`

Education demand is not randomized.

### Garbage Demand
Every occupied building generates collectible waste based on its actual building definition and occupancy. Waste accumulates at the building until a truck collects it.

Citywide Phase 2 garbage backlog becomes a compatibility aggregate:

`garbageBacklog = sum(building.collectibleWaste) + processingQueue`

This prevents duplicate incompatible garbage statistics.

## Service Accessibility System
Service coverage must use the transportation graph rather than circular distance.

For each occupied building and service department, calculate:
- whether at least one compatible facility is reachable
- network travel time to candidate facilities
- facility effective capacity and current utilization
- response/accessibility score

### Candidate Cost
For dispatched services:

`candidateCostTicks = currentRouteTravelTicks + predictedIntersectionDelayTicks + dispatchTurnaroundTicks`

For non-dispatched education access:

`accessCostTicks = routeTravelTicks`

Selection uses the lowest deterministic cost, with facility ID as tie-breaker.

### Accessibility Normalization
Recommended normalization:

`accessibility = clamp01(1 - (estimatedTravelTicks / departmentMaxUsefulTravelTicks))`

Capacity factor:

`capacityFactor = clamp01(availableEffectiveCapacity / localDemand)`

Service access score:

`serviceAccess = accessibility * capacityFactor`

If no route exists, accessibility is zero. A nearby disconnected station is therefore not counted as coverage.

Accessibility snapshots are derived and rebuildable; they are not persisted unless needed as a rolling metric for deterministic continuation.

## Service Dispatch Jobs
Phase 4 defines four routed job families:
- `fire_response`
- `police_response`
- `medical_response`
- `garbage_collection`

Education is capacity/accessibility based and does not dispatch school buses in Phase 4.

Each service job contains:
- jobId
- department
- targetBuildingId
- createdTick
- severity
- status: `waiting | assigned | responding | servicing | returning | completed | failed`
- assignedFacilityId
- assignedVehicleId when applicable
- responseStartTick
- arrivalTick
- completionTick
- accumulatedDelayTicks

Jobs are authoritative save state.

### Job Assignment
A job may only assign to:
- compatible department facility
- facility with sufficient effective staffing
- an available compatible vehicle where required
- a routable facility/target pair

Dispatch chooses minimum predicted response cost, not Euclidean distance.

If no eligible facility exists, the job remains waiting and contributes to unresolved demand/quality penalties. It must not teleport or disappear.

## Emergency Incidents
### Fire Incidents
A fire incident tracks:
- target building
- severity
- fire intensity
- damage accumulation
- responder arrival/service state

Until responders arrive, intensity grows deterministically according to configured risk/severity. After a fire engine begins service, intensity declines according to effective crew capacity.

Local spread in Phase 4 is limited to cardinally adjacent occupied buildings and only when intensity exceeds a configured threshold. Full wildfire/weather/environmental disaster simulation is deferred.

Buildings may become temporarily unusable or demolished if damage reaches the configured terminal threshold. Any occupant/economy consequences use existing building/population APIs.

### Police Incidents
Police incidents track unresolved safety demand. Patrol arrival and service reduce the unresolved incident load. Failure or excessive delay worsens recent safety outcome metrics.

### Medical Incidents
Medical incidents dispatch ambulances. Arrival time and clinic treatment capacity determine whether the job completes promptly or remains delayed. Phase 4 records service success/response metrics, not individual medical diagnoses.

## Service Vehicles
Service vehicles are explicit authoritative agents distinct from ordinary commuter vehicles but use the Phase 3 graph/pathfinding infrastructure.

Vehicle classes:
- `fire_engine`
- `patrol_car`
- `ambulance`
- `garbage_truck`

Each service vehicle contains:
- vehicleId
- facilityId
- department
- vehicleType
- currentJobId or null
- route edge IDs
- currentEdgeIndex
- progressOnEdge
- currentSpeed
- state: `idle | outbound | servicing | returning | unavailable`
- accumulatedDelayTicks

### Traffic Interaction
Emergency vehicles (`fire_engine`, `patrol_car`, `ambulance`) receive priority where possible.

Priority is modeled as increased intersection service eligibility and a reduced congestion-delay coefficient, not traffic immunity. Congestion still increases response time.

Garbage trucks use ordinary traffic priority and contribute weighted road volume.

Service vehicles count toward active-agent/performance diagnostics.

### Network Mutation Safety
Road demolition invalidates service-vehicle routes using the same stale-edge safety discipline introduced in Phase 3. Affected vehicles attempt deterministic rerouting; if rerouting is impossible, their job returns to waiting/failure handling rather than deadlocking in a removed-edge queue.

## Garbage Collection
Phase 4 replaces purely aggregate collection with routed collection while preserving aggregate compatibility.

### Building Waste State
Each occupied building owns:
- currentCollectibleWaste
- wasteGenerationRate
- lastCollectionTick
- missedCollectionCount

Waste generation is deterministic from authoritative occupancy/building data.

### Collection Jobs
Garbage collection jobs are created when building waste crosses a configurable pickup threshold.

A truck:
1. departs an eligible garbage facility
2. routes to the target building
3. collects up to truck capacity
4. may collect additional nearby queued jobs only if deterministic route-cost and remaining-capacity criteria are satisfied
5. returns to a compatible processing facility
6. unloads into processing capacity
7. becomes available

For Phase 4, deterministic one-stop collection is the acceptance baseline; route batching is optional only if it can be implemented without compromising correctness.

### Processing
Landfill/recycling facilities own processing/disposal capacity. If processing capacity is saturated, trucks can queue at the facility and citywide backlog remains elevated.

Poor garbage management causes measurable:
- local cleanliness penalty
- healthcare demand pressure
- neighborhood-quality penalty

Pollution remains deferred until Phase 9; Phase 4 must not invent a pollution metric.

## Education System
Education uses aggregate enrollment and capacity.

For each residential building, estimated students are allocated proportionally from the citywide school-age population.

A school contributes only if reachable through the transportation graph.

Citywide education snapshot includes:
- eligibleStudents
- reachableStudents
- enrolledStudents
- effectiveSeats
- overcrowdedStudents
- averageSchoolAccessTicks
- educationServiceRatio

Recommended quality:

`educationQuality = coverageRatio * accessibilityRatio * fundingEffectiveness`

Where:
- `coverageRatio = min(1, effectiveSeats / max(1, eligibleStudents))`
- `accessibilityRatio` is the demand-weighted normalized road accessibility to reachable schools

No fake education level/productivity benefit is introduced until the later labor-skill/economic-depth systems can consume it coherently. Phase 4 may expose education quality for neighborhood attractiveness only.

## Neighborhood Quality System
Every occupied building receives a service-quality snapshot:
- fireSafety
- policeSafety
- healthcareAccess
- educationAccess
- garbageCleanliness
- combinedServiceQuality
- primaryIssue codes/reasons

Recommended combined Phase 4 service quality:

`combinedServiceQuality = 0.22*fire + 0.22*police + 0.22*healthcare + 0.20*education + 0.14*garbage`

All components are normalized `0..1` and derived from actual system outcomes.

The citywide snapshot is population-weighted across occupied residential buildings.

### Feedback into Growth
Neighborhood/service quality affects:
- residential attractiveness/migration
- commercial attractiveness where police/garbage access is poor
- development demand only through documented bounded modifiers

Recommended residential modifier:

`serviceDemandModifier = clamp(-0.25, 0.15, (combinedServiceQuality - 0.70) * 0.50)`

Commercial modifier uses police safety and garbage cleanliness only in Phase 4.

Service quality must not instantly demolish or abandon buildings. Persistent long-term abandonment/redevelopment belongs to Phase 7.

## Simulation Update Order
Phase 4 deterministic evaluation order:

High-frequency traffic/service-vehicle cadence:
1. refresh transportation graph when road revision changed
2. reroute service vehicles invalidated by topology changes
3. service intersection priority queues
4. move commuter and service vehicles
5. process service-vehicle arrivals/departures

Service cadence:
6. generate building waste
7. update service demand/risk accumulators
8. create eligible incidents/collection jobs
9. assign waiting jobs to facilities/vehicles
10. advance on-site service/fire intensity/processing queues
11. recompute service accessibility and department utilization
12. update neighborhood-quality snapshot

Existing longer-horizon cadence:
13. compute employment/traffic/service snapshots
14. compute R/C/I demand
15. advance building development
16. update population/migration
17. settle fiscal period when due

Presentation reads snapshots only and never advances service state.

## Treasury and Fiscal Integration
Public-service construction uses real treasury costs.

Recurring expenses are grouped by department:
- fire
- police
- healthcare
- education
- garbage

The financial snapshot exposes these separately from utility operating costs.

Facilities without affordable operating funding are not silently free. Existing unpaid-obligation semantics remain authoritative.

If obligations remain unpaid, department effectiveness is reduced according to explicit fiscal status rather than random shutdowns.

## UI and Player Tools
Add build tools for:
- Fire Station
- Police Station
- Clinic
- Elementary School
- Recycling Center

Existing landfill construction remains available through the unified service-facility tool family.

Add department budget controls for all five Phase 4 departments.

HUD/service summary shows:
- combined service quality
- fire response/access score
- police safety/access score
- healthcare access
- education coverage/overcrowding
- garbage collection/cleanliness
- active service vehicles
- waiting service jobs

## Service Overlays
Add selectable overlays:
- Fire
- Police
- Healthcare
- Education
- Garbage

Each overlay shows both:
- reachable/geographic coverage information
- network accessibility or estimated response time

Critical information must not be communicated by color alone. Overlay legend/inspection text includes numeric score/response values and issue labels.

## Inspection
### Facility Inspection
Show:
- name/type
- department
- funding
- staffing/effectiveness
- effective capacity
- utilization
- vehicles active/idle/unavailable
- waiting/active jobs
- average recent response time
- operating cost
- current bottlenecks

### Building Inspection
Show:
- service-quality components
- estimated fire response
- police access/safety
- healthcare access
- education access for residential buildings
- current collectible waste
- recent missed collections
- active incidents/jobs
- primary service issue and remediation hint

### Service Vehicle Inspection
Show:
- vehicle type
- home facility
- assigned job
- current state
- route progress
- delay

## Alerts and Advisor Behavior
Service alerts are transition-based and severity-ranked.

Examples:
- WARNING: fire response above target threshold
- WARNING: school overcrowding above configured threshold
- WARNING: ambulance fleet fully utilized with waiting medical jobs
- WARNING: missed garbage collections increasing
- CRITICAL: no reachable fire protection for occupied buildings
- CRITICAL: no reachable healthcare capacity

Alerts must expose cause and possible remedy. Do not spam the same unchanged condition every evaluation tick.

## Debugging and Profiling
Developer diagnostics add:
- service evaluation duration
- accessibility/pathfinding requests for services
- active service vehicles by type
- waiting/active/completed/failed jobs
- average response time by department
- unreachable service demand
- garbage pickup backlog and processing queue
- school capacity/utilization
- department funding/effective capacity

Debug overlays may show:
- facility graph attachment nodes
- assigned service routes
- service-job targets
- response-time buckets

Profiling must separate traffic cost from service-system cost.

## Persistence — Save V4
Save schema advances to `saveVersion: 4`.

Persist authoritative Phase 4 state:
- public-service facilities and runtime facility state
- department funding percentages
- service jobs/incidents and their status
- service vehicles and active route progress
- building collectible waste state
- garbage processing queues/backlog compatibility state
- fire incident intensity/damage state
- rolling service-response outcome metrics needed for deterministic continuation

Do not persist rebuildable derived state:
- transportation graph
- route cache
- service accessibility maps
- overlay buffers
- neighborhood-quality caches that can be reconstructed deterministically from authoritative state

### Migration
V3 -> V4 migration initializes:
- no public-service facilities beyond converting existing landfill runtime state into the V4 facility form
- department funding at 100%
- no incidents/service jobs
- no service vehicles except those deterministically spawned from migrated garbage facilities after hydration
- building collectible waste from the prior aggregate garbage backlog using deterministic proportional allocation, or zero when no compatible per-building distribution can be reconstructed safely
- empty rolling service-response metrics

Migration must never invent successful service history.

Corrupt V4 traffic/service references must be rejected before replacing the live city.

## Error Handling
The simulation must fail safely.

Examples:
- unreachable incident: keep waiting/mark unresolved, no teleportation
- demolished facility with active vehicle: detach/reroute/fail job deterministically
- demolished road invalidates route: reroute or return job to waiting; no stale queue deadlock
- insufficient treasury: reject construction before mutation
- invalid budget value: clamp/reject through typed command API
- corrupted save: do not overwrite healthy live/save state

No NaN, negative capacities, impossible vehicle ownership, duplicate assignment, or permanently stranded jobs are acceptable.

## Testing Strategy
Every Phase 4 subsystem requires tests.

### Unit Tests
Cover:
- service definition values and department mapping
- budget clamp/effectiveness/operating-cost formulas
- fire/police/healthcare/education/garbage demand formulas
- graph-based service accessibility
- unreachable-service result
- deterministic facility selection by response time
- staffing/effective-capacity calculation
- service job lifecycle
- emergency-priority intersection behavior
- service-vehicle movement and return
- building waste generation/collection
- garbage processing capacity
- education enrollment/capacity/overcrowding
- neighborhood-quality calculation
- alert transition/severity behavior

### Integration Tests
Cover:
- fire station dispatches engine over actual road route
- congestion increases emergency response time
- closer-but-disconnected facility loses to farther reachable facility
- road demolition reroutes/fails service vehicle without deadlock
- police response improves safety metric
- ambulance saturation creates waiting medical demand
- school capacity/accessibility determines education quality
- garbage truck physically collects building waste and unloads
- poor garbage collection increases healthcare pressure/quality penalty
- lower service funding reduces real staffing/capacity
- service quality changes residential/commercial demand within bounded modifiers
- V3 -> V4 migration
- V4 save/load deterministic service continuation

### Headless Acceptance Tests
Create two otherwise equivalent neighborhoods with equal nominal facility capacity:
- Neighborhood A: direct collector/arterial access to services
- Neighborhood B: congested/bottlenecked or circuitous local-road access

Verify over a fixed deterministic horizon that B has measurably:
- slower emergency response
- more unresolved/waiting jobs
- worse garbage collection reliability
- lower combined service quality
- weaker residential development/migration outcome

Also verify:
- all numeric state remains finite
- no negative capacities/inventories
- no duplicated service-vehicle ownership
- no deadlocked service jobs after topology mutation
- same seed/state/input yields identical V4 state hash

### Browser Smoke Test
Real compiled browser scenario:
1. load Phase 4 game
2. create residential/commercial/industrial city with utilities and traffic
3. place fire/police/clinic/school/garbage facilities
4. advance until service demand/jobs/vehicles are observable
5. activate at least one service overlay
6. inspect a facility and building service status
7. create a road bottleneck/disconnection
8. observe degraded service response/quality
9. repair network and observe recovery
10. change a department budget and observe effective-capacity change
11. save V4 while paused
12. destructively modify a service facility/road
13. load V4 and verify authoritative service state restores safely

## Performance Acceptance
Profile at minimum:
- 1,000 simulation ticks with active Phase 4 service load
- repeated service accessibility/pathfinding queries with route-cache behavior
- garbage collection load across multiple buildings
- active emergency/service vehicle movement

Record:
- total simulation tick time
- traffic-only update time
- service-only update time
- service pathfinding requests/cache hits
- active service vehicle count
- waiting service job count

Do not set arbitrary pass/fail wall-clock thresholds until measurements identify a real bottleneck. No unbounded queue or memory growth is acceptable.

## Documentation
Update:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/SIMULATION.md`
- `docs/SAVE_FORMAT.md`
- `docs/BALANCING.md`
- `docs/TESTING.md`
- `docs/DEVELOPMENT_LOG.md`

Document exact configured values and formulas after implementation.

## Acceptance Criteria
Phase 4 is complete only when all of the following are verified:
1. fire, police, healthcare, education, and garbage services derive demand from real city state
2. service facilities own real capacity/staffing/funding and cost real money
3. service accessibility uses actual transportation connectivity/travel time rather than circular radius
4. fire/police/medical/garbage service jobs have explicit lifecycle state
5. emergency and garbage vehicles physically route through the Phase 3 transportation graph
6. congestion measurably affects service response
7. emergency priority improves routing/intersection service without making vehicles immune to congestion
8. garbage trucks collect real building waste and processing capacity constrains disposal
9. education quality derives from eligible population, reachable seats, capacity, and funding
10. neighborhood service quality derives from measured service outcomes and feeds growth/demand in bounded form
11. UI overlays/inspectors explain both capacity and accessibility/response time
12. alerts identify symptoms, causes, and possible remedies without repetitive spam
13. V3 saves migrate to V4 and V4 service state continues deterministically after save/load
14. headless comparison proves equal nominal capacity can produce different neighborhood outcomes because of transportation accessibility
15. browser smoke proves the playable end-to-end service loop
16. service/traffic performance metrics are recorded
17. full automated tests, typecheck, lint, and production build pass
18. stable Phase 4 state is committed before Phase 5 begins

## Explicit Non-Goals
Do not claim or partially fake these in Phase 4:
- buses/trams/metro/rail/ferries
- school buses
- detailed education progression or individual student agents
- individual disease/diagnosis simulation
- detailed age cohorts
- full criminal-agent simulation
- courts/prisons
- full fire department staffing rosters
- complex multi-engine incident command
- wildfire/weather-driven fire simulation
- pollution simulation
- full disaster system
- freight/supply chains
- land value/redevelopment/abandonment system
- districts/policies beyond department funding percentages
- advanced emergency lanes or signal preemption editor
- transfer stations/incinerators/advanced garbage processing unless implemented completely

The architecture must leave extension points for these systems without exposing placeholders as completed gameplay.
