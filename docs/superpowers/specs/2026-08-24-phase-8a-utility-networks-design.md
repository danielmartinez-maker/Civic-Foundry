# Phase 8A — Utility Networks Design

## Status

Approved architectural direction for the first Phase 8 — Metropolitan Infrastructure slice.

This slice replaces Civic Foundry's road-component utility proxy with explicit, capacity-constrained power and water networks while preserving the existing deterministic simulation philosophy and the public `SimulationCore`/utility snapshot seams wherever practical.

Phase 8A is implemented before Phase 8B. It introduces the minimal shared infrastructure graph machinery that Phase 8B may reuse, but it must not build speculative highway abstractions into the utility implementation.

## Goals

Phase 8A must make utility infrastructure a real spatial and economic constraint.

A building is no longer powered or watered merely because it shares a road component with a source. Service must physically traverse an explicit utility network with finite source, segment and connection capacity. Water must additionally have adequate pressure reach. Network saturation, disconnection, upgrades and deterministic protection trips must create observable local consequences.

The player must be able to answer:

- Where does this building's power and water come from?
- Which segment is the bottleneck?
- How much spare capacity exists locally?
- Why is this parcel unable to support higher-intensity development?
- Would a line upgrade, substation or pump fix the problem?
- Which areas are affected by a disconnected or tripped segment?

## Non-goals

Phase 8A does not add:

- stochastic weather or natural-disaster failures; those belong to Phase 10 resilience
- detailed AC power-flow physics, voltage phase, reactive power or transformer engineering
- full hydraulic transient simulation, pipe diameter chemistry or water contamination
- individual utility customers/meters
- utility pricing, bonds, rate cases or enterprise-fund accounting; those belong primarily to later finance/government phases
- regional imports/exports of electricity or water beyond the city's explicit source facilities
- speculative generic infrastructure abstractions not used by power or water

## Existing baseline and compatibility constraints

The V7 baseline has `UtilitySystem` facilities for `power`, `water` and `landfill`. Power and water production are currently assigned to road-connected components, and every occupied building on the same component receives a common resource ratio. Existing building definitions already expose exact `powerDemand`, `waterDemand` and `minimumUtilityRatio` values. Development, neighborhood/service quality, population and demand already consume utility outcomes.

Phase 8A must preserve those downstream causal channels. It changes how the utility ratio is produced; it does not introduce a parallel city-growth bonus.

`landfill` remains on the existing garbage/public-service path and is not converted into the new capacity network in this slice.

## Architectural decision

### 1. Minimal shared `InfrastructureGraph`

Introduce a focused reusable graph under `src/simulation/infrastructure/`.

It is an algorithmic graph, not a new all-purpose world model. Its required responsibilities are only:

- stable deterministic node and edge IDs
- directed or bidirectional edges
- finite edge capacity
- operational/failed eligibility
- sorted adjacency for deterministic traversal
- deterministic max-flow/residual-flow evaluation
- edge utilization and residual-capacity reporting

It must not know about buildings, roads, electricity, water, money, zoning or rendering.

Authoritative world topology remains owned by the domain system. Power/water corridor records are persisted; the `InfrastructureGraph` is rebuilt deterministically from them after load or topology revision.

### 2. `UtilitySystem` remains the public facade

Keep `SimulationCore.utilities` as the primary utility-facing seam to avoid unnecessary churn across the rest of the codebase.

`UtilitySystem` becomes a facade/composition root for:

- utility facilities
- power corridor topology
- water corridor topology
- `PowerNetworkSystem`
- `WaterNetworkSystem`
- placement/upgrades/removal
- aggregate `UtilitySnapshot`
- local development-headroom queries
- persistence snapshot/restore

The resource-specific systems remain independently testable and use the shared graph algorithms rather than each implementing custom traversal.

### 3. Explicit corridor topology

Utility networks are player-built corridors represented as deterministic path cells. Adjacent compatible cells derive graph edges.

Distribution networks follow the public right-of-way:

- `power_distribution` may be placed only on existing road cells
- `water_main` may be placed only on existing road cells

High-capacity backbone networks may use roads or independent buildable terrain:

- `power_transmission`
- `water_trunk`

Backbone corridors may cross ordinary road cells without changing road connectivity. They may not occupy water/unbuildable terrain in Phase 8A.

Multiple utility layers may coexist on the same coordinate because they are separate infrastructure layers rather than mutually exclusive surface occupancy.

### 4. Tiered capacity and upgrades

Each corridor cell has authoritative tier `1 | 2 | 3`. Adjacency edges take the lower capacity of the two connected cells so an undersized segment remains a real bottleneck.

Initial capacities are:

| Network | Tier 1 | Tier 2 | Tier 3 |
| --- | ---: | ---: | ---: |
| power distribution | 180 | 360 | 720 |
| power transmission | 720 | 1,440 | 2,880 |
| water main | 150 | 300 | 600 |
| water trunk | 600 | 1,200 | 2,400 |

Capacity units use the same abstract units as existing building/facility demand and production. These values intentionally align Tier 1 distribution with the current small source facilities, while backbone infrastructure creates headroom for later metropolitan-scale sources and demand.

An upgrade changes only the selected authoritative corridor cells and charges the delta construction cost from the treasury. No downgrade is provided in Phase 8A.

Construction/operating cost constants live in data definitions and must preserve the following monotonic rules:

- higher tier always costs more to build and operate
- backbone capacity is cheaper per unit than distribution capacity but has higher absolute cost
- a network that is substantially overbuilt creates a real recurring fiscal burden

### 5. Power network

Existing `power` utility facilities remain valid low-capacity generation facilities with production `180`. They may inject directly into adjacent `power_distribution` or `power_transmission` topology. This preserves small-city usability and avoids inventing migration-only facilities.

Add `power_substation` as a utility facility. A substation bridges transmission to distribution and has finite transfer capacity. Distribution demand cannot consume transmission capacity without either a substation bridge or a direct low-capacity source connection.

Power flow evaluation:

1. create source nodes from operational power facilities
2. create transmission/distribution graph layers and substation bridge edges
3. create building sink edges only for occupied buildings adjacent to distribution corridor
4. building sink capacity equals the building's exact power demand
5. run deterministic max flow with sorted node/edge order
6. derive per-building power served ratio from delivered sink flow
7. derive segment utilization from realized flow / capacity

When several maximum-flow solutions are possible, deterministic adjacency and stable IDs define the canonical solution. Input iteration order must not change results.

### 6. Water network and pressure

Existing `water` facilities remain valid low-capacity treated-water sources with production `150`. They may inject directly into adjacent `water_main` or `water_trunk` topology.

Add `water_pump` as a facility that bridges/boosts water trunk/main networks with finite throughput.

Water has two independent constraints:

- hydraulic capacity, evaluated with the same deterministic max-flow machinery
- pressure reach, evaluated before flow eligibility

Pressure uses a deliberately simplified deterministic head model:

- a source or pump emits `8.0` head units
- every traversed corridor edge consumes `0.25` head units
- uphill travel additionally consumes `8 * max(0, destinationElevation - sourceElevation)` head units
- downhill travel receives no pressure credit beyond avoiding the uphill penalty
- an edge/node is pressure-eligible only while remaining head is greater than zero
- a pump resets outgoing head to `8.0` subject to its own transfer capacity

Pressure propagation uses a deterministic best-remaining-head traversal with stable-ID tie breaking. Only pressure-eligible edges participate in the water max-flow network.

A building adjacent to a water main but outside positive pressure reach receives zero water even if raw source capacity exists elsewhere in the component.

The water snapshot exposes pressure margin as a derived diagnostic; only delivered water ratio feeds existing building utility outcomes.

### 7. Building connections

Occupied buildings connect automatically to cardinal-adjacent distribution infrastructure:

- power consumers require adjacent `power_distribution`
- water consumers require adjacent `water_main`

A building does not connect directly to transmission/trunk lines.

Connection edges are virtual derived edges with capacity equal to the building's exact current demand. They are not separately placed or persisted.

This preserves the current one-cell building model and makes road-following distribution practical because zoned buildings already require road frontage.

### 8. Local infrastructure headroom for development

Phase 7 development must stop using only a citywide/road-component utility proxy for parcel eligibility.

Add a deterministic local-capacity query to the utility facade:

`evaluateDevelopmentHeadroom(x, y, powerDemand, waterDemand)`

For a prospective occupied building definition, the query evaluates maximum additional power/water deliverability from the current residual network to a virtual sink at the lot/building connection location. It returns:

- `powerHeadroom`
- `waterHeadroom`
- `powerServiceRatio`
- `waterServiceRatio`
- combined `utilityRatio = min(powerServiceRatio, waterServiceRatio)`
- water pressure eligibility/margin
- limiting reason when below full service

The development feasibility path uses this candidate-specific ratio against the existing building `minimumUtilityRatio`. It does not require 100% prospective service if the building definition itself permits a lower minimum.

Headroom queries must be cached within a single development-market evaluation by topology revision + current flow revision + location + demand tuple so candidate underwriting does not repeatedly rebuild identical graphs.

This is a direct causal constraint: adding or upgrading nearby infrastructure changes feasible intensity because it changes real residual deliverability.

### 9. Deterministic overload protection and outages

Phase 8A introduces infrastructure outages only as deterministic overload protection, not random failure.

Each authoritative corridor cell tracks:

- consecutive saturated evaluation cycles
- `trippedUntilTick` when applicable

After a utility evaluation, a corridor cell is considered saturated when any incident edge is at or above `0.98` utilization. If it remains saturated for three consecutive 50-tick core-city utility evaluations, protection trips the cell for the next `100` simulation ticks.

A tripped cell is excluded from the network graph. Its saturation counter resets when the trip begins. After `trippedUntilTick`, it returns automatically unless it becomes saturated again over subsequent evaluation cycles.

Manual demolition/disconnection produces immediate topology loss without waiting for the 50-tick overload cadence.

Trip state is authoritative because it affects future service and must persist in Save V8.

### 10. Simulation ordering

Retain the existing service/development cadences while making utility topology authoritative.

High-level order on relevant cycles:

1. apply topology/player mutations immediately
2. rebuild utility graphs only when topology/facility revision changes
3. evaluate current power flow and water pressure/flow
4. expose per-building utility service
5. run service/neighborhood consequences
6. run housing/economy/demand consequences
7. use residual local utility headroom during development underwriting
8. after development/building topology changes, reevaluate affected utility connections before downstream snapshots are finalized

Utility evaluation must occur before any system that consumes the current utility ratio.

### 11. Persistence — Save V8

Phase 8A introduces `SaveV8` and game version `0.8.0-metropolitan-infrastructure`.

Save V8 extends V7 and persists authoritative utility infrastructure state:

- utility corridor cells by resource/network class/tier
- expanded facility list and deterministic next IDs
- saturation counters
- trip expiry ticks
- utility topology revision/cursors only where required for exact continuation

Derived graph edges, flows, per-building service, pressure maps, utilization, headroom caches and overlays are not persisted.

#### V7 → V8 migration

Loading V7 must not make previously road-connected cities instantly unusable.

For each legacy road connected component:

- if the component has at least one `power` source, seed Tier 1 `power_distribution` corridor cells on every road cell in that component
- if the component has at least one `water` source, seed Tier 1 `water_main` corridor cells on every road cell in that component
- do not create transmission, trunk, substations, pumps, overload history or outages
- initialize all saturation counters to zero and all segments operational

This deterministic migration reproduces the old spatial service envelope as explicit infrastructure without fabricating historical failures or upgrades.

A newly created V8 city starts with no utility corridors; placing a source automatically creates a single Tier 1 compatible distribution/main corridor cell on one deterministic adjacent road cell if one exists, and the player extends the network from there.

### 12. UI and player controls

Add a dedicated Metropolitan Infrastructure / Utilities surface rather than overloading Land & Housing.

Player tools:

- draw power distribution
- draw power transmission
- draw water main
- draw water trunk
- place substation
- place pump
- upgrade selected utility path to next tier
- bulldoze/remove utility path/facility through typed `SimulationCore` APIs

Presentation:

- citywide power production, demand, delivered, unserved and reserve margin
- citywide water production, demand, delivered, unserved and reserve margin
- network operating cost
- saturated/tripped segment counts
- power capacity/utilization overlay
- water capacity/pressure overlay
- outage overlay
- segment inspector: type, tier, capacity, realized utilization, residual capacity, saturation cycles, trip status
- facility inspector: type, capacity, realized throughput, connected network, utilization
- building inspector: delivered power/water ratios and local limiting reason

Overlay values are derived only from authoritative network snapshots.

### 13. Public API direction

Likely public seams:

- `SimulationCore.buildUtilityPath(...)`
- `SimulationCore.upgradeUtilityPath(...)`
- `SimulationCore.placeUtility(...)` extended for new facility types
- `SimulationCore.removeUtilityAt(...)`
- `UtilitySystem.snapshotState()` / `restoreState()`
- `UtilitySystem.evaluate(...)`
- `UtilitySystem.evaluateDevelopmentHeadroom(...)`

Exact naming may vary during implementation only if the resulting interface preserves these responsibilities and typed-mutation boundary.

### 14. Error handling and invariants

Placement rejects atomically for:

- out-of-bounds/unbuildable backbone coordinates
- distribution/main cells not on road rights-of-way
- duplicate path coordinates
- invalid layer transitions
- insufficient treasury
- upgrades above Tier 3
- facility collision or missing required network adjacency

No partial treasury debit or partial path placement may occur on failure.

Required invariants:

- delivered resource never exceeds source production
- segment realized flow never exceeds operational segment capacity
- building delivered flow never exceeds building demand
- tripped segments carry zero flow
- water flow cannot traverse pressure-ineligible edges
- totals equal the sum of per-building delivered demand within floating-point tolerance
- same authoritative state yields identical flow assignment regardless of input ordering
- graph/cache invalidation follows authoritative topology revisions

### 15. Tests and acceptance criteria

TDD coverage must prove at minimum:

1. road connectivity alone no longer supplies a new V8 networked building
2. explicit distribution/main corridors restore service
3. a low-tier bottleneck creates partial local service while unrelated branches remain served
4. upgrading the bottleneck increases deliverable service/headroom
5. two equivalent input orderings produce identical flow and utilization snapshots
6. a building adjacent only to transmission/trunk receives no direct service
7. a substation bridges transmission to distribution
8. elevation can make a water consumer pressure-ineligible
9. a pump restores pressure reach and remains capacity constrained
10. three consecutive saturated 50-tick evaluations trip a segment for exactly 100 ticks
11. a tripped segment creates a deterministic outage and later returns to service
12. development of a high-demand candidate is rejected when local residual headroom is below its `minimumUtilityRatio`
13. an infrastructure upgrade can make that same candidate feasible without an artificial development bonus
14. V7 migration creates deterministic Tier 1 road-following utility networks with zero invented outage history
15. Save V8 round-trips topology, upgrades and active trip state and continues deterministically
16. long-run utility evaluation remains finite and respects capacity invariants
17. Chromium smoke exercises building/upgrading a power path and water path and sees authoritative overlay/inspector state

Full pre-merge verification remains:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Phase 8A Chromium smoke
- exact-head PR CI
- review/comment/thread check

## Phase boundary

Phase 8A is complete when explicit power and water networks fully replace road-component distribution as the authoritative source of building utility service and development headroom, Save V8 preserves them, and the player can build/inspect/upgrade/troubleshoot those networks.

Phase 8B then consumes the shared infrastructure-graph conventions for metropolitan roads without changing the utility network contract.