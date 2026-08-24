# Civic Foundry Architecture — Phase 0A Kernel over V7

## Civic Foundry 2.0 Phase 0A boundary

Phase 0A inserts a deterministic simulation kernel beneath the existing V7 city model without migrating gameplay-domain ownership or changing Save V7. The runtime path is now:

`GameApp → SimulationCore facade → SimulationKernel → legacy-v7-city compatibility system → unchanged V7 domain orchestration`

`SimulationCore` remains the public gameplay facade used by the browser, save/load code, and existing tests. It owns one shared `SimulationClock` and constructs `SimulationKernel` around that exact clock object. During normal `SimulationCore.step()` execution, the kernel is the sole clock advancer. The previous V7 per-tick body is preserved as `runLegacyV7Tick()` and registered as the only production kernel system, `legacy-v7-city`, at cadence `{ every: 1 }`.

The Phase 0A kernel package provides deterministic system registration/scheduling, command sequencing, a domain-event journal, isolated named RNG streams, cadence-aware invariants, and ordered diagnostic snapshot providers. These capabilities are infrastructure only in Phase 0A: current player mutations remain direct `SimulationCore` APIs, V7 gameplay emits no authoritative kernel events, and no existing gameplay decision consumes a named kernel RNG stream.

Kernel command/event/RNG/invariant/snapshot state is therefore diagnostic and non-authoritative in this tranche and is intentionally excluded from persistence. Save V7 remains unchanged. Hydration creates a fresh kernel around the restored shared clock while existing persisted V7 RNG/domain state resumes exactly as before.

A committed pre-kernel seven-scenario parity fixture guards this compatibility seam. It covers cadence boundaries, city development, services/incidents, transit, economy/freight, housing/development, and save → hydrate → continue. Phase 0A is accepted only while those canonical V7 serialized-state digests remain exact. Later reviewed tranches may peel individual domains out of `legacy-v7-city` into separately declared kernel systems only after defining ownership, persistence, invariants, and parity gates for that domain.

## V7 authoritative boundary

The authoritative simulation remains independent from DOM and Canvas rendering. `SimulationCore` composes focused V7 state owners, while `SimulationKernel` now controls the outer fixed-step scheduling shell. `MobilityScheduler` owns the multimodal sub-schedule, `EconomyScheduler` owns the Phase 6 establishment/freight sub-schedule, and the Phase 7 development/housing domain derives property markets, aggregate housing allocation, redevelopment pressure/execution planning, parcel feasibility and deterministic developer allocation. Presentation code consumes public snapshots and public mutation APIs only.

## Authoritative city systems

- `TerrainGrid`, `TreasurySystem`, `RoadSystem`, `ZoningSystem`, `LotSystem`, `BuildingSystem`, `PopulationSystem`
- `EmploymentSystem`, `TaxSystem`, `DemandSystem`, `UtilitySystem`, `GarbageSystem`, `EconomySystem`
- `TransportationGraph`, `PathfindingSystem`, `TripGenerationSystem`, `IntersectionSystem`, `TrafficSystem`, `TrafficAnalytics`
- Phase 4 service owners: `ServiceFacilitySystem`, `ServiceDemandSystem`, `ServiceDispatchSystem`, `ServiceVehicleSystem`, `IncidentSystem`, `WasteCollectionSystem`, `EducationSystem`, `NeighborhoodQualitySystem`

## Phase 7 land, housing and development systems

- `LandHousingMarketSystem` derives bounded residential/commercial/industrial market pressure, rent, vacancy and land-value indexes from current demand, housing utilization, employment utilization, accessibility, services and utilities. It retains only the latest derived snapshot for diagnostics; it owns no authoritative market history.
- `parcelSignal()` combines the relevant zone market with parcel-local person/freight access, service quality, neighborhood quality, utility availability and frontage quality. Industrial signals weight freight access more heavily; residential/commercial signals weight person access more heavily.
- `HousingChoiceSystem` derives deterministic weighted residential allocation for fixed lower/middle/upper income bands. Each occupied residential building becomes a housing option with physical capacity, current market rent and local quality/access/service/utility conditions.
- Housing choice separates **physical capacity** from **effective affordable capacity**. The latter is the income-share-weighted affordability of existing stock and is passed through the existing `DemandSystem.housingCapacity` input, so expensive stock creates stronger residential development demand without fabricating a second demand model.
- Housing affordability applies only a bounded `0.85 + 0.15 × affordabilityIndex` modifier to migration attractiveness. `PopulationSystem` still receives raw physical residential capacity as its hard cap, preventing a price shock from instantaneously deleting residents.
- `DevelopmentFeasibilitySystem` owns legal/physical gates plus project underwriting. Achievable rent, vacancy and land cost come from explicit market signals; construction cost, financing, NOI, stabilized value, yield/return and residual-land-value calculations remain project-specific.
- `DeveloperMarketSystem` owns the deterministic roster of competing developers, hurdle rates, leverage, available/committed capital, risk tolerance, zone preferences, bids, awards and capital release. Active commitments are keyed by deterministic building identity, and allocation refuses an opportunity when `building:<lotId>` already has an active commitment; the award loop repeats the same check as an authoritative defense-in-depth backstop, so a later project cannot overwrite a prior developer's capital lock.
- `RedevelopmentPressureSystem` derives occupied-residential replacement pressure from current-use value, feasible higher-intensity replacement economics, demolition cost and weighted resident displacement cost. It ranks parcels but cannot itself demolish buildings, move residents, create developer bids or mutate zoning.
- `RedevelopmentExecutionSystem` is a derived planning gate between pressure and the developer market. It requires pressure ≥ 0.25, zero already-unplaced residents, no active developer commitment for the occupied building, post-demolition physical capacity ≥ current population and post-demolition effective-affordable capacity ≥ 85% of population. Eligible parcels reserve physical/affordable slack cumulatively in deterministic pressure order so multiple same-cycle candidates cannot collectively violate the relocation floor. `SimulationCore` derives the live committed-building set from `DeveloperMarketSystem.listCommitments()` and passes that state into the planner, whose diagnostic reason is `active-commitment` when the capital lock is the blocking condition.
- Redevelopment execution adds demolition and displacement friction to the replacement's developer-underwritten cost basis, recomputes project economics, and rejects projects whose adjusted residual economics no longer clear the land-value floor. Admitted redevelopment opportunities then compete with vacant parcels in the same `DeveloperMarketSystem.allocate()` call.
- `SimulationCore` uses a dedicated secondary `DevelopmentFeasibilitySystem` instance for redevelopment diagnostics/planning so evaluating occupied parcels does not overwrite the normal vacant-parcel developer-market feasibility diagnostics.
- `BuildingSystem.startDevelopment()` remains the authoritative construction entry point for vacant awards. `BuildingSystem.replaceDevelopment()` is the occupied-residential entry point: it validates an existing occupied residential building, requires a strictly higher-intensity awarded definition, preserves deterministic `building:<lotId>` identity and replaces the old use with normal construction state.

The property market is refreshed immediately before each 10-tick development evaluation. That path now also refreshes housing choice, redevelopment pressure and redevelopment execution planning before one combined developer auction. After awards, the same derived layers are refreshed so under-construction redevelopment immediately disappears from occupied housing. The 50-tick core-city loop also refreshes market, housing, pressure and execution snapshots after migration. These calculations are bounded and deterministic.

Individual household/person agents, ages/families, endogenous incomes, tenure, mortgages/leases, housing-search duration, explicit moving friction, eviction/homelessness state, land ownership, mixed-use occupancy, commercial/industrial redevelopment and anti-displacement policy remain deferred. Those features require richer authoritative history and belong in later Phase 7/Phase 9 work rather than being invented from aggregate derived snapshots.

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

Player command → authoritative road/zoning/utility/service/transit mutation → `SimulationCore.step()` → `SimulationKernel` tick/clock boundary → `legacy-v7-city` → topology/revision invalidation → mobility/economy/service updates → current access/service/utility snapshots → aggregate housing choice → affordability-sensitive residential demand → municipal settlement/migration → refreshed property market → housing allocation → residential redevelopment pressure → relocation/commitment-safeguarded redevelopment planning → combined vacant/redevelopment parcel underwriting → developer bids/awards with duplicate-commitment backstop → construction/replacement → city/economy feedback → UI/rendering.

The 10-tick development path refreshes property markets, housing choice and redevelopment diagnostics/planning immediately before evaluating development. Vacant opportunities and admitted occupied-residential replacement opportunities enter one developer allocation, preserving capital/project-slot competition. Buildings with an unreleased prior developer commitment are excluded both by planner diagnostics and by the market's authoritative commitment map. The 50-tick core-city path evaluates housing affordability before demand, keeps raw physical housing as the population cap, then refreshes the property market, housing allocation and redevelopment layers after migration.

Surface transit participates in real road conditions: buses and street-running trams submit road load; BRT uses a reduced-congestion abstraction; metro segment timing is insulated from road congestion. Service vehicles and car traffic continue using the Phase 3 road/intersection model.

Capacity feedback is derived from authoritative waiting weight and active vehicle capacity. For each line, queue pressure is bounded at 600 ticks and uses `waitingWeight / activeCapacity × 60`; the citywide penalty is waiting-weighted. It augments experienced wait and later transit mode choice without adding a new persisted state variable.

## Presentation

`GameApp` owns browser orchestration only. `WorldRenderer` composes road/building/service rendering with transit and economy overlays plus transit/freight vehicle renderers. `TransitPanelController` translates player line/headway/fare/fleet edits into authoritative system calls. `HudView`, transit inspectors, `EconomyPanel`, firm/freight/gateway inspectors and `EconomyOverlayLayer` expose simulation-derived mobility/economic metrics.

Phase 7 exposes property-market, housing-choice, redevelopment-pressure and redevelopment-execution snapshots for diagnostics and downstream systems. This slice intentionally adds no UI-side price, affordability, allocation or redevelopment logic. Future market/housing panels and overlays must read these simulation outputs.

Transit overlays include route/mode, access, ridership, crowding, wait, reliability, mode share and person accessibility. Numeric legends accompany encoded line/stop styling; color is not the only route-mode cue.

The application exposes `window.__civicApp` as a development/smoke-test handle; gameplay does not depend on it.

## Persistence ownership

Save V7 retains the complete V6 city/transit/economy envelope and adds `DeveloperMarketStateSnapshot`: developer financial/risk parameters, available and committed capital, and active development commitments required for exact continuation.

Phase 0A adds no save fields. The kernel scheduler metadata, command queue, event journal, named random streams, invariants and snapshot providers are not authoritative inputs to current V7 gameplay and are reconstructed fresh on core construction/hydration. The existing V7 `clock`, RNG, transit, economy, development and housing fields remain the sole continuation inputs for this compatibility tranche.

Phase 7 property markets, aggregate housing allocation, redevelopment pressure and redevelopment execution planning add no save fields. Their inputs already exist in persisted/restored authoritative state: population, buildings, lots/zoning/roads, developer/economy state, accessibility, services, utilities and cached city demand. When redevelopment executes, its authoritative result is already representable as the existing construction-stage building plus the existing developer commitment. The active-commitment planning gate is reconstructed from that persisted developer-market state, so no duplicate state or separate demolition/relocation event ledger is introduced.

V5→V6 migration restores the Phase 5 city exactly with empty Phase 6 economic history. V6→V7 migration restores the economy/freight city exactly and starts the default developer roster with no fabricated historical commitments. Older serializers/hydrators remain available for compatibility and migration fixtures.

Derived state is rebuilt rather than persisted: road/multimodal graphs, route caches, building-to-road freight access, traffic analytics, property-market snapshots, aggregate housing allocations, redevelopment-pressure rankings, redevelopment-execution decisions, overlays and render geometry. Hydration validates authoritative references, restores state owners and rebuilds derived context before future decisions consume it.

## Provenance

The historical temporary Phase 3 checkout expired before upload. Current Phase 1–3 code is a fresh implementation from preserved specifications; Phases 4–7 extend that reverified codebase. Civic Foundry 2.0 Phase 0A adds only the reviewed scheduling shell beneath that V7 baseline. GitHub is the durable canonical source.