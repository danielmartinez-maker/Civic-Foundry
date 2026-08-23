# Civic Foundry Phase 5 Design — Transit Revolution

## Status
Design for review. Phase 5 is the first implementation slice of the Metropolitan Era expansion.

## Goal
Make transit a real transportation alternative whose usefulness emerges from network geometry, frequency, capacity, transfers, walking access, fares, congestion, and destination patterns. A transit line must change actual person-trip routing and therefore change car traffic, accessibility, land-use pressure, and service performance.

## Scope
Phase 5 includes bus, BRT, tram, metro, transit stops/stations, depots/yards where required, lines and ordered stop sequences, frequencies/headways and service hours, explicit transit vehicles, station/platform passenger queues, boarding/alighting and capacity, dwell time, transfers, weighted person-trip cohorts, generalized-cost route planning, mode choice between private car and transit, transit operating cost and fares, transit overlays/route editor/inspection/alerts, and Save V5. Commuter rail and ferries get interfaces but full regional operations remain later.

## Architecture

### Preserve the Phase 3 road graph
`TransportationGraph` remains the road graph for road vehicles. It is not converted into a universal future network.

### TransitNetworkSystem
Owns stops/stations, stop coordinates and access nodes, lines, ordered stop sequences, mode, headway, fare, depot association, enabled state, and a transit topology revision.

### MultimodalRoutingGraph
Derived from road access nodes, walking connectors, transit ride edges, and transfer edges. It is never persisted.

### JourneyPlanner
Finds deterministic generalized-cost journeys. Cost includes road travel time, walking time, expected wait, in-vehicle transit time, transfer penalties, fare impedance, congestion delay, and a parking-impedance placeholder. Tie-breaking is deterministic.

### Person-trip cohorts
Phase 5 adds weighted person-trip cohorts with origin, destination, purpose, departure tick, and traveler weight. Existing Phase 3 trip generation remains compatible.

### ModeChoiceSystem
Compares car and transit alternatives deterministically. Utility/cost responds to total journey time, wait, transfers, fare, congestion, and crowding.

### TransitVehicleSystem
Owns explicit vehicles with vehicle ID, mode, line, current stop/segment, progress, capacity, onboard weighted passengers by alighting stop, dwell state, delay, and out-of-service state. Bus/BRT/street-running tram contributes real road load; metro uses dedicated guideway edges.

### PassengerQueueSystem
Each stop/line direction holds FIFO weighted passenger cohorts. Capacity-constrained boarding leaves excess passengers waiting; no teleportation.

### TransitOperationsSystem
Owns dispatch by headway, active fleet requirement, operating cost, fare revenue, missed trips from fleet constraints, and line reliability. Transit finance feeds the existing fiscal model while remaining separately inspectable.

## Scheduling Order
1. Rebuild road graph if needed.
2. Rebuild transit/multimodal derived graph if topology changed.
3. Advance road/service traffic.
4. Advance transit vehicles.
5. Process arrivals, alighting, boarding, dwell.
6. Generate person-trip demand on cadence.
7. Plan journeys and choose modes.
8. Enqueue transit passengers or submit car trips.
9. Update transit analytics/accessibility on cadence.
10. Feed accessibility into city demand/economy.

## Transit Access
Buildings connect to nearby stops through bounded deterministic walking connectors. Full pedestrian pathfinding is deferred.

## Road Interaction
Bus and street-running tram consume road capacity. BRT uses a reduced-congestion dedicated-lane abstraction in Phase 5 rather than full lane geometry. Emergency priority remains above normal transit priority. Metro is insulated from road congestion.

## Capacity & Crowding
Vehicles have weighted passenger capacity. Crowding creates left-behind passengers, longer waits, and a future mode-choice penalty.

## Finance
Each line exposes scheduled vehicle-hours, operating cost, fare revenue, ridership, and cost recovery. Financial loss does not automatically disable service; player budget/fleet decisions govern service availability.

## Player Tools
Build stop/station, create/edit line, assign mode, add/remove ordered stops, set headway/frequency, set fare, enable/disable line, and adjust transit budget/fleet controls.

## Overlays
Transit lines/modes, stop catchment/access, ridership, crowding, average wait, reliability/delay, mode share, and person accessibility. Color is never the only encoding.

## Inspection
Stop inspection shows lines served, waiting passengers, average wait, boardings/alightings, transfers, and crowding. Line inspection shows route, headway, active vehicles, ridership, utilization, delay, cost, fare revenue, and cost recovery. Vehicle inspection shows line/mode, onboard load, capacity, delay, and next stop.

## Save V5
Persist transit topology, lines/config, depots/fleet assignments, active transit vehicles/progress, passenger queues, committed transit journey cohorts, financial/operations counters needed for deterministic continuation, next IDs, and relevant RNG state. Do not persist the derived multimodal graph, journey cache, render geometry, overlay state, or recomputable analytics. V4→V5 creates empty transit state while preserving Phase 4 authoritative state exactly.

## Failure Handling
Deleting a road/stop/line invalidates affected journeys deterministically. Passengers replan or return to waiting instead of teleporting. Road-running transit vehicles whose segment disappears fail safely and release queue/reservation state. Topology edits invalidate route caches. Disconnected stops provide zero useful access.

## Acceptance Scenarios

### Competitive transit reduces car traffic
Two equivalent corridors, one car-only and one with frequent high-capacity transit. Competitive transit must reduce weighted car traffic and improve person accessibility.

### Bad transit does not magically win
A circuitous, low-frequency, multi-transfer line must retain low mode share even with nearby stops.

### Capacity matters
Lower fleet/headway capacity must create queues, higher waits, left-behind passengers, and reduced transit attractiveness.

### Congestion affects buses
Road congestion increases bus travel time and reduces reliability; metro on dedicated guideway remains insulated.

### Save/load determinism
Save with active vehicles, passenger queues, and mixed car/transit journeys; load and continue. Authoritative hashes must match uninterrupted continuation.

## Performance Targets
10,000 mixed-mode journey-planning requests must remain within a practical interactive benchmark using cache reuse. A 5,000-tick active-transit simulation must remain comfortably below the current real-time budget at test-city scale. Stable-network route-plan cache hit ratio should exceed 95%. These are hardware-specific diagnostics, not permanent platform guarantees.

## Explicit Non-Goals
Full pedestrian microsimulation, bike networks, parking search/pricing, full commuter rail regional operations, ferry physics, lane-by-lane signal engineering, stochastic individual citizen personalities, and full TOD redevelopment mechanics.

## Exit Criteria
Phase 5 is complete only when transit is not decorative: weighted travelers actually choose it, vehicles physically carry capacity-constrained cohorts, road-running transit interacts with congestion, line quality changes mode share, and those mobility changes feed the city simulation.
