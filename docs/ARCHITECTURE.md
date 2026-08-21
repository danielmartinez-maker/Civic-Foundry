# Civic Foundry Architecture — Phase 4

## Boundary

The authoritative simulation is independent from DOM and Canvas rendering. `SimulationCore` composes focused state owners and controls deterministic update order. Presentation code consumes public snapshots and public mutation APIs only.

## Authoritative city systems

- `TerrainGrid`, `TreasurySystem`, `RoadSystem`, `ZoningSystem`, `LotSystem`, `BuildingSystem`, `PopulationSystem`
- `EmploymentSystem`, `TaxSystem`, `DemandSystem`, `UtilitySystem`, `GarbageSystem`, `EconomySystem`
- `TransportationGraph`, `PathfindingSystem`, `TripGenerationSystem`, `IntersectionSystem`, `TrafficSystem`, `TrafficAnalytics`

## Phase 4 public-service systems

- `ServiceFacilitySystem` owns facilities, department funding, fiscal effectiveness, staffing/capacity and fleet availability.
- `ServiceDemandSystem` derives fire, police, healthcare, education and waste demand from authoritative city conditions.
- `ServiceAccessibilitySystem` measures reachability/capacity over the transportation graph; no circular-radius coverage is authoritative.
- `ServiceDispatchSystem` owns waiting/assigned/responding/servicing/returning/completed jobs and deterministic facility/vehicle assignment.
- `ServiceVehicleSystem` owns explicit fire engines, patrol cars, ambulances and garbage trucks using real graph routes and intersection queues.
- `IncidentSystem` owns seeded fire/police/medical incidents, fire intensity/damage/spread and response outcomes.
- `WasteCollectionSystem` owns per-building waste, collection reservations, truck cargo, processing queues and processed totals.
- `EducationSystem` derives eligible students, reachable/effective seats, overcrowding and network-based school access.
- `NeighborhoodQualitySystem` combines measured fire/police/healthcare/education/garbage outcomes into per-building and citywide service quality.

## Data flow

Player command → validate → mutate authoritative owner → revision/cache invalidation → fixed-step simulation → immutable/query snapshot → UI/rendering.

Road topology remains the shared physical dependency. Both commuter and service routing use `TransportationGraph`/`PathfindingSystem`; congestion derives from commuter plus service-vehicle edge loads. Emergency vehicles receive deterministic intersection priority and reduced congestion delay, not traffic immunity.

## Presentation

`GameApp` owns browser orchestration only. `WorldRenderer`, `VehicleRenderer`, `ServiceVehicleRenderer`, `TrafficOverlayLayer` and `ServiceOverlayLayer` read simulation state. `ToolController` routes player mutations through `SimulationCore`. `HudView` and `Inspector` expose authoritative metrics, budgets and service causes.

The application exposes `window.__civicApp` as a development/smoke-test handle; gameplay does not depend on it.

## Persistence ownership

Save V4 serializes authoritative owner state through snapshot/restore APIs. It persists active public-service jobs/vehicles/incidents/waste reservations because those are required for exact continuation. It does not persist transportation graphs, pathfinding caches, service-accessibility maps, rendered buffers or overlays.

Hydration restores owners into a candidate core, rebuilds the road graph, validates traffic/service references against that graph, reconstructs derived metrics, and only then returns the candidate.

## Provenance

The historical temporary Phase 3 checkout expired before upload. Current Phase 1–3 code is a fresh implementation from preserved specifications; Phase 4 extends that reverified codebase. GitHub is the durable canonical source.
