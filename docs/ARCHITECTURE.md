# Civic Foundry Architecture — Phase 7

## Boundary

The authoritative simulation is independent from DOM and Canvas rendering. `SimulationCore` composes focused state owners and controls the fixed-step city loop. `MobilityScheduler` owns the multimodal sub-schedule, `EconomyScheduler` owns the Phase 6 establishment/freight sub-schedule, and the Phase 7 development domain owns derived property-market signals, parcel feasibility and deterministic developer allocation. Presentation code consumes public snapshots and public mutation APIs only.

## Authoritative city systems

- `TerrainGrid`, `TreasurySystem`, `RoadSystem`, `ZoningSystem`, `LotSystem`, `BuildingSystem`, `PopulationSystem`
- `EmploymentSystem`, `TaxSystem`, `DemandSystem`, `UtilitySystem`, `GarbageSystem`, `EconomySystem`
- `TransportationGraph`, `PathfindingSystem`, `TripGenerationSystem`, `IntersectionSystem`, `TrafficSystem`, `TrafficAnalytics`
- Phase 4 service owners: `ServiceFacilitySystem`, `ServiceDemandSystem`, `ServiceDispatchSystem`, `ServiceVehicleSystem`, `IncidentSystem`, `WasteCollectionSystem`, `EducationSystem`, `NeighborhoodQualitySystem`

## Phase 7 land, housing and development systems

- `LandHousingMarketSystem` derives bounded residential/commercial/industrial market pressure, rent, vacancy and land-value indexes from current demand, housing utilization, employment utilization, accessibility, services and utilities. It retains only the latest derived snapshot for diagnostics; it owns no authoritative market history.
- `parcelSignal()` combines the relevant zone market with parcel-local person/freight access, service quality, neighborhood quality, utility availability and frontage quality. Industrial signals weight freight access more heavily; residential/commercial signals weight person access more heavily.
- `DevelopmentFeasibilitySystem` owns legal/physical gates plus project underwriting. Achievable rent, vacancy and land cost now come from explicit market signals; construction cost, financing, NOI, stabilized value, yield/return and residual-land-value calculations remain project-specific.
- `DeveloperMarketSystem` owns the deterministic roster of competing developers, hurdle rates, leverage, available/committed capital, risk tolerance, zone preferences, bids, awards and capital release.
- `BuildingSystem.startDevelopment()` remains the authoritative construction entry point after a valid developer award.

The market is refreshed immediately before each 10-tick development evaluation and again after the 50-tick core-city loop. This keeps underwriting synchronized with current derived conditions and prevents an unpersisted 50-tick market cache from causing save/load continuation drift. The calculation is constant-sized and deterministic, so the additional refresh does not create a meaningful performance burden.

Household cohorts, income/tenure, housing search/moves, affordability by income band, land ownership and occupied-parcel redevelopment are deliberately deferred. They require new authoritative state rather than being fabricated from the derived market snapshot.

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

Player command → authoritative road/zoning/utility/service/transit mutation → topology/revision invalidation → fixed-step simulation → mobility/economy/service updates → current demand/access/service/utility snapshots → derived land/housing market → parcel underwriting → developer bids/awards → construction → city/economy feedback → UI/rendering.

Surface transit participates in real road conditions: buses and street-running trams submit road load; BRT uses a reduced-congestion abstraction; metro segment timing is insulated from road congestion. Service vehicles and car traffic continue using the Phase 3 road/intersection model.

Capacity feedback is derived from authoritative waiting weight and active vehicle capacity. For each line, queue pressure is bounded at 600 ticks and uses `waitingWeight / activeCapacity × 60`; the citywide penalty is waiting-weighted. It augments experienced wait and later transit mode choice without adding a new persisted state variable.

## Presentation

`GameApp` owns browser orchestration only. `WorldRenderer` composes road/building/service rendering with transit and economy overlays plus transit/freight vehicle renderers. `TransitPanelController` translates player line/headway/fare/fleet edits into authoritative system calls. `HudView`, transit inspectors, `EconomyPanel`, firm/freight/gateway inspectors and `EconomyOverlayLayer` expose simulation-derived mobility/economic metrics.

The Phase 7 land/housing market currently exposes simulation snapshots for diagnostics and downstream systems; this slice intentionally adds no fabricated UI-side pricing logic. Future market panels/overlays must read these derived simulation outputs.

Transit overlays include route/mode, access, ridership, crowding, wait, reliability, mode share and person accessibility. Numeric legends accompany encoded line/stop styling; color is not the only route-mode cue.

The application exposes `window.__civicApp` as a development/smoke-test handle; gameplay does not depend on it.

## Persistence ownership

Save V7 retains the complete V6 city/transit/economy envelope and adds `DeveloperMarketStateSnapshot`: developer financial/risk parameters, available and committed capital, and active development commitments required for exact continuation.

The Phase 7 `LandHousingMarketSystem` adds no save fields. Rent, vacancy, land-value and parcel market signals are derived from already persisted/restored city state and are recomputed before development decisions. This preserves the V7 schema while avoiding stale-cache continuation drift.

V5→V6 migration restores the Phase 5 city exactly with empty Phase 6 economic history. V6→V7 migration restores the economy/freight city exactly and starts the default developer roster with no fabricated historical commitments. Older serializers/hydrators remain available for compatibility and migration fixtures.

Derived state is rebuilt rather than persisted: road/multimodal graphs, route caches, building-to-road freight access, traffic analytics, land/housing market snapshots, overlays and render geometry. Hydration validates authoritative references, restores state owners and rebuilds derived context before future decisions consume it.

## Provenance

The historical temporary Phase 3 checkout expired before upload. Current Phase 1–3 code is a fresh implementation from preserved specifications; Phases 4–7 extend that reverified codebase. GitHub is the durable canonical source.