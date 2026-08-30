# Civic Foundry — Transportation & Mobility

## Status summary

Transportation is currently a mixture of **playable inherited systems** and a **Target authority replacement**.

- Existing road, traffic and transit gameplay: **Transitional but current/playable**.
- Phase 3R Transportation Engine 2.0: **Target / next major replacement**.
- Phase 5R Mobility & Transit 2.0: **Target later expansion**.

Do not describe the 3R lane/turn/signal/parking/crash model as current authority until that phase is accepted.

## Why transportation matters

Transportation is the mechanism that turns urban geometry into accessibility. It connects:

- homes to jobs and schools;
- firms to workers, suppliers and customers;
- freight origins to destinations;
- emergency units to incidents;
- households to shopping/services;
- development sites to the broader city.

Travel time, reliability, capacity, cost and connectivity should therefore feed land value, labor matching, firm performance, service outcomes and development.

## Current road/traffic baseline — Transitional

The existing gameplay stack already supports meaningful deterministic transportation behavior, including:

- road graphs/topology;
- deterministic pathfinding;
- weighted trip generation;
- moving vehicles;
- intersections and queues;
- congestion;
- accessibility;
- road construction and cost interactions;
- active vehicle presentation.

These systems remain the accepted current owner of road/traffic behavior until 3R transfers authority.

## Current transit baseline — Transitional

The existing transit system includes:

- bus;
- BRT;
- tram;
- metro;
- network/topology representation;
- multimodal journey planning;
- passenger queues;
- transit vehicles;
- operating/fare concepts;
- crowding;
- reliability;
- accessibility effects.

This is a functional gameplay layer. Later replacement phases deepen its operational realism rather than starting from zero.

## Phase 3R Transportation Engine 2.0 — Target

3R is intended to become the final street-transport authority for the Civic Foundry 2.0 architecture.

### Road hierarchy

Target road types include local streets, collectors, arterials, avenues, expressways and highways.

A road segment can carry explicit attributes such as:

- lane configuration;
- direction;
- speed;
- vehicle permissions;
- turn restrictions;
- parking;
- bike facilities;
- transit priority;
- tolls;
- condition;
- incident state.

### Lane model

Target lane types include:

- through lanes;
- turn lanes;
- bus lanes;
- bike facilities;
- parking lanes;
- reversible lanes;
- shoulders where appropriate.

Civic Foundry does not require maximum microscopic lane-changing detail everywhere. The rule is to model enough lane structure that intersection throughput, queueing and road design choices produce credible gameplay consequences.

### Intersections and movement groups

Target intersections own permitted movements and conflict relationships rather than acting as generic nodes.

Signals can include:

- phases;
- cycle length;
- protected turns;
- offsets;
- pedestrian timing;
- later adaptive policies.

This lets changes to lane allocation or signal design affect capacity in a causal way.

### Dynamic route choice

Target generalized route cost can combine:

- predicted/current travel time;
- experienced congestion;
- tolls;
- incident delay;
- parking access/cost;
- traveler-specific preferences where relevant.

Vehicles need not recalculate continuously. Bounded decision points preserve performance and determinism.

### Trip causality

Trips should originate from real simulation relationships rather than arbitrary traffic generation.

Examples:

```text
home → work
home → school
home → shopping/service
firm → supplier
warehouse → customer
service facility → incident
construction site → supplier
```

The same household/firm/service state that creates a trip should be able to consume the resulting accessibility or delay outcome.

### Parking

**Target 3R.** Parking becomes explicit enough to affect travel decisions:

- curb spaces;
- private spaces;
- lots/garages;
- price;
- occupancy;
- cruising/generalized-cost penalties.

Parking should consume physical space and influence accessibility rather than existing as a universal invisible capacity.

### Crashes and disruption

**Target 3R.** Crash/disruption probability may respond to volume, speed, geometry, weather and control type. Incidents can remove capacity and create service demand.

The design should stay bounded: incidents exist because they change network operations and player decisions, not simply to maximize simulation detail.

## Phase 5R Mobility & Transit 2.0 — Target

After street authority stabilizes, mobility expands beyond network mechanics into traveler and transit-operation depth.

### Mode set

Target modes include walking, cycling, private car, taxi/ride-hail, bus, trolleybus, BRT, tram, metro, commuter/regional rail and ferry where geography supports them.

### Traveler utility

Mode choice can depend on:

- in-vehicle time;
- waiting;
- transfer penalties;
- reliability;
- fare;
- fuel;
- tolls;
- parking;
- comfort/accessibility;
- traveler income/preferences.

Weighted traveler cohorts are preferable to full individual simulation when they preserve meaningful heterogeneity more efficiently.

### Scheduled transit operations

Target transit vehicles have runs/schedules. Delay can propagate through a run and create:

- bunching;
- missed transfers;
- crowding;
- reliability penalties;
- reduced realized service.

### Fleet and depots

Target service depends on available fleet, depot/storage capacity and maintenance. A line configuration alone should not magically provide unlimited vehicles.

### Passenger conservation

Passenger queues and boarding must conserve weighted passenger demand. Partial boarding, transfers and left-behind passengers cannot duplicate or delete traveler weight.

## Relationship to Urban Fabric

Transportation and land are separate authorities but strongly coupled.

Urban Fabric can supply:

- parcel frontage/access;
- building locations/capacity;
- land uses and development intensity.

Transportation supplies:

- network connectivity;
- generalized travel cost;
- accessibility;
- congestion and reliability.

Together they drive development feasibility, household location, firm location and municipal service reach.

## Relationship to economy/freight

Freight should use real network travel and delivered cost. Congestion can raise logistics cost and reduce firm profitability.

Long-term supplier choice should consider production price plus transport distance, delay, reliability and inventory risk.

## Relationship to services

Emergency and service vehicles depend on network paths. A nearby fire station with no viable route should not provide full service as a radius bonus.

Current systems already include routed service behavior; future institution/transport replacements should retain this principle.

## Player-facing transportation questions

The game should help the player answer:

- Where is congestion occurring and why?
- Which movement/intersection is the bottleneck?
- Is a road under-capacity, badly configured or simply feeding too much demand?
- Which trips would benefit from a transit improvement?
- Is parking scarcity raising travel cost?
- Is unreliable transit caused by fleet limits, congestion, schedule design or crowding?
- How does a network change affect land/accessibility beyond the construction site?

## Acceptance philosophy

Transportation changes should be tested directionally as well as technically. Examples:

- adding effective capacity should reduce the intended bottleneck under controlled demand;
- restricting a movement should reroute or block affected trips deterministically;
- signal timing should alter queues in plausible directions;
- scarce parking should increase generalized cost;
- transit improvements should redistribute mode demand when competitive;
- deleting topology should invalidate routes without leaving vehicles on nonexistent network elements.

Transportation is one of Civic Foundry’s central coupling systems. Its purpose is to make spatial choices matter throughout the rest of the simulation.