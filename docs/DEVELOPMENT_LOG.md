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
