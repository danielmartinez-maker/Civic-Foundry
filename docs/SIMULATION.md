# Simulation — Phase 3 Rebuild

## Clock and cadence

The core advances in deterministic logical ticks. Browser speed modes are paused, 1×, 2×, and 4×.

Per tick:

1. advance clock
2. rebuild transportation graph if road revision changed
3. invalidate traffic routes that reference removed edges
4. service intersection queues
5. advance active vehicles
6. derive edge traffic metrics and traffic analytics
7. advance building construction

Every 10 ticks: evaluate new building development.

Every 50 ticks: evaluate utilities, garbage, employment, taxes, R/C/I demand, recurring economy, and population migration.

Every 100 ticks: derive weighted commute/shopping trip requests from occupied buildings/population/employment, route them, and submit active traffic vehicles.

## Roads and traffic

Road classes are `local`, `collector`, and `arterial`. Each definition owns cost, free-flow speed, capacity, intersection service rate, and render width.

The transportation graph contains one node per road cell and cardinal directed edges between adjacent road cells. Edge free-flow travel time derives from road speed. A* routing minimizes supplied generalized edge cost with deterministic tie breaking.

Traffic is mesoscopic: one active vehicle may represent a weighted cohort. Edge utilization is:

`utilization = weightedVehicles / capacityPerMinute`

Delay multiplier:

`delayMultiplier = 1 + 3 * max(0, utilization)^4`

Then:

`actualSpeed = freeFlowSpeed / delayMultiplier`

`travelTimeTicks = freeFlowTicks * delayMultiplier`

`congestion = clamp01(1 - actualSpeed/freeFlowSpeed)`

Vehicles reaching graph nodes with more than two outgoing edges enter deterministic intersection queues. Road demolition invalidates any moving or queued vehicle whose remaining route references a removed edge; queue state is cleaned in the same update.

## Traffic analytics

The rolling recent-outcome window is capped at 128 trip outcomes. Lifetime completed/failed counters remain separate diagnostics.

Accessibility uses successful weighted trips and actual travel time. Commute and shopping use different maximum acceptable travel-time constants. Failures reduce the route-success component instead of disappearing from analytics.

Traffic accessibility feeds R/C/I demand through bounded modifiers; it does not directly demolish buildings or alter treasury.

## Phase 2 city loop

Employment workforce ratio is 50% of population. Employment is capped by occupied commercial/industrial job capacity.

Power and water are distributed only inside road-connected components. Surplus in one disconnected component cannot serve another component.

Garbage generation derives from occupied building definitions. Connected landfill capacity processes backlog; disconnected or insufficient processing accumulates backlog.

Population growth is bounded by occupied residential capacity and current attractiveness. Essential utility failures cap attractiveness and can stall/decline growth.
