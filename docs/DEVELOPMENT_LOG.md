# Civic Foundry — Development Log

## 2026-08-21 — Phase 1–3 fresh reimplementation

The earlier temporary execution workspace reached a verified Phase 3 checkpoint (`f0bb3d6`) but expired before source upload. Current Phase 1–3 code is therefore a fresh implementation from preserved specifications, not recovered historical source.

The rebuild introduced the durability rule that `danielmartinez-maker/Civic-Foundry` is the canonical source of truth. The audited Phase 3 rebuild checkpoint is `5c351d3ae57d6505aa8a439c8c3a7a5ceeeb5516`.

## 2026-08-21 — Phase 4 Public Services

Implemented the approved public-services vertical slice:

- fire stations, police stations, clinics, elementary schools, landfills and recycling centers
- 50–150% department budgets with staffing/capacity/fleet and fiscal-payment effects
- road-network service accessibility instead of circular coverage
- explicit dispatch jobs and physical fire engines, patrol cars, ambulances and garbage trucks
- emergency intersection priority and congestion-sensitive response
- seeded fire/police/medical incidents, fire intensity/damage and cardinal spread
- detailed building waste, routed pickup/cargo/processing and compatibility garbage snapshot
- reachable school seats, overcrowding and education service quality
- weighted per-building neighborhood service quality feeding R/C demand and migration
- V4 persistence/migration with deterministic active-service continuation
- Phase IV HUD, service inspection, build tools, budgets, overlays, vehicles and alerts

### Bugs found by acceptance testing

1. **Routed garbage migration deadlock:** the old Phase 2 instantaneous garbage hard-stop prevented initial residents before the first truck could finish a route. Fixed by retaining power/water as instantaneous essential gates while routing garbage consequences through service quality, demand, health and cleanliness.
2. **Waste cadence inflation:** the inherited per-building waste rate was accidentally applied every 10 service ticks instead of the original 50-tick economy cadence, generating 5× intended waste. Locked to the inherited 50-tick balance with a regression test.
3. **V4 deterministic continuation:** detailed waste initially omitted the building→active collection-job reservation map, allowing duplicate jobs after load. That reservation state is now persisted and validated.

### Acceptance evidence

An otherwise-equivalent local-vs-arterial service scenario produced 94 vs 46 tick fire arrival, ~0.49 vs ~0.71 service quality, 186 vs 354 processed waste, and 446 vs 284 garbage backlog. Residential and commercial demand were both stronger in the arterial city.

The real Chromium smoke verifies service construction, active service vehicles, numeric service overlay, department-budget changes, Save V4, destructive road/funding edits and exact restoration.

### Tooling

TypeScript ES modules, Node built-in tests, global `tsc`, browser Canvas 2D, Python Playwright and system Chromium. No external npm runtime dependencies are required.

## 2026-08-21 — Phase 5 Transit Revolution

Implemented the approved first Metropolitan Era vertical slice:

- bus, BRT, tram and metro topology with deterministic stops, lines, ordered routes, headways, fares and enablement
- a derived multimodal graph and deterministic generalized-cost journey planner with revision-keyed caching
- weighted person-trip cohorts and deterministic car/transit/unmet mode choice
- FIFO passenger queues, transfers, partial boarding and capacity-constrained left-behind passengers
- explicit transit vehicles with dispatch, dwell, capacity and line operations counters
- road-sensitive buses/trams, reduced-congestion BRT and road-insulated metro timing
- transit operating cost/fare revenue plus person accessibility integrated into the existing city loop
- Phase V transit tools, line configuration, HUD metrics, inspection, route/metric overlays and transit vehicle rendering
- Save V5 with authoritative transit/mobility continuation and legacy V4 migration

### Bugs found by acceptance testing

1. **Legacy save continuation drift:** Phase 5 mobility state affected future demand while the default serializer was still V4. The public save API now emits V5; explicit V4 serialization remains migration-only.
2. **Capacity feedback gap:** fleet shortages correctly produced larger queues but did not change experienced wait or subsequent mode choice. Derived queue pressure now feeds both metrics deterministically from waiting weight and active capacity.
3. **Browser smoke origin restriction:** this execution environment blocks navigable HTTP origins, so the smoke uses the same compiled ES modules through Playwright request routing and installs a minimal in-page Storage-compatible shim. It still exercises the real `GameApp` save/load path and verifies exact V5 restoration.

### Acceptance evidence

The deterministic corridor scenarios show frequent zero-fare BRT eliminating the tested weighted car demand and improving person accessibility, while deliberately poor transit retains car mode choice. Reducing active fleet capacity raises waiting weight and experienced wait and lowers transit attractiveness.

The 10,000-request journey benchmark exceeds the 95% stable-topology cache target; the latest representative run recorded 9,998 cache hits (99.98%). A separate 5,000-tick active-transit diagnostic verifies finite vehicle, queue, accessibility and performance outputs.

The Phase V Chromium smoke creates and edits a BRT line through the browser UI, dispatches vehicles, boards/completes weighted passengers, renders a numeric ridership overlay, changes headway/fare, saves V5, destructively removes transit/road topology, reloads and confirms exact serialized restoration.

## 2026-08-22 — Phase 6 Firms, Production & Freight

Implemented the second Metropolitan Era slice:

- deterministic commercial/industrial establishments, homogeneous labor allocation and firm-derived employment;
- compact conservation-safe production chain and inventory/cargo ownership;
- stable boundary freight gateways, local/import supplier matching, imports/exports and explicit weighted trucks;
- freight congestion and accessibility feeding logistics cost, shortages, production, firm health and employment;
- sustained formation/distress/recovery/closure using accrued operating evidence rather than random bankruptcy;
- authoritative freight dispatch capacity with waiting-order age and shortage consequences;
- Economy/Freight panel, firm diagnostics, nine overlays and explicit freight vehicle rendering;
- Save V6 with active-freight deterministic continuation and honest V5 migration.

### Bugs found by acceptance testing

1. **Historical Phase 3 gateway fixture:** the old local-vs-arterial benchmark road stopped short of the map boundary. Under Phase 6 that correctly created no external trade gateway, so all firms remained forming and commute averages collapsed to zero. The historical fixture now reaches the boundary; production code was not weakened. The benchmark again measures a large local-road versus arterial commute gap.
2. **Freight dispatch capacity gap:** the first economic implementation could dispatch every waiting order, so fleet capacity could not create queue delay or shortages. `FreightVehicleSystem` now owns persisted dispatch capacity; waiting orders age when capacity is exhausted and stockouts emerge causally.
3. **Bulldozed-firm late delivery:** building removal closed the firm and deleted inventory records but initially left already-dispatched inbound trucks alive. A late arrival could recreate inventory for the closed firm. Building removal now uses the same order/cargo/vehicle cleanup path as lifecycle closure.
4. **V6 continuation derived context:** authoritative economy state restored correctly, but future freight matching diverged until the derived building-to-road firm access cache was rebuilt after hydration. V6 now reconstructs that cache instead of persisting it.
5. **Full-suite runtime risk:** freight supplier routing initially risked repeated pathfinding on congestion changes. Stable OD routes now reuse the free-flow route cache while current edge travel times are summed over that cached path for generalized logistics cost. The Phase 3 long-horizon file returns to a few seconds locally rather than minutes.

### Acceptance evidence

All 12 Phase 6 causal acceptance chains pass. Representative diagnostics recorded roughly 0.7–0.8 seconds for 5,000 active-economy ticks, ~6 ms for 10,000 small indexed supplier matches, and 99/100 cache hits for repeated stable freight OD planning. Timings remain diagnostic-only.

The Phase VI Chromium smoke formed 17 establishments with 17 active freight agents in the test city, verified the economy panel/firm inspector/freight overlay, saved V6, destructively removed a firm and boundary road, then restored the serialized authoritative state exactly.

## 2026-08-22 — Phase 7 Land & Housing Market Signals

Continued the Land, Housing & Development phase on top of the V7 developer-market baseline:

- added `LandHousingMarketSystem`, a deterministic derived property-market layer for residential, commercial and industrial zones;
- residential market pressure now responds directly to housing utilization (`population / residentialCapacity`) as well as demand, accessibility, services and utilities;
- commercial and industrial pressure respond to their own demand plus relevant person/freight access and employment/utilities;
- added bounded zone rent, vacancy and land-value indexes plus parcel-local adjustments for access, services, neighborhood quality, utilities and frontage;
- moved achievable rent, explicit vacancy and land-value formation out of `DevelopmentFeasibilitySystem` and into the market layer;
- retained project-specific zoning/access/utility/service gates, construction cost, financing, NOI, cap-rate, return and residual-land-value underwriting;
- exposed `SimulationCore.landHousingMarketSnapshot` for diagnostics and future UI/overlay work;
- kept Save V7 unchanged because the market contains no authoritative history and is recomputed from existing simulation state.

### TDD and bugs found during integration

1. **Duplicated price formation:** the developer pro-forma slice still synthesized rent, vacancy and land value internally from generic demand/access multipliers. The new market subsystem makes those signals explicit and inspectable, and underwriting now consumes them rather than creating a second market model.
2. **Core integration contract:** the first repository-level RED run executed 223 tests; 185 passed and 38 failed with `marketPressure must be finite`. The new market/underwriting unit tests were already green, isolating the defect to `SimulationCore` not yet supplying the new parcel signals. Core wiring removed the cascade.
3. **Derived-cache save drift risk:** a market snapshot refreshed only every 50 ticks could diverge after loading a save mid-window because that derived snapshot is intentionally not persisted. The final architecture refreshes the tiny derived market immediately before each 10-tick development evaluation and after the 50-tick city loop, preserving schema-free deterministic decisions.

### Acceptance evidence

Unit tests verify housing-scarcity directionality, commercial-demand monotonicity, industrial freight weighting, parcel service/utility penalties, determinism and invalid-input rejection. Underwriting tests verify that higher market rent raises NOI/return, higher vacancy suppresses income/return and higher land value raises cost/suppresses return.

The integration CI cycle passed the complete repository tests, typecheck, lint and production build after core wiring.

## 2026-08-22 — Phase 7 Aggregate Housing Choice & Redevelopment Pressure

Extended the property-market slice into affordability and occupied-residential redevelopment diagnostics while deliberately remaining aggregate and save-neutral:

- added `HousingChoiceSystem` with deterministic lower/middle/upper income-band shares, rent-burden thresholds and quality-sensitive weighted housing allocation;
- each occupied residential building becomes a housing option using its real building capacity/base rent plus current parcel market rent, person access, services, neighborhood quality and utilities;
- separated raw physical housing capacity from `effectiveAffordableCapacity`, the income-share-weighted economically usable portion of existing stock;
- fed effective affordable capacity through the existing residential-demand housing-pressure channel, causing expensive stock to increase development demand without creating a parallel demand model;
- added citywide affordability, rent burden, cost-burdened resident, unplaced resident and per-building occupancy diagnostics;
- kept raw physical residential capacity as `PopulationSystem`'s hard cap while applying affordability only as a bounded 0.85–1.0 modifier to migration attractiveness;
- added `RedevelopmentPressureSystem`, ranking occupied residential parcels by the economics of feasible higher-intensity replacements after current-use opportunity cost, demolition cost and resident displacement burden;
- used a dedicated redevelopment feasibility evaluator so occupied-parcel diagnostics cannot overwrite normal developer-market feasibility diagnostics;
- exposed `SimulationCore.housingChoiceSnapshot` and `SimulationCore.redevelopmentPressureSnapshot` as read-only derived diagnostics;
- kept Save V7 unchanged and added no automatic demolition, relocation, tenure or individual-household state.

### TDD and integration evidence

1. **Housing choice RED:** the first housing-choice CI run left all 223 existing tests green and failed only because `HousingChoiceSystem.ts` did not exist. The implemented system then passed the full test/typecheck/lint/build gate.
2. **Affordability integration RED:** 231/232 tests passed before core wiring; the only failure was the missing `housingChoiceSnapshot`. The independent causal test already showed that identical physical stock with higher rents produces lower effective affordable capacity and therefore higher residential demand.
3. **Redevelopment engine RED:** 232 existing tests passed and only the intentionally missing `RedevelopmentPressureSystem.ts` failed. Unit tests then covered feasible/infeasible replacements, displacement burden, deterministic ranking and validation.
4. **Redevelopment core RED:** 238/240 tests passed; both failures were exactly the absent core redevelopment snapshot. After wiring, the full 240-test suite, typecheck, lint and build passed.

### Causal boundaries

Housing allocation is an aggregate market-clearing approximation rather than a hidden demographic simulation. Fixed income bands are game-economy cohorts, fractional weighted residents are allowed, and no resident object, lease, mortgage, move queue or eviction history is fabricated. Redevelopment pressure is a derived diagnostic: it cannot itself demolish a building, displace residents, alter zoning or create a developer award.

## 2026-08-22 — Phase 7 Safeguarded Residential Redevelopment Execution

Converted redevelopment pressure into an actual residential development path without introducing individual household agents or a second capital market:

- added `BuildingSystem.replaceDevelopment()` with strict occupied-residential, award-identity and higher-intensity validation;
- preserves deterministic `building:<lotId>` identity while replacing the old occupied use with the awarded definition in normal construction state;
- added `RedevelopmentExecutionSystem`, a pure deterministic planner between pressure diagnostics and developer allocation;
- requires redevelopment pressure ≥ 0.25 and blocks all demolition while the current housing allocation already has unplaced residents;
- requires post-demolition raw residential capacity to remain at least current population;
- requires post-demolition effective affordable capacity to remain at least 85% of current population;
- reserves both relocation constraints cumulatively in stable pressure order so several same-cycle candidates cannot collectively over-demolish the housing stock;
- adds demolition and aggregate displacement friction to the developer-underwritten pre-finance cost and recomputes feasibility/return economics;
- combines admitted occupied-parcel replacements with vacant-lot opportunities in one `DeveloperMarketSystem.allocate()` call, preserving the same developer capital, leverage, risk, hurdle and concurrent-project constraints;
- blocks redevelopment while the deterministic building identity still has an active developer commitment, with `SimulationCore` exposing `active-commitment` as the planner diagnostic;
- independently prevents duplicate building commitments inside `DeveloperMarketSystem.allocate()`, so even a caller that bypasses planner diagnostics cannot overwrite an unreleased commitment or orphan a prior developer's committed capital;
- on award, removes the old building from the economy-domain building lifecycle, starts higher-intensity construction in place and retains the normal developer capital commitment;
- does not directly mutate population on demolition; the existing 50-tick population loop remains authoritative, with relocation safeguards ensuring enough occupied stock remains;
- keeps Save V7 unchanged because the executed state is already represented by the existing construction-stage building and developer commitment while pressure/execution snapshots remain derived.

### TDD and integration evidence

1. **Building replacement RED:** 240 existing tests passed and the 3 new replacement tests failed only because `replaceDevelopment()` did not exist. After implementation, 243/243 tests plus typecheck, lint and build passed.
2. **Execution planner RED:** all 243 existing/replacement tests passed and CI failed only because `RedevelopmentExecutionSystem.ts` was intentionally absent. The planner then passed its physical-capacity, unplaced-resident, cumulative-slack, friction-economics and mismatch/threshold tests.
3. **Core execution RED:** before core wiring, 249/250 tests passed; the only failure was the eligible occupied parcel receiving no redevelopment award.
4. **Integration observation fix:** after core wiring the redevelopment itself succeeded, but one assertion still inspected `DeveloperMarketSystem.lastAwards()` after a later 10-tick auction had intentionally overwritten that ephemeral diagnostic. The test was corrected to inspect the authoritative active developer commitment instead of weakening production behavior.
5. **Capital-ledger review bug:** manual review found that deterministic building IDs outlive construction while developer commitments release later. A redeveloped/occupied building could therefore be reconsidered while its prior commitment was still active, allowing a second award for the same `building:<lotId>` to overwrite the commitment map entry and leave the first developer's committed capital orphaned. A developer-market regression was written first and failed exactly on the duplicate award; allocation now filters and rechecks active building commitments before awards.
6. **Core diagnostic RED:** after the authoritative market backstop was green, a new core regression seeded a live building commitment and required redevelopment diagnostics to report `active-commitment`. The first run produced 253 tests with 252 passing; the only failure reported `physical-capacity` because `SimulationCore` had not passed live commitment state to the planner. Core now derives committed building IDs from `DeveloperMarketSystem.listCommitments()` and passes the boolean into redevelopment execution inputs.
7. **Final code gate before documentation:** GitHub Actions run #144 passed **253/253 tests**, Typecheck, Lint and Build on the commitment-wired head.

### Causal boundaries

This remains an aggregate relocation safeguard, not a household-moving simulation. No leases, tenure, mortgages, owner identities, household search duration, temporary housing, eviction or homelessness queues are fabricated. Commercial/industrial redevelopment and policy/UI controls remain deferred. The older conflicting Phase 7 household branch was not merged wholesale because it predates and overlaps the now-canonical property-market/developer architecture; its cohort/tenure concepts remain design input for later work rather than a regression source.