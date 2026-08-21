# Civic Foundry Architecture — Phase 3 Rebuild

## Boundary

The authoritative simulation is independent from DOM and Canvas rendering. `SimulationCore` composes domain systems and owns deterministic update order. Presentation code consumes public snapshots and public mutation APIs.

## Authoritative systems

- `TerrainGrid` — deterministic buildability/elevation/water cells.
- `TreasurySystem` — nonnegative balance and immutable transaction history.
- `RoadSystem` — grid road state and road revision.
- `ZoningSystem` — R/C/I zoning cells.
- `LotSystem` — rebuildable road-frontage lots.
- `BuildingSystem` — construction/occupied lifecycle and real capacities.
- `PopulationSystem` — aggregate bounded population.
- `EmploymentSystem` — workforce/jobs/employment/unemployment.
- `TaxSystem` — bounded R/C/I tax rates and occupied-building revenue.
- `UtilitySystem` — road-component-limited power/water capacity and facilities.
- `GarbageSystem` — per-building backlog plus connected landfill processing.
- `EconomySystem` — recurring tax revenue and operating obligations.
- `TransportationGraph` — rebuildable directed graph derived from road cells.
- `PathfindingSystem` — deterministic A* and revision/cost-key route cache.
- `TripGenerationSystem` — deterministic weighted commute/shopping trip cohorts.
- `IntersectionSystem` — deterministic per-approach queues.
- `TrafficSystem` — active vehicles, edge flow, congestion, completion/failure history.
- `TrafficAnalytics` — commute, speed, congestion, delay, accessibility, bottlenecks.

## Data flow

Player command → validate → mutate authoritative owner → revision/cache invalidation → fixed-step simulation → immutable/query snapshot → UI/rendering.

Road topology is authoritative world state. `TransportationGraph.rebuildIfNeeded()` reads road revision and rebuilds only after topology changes. Pathfinding caches are keyed by graph revision and a generalized-cost key. Traffic metrics are derived from active weighted vehicles on actual graph edges.

## Presentation

`GameApp` owns browser orchestration only. `WorldRenderer`, `VehicleRenderer`, and `TrafficOverlayLayer` read simulation state. `ToolController` routes player actions through public `SimulationCore` APIs. `HudView` and `Inspector` derive their content from authoritative snapshots.

The application exposes `window.__civicApp` as a development/smoke-test handle; gameplay does not depend on it.

## Persistence ownership

Save V3 serializes authoritative owner state through public snapshot/restore APIs. It does not persist the transportation graph, route cache, rendered buffers, or traffic analytics caches. Hydration constructs a candidate core, restores owners, rebuilds graph state, validates traffic references, then returns the coherent candidate.

## Reimplementation provenance

The original temporary Phase 3 checkout expired before it was uploaded. This branch is a fresh implementation from the preserved specifications. It must not be represented as source-continuous with historical commit `f0bb3d6`.
