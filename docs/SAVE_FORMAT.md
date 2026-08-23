# Save Format — V7

Current canonical envelope:

- `saveVersion: 7`
- `gameVersion: "0.7.0-metropolitan"`

V7 is the default persistence baseline moving forward. Explicit V5 and V6 serializers/hydrators remain supported for compatibility, migration tests and historical fixtures.

## Inherited V6 state

V7 retains the complete deterministic V6 envelope: seed/RNG, clock, terrain, treasury, roads/revision, zoning/buildings, population/taxes/utilities/waste/economy, traffic/intersections/service systems, transit topology, passenger queues, active transit vehicles, transit operations, mobility continuation state, firms, inventories/cargo, freight orders, active freight vehicles, trade gateways/counters, lifecycle state and firm financial accruals.

## Persisted V7 development state

`developmentMarket` stores the authoritative continuation state owned by `DeveloperMarketSystem`:

- the deterministic developer roster and IDs;
- available capital and committed capital;
- hurdle rates, leverage limits, financing spreads and risk tolerances;
- concurrent-project limits and minimum project-cost constraints;
- per-zone developer preferences;
- active development commitments with award/building/lot/definition/developer IDs;
- committed equity, award/completion/release ticks and expected return.

This state is sufficient to continue developer capital allocation, active project commitments and future deterministic awards after load.

## Rebuilt state

V7 does not persist deterministic/derived presentation, routing or underwriting diagnostics that can be recomputed:

- `TransportationGraph` or `MultimodalRoutingGraph`;
- road, journey or freight route caches;
- building-to-road firm access cache;
- latest parcel feasibility evaluations, bids or awards;
- recomputable aggregate economy/traffic/development analytics;
- Canvas/render geometry and overlay/UI selection.

After hydration, the V6 city/economy/transit state is restored first, then V7 development references are validated and the developer market is restored.

## Validation and hydration

1. identify V7 versus a supported legacy envelope;
2. validate the V7 game version and `developmentMarket` envelope;
3. convert the shared envelope to V6 and hydrate the complete V6 candidate core;
4. validate every commitment's developer ID against the saved developer roster;
5. validate every commitment's building ID against an existing restored building;
6. validate commitment lot/definition/owner references against that building;
7. restore developer capital and active commitments with `DeveloperMarketSystem.restoreState()`;
8. return the coherent V7 candidate.

`DeveloperMarketSystem.restoreState()` additionally rejects duplicate developers/awards/building commitments, unknown developers, non-finite or negative capital/equity, invalid leverage/timing, unknown building definitions and committed-capital totals that disagree with active commitment equity.

## V6 → V7 migration

Loading a V6 save preserves every V6 authoritative field and initializes the V7 development market from the deterministic default developer roster with **no fabricated historical commitments**. Existing buildings are preserved, but they do not acquire invented developer ownership or financing history.

The normal development cadence can create new V7 commitments only after simulation resumes and parcels satisfy current infrastructure, feasibility and developer-allocation rules.

## Legacy compatibility

The public `serializeCore`/`hydrateCore` API emits/accepts V7 by default. Explicit V3/V4/V5/V6 serializers and hydrators remain available for migration tests and historical fixtures. V5/V6 remain compatibility formats; they are not the baseline for new feature work.