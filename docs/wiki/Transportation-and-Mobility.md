# Transportation & Mobility

[← Wiki Home](Home.md)

## Current transportation

**Status: Transitional but playable.**

The existing simulation includes deterministic road graphs, pathfinding, weighted trips, moving vehicles, intersections, queues, congestion, accessibility, bus/BRT/tram/metro topology, multimodal journey planning, passenger queues, transit vehicles, fares, crowding, reliability, accessibility, freight orders, and explicit freight trucks.

These systems remain current until Transportation Engine 2.0 earns authority.

## Phase 3R — Transportation Engine 2.0

**Status: Target / next major replacement.**

### Road hierarchy
Target road classes include local streets, collectors, arterials, avenues, expressways, and highways. Segments may own lanes, direction, speed, vehicle permissions, turn restrictions, parking, bike facilities, transit priority, tolls, condition, and incidents.

### Lane authority
Target lane types include through, turn, bus, bike, parking, reversible, and shoulder. Full lane-changing microsimulation is not mandatory where aggregated behavior preserves the decisions that matter.

### Intersections
Intersections should own movement groups, conflict matrices, and control state. Signals may support phases, cycle length, protected turns, offsets, pedestrian timing, and adaptive policy.

### Dynamic route choice
Generalized travel cost can include predicted travel time, experienced congestion, tolls, incident delay, parking access, and traveler preferences. Rerouting should happen at bounded decision points rather than every tick.

### Trip causality
Trips should arise from real relationships: home→work, home→school, home→shopping, firm→supplier, warehouse→customer, incident→facility, and construction→supplier.

### Parking and incidents
3R targets explicit parking inventory, pricing, occupancy, cruising penalties, and incident/crash effects on capacity and service demand.

## Later mobility/transit direction

Later phases expand toward schedule-based operations with walking, cycling, private car, taxi/ride hail, bus, trolleybus, BRT, tram, metro, commuter/regional rail, and ferry. Mode choice should respond to time, wait, transfers, reliability, fare, fuel, tolls, parking, comfort, accessibility, and preferences.

Passenger weight must remain conserved throughout queues, boarding, transit operations, failures, and alighting.