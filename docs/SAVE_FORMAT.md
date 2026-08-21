# Save Format — V4

Current envelope:

- `saveVersion: 4`
- `gameVersion: "0.4.0-rebuild"`

## Persisted Phase 1–3 state

V4 retains seed/RNG, clock, terrain, treasury, roads/revision, zoning, buildings, population, taxes, utilities, legacy garbage compatibility state, economy snapshots, trip-generation RNG, active traffic vehicles/outcomes/counters, congestion epoch and intersection queues.

## Persisted Phase 4 public-service state

- service facilities, next facility ID
- department funding and current fiscal-payment ratio
- service jobs and next job ID
- service vehicles including routes/progress/state
- incidents, incident outcomes, incident RNG and next incident ID
- detailed per-building waste
- processing queue and processed total
- garbage-truck cargo by job
- building→active collection-job reservations
- service-demand snapshot
- education snapshot
- neighborhood-quality snapshot
- per-building service access snapshot used for cadence-exact continuation
- last generated waste amount

The building→collection-job reservation map is authoritative: without it a loaded city could create duplicate collection jobs and diverge deterministically.

## Rebuilt state

Not persisted:

- transportation graph
- pathfinding route cache
- edge traffic metrics
- renderer/Canvas state
- traffic/service overlays
- road-component indexes
- lots

## Hydration

1. validate base envelope and supported version (V2/V3/V4)
2. construct candidate core and restore Phase 1–3 owners
3. rebuild lots and transportation graph
4. restore/migrate public-service facilities and budgets
5. validate all active commuter/service edge, node, job, building, facility and queue references
6. restore service jobs, vehicles, incidents, outcomes, detailed waste/cargo/reservations and cached service state
7. reconstruct derived traffic metrics and other rebuildable state
8. return the coherent candidate

Corrupt service/traffic graph references throw before a live core is returned.

## V3 migration

V3 saves preserve their city/traffic state and initialize public-service history honestly. Existing legacy utility landfills are deterministically converted into Phase 4 service landfills and removed from the legacy utility list. Department budgets start at 100%; no successful incident/job history is invented.

V2 continues through the existing V2→traffic migration before Phase 4 defaults are applied.
