# Civic Foundry Architecture — Phase 5

## Boundary

The authoritative simulation is independent from DOM and Canvas rendering. `SimulationCore` composes focused state owners and controls the fixed-step city loop. `MobilityScheduler` owns the Phase 5 multimodal sub-schedule. Presentation code consumes public snapshots and public mutation APIs only.

## Authoritative city systems

- `TerrainGrid`, `TreasurySystem`, `RoadSystem`, `ZoningSystem`, `LotSystem`, `BuildingSystem`, `PopulationSystem`
- `EmploymentSystem`, `TaxSystem`, `DemandSystem`, `UtilitySystem`, `GarbageSystem`, `EconomySystem`
- `TransportationGraph`, `PathfindingSystem`, `TripGenerationSystem`, `IntersectionSystem`, `TrafficSystem`, `TrafficAnalytics`
- Phase 4 service owners: `ServiceFacilitySystem`, `ServiceDemandSystem`, `ServiceDispatchSystem`, `ServiceVehicleSystem`, `IncidentSystem`, `WasteCollectionSystem`, `EducationSystem`, `NeighborhoodQualitySystem`

## Phase 5 mobility systems

- `TransitNetworkSystem` owns deterministic stop/station IDs, transit lines, ordered stop sequences, modes, headways, fares, enabled state and topology revision.
- `PersonTripSystem` adapts weighted commute/shopping demand into person-trip cohorts without creating one resident object per traveler.
- `MultimodalRoutingGraph` is a derived graph containing bounded walking connectors, board/wait edges, transit ride edges, transfer edges and car alternatives.
- `JourneyPlanner` computes deterministic generalized-cost journeys and maintains a topology/cost-revision keyed cache.
- `ModeChoiceSystem` deterministically compares car/transit generalized cost, including fare and crowding pressure.
- `PassengerQueueSystem` owns FIFO stop/line/direction queues, partial weighted boarding, transfers and left-behind cohorts.
- `TransitVehicleSystem` owns explicit vehicle mode, line, stop/segment progress, capacity, onboard cohorts, dwell and road load.
- `TransitOperationsSystem` owns headway dispatch, fleet limits, line counters, reliability, operating cost and fare revenue.
- `MobilityScheduler` orders the multimodal work and exposes car/transit/unmet mode share, person accessibility, ridership, wait, reliability, crowding and fiscal totals.

`TransportationGraph` remains the road graph. It was deliberately not converted into a universal network. Multimodal connectivity is derived separately and is never persisted.

## Scheduling and data flow

Player command → authoritative transit/road mutation → topology/revision invalidation → fixed-step simulation → multimodal rebuild when required → transit operations → person-trip generation/mode choice → road/transit movement → accessibility/finance snapshots → UI/rendering.

Surface transit participates in real road conditions: buses and street-running trams submit road load; BRT uses a reduced-congestion abstraction; metro segment timing is insulated from road congestion. Service vehicles and car traffic continue using the Phase 3 road/intersection model.

Capacity feedback is derived from authoritative waiting weight and active vehicle capacity. For each line, queue pressure is bounded at 600 ticks and uses `waitingWeight / activeCapacity × 60`; the citywide penalty is waiting-weighted. It augments experienced wait and later transit mode choice without adding a new persisted state variable.

## Presentation

`GameApp` owns browser orchestration only. `WorldRenderer` composes road/building/service rendering with `TransitOverlayLayer` and `TransitVehicleRenderer`. `TransitPanelController` translates player line/headway/fare/fleet edits into authoritative system calls. `HudView` and transit inspectors expose simulation-derived mobility metrics.

Transit overlays include route/mode, access, ridership, crowding, wait, reliability, mode share and person accessibility. Numeric legends accompany encoded line/stop styling; color is not the only route-mode cue.

The application exposes `window.__civicApp` as a development/smoke-test handle; gameplay does not depend on it.

## Persistence ownership

Save V5 persists the authoritative Phase 1–4 envelope plus transit topology and `MobilityScheduler` state: passenger queues, active transit vehicles, operations counters, decisions/crowding configuration and fiscal cursors required for exact continuation. The derived multimodal graph and journey cache are rebuilt after hydration.

V4 migration constructs an honest empty transit state while preserving the Phase 4 city. Current public `serializeCore`/`hydrateCore` use V5; explicit legacy V4 functions remain available only for migration tests and historical fixtures.

Hydration restores a candidate core, rebuilds the road graph, validates transit/vehicle/passenger references, restores authoritative mobility owners, reconstructs derived traffic metrics and only then returns the candidate.

## Provenance

The historical temporary Phase 3 checkout expired before upload. Current Phase 1–3 code is a fresh implementation from preserved specifications; Phases 4 and 5 extend that reverified codebase. GitHub is the durable canonical source.
