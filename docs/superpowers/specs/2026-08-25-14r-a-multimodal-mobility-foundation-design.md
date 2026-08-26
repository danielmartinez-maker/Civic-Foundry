# Civic Foundry 2.0 — Phase 14R-A Multimodal Mobility Foundation

## Status

Design for user review. Approved architectural direction in chat on 2026-08-25. Implementation has not started.

This tranche is the first implementation slice of **Phase 14R — Mobility & Transit 2.0** from the Full Individual Sim Master Roadmap. It is intentionally compatibility-first: it establishes the durable multimodal architecture on current `main` without prematurely claiming person-authoritative mobility before Personhood, households, schedules, and the remaining Transportation Engine 2.0 work are integrated.

## Goal

Replace the current hard-coded `car | transit | unmet` mobility-choice seam with a deterministic multimodal foundation capable of representing and comparing:

- walking;
- bicycle;
- private car;
- taxi / ride-hail;
- bus;
- trolleybus;
- BRT;
- tram;
- metro;
- commuter rail;
- regional rail;
- ferry.

14R-A must preserve the existing V7 bus/BRT/tram/metro simulation while making those modes providers inside a more general mobility architecture. Later 14R tranches will cut over detailed-city travel to actual `PersonId`-backed journeys and expand mode-specific operations.

## Current-state constraints

The existing runtime already provides useful transit mechanics:

- `TransitNetworkSystem` owns stops, lines, mode, ordered stop sequences, headway, fare, enabled state, and topology revision;
- `MultimodalRoutingGraph` derives walking connectors and transit ride/transfer edges;
- `JourneyPlanner` computes deterministic generalized-cost journeys;
- `TransitVehicleSystem` owns explicit transit vehicles and capacity;
- `PassengerQueueSystem` owns capacity-constrained waiting cohorts;
- `TransitOperationsSystem` owns dispatch, operating cost, fare revenue, and reliability;
- `MobilityScheduler` integrates the above into the city loop;
- `ModeChoiceSystem` currently compares only private car against an undifferentiated transit alternative;
- `PersonTripSystem` still converts aggregate `TripGenerationSystem` demand into weighted trip cohorts rather than generating journeys from actual person schedules.

The current transit data model supports only `bus | brt | tram | metro`. Existing weighted passenger cohorts are not authoritative individual residents.

## Architectural principles

### 1. One mobility orchestration layer

14R-A introduces one authoritative **mobility choice/orchestration layer** for trip alternative generation and selection. It must not create a second transit operations authority.

Existing `TransitNetworkSystem`, `TransitVehicleSystem`, `PassengerQueueSystem`, and `TransitOperationsSystem` remain authoritative for the V7 transit modes during this tranche.

### 2. Mode providers, not mode-specific branching

The central mobility scheduler must not accumulate a growing `if (mode === ...)` chain. Each travel mode or closely related mode family exposes alternatives through a common provider contract.

A provider is responsible for determining whether its mode is available for a journey and, when available, producing a deterministic `MobilityAlternative` with normalized cost components and execution metadata.

### 3. Generalized cost is structured

A mobility alternative must expose its cost components rather than only a single opaque score.

At minimum, the normalized cost model supports:

- access / egress time;
- expected wait time;
- in-vehicle or movement time;
- transfer penalty;
- fare / direct monetary cost impedance;
- parking impedance;
- congestion / delay contribution;
- crowding penalty;
- reliability penalty;
- mode switching / inertia penalty hook;
- accessibility infeasibility.

The final generalized cost is deterministic and derived from these components. Later person-authoritative phases may apply traveler-specific weights, but 14R-A does not invent synthetic personalities or household preferences.

### 4. Capability-driven availability

Mode availability must be represented explicitly.

The foundation supports capability constraints such as:

- requires household/private vehicle access;
- requires licensed/eligible driver;
- supports mobility-limited travelers;
- requires bicycle access;
- requires transit service at origin/destination;
- requires ride-hail service coverage;
- requires ferry/rail station access;
- surface-road-running versus dedicated guideway;
- capacity-constrained versus unconstrained-at-this-layer.

14R-A may use compatibility defaults for legacy weighted cohorts, but every capability input must have a named source so later 14R-B can replace it with actual Person/Household state without changing the provider interface.

### 5. Compatibility before authority cutover

No detailed-city traveler becomes an authoritative `Person` merely because 14R-A exists. Weighted cohorts remain the live demand source until the Personhood/schedule stack is integrated.

14R-A therefore supports a compatibility traveler context while reserving a stable `personId` field for later use. The compatibility path must be explicitly distinguishable from a real person-backed journey and may not be surfaced as an actual resident identity.

### 6. Determinism

Alternative generation, provider iteration, cost calculation, tie-breaking, and execution selection must be deterministic.

Tie-breaking order is:

1. lower generalized cost;
2. lower deterministic provider priority;
3. lexicographically smaller canonical mode ID;
4. lexicographically smaller alternative ID.

No unordered object/map iteration may affect the chosen mode.

## Core data model

### `MobilityModeId`

Canonical mode identifiers:

```text
walk
bicycle
car
ride_hail
bus
trolleybus
brt
tram
metro
commuter_rail
regional_rail
ferry
```

`unmet` is a journey outcome, not a travel mode.

### `MobilityModeDefinition`

Each definition contains only durable cross-system properties required by routing and choice:

- `id`;
- human-readable label;
- mode family (`active`, `private_vehicle`, `for_hire`, `surface_transit`, `rail_transit`, `water_transit`);
- infrastructure family;
- whether the mode is scheduled;
- whether it is capacity-constrained;
- whether it consumes ordinary road capacity;
- whether it uses dedicated guideway;
- baseline access capability requirements;
- deterministic provider priority.

Operational tuning such as headways, fares, vehicle capacity, and service hours stays in the relevant operations/network systems rather than being duplicated in the global mode definition.

### `MobilityJourneyRequest`

A request identifies:

- journey ID;
- optional authoritative `personId`;
- explicit provenance (`legacy_cohort` or `person`);
- origin and destination location/access references;
- departure tick;
- trip purpose;
- traveler capability snapshot;
- policy/cost epoch keys required for cache safety.

For 14R-A production traffic generated by the legacy cohort path, `personId` must be absent and provenance must be `legacy_cohort`.

### `MobilityTravelerCapabilities`

Contains only externally supplied constraints needed to determine feasibility, including hooks for:

- private vehicle access;
- bicycle access;
- ride-hail eligibility/coverage;
- mobility limitation/accessibility requirements;
- fare/payment eligibility where later required;
- maximum tolerated walking/access distance hook.

14R-A uses conservative compatibility defaults derived from the existing legacy mobility behavior. It does not fabricate household ownership or disability state.

### `MobilityCostBreakdown`

Contains normalized non-negative numeric components and the computed `generalizedCost`. Any infeasible alternative is represented as unavailable rather than by relying on `Infinity` as normal business logic across the entire orchestration layer.

### `MobilityAlternative`

Contains:

- stable alternative ID;
- canonical mode ID;
- provider ID;
- cost breakdown;
- route/journey summary;
- expected arrival tick;
- execution token/descriptor consumed by the provider when the alternative wins;
- optional inspectable explanation inputs.

The execution descriptor is opaque outside the owning provider. This prevents the orchestrator from depending on transit- or road-specific internals.

## Provider architecture

### `MobilityAlternativeProvider`

The provider interface conceptually exposes:

- stable provider ID and priority;
- supported mode IDs;
- `buildAlternatives(request, context)`;
- `execute(alternative, request, context)` or an equivalent explicit handoff contract.

Provider output is immutable and deterministically ordered.

### Legacy private-car provider

Wraps the existing road pathfinding/traffic submission path.

For 14R-A it must preserve current car-route semantics and traffic load. It may expose structured parking impedance as zero/default until the parking tranche becomes authoritative.

### Legacy transit provider

Wraps the existing `JourneyPlanner`, `TransitNetworkSystem`, `PassengerQueueSystem`, and transit operations stack.

It must continue to produce real queueing, boarding, capacity, dwell, fare, road congestion interaction, and reliability for bus/BRT/tram/metro exactly through the current transit authority.

The provider reports the actual selected line/mode when available so bus, BRT, tram, and metro are inspectable as distinct modes rather than a single generic `transit` result.

### Foundation-only providers

Walking, bicycle, ride-hail, trolleybus, commuter rail, regional rail, and ferry receive canonical mode definitions and provider interfaces in 14R-A, but only behavior that can be grounded in current authoritative networks may execute.

A mode with no authoritative network/operations implementation must be **unavailable**, not simulated using a fake teleportation or placeholder trip.

This rule prevents the foundation from creating decorative modes that appear functional before their actual operations tranches exist.

## Scheduler integration

The current `MobilityScheduler` becomes the composition point for the new orchestrator, but its existing transit operations order remains intact.

Target ordering for 14R-A:

1. update/rebuild road and transit derived topology as current code requires;
2. advance existing transit operations and vehicles;
3. obtain legacy trip demand on its existing cadence;
4. convert each cohort trip into a compatibility `MobilityJourneyRequest`;
5. ask registered providers for feasible alternatives;
6. choose one alternative through the generalized deterministic choice engine;
7. hand execution back to the winning provider;
8. record normalized mobility decisions/analytics;
9. preserve current fiscal and accessibility feeds.

No second vehicle advancement loop or duplicate passenger queue is introduced.

## Choice engine

`ModeChoiceSystem` is replaced or evolved into a generalized `MobilityChoiceSystem` that accepts an arbitrary ordered list of `MobilityAlternative` objects.

14R-A behavior remains intentionally conservative:

- choice is deterministic generalized-cost minimization;
- no invented individual taste coefficients;
- no stochastic mode choice;
- no memory learning yet;
- no household vehicle competition yet;
- no schedule lateness utility yet.

Those become 14R-B/14R-D behavior once real Person, Household, and Schedule state are authoritative.

The architecture must allow traveler-specific weights and switching costs later without changing provider contracts.

## Analytics and inspection

Existing top-level compatibility metrics remain available:

- car mode share;
- transit mode share;
- unmet share;
- person-accessibility compatibility metric;
- ridership;
- wait;
- reliability;
- crowding;
- transit cost/revenue.

14R-A additionally exposes mode-level decision shares keyed by canonical `MobilityModeId`.

The old aggregate `transitModeShare` remains a derived compatibility metric equal to the combined share of transit-family modes.

No UI overhaul is required in 14R-A, but the public state must be sufficient for a later UI tranche to inspect alternatives, chosen mode, and generalized-cost components.

## Persistence

14R-A does **not** introduce a new save version solely for derived mode definitions, provider registration, route caches, or generalized-cost analytics.

Existing V8 authoritative state remains unchanged.

Persisted V7/V8 transit state continues through the current compatibility structures. The following 14R-A state is derived/rebuildable and must not be added to Save V8:

- mode registry definitions;
- provider registry;
- route/journey caches;
- derived alternatives;
- mode-share analytics;
- generalized-cost explanations.

If implementation uncovers genuinely new authoritative runtime state that cannot be reconstructed, the tranche must stop and amend this design before advancing the save schema. It must not silently append fields to Save V8.

## Compatibility guarantees

14R-A must preserve:

- existing V7/V8 save loading and deterministic continuation;
- current bus/BRT/tram/metro network editing and operations;
- explicit transit vehicle movement;
- passenger queue capacity behavior;
- transit fare and operating-cost accounting;
- road congestion interaction for surface-running transit;
- current road traffic submission for chosen car trips;
- existing TransitPanel/rendering contracts unless a minimal compatibility adapter is required;
- World Foundation authority and Save V8 semantics;
- Transportation Engine 2.0 road/lane/turn semantics already present on `main`.

## Failure handling

- A provider that cannot route the requested journey returns no alternative.
- If all providers return no alternatives, the result is `unmet`.
- Invalid or non-finite cost components reject that alternative deterministically.
- Provider execution must validate that the winning execution descriptor still matches the relevant topology/cost epoch; stale alternatives are discarded/replanned rather than executed against changed topology.
- Removing a transit line/stop continues to use the existing deterministic transit invalidation behavior.
- Missing future-mode infrastructure produces unavailability, never teleportation.

## Performance model

Provider discovery must not scan all city entities. It operates on one journey request plus cached/derived network structures.

Targets for the 14R-A acceptance benchmark:

- provider registration/iteration cost scales with the small number of registered mode providers, not population;
- existing stable-network transit journey-cache reuse is preserved;
- 10,000 mixed car/transit compatibility journey requests remain within the same practical interactive class as the existing Phase 5 benchmark;
- adding unavailable future-mode providers must not materially increase routing cost by triggering network searches for modes whose required infrastructure is absent;
- no per-tick full-population scan is introduced.

Hardware-specific timings remain diagnostic rather than permanent product guarantees.

## TDD acceptance scenarios

### A. Legacy parity

Given a current-main scenario containing only car and existing bus/BRT/tram/metro infrastructure, 14R-A produces the same feasible winner and preserves equivalent traffic/transit execution behavior for representative deterministic cases.

### B. Arbitrary provider choice

Register at least three feasible synthetic test providers. The generalized choice system chooses the minimum generalized-cost alternative with deterministic tie-breaking and without mode-specific branching.

### C. Distinct transit modes

A journey routed by the existing transit network reports the actual winning canonical mode (`bus`, `brt`, `tram`, or `metro`) while retaining combined transit compatibility analytics.

### D. Capability exclusion

When private-car access is explicitly unavailable, the car provider returns no feasible alternative. The choice engine selects another feasible provider or `unmet`.

### E. Unsupported future mode is not fake

A ferry/rail/trolleybus mode definition without an authoritative network produces no executable journey and never teleports a traveler.

### F. Deterministic tie-breaking

Equal-cost alternatives always resolve in the documented provider/mode/alternative order regardless of map/object insertion order.

### G. Save compatibility

Save V8 round-trip remains unchanged in schema and deterministic continuation. No 14R-A derived provider/alternative/cache state appears in the save payload.

### H. Existing transit capacity remains real

Capacity-constrained bus/BRT/tram/metro operation continues to leave excess cohorts waiting, and the new orchestration layer does not bypass `PassengerQueueSystem` or `TransitVehicleSystem`.

### I. Surface transit still consumes the correct road behavior

Existing road-running transit remains coupled to road travel time/congestion through the current transit operations implementation.

### J. Performance

The compatibility benchmark verifies no full-city scan and no routing of unavailable future modes.

## Explicit non-goals for 14R-A

The following belong to later 14R tranches and must not be smuggled into this foundation slice:

- making weighted cohorts into real people;
- authoritative `PersonId` trip generation;
- daily schedule-driven journey creation;
- updating a person's physical location/activity on boarding/alighting;
- missed-connection lateness propagation into schedules;
- memory-based evolving mode preference;
- household vehicle ownership/competition;
- parking search and parking occupancy authority;
- full walking microsimulation;
- full bicycle network/vehicle operations;
- ride-hail fleet dispatch and pricing;
- trolleybus power/network operations;
- commuter/regional rail operations;
- ferry vessel/water-network operations;
- transit signal priority/intersection-control behavior beyond existing hooks;
- broad TransitPanel redesign;
- a new save-version migration.

## Follow-on 14R decomposition

### 14R-B — Individual Journey Authority

Replace legacy weighted detailed-city trip demand with actual `PersonId` schedule/activity journeys once Personhood and schedule dependencies are ready. Enforce the no-synthetic-traveler invariant.

### 14R-C — Active Mobility & Ride-Hail

Implement authoritative walking, cycling, taxi/ride-hail access, routing, fleet behavior, and costs.

### 14R-D — Transit Operations 2.0

Upgrade person-level waiting/boarding/alighting, timetables, service hours, depots/yards, missed connections, schedule lateness, accessibility, experience/reliability learning, and household vehicle constraints.

### 14R-E — Regional & Heavy Modes

Implement trolleybus-specific infrastructure where not completed earlier, commuter rail, regional rail, and ferry operations with explicit networks/fleets and regional interfaces.

### 14R-F — Integration, Persistence, UI & Acceptance

Finalize authoritative persistence/migration, analytics, inspectors/overlays, performance, compatibility retirement, and complete Phase 14R acceptance against person-derived travel.

## Exit criteria for 14R-A

14R-A is complete only when:

1. mobility choice is generalized beyond the hard-coded `car | transit | unmet` seam;
2. all roadmap modes have canonical definitions and capability semantics;
3. existing car and bus/BRT/tram/metro execution runs through provider adapters without duplicating operational authority;
4. unsupported future modes remain explicitly unavailable rather than fake;
5. current transit gameplay, fiscal behavior, saves, determinism, and performance remain compatible;
6. mode-level analytics are exposed while legacy aggregate metrics remain available;
7. full unit/integration/static/build/browser/visual CI gates are green on the exact PR head;
8. the design leaves a clean insertion point for actual `PersonId`/Household/Schedule state in 14R-B without rewriting provider contracts.
