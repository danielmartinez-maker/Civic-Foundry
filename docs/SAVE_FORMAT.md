# Save Format — V5

Current envelope:

- `saveVersion: 5`
- `gameVersion: "0.5.0-metropolitan"`

## Persisted Phase 1–4 state

V5 retains the complete V4 city envelope: seed/RNG, clock, terrain, treasury, roads/revision, zoning, buildings, population, taxes, utilities, garbage/economy state, trip-generation RNG, active traffic vehicles/outcomes/counters, congestion epoch, intersection queues, service facilities/budgets/jobs/vehicles/incidents, detailed waste and cadence-critical service snapshots.

## Persisted Phase 5 transit state

`transit.network` stores authoritative transit topology and configuration:

- deterministic stop/station records and next stop ID
- line records and next line ID
- ordered stop sequences
- mode, name, headway, fare and enabled state
- transit topology revision

`transit.mobility` stores authoritative continuation state:

- recent mode-choice decisions needed by the mobility snapshot
- configured crowding penalty and transit fiscal cursors
- FIFO passenger queues, including partial cohorts and transfer legs
- active transit vehicles, route/progress/dwell state, capacity and onboard cohorts
- transit operations line state, fleet limits and accumulated dispatch/ridership/reliability/finance counters

## Rebuilt state

V5 deliberately does not persist:

- `TransportationGraph`
- `MultimodalRoutingGraph`
- pathfinding or journey-plan caches
- edge traffic metrics that can be reconstructed
- renderer/Canvas state
- traffic/service/transit overlay selection
- render geometry
- lots and other deterministic topology indexes
- capacity-pressure analytics, which derive from saved queues and active vehicle capacity

## Hydration

1. identify V5 versus a supported legacy envelope;
2. validate the V5 game version and transit envelope shape;
3. hydrate the Phase 4 candidate core through the legacy owner restore path;
4. restore transit topology;
5. validate passenger, transfer, vehicle, line, stop and road-edge references against the restored topology;
6. restore passenger queues, active vehicles and operations state;
7. clear/rebuild derived multimodal and route caches;
8. reconstruct traffic/mobility snapshots and return the coherent candidate.

Corrupt transit references throw before the hydrated core is returned.

## V4 migration

V4→V5 preserves the Phase 4 city exactly and initializes honest empty transit topology/mobility state. It does not invent lines, passengers, vehicles, ridership or successful history.

The public `serializeCore` and `hydrateCore` API is V5. `serializeCoreV4`/legacy hydration remain explicit compatibility tools for migration tests and historical Phase 3/4 fixtures.

## Earlier migration

V3 migration preserves city/traffic state and initializes public-service history honestly. Legacy utility landfills are deterministically converted into Phase 4 service landfills. V2 continues through the existing traffic migration path before later-phase defaults are applied.
