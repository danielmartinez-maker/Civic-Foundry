# Civic Foundry Architecture — Phase 6

## Boundary

The authoritative simulation is independent from DOM and Canvas rendering. `SimulationCore` composes focused state owners and controls the fixed-step city loop. `MobilityScheduler` owns the multimodal sub-schedule and `EconomyScheduler` owns the Phase 6 establishment/freight sub-schedule. Presentation code consumes public snapshots and public mutation APIs only.

## Authoritative city systems

- `TerrainGrid`, `TreasurySystem`, `RoadSystem`, `ZoningSystem`, `LotSystem`, `BuildingSystem`, `PopulationSystem`
- `EmploymentSystem`, `TaxSystem`, `DemandSystem`, `UtilitySystem`, `GarbageSystem`, `EconomySystem`
- `TransportationGraph`, `PathfindingSystem`, `TripGenerationSystem`, `IntersectionSystem`, `TrafficSystem`, `TrafficAnalytics`
- Phase 4 service owners: `ServiceFacilitySystem`, `ServiceDemandSystem`, `ServiceDispatchSystem`, `ServiceVehicleSystem`, `IncidentSystem`, `WasteCollectionSystem`, `EducationSystem`, `NeighborhoodQualitySystem`


## Phase 6 economy systems

- `FirmSystem` owns establishment identity, building tenancy, archetype, job capacity and lifecycle status.
- `LaborMarketSystem` allocates homogeneous aggregate workforce to operating/distressed firms; raw building job capacity is no longer authoritative employment.
- `InventorySystem` owns three storable commodities and shipment-owned cargo tokens with exactly-once terminal delivery/cancel semantics.
- `ProductionSystem` runs the compact chain: imported `industrial_inputs` → industrial `manufactured_goods` → wholesale `consumer_goods` → retail consumption.
- `TradeSystem` derives stable `gateway:x:y` access from drivable boundary nodes and owns aggregate import/export counters.
- `FreightDemandSystem` owns replenishment/export orders and deterministic generalized-cost supplier matching.
- `FreightVehicleSystem` owns explicit weighted trucks, route progress, dispatch capacity and road edge load.
- `BusinessLifecycleSystem` turns accrued revenue/cost/shortage/logistics evidence into sustained formation, distress, recovery and closure decisions.
- `EconomyScheduler` coordinates these owners on production (50), replenishment (100) and lifecycle (250) tick cadences and exposes one immutable domain snapshot.

Freight free-flow OD routes reuse the existing revision-keyed path cache. Current congestion affects generalized logistics cost by summing current edge travel times over the cached route; congestion epochs do not invalidate the underlying OD path. This avoids repeated A* work while preserving causal road-delay costs.

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

`GameApp` owns browser orchestration only. `WorldRenderer` composes road/building/service rendering with transit and economy overlays plus transit/freight vehicle renderers. `TransitPanelController` translates player line/headway/fare/fleet edits into authoritative system calls. `HudView`, transit inspectors, `EconomyPanel`, firm/freight/gateway inspectors and `EconomyOverlayLayer` expose simulation-derived mobility/economic metrics.

Transit overlays include route/mode, access, ridership, crowding, wait, reliability, mode share and person accessibility. Numeric legends accompany encoded line/stop styling; color is not the only route-mode cue.

The application exposes `window.__civicApp` as a development/smoke-test handle; gameplay does not depend on it.

## Persistence ownership

Save V6 retains the complete V5 city/transit envelope and adds `EconomySchedulerStateSnapshot`: firms/lifecycle counters, inventory records and shipment cargo, freight orders, active truck routes/progress, trade gateways/counters, financial accruals, dispatch capacity, scheduler counters and stable IDs required for deterministic continuation.

V5→V6 migration restores the Phase 5 city exactly with empty Phase 6 economic history. Firms are not backdated; occupied commercial/industrial buildings become normal future formation candidates. The public `serializeCore`/`hydrateCore` API is V6 while explicit V3/V4/V5 serializers remain migration/compatibility tools.

Derived state is rebuilt rather than persisted: road/multimodal graphs, route caches, building-to-road freight access, analytics, overlays and render geometry. Hydration validates firm/order/cargo/gateway/road references, restores authoritative owners, rebuilds the firm-access context and traffic loads, and only then returns the coherent candidate.

## Provenance

The historical temporary Phase 3 checkout expired before upload. Current Phase 1–3 code is a fresh implementation from preserved specifications; Phases 4 and 5 extend that reverified codebase. GitHub is the durable canonical source.
