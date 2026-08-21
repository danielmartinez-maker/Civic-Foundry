# Save Format — V3

Current envelope:

- `saveVersion: 3`
- `gameVersion: "0.3.0-rebuild"`

## Persisted authoritative state

- seed and authoritative RNG state
- clock tick and speed
- full terrain cell state
- treasury balance and transaction history
- road cells and road revision
- zoning cells
- buildings and construction status/ticks
- population
- tax rates
- utility facilities and next facility ID
- garbage backlog by building
- economy settlement state
- cached Phase 2 evaluation snapshots needed for cadence-exact continuation
- trip-generation RNG state and next trip ID
- active traffic vehicles/routes/progress/delay/status
- rolling traffic outcomes, lifetime completed/failed counts, next vehicle ID, congestion epoch
- intersection queues

## Rebuilt state

Not persisted:

- transportation graph
- pathfinding route cache
- edge traffic metrics
- traffic analytics snapshot
- Canvas/render buffers
- traffic overlays
- road-component indexes
- lots (rebuilt from roads + zoning)

## Hydration sequence

1. validate envelope/version/base state
2. construct candidate `TerrainGrid` and `SimulationCore`
3. restore RNG/clock/treasury/roads/zoning/buildings/population/taxes/utilities/garbage/economy
4. rebuild lots and transportation graph
5. validate every persisted traffic edge/node/queue reference against rebuilt graph
6. restore trip RNG, traffic vehicles/outcomes/counters, and intersection queues
7. rebuild edge metrics and traffic analytics
8. return the candidate core

Corrupt traffic references throw before the candidate is returned.

## V2 migration

V2-compatible saves hydrate the Phase 2 city state and initialize:

- no active traffic vehicles
- no rolling traffic outcomes
- zero completed/failed traffic counters
- empty intersection queues

Migration does not invent successful trip history.
