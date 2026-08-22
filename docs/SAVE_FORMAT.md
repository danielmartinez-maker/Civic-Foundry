# Save Format — V6

Current envelope:

- `saveVersion: 6`
- `gameVersion: "0.6.0-metropolitan"`

## Inherited V5 state

V6 retains the complete deterministic V5 envelope: seed/RNG, clock, terrain, treasury, roads/revision, zoning/buildings, population/taxes/utilities/waste/economy, traffic/intersections/service systems, transit topology, passenger queues, active transit vehicles, transit operations and mobility continuation state.

## Persisted Phase 6 economy state

`economyDomain` stores the authoritative continuation state owned by `EconomyScheduler`:

- establishment records, status/health/lifecycle counters and stable next IDs;
- inventory balances/targets/capacity plus shipment-owned cargo tokens;
- replenishment/export orders and stable order IDs;
- active freight vehicles with shipment data, route edge IDs, edge progress, delay and stable IDs;
- freight dispatch capacity;
- boundary gateway records and cumulative import/export value/volume;
- per-firm accrued operating financials;
- scheduler counters/diagnostics required to continue deterministically;
- the current firm-derived employment snapshot.

## Rebuilt state

V6 does not persist deterministic/derived presentation or routing state:

- `TransportationGraph` or `MultimodalRoutingGraph`;
- road, journey or freight route caches;
- building-to-road firm access cache;
- recomputable aggregate economy/traffic analytics;
- Canvas/render geometry and overlay/UI selection.

After hydration, the building-to-road freight access context and traffic extra loads are reconstructed from the restored authoritative city.

## Validation and hydration

1. identify V6 versus a supported legacy envelope;
2. validate the V6 game version and economy-domain envelope;
3. hydrate the complete V5 candidate core;
4. validate inventory firm references and non-negative values;
5. validate cargo→shipment, order→firm/gateway and shipment→order/firm/gateway references;
6. validate every active freight route edge against the restored road graph;
7. restore the economy domain, derived firm-access context, employment and traffic loads;
8. return the coherent candidate.

Corrupt freight road references or invalid economy references throw before the hydrated core is returned.

## V5 → V6 migration

Migration preserves every V5 authoritative field exactly and initializes empty Phase 6 economic history. It does not fabricate firms, production, sales, imports, exports, profit, closure counts or historical freight. Existing occupied commercial/industrial buildings participate in the normal deterministic formation cadence only after migration resumes.

The public `serializeCore`/`hydrateCore` API emits/accepts V6 by default. Explicit V3/V4/V5 serializers remain available for migration tests and historical fixtures.
