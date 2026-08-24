# Civic Foundry

Civic Foundry is an original browser-based city-management and urban-development simulator built as deterministic vertical slices.

## Canonical baseline

**V7 (`0.7.0-metropolitan`) remains the canonical gameplay/save baseline while Civic Foundry 2.0 is introduced progressively.** Civic Foundry 2.0 **Phase 0A — Kernel Skeleton & Deterministic Scheduling** now places a deterministic simulation kernel beneath V7 without changing the V7 save schema, gameplay formulas, random-number consumption, public mutation APIs, or authoritative domain ownership. Older V5/V6 serializers and hydrators remain supported for compatibility and migration testing.

The current runtime path is:

`GameApp → SimulationCore facade → SimulationKernel → legacy-v7-city compatibility system → unchanged V7 domain orchestration`

`SimulationKernel` owns the outer fixed-step/clock boundary and provides deterministic system scheduling, sequenced commands, a domain-event journal, isolated named RNG streams, cadence-aware invariants, and diagnostic snapshot providers. In Phase 0A those new facilities are infrastructure only: the single production kernel system is `legacy-v7-city`, existing gameplay mutations remain direct `SimulationCore` APIs, no gameplay domain consumes kernel RNG streams or authoritative kernel events, and kernel diagnostic state is not persisted.

The V7 baseline contains the reverified rebuild through **Phase 6 — Firms, Production & Freight** plus the complete **Phase 7 — Land, Housing & Development** domain: deterministic developer pro-formas and competition, derived property markets, affordability, renter/owner tenure economics, persistent aggregate housing relocation, safeguarded redevelopment, player-facing land/housing intelligence and housing/development policy controls.

Implemented in the V7 gameplay baseline:

- deterministic terrain, simulation clock, treasury, construction costs and save/load
- local, collector and arterial roads with intersections and graph revisions
- R/C/I zoning, road-frontage lots, construction, population, employment and taxes
- road-connected power/water plus recurring city finance
- deterministic transportation graph, A* routing and revision-aware route cache
- weighted commute/shopping traffic, moving vehicles, queues and real congestion
- fire, police, healthcare, education, routed garbage collection and public-service budgets
- explicit fire engines, patrol cars, ambulances and garbage trucks using the road graph
- seeded fire/police/medical incidents, network-based service accessibility, school capacity and detailed building waste
- bus, BRT, tram and metro transit topology with ordered stops, headways, fares, enablement and fleet limits
- deterministic multimodal journey planning and weighted car/transit mode choice
- FIFO passenger queues, partial boarding, transfers, capacity constraints and left-behind passengers
- explicit transit vehicles, scheduled dispatch, dwell, road-sensitive surface service and insulated metro timing
- transit operating cost, fare revenue, reliability, crowding, mode share and person accessibility feeding city outcomes
- Phase V transit build/configuration tools, HUD metrics, inspectors, vehicles and numeric overlays
- establishment-based commercial/industrial firms with deterministic formation, labor allocation, operating health, distress and closure
- conservation-safe inventories and the explicit `industrial_inputs → manufactured_goods → consumer_goods` production chain
- boundary-derived freight gateways, imports/exports, generalized-cost supplier matching, queued freight orders and explicit weighted trucks
- freight congestion/logistics feedback into shortages, output, firm economics, employment and city demand
- Phase VI economy/freight HUD metrics, firm inspection, nine diagnostic overlays and authoritative freight-agent rendering
- multiple deterministic building variants by zone and intensity
- explicit derived residential/commercial/industrial property markets with bounded pressure, rent, vacancy and land-value indexes
- parcel market signals that combine zone conditions with local person/freight access, services, neighborhood quality, utilities and frontage
- deterministic aggregate lower/middle/upper income-band housing choice across occupied residential buildings
- physical housing capacity separated from effective affordable capacity, with affordability, housing burden, cost-burdened residents and unplaced-resident diagnostics
- effective affordable capacity feeding the existing residential-demand channel while affordability applies only a bounded migration-attractiveness modifier and raw physical capacity remains the population hard cap
- deterministic renter/owner capacity splits by residential intensity, with asking rent, implied purchase price, financing-sensitive owner monthly cost and explicit rental/ownership vacancy
- persistent aggregate housing cohorts by income band and tenure, with deterministic search, tenure preference, affordability/quality scoring, bounded voluntary turnover, severe-burden search, forced displacement, rehousing and explicit failed-search state
- resident-conservation and tenure-capacity invariants: housed plus unplaced population is conserved, renter plus owner occupancy equals housed population, and cohort allocations cannot exceed the current tenure option capacity
- occupied residential redevelopment-pressure diagnostics comparing current-use value with feasible higher-intensity replacements, demolition cost and resident displacement burden
- safeguarded residential redevelopment execution when pressure clears 0.25, no residents are already unplaced, no prior developer commitment remains active on the deterministic building identity, and post-demolition physical and effective-affordable capacity remain above relocation floors
- targeted lower-income redevelopment protection that requires sufficient affordable relocation slack for the protected share of actual lower-income occupants before demolition can be admitted
- cumulative relocation-slack reservation so several same-cycle redevelopment awards cannot collectively demolish more housing than the city can absorb
- occupied-parcel demolition and displacement costs folded into developer underwriting before redevelopment competes with vacant-lot projects in the same deterministic capital market
- in-place higher-intensity rebuilding that preserves deterministic building identity, enters normal construction state and retains authoritative developer capital commitments
- defense-in-depth capital-ledger protection: redevelopment diagnostics report `active-commitment`, while `DeveloperMarketSystem` independently refuses any award that would overwrite an existing `building:<lotId>` commitment
- player-facing Land & Housing intelligence panel with R/C/I pressure, rent, vacancy and land-value indexes plus affordability, tenure, financing, movement/displacement, lower-income relocation slack and redevelopment diagnostics
- deterministic housing-affordability, residential-occupancy, owner/renter-tenure, relocation-pressure and redevelopment-pressure overlays with numeric legends
- residential building inspection sourced from authoritative Phase 7 snapshots, including occupancy, affordability, tenure mix, rental/ownership occupancy, asking rent, owner cost, movement/displacement and redevelopment status
- player-controlled residential density bonus, affordable-housing share, development fee, permitting-cost incentive, redevelopment-affordability floor and lower-income relocation-protection floor
- policy effects feed existing deterministic channels rather than bypassing them: density changes intensity eligibility, affordability requirements blend residential rents/project income, fees and incentives change pro-formas, and redevelopment protections change relocation admission
- parcel underwriting using market rent/vacancy/land value, taxes, service/utility/accessibility, construction cost, financing, stabilized value, return and residual land value
- deterministic competing developers with distinct hurdle rates, leverage, capital, risk tolerances and zone preferences
- explicit development awards, owner/finance metadata, capital commitments, cancellation recovery and post-stabilization capital recycling
- infrastructure, market economics, relocation safeguards and developer-hurdle gating that prevents automatic uneconomic or housing-destructive development
- Save V7 with exact developer-capital/commitment, development-policy and persistent housing-relocation continuation plus Save V6 economy/freight continuation

Phase 0A additionally includes an immutable seven-scenario pre-kernel parity fixture. Current V7 cadence boundaries, city development, services/incidents, transit, economy/freight, housing/development, and save → hydrate → continue must serialize to the same canonical digests after kernel-shell changes.

## Toolchain

The project intentionally uses an offline-capable dependency-light stack:

- TypeScript 5.x ES modules
- Node 22 built-in test runner with TypeScript strip-types
- browser-native Canvas 2D
- global `tsc`
- Python Playwright + Chromium for browser smoke testing

No runtime npm dependency is required.

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run dev
```

`npm run build` produces `dist/`. `npm run dev` serves the compiled build on port 5173 when local navigation is permitted.

## Architecture rule

`SimulationCore` remains the public gameplay facade and composes focused authoritative V7 systems. `SimulationKernel` owns the outer deterministic tick boundary and currently schedules exactly one production system, `legacy-v7-city`, which executes the unchanged V7 per-tick orchestration. Future Civic Foundry 2.0 tranches may extract domains into separately registered kernel systems only after their ownership, dependencies, persistence and parity rules are reviewed.

Inside V7, `MobilityScheduler` owns multimodal update order, `EconomyScheduler` owns Phase 6 firms/inventories/production/freight/trade/business lifecycle state, and the Phase 7 development/housing domain owns property-market signals, tenure economics, persistent aggregate housing occupancy/relocation, development policy, redevelopment diagnostics/planning, parcel feasibility and deterministic developer allocation.

Within Phase 7, `HousingTenureSystem` derives current renter/owner options and their economics from the residential stock and financing environment. `HousingRelocationSystem` owns the persistent aggregate cohort ledger and movement/displacement history. `HousingChoiceSystem` remains the derived affordability/reporting layer over those authoritative allocations. Rendering/UI reads snapshots and submits typed mutations through public APIs; it does not manufacture simulation outcomes.

Road traffic, transit attractiveness, service access, demand, finance, property-market conditions, affordability, tenure, relocation, development policy and development economics are coupled through measured travel/capacity/accessibility results. A transit line only helps when its geometry, frequency, capacity, fare and destination access make it competitive; residential demand distinguishes physical stock from economically usable stock; a parcel only develops when infrastructure, market conditions, project economics, policy and a developer's capital/hurdle constraints permit it; an occupied residential parcel only redevelops when aggregate and lower-income relocation capacity satisfies current policy floors and its deterministic building identity has no live developer commitment.

The Land & Housing UI consumes the existing property-market, tenure, housing-choice, relocation, redevelopment and policy snapshots. Its overlay controller uses a pointer-transparent canvas aligned through the public world renderer coordinates and is mutually exclusive with traffic, service, transit and economy overlays. Policy controls mutate only the authoritative `DevelopmentPolicySystem` through `SimulationCore.setDevelopmentPolicy()`.

## Persistence

Current default save envelope: `saveVersion: 7`, game version `0.7.0-metropolitan`. V7 retains the complete V6 authoritative economy/transit/city state and adds the developer market state, development-policy state and persistent aggregate `housingState` required for exact continuation.

Phase 0A does **not** introduce Save V8. `SimulationKernel`, its scheduler metadata, pending commands, diagnostic event journal, named RNG streams, invariant registrations and snapshot providers are excluded because none is an authoritative V7 gameplay input in this tranche. Hydration reconstructs a fresh kernel around the same restored `SimulationClock`; existing V7 RNG/domain state continues exactly.

Both Phase 7 extension fields are backward-compatible within V7. Older V7 saves without development policy load the default policy. Older V7 saves without `housingState` initialize deterministic housing occupancy from current city/population state with zero fabricated movement history. Loading V6 into the V7 runtime likewise starts the default developer roster with no fabricated commitments, the default development policy and no fabricated housing movement history.

Property-market snapshots, tenure-option economics, affordability/reporting snapshots, redevelopment-pressure/execution planning, overlays and render state are derived and rebuilt from authoritative state rather than persisted. The aggregate occupancy/relocation cohort ledger and its cumulative movement/displacement totals are authoritative and persisted. A redevelopment that actually executes is represented by the existing authoritative construction building plus developer commitment; displaced housing cohorts remain represented in `housingState` until rehoused or otherwise reconciled by the housing system.

Explicit V5 and V6 serializers/hydrators remain available for compatibility, migration tests and historical fixtures.

## Roadmap

0. Civic Foundry 2.0 Phase 0A — Kernel Skeleton & Deterministic Scheduling ✅ — compatibility shell only; no gameplay-domain migration yet
1. Phase 1 — Playable Foundation ✅
2. Phase 2 — Core City Loop ✅
3. Phase 3 — Traffic ✅
4. Phase 4 — Public Services ✅
5. Phase 5 — Transit Revolution ✅
6. Phase 6 — Firms, Production & Freight ✅
7. Phase 7 — Land, Housing & Development ✅ — developer competition, property markets, affordability, renter/owner tenure, persistent aggregate cohort search/relocation/displacement, redevelopment safeguards, anti-displacement policy, Land/Housing intelligence and policy controls
8. Civic Foundry 2.0 Phase 1R onward — progressive reviewed replacement of the V7 foundation and later 2.0 systems per `docs/superpowers/specs/2026-08-24-civic-foundry-2.0-master-design.md`

Individual household/person simulation remains deferred until its reviewed Civic Foundry 2.0 demographic tranche; Phase 0A deliberately changes scheduling infrastructure only.

See `docs/` and `docs/superpowers/` for architecture, balancing, testing, save-format, design and implementation-plan details.