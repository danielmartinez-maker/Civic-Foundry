# Civic Foundry Phase 6 Design — Firms, Production & Freight

## Status
Approved in chat on 2026-08-21. Phase 6 is the second implementation slice of the Metropolitan Era expansion.

## Goal
Replace abstract job capacity with an inspectable establishment economy in which firms occupy commercial and industrial buildings, hire workers, consume inputs, produce or sell goods, hold inventory, create freight demand, import and export through external gateways, and survive or fail according to deterministic operating conditions. Congestion, freight access, labor availability, utilities, taxes, and local demand must materially affect firm performance.

Phase 6 must preserve the existing city loop while making employment and goods movement causal rather than decorative. A player should be able to inspect a struggling business and trace the problem to concrete causes such as input shortages, insufficient labor, high logistics time, poor market access, weak local demand, utility constraints, or sustained negative cash health.

## Design Principles
1. **Establishments, not corporations.** The authoritative economic unit is one establishment occupying one eligible building. Multi-site corporate structures are deferred.
2. **Small commodity graph.** Phase 6 uses a deliberately compact commodity set so production chains remain legible and computationally cheap.
3. **Explicit freight where routing matters.** Truck movements are explicit weighted vehicle trips on the existing road network. Orders and inventories are cohort/aggregate state rather than one object per physical item.
4. **External economy is aggregate.** Imports, exports, external prices, and outside demand enter through map-edge freight gateways rather than simulating another city.
5. **No random bankruptcies.** Formation, downsizing, recovery, and failure use deterministic scoring and sustained-state thresholds.
6. **Physical shells remain Phase 3/4 buildings.** Phase 6 changes occupancy and economic use. Phase 7 will make land, rent, redevelopment, and developer behavior endogenous.
7. **One owner per state domain.** `SimulationCore` coordinates; it does not own firm ledgers, inventories, shipment queues, or trade balances directly.

## Scope
Phase 6 includes:
- commercial and industrial establishments;
- industry archetypes and deterministic establishment assignment;
- active jobs derived from firms rather than raw building job capacity;
- labor fill and vacancy state;
- input/output inventories;
- deterministic production and retail consumption;
- freight orders and shipment cohorts;
- explicit truck vehicles sharing the road network;
- external freight gateways;
- imports and exports;
- logistics cost and delivery reliability;
- firm revenue, operating cost, cash health, profitability, and viability;
- business formation, downsizing, recovery, and failure;
- economy/freight inspection and overlays;
- Save V6 with deterministic V5 migration;
- acceptance and performance tests proving the new causal chains.

## Commodity Model
Phase 6 uses four authoritative economic flow categories:

### `industrial_inputs`
Raw and intermediate inputs used by industrial producers. Primarily imported through gateways in Phase 6, with limited local recirculation where produced by logistics/industrial establishments.

### `manufactured_goods`
Output of industrial producers. Can be sold to local commercial establishments or exported through gateways.

### `consumer_goods`
Retail stock available to satisfy local household-equivalent consumption demand. Commercial establishments obtain it from local manufactured-goods supply after conversion/wholesale handling or from imports when local supply is insufficient.

### `logistics_capacity`
A non-storable service capacity representing warehousing/handling throughput. Logistics establishments improve transfer efficiency and reduce effective shipment delay/cost. It is not transported as cargo.

The commodity graph is intentionally compact. Food, fuel, construction materials, specialized industrial chains, tourism products, and services-sector distinctions are deferred until later specialization and construction phases.

## Industry Archetypes
Every eligible commercial or industrial establishment has one stable archetype.

### Commercial
- `retail_local`: consumes consumer goods and local market demand; produces retail service/revenue.
- `wholesale_logistics`: buffers goods, provides logistics capacity, and redistributes shipments.

### Industrial
- `light_manufacturing`: consumes industrial inputs and produces manufactured goods.
- `assembly_manufacturing`: consumes a higher ratio of industrial inputs, has higher job/productivity capacity, and produces manufactured goods with greater freight intensity.

Archetype assignment is deterministic from building ID, city seed, zone, and current formation context. Re-loading or re-running the same authoritative state must produce the same result.

## Architecture

### `EconomyScheduler`
A new focused domain scheduler coordinates firm/economic cadence and exposes one immutable `EconomyDomainSnapshot` to `SimulationCore` and presentation code.

Responsibilities:
- synchronize eligible buildings with establishment state;
- evaluate labor allocation;
- advance production and retail demand;
- create freight demand;
- advance shipment/trade accounting;
- update firm ledgers and viability;
- run formation/failure cadence;
- expose employment totals, production totals, shortages, trade, logistics metrics, and firm health;
- provide freight vehicle road loads to the existing traffic simulation.

`EconomyScheduler` is authoritative for Phase 6 firm/freight state. The existing `EconomySystem` remains the municipal recurring-settlement component and is not repurposed as a firm ledger.

### `FirmSystem`
Owns establishment identity and operating state.

Authoritative establishment fields include:
- `id`;
- `buildingId`;
- `zone`;
- `archetype`;
- `status` (`forming`, `operating`, `distressed`, `closed`);
- `jobCapacity`;
- `filledJobs`;
- `vacancies`;
- `productivity`;
- `cashHealth`;
- `consecutiveLossCycles`;
- `consecutiveRecoveryCycles`;
- `formationTick`;
- `closureTick` when applicable.

A building may host at most one active establishment in Phase 6.

### `LaborMarketSystem`
Deterministically allocates the city workforce across active firms.

Allocation score uses:
- firm job capacity;
- sector/archetype priority only as a stable tie-breaker, not a hidden bonus;
- worker accessibility proxy derived from current person/job accessibility;
- firm operating health;
- utility/service viability.

Phase 6 does not add household skill cohorts; that belongs to Phase 9. Labor is therefore homogeneous but physically constrained by accessibility and aggregate workforce availability.

The public `EmploymentSnapshot` remains available for compatibility but becomes derived from firm state:
- `totalJobs` = sum of active establishment job capacities;
- `employed` = sum of filled jobs;
- `vacancies` = sum of unfilled jobs;
- `unemployed` = workforce minus employed.

The previous direct `building.jobCapacity()` path must no longer determine authoritative employment after V6 state is active.

### `InventorySystem`
Owns per-establishment inventory balances and capacity.

Inventories are non-negative weighted units keyed by commodity. Each establishment exposes:
- on-hand quantity;
- target stock;
- reserved inbound quantity;
- reserved outbound quantity;
- storage capacity;
- shortage ratio;
- overflow ratio.

Inventory operations are deterministic and conservation-aware. Local transfers reduce one source balance and increase one destination balance only after a successful delivery event. Failed or invalidated shipments release reservations deterministically.

### `ProductionSystem`
Transforms inputs into outputs on a fixed economic cadence.

Production is constrained by the minimum of:
- labor fill ratio;
- utility/service viability;
- required input availability;
- output storage headroom;
- logistics throughput where applicable.

Production does not create goods when an input is absent. Shortage-caused lost output is tracked for inspection.

Commercial retail establishments consume inventory against deterministic household-equivalent local demand derived from population, commercial accessibility, and service quality. This creates revenue and replenishment demand.

### `FreightDemandSystem`
Creates deterministic shipment orders from inventory targets, local supply availability, and export opportunities.

Order fields include:
- `id`;
- `commodity`;
- `quantity`;
- `originKind` (`firm` or `gateway`);
- `originId`;
- `destinationKind` (`firm` or `gateway`);
- `destinationId`;
- `createdTick`;
- `priority`;
- `status`;
- `assignedShipmentId` when dispatched.

Matching policy:
1. prefer valid local supply when generalized freight cost is competitive;
2. otherwise import through the best reachable gateway;
3. route eligible surplus to local buyers first, then export when external demand remains.

Stable IDs and stable sorting are mandatory for deterministic matching.

### `FreightVehicleSystem`
Owns explicit weighted truck vehicles.

Truck fields include:
- `id`;
- `shipmentId`;
- `cargoCommodity`;
- `cargoQuantity`;
- `origin`;
- `destination`;
- `routeEdgeIds`;
- `currentEdgeIndex`;
- `edgeProgress`;
- `departureTick`;
- `expectedArrivalTick`;
- `delayTicks`;
- `status`.

Freight trucks route through `TransportationGraph`/`PathfindingSystem` and contribute real edge load to `TrafficSystem`. They must not teleport between firms.

A shipment may represent multiple physical trucks through `vehicleWeight` when scale requires it; routing sequence remains explicit while freight volume remains cohort-weighted.

### `TradeSystem`
Owns map-edge freight gateways and regional aggregate trade state.

Gateway state includes:
- gateway ID and road-access node;
- import throughput capacity;
- export throughput capacity;
- current queued inbound/outbound volume;
- effective external price indices;
- external demand index;
- cumulative import/export value and volume.

At least one reachable map-edge road connection is required for meaningful external trade. If no valid gateway exists, imports/exports cannot occur and affected firms experience shortages or unsold output.

External price indices are deterministic constants/seeded scenario parameters during Phase 6. Dynamic macroeconomic cycles are deferred.

### `BusinessLifecycleSystem`
Evaluates formation, distress, recovery, downsizing, and closure on a slower cadence than production.

Formation score considers:
- eligible empty commercial/industrial building;
- reachable road/freight gateway;
- utility viability;
- labor availability;
- job/person accessibility;
- local commercial demand;
- current sector supply gaps;
- current tax burden.

Failure score considers sustained:
- negative operating margin;
- low cash health;
- input shortage;
- labor shortage;
- logistics delay/cost;
- weak demand;
- utility failure.

Closure requires multiple consecutive failing lifecycle evaluations. Recovery likewise requires sustained improvement. One bad shipment or one congested tick cannot instantly bankrupt a firm.

Closed establishments release jobs, inventory reservations, and pending freight work safely. The physical building remains unless the existing bulldoze system removes it.

## Firm Financial Model
Firm finance is a normalized operating-health model rather than a full accounting ledger.

Each economic cycle computes:
- sales/export revenue;
- input/import cost;
- wage cost proxy from filled jobs;
- utility/service operating burden;
- tax burden;
- logistics cost based on route time, delay, shipment weight, and gateway handling;
- inventory carrying/shortage penalties;
- operating margin;
- cash-health change.

`cashHealth` is bounded and used for viability/formation/failure logic. It is not city treasury cash and must never directly debit or credit `TreasurySystem`.

Tax revenue remains calculated by the municipal tax model for Phase 6 compatibility, but its commercial/industrial base should be updated from active firm economic activity where practical. Residential tax behavior remains unchanged. Full municipal finance reform is Phase 11.

## Freight Generalized Cost
Freight routing cost must reflect actual network conditions.

For a shipment, generalized logistics cost includes:
- routed travel time;
- congestion delay above free flow;
- shipment weight/vehicle weight;
- gateway handling cost if external;
- logistics-capacity modifier;
- missed/late delivery penalty.

The cost may be normalized for gameplay, but each visible component must be inspectable.

A closer but severely congested supplier may lose to a farther supplier when total generalized cost is higher. Deterministic tie-breaking uses stable supplier/gateway IDs.

## Scheduling Order
Per simulation tick:
1. rebuild road graph if needed;
2. advance service/transit/freight road vehicles using the same authoritative network costs;
3. merge service, transit, passenger-car, and freight edge loads;
4. advance road congestion state;
5. process completed freight arrivals and inventory reservation release;
6. on production cadence, allocate labor and run production/retail consumption;
7. on replenishment cadence, create/match freight orders and dispatch shipments;
8. on lifecycle cadence, evaluate establishment formation, distress, recovery, downsizing, and closure;
9. refresh economy-domain analytics;
10. on core city-loop cadence, derive authoritative employment and feed it into demand/population/tax systems;
11. settle municipal recurring finance through the existing `EconomySystem`.

No presentation layer may call mutating economic methods outside the normal command/scheduler flow.

## Building Integration
Commercial and industrial buildings remain authoritative physical locations.

When an eligible occupied building appears:
- it enters the formation candidate pool;
- formation may create an establishment after the lifecycle cadence evaluates conditions;
- until a firm forms, the building contributes no authoritative active jobs in V6.

When a building is removed:
- its establishment closes immediately with deterministic cleanup;
- pending orders and shipment reservations are cancelled or rerouted according to shipment state;
- active trucks already on road either complete to a valid fallback gateway or terminate safely without duplicating cargo.

Residential buildings do not host firms in Phase 6.

## Traffic & Mobility Integration
Freight vehicles share road congestion with cars, road-running transit, and service vehicles.

Required interaction:
- freight increases edge load;
- congestion increases freight travel time and logistics cost;
- late freight increases shortage risk;
- shortages reduce output/sales;
- weak output/sales reduce firm health and employment;
- lower employment changes city demand and attractiveness through the existing city loop.

This feedback chain is an acceptance requirement.

Phase 6 does not add employee-by-employee commute assignment to individual firms. Aggregate job accessibility remains the worker-access input until demographic/household phases deepen labor matching.

## Player Tools & Presentation
Phase 6 adds an Economy/Freight panel rather than forcing economic controls into the transit panel or general HUD.

### Citywide metrics
- active firms;
- forming/distressed/closed firms;
- active jobs, employment, vacancies, unemployment;
- industrial output;
- retail sales;
- input shortage rate;
- freight volume in transit;
- import/export volume and value;
- average freight delay;
- average logistics cost;
- business formation/closure counts;
- aggregate firm health.

### Firm inspector
Shows:
- archetype/status;
- jobs/filled jobs/vacancies;
- production or retail throughput;
- input/output inventories;
- inbound/outbound shipments;
- revenue/cost/margin components;
- logistics cost and delay;
- utility/labor/access constraints;
- cash health and distress reason.

### Freight shipment/vehicle inspector
Shows:
- commodity/quantity;
- source/destination;
- route progress;
- free-flow vs current travel time;
- delay;
- logistics cost;
- shipment status.

### Gateway inspector
Shows:
- throughput capacity/utilization;
- inbound/outbound queue;
- import/export volumes;
- external price indices;
- accessibility status.

## Overlays
Phase 6 adds:
- firm health;
- active jobs/vacancies;
- production intensity;
- inventory shortage;
- freight generation;
- freight routes/volume;
- logistics delay;
- gateway throughput;
- import/export flow.

Color must not be the only encoding; overlays also expose labels, intensity, patterns, or inspector values.

## Save V6
Persist all authoritative Phase 6 state required for identical continuation:
- establishment records and next IDs;
- firm health/lifecycle counters;
- labor allocation state if not fully recomputable at the same tick boundary;
- per-firm inventories and reservations;
- freight orders;
- active shipments and truck progress;
- gateway definitions and throughput queues;
- trade counters/price scenario state;
- scheduler cadence counters/epochs needed for deterministic continuation;
- Phase 6 RNG state if any new seeded stream is introduced.

Do not persist:
- derived route caches;
- recomputable aggregate analytics;
- overlay/UI state;
- render geometry;
- presentation-only sorting/filter state.

### V5 → V6 migration
Migration preserves every Phase 5 authoritative field exactly and initializes the firm economy transparently.

Rules:
1. create empty Phase 6 scheduler/domain state at the saved tick;
2. rebuild eligible commercial/industrial formation candidates from existing occupied buildings in stable building-ID order;
3. do not fabricate historical production, sales, trade, profit, or closure statistics;
4. initialize inventories and lifecycle counters to documented neutral starting values;
5. allow firms to form through the normal deterministic lifecycle evaluation after load rather than backdating economic history;
6. preserve deterministic future continuation from the migrated V5 state.

The public default save API advances to V6. Explicit V5 serialization remains available for historical acceptance tests where required.

## Failure Handling
- **Disconnected firm:** no freight route means no local/external delivery; firm records a logistics constraint rather than teleporting inventory.
- **Deleted road during shipment:** route invalidation triggers deterministic replanning from the current reachable node. If no route exists, shipment becomes stranded/failed and reservations are released without duplicating cargo.
- **Deleted destination building:** shipment reroutes to a valid gateway or is cancelled with deterministic cargo handling.
- **Gateway disconnected:** queued external orders remain blocked and accumulate delay until capacity/connectivity returns or lifecycle logic closes the firm.
- **Insufficient truck capacity:** orders queue; queue delay raises logistics cost and shortage risk.
- **Inventory overflow:** production is throttled; goods are not silently destroyed except through an explicit deterministic disposal/overflow loss counter.
- **Negative/NaN inputs:** all public mutation paths validate/sanitize values consistently with existing systems.

## Determinism Rules
- stable sorted iteration for buildings, firms, orders, shipments, and gateways;
- stable ID allocation persisted in V6;
- no iteration-order dependence on `Map` insertion when outcomes can differ;
- seeded randomness only where explicitly required, with persisted state or reproducible derivation;
- deterministic tie-breakers for supplier selection, gateway selection, labor allocation, route selection, and business formation;
- save/load continuation hashes must match uninterrupted execution.

## Acceptance Scenarios

### Firms replace abstract jobs
A city with occupied commercial/industrial buildings but no viable formed establishments must not receive full raw building job capacity. After firms form, `EmploymentSnapshot.totalJobs` must equal active establishment capacity and filled jobs must equal the labor allocation result.

### Production requires inputs
A light-manufacturing firm with labor and utilities but no industrial inputs must produce no manufactured goods. Restoring inbound supply must resume output deterministically.

### Local supply can beat imports
With a reachable local manufacturer and retailer, a sufficiently competitive local route must satisfy retail replenishment before import fallback. Removing or heavily congesting that route may make the gateway import option cheaper.

### Freight creates real congestion
A high-freight industrial corridor must increase actual road edge load/travel time relative to an otherwise identical no-freight scenario.

### Congestion harms business economics
Under identical demand and utility conditions, a deliberately congested logistics route must increase delivery time/logistics cost and reduce the affected firm's operating health relative to a free-flow route.

### Better access improves firm economics
Adding a shorter or higher-capacity road connection to the same supplier/gateway must reduce generalized freight cost and improve delivery performance without directly modifying firm health through a flat bonus.

### Truck capacity matters
Reducing available freight dispatch capacity must increase queued orders, average delay, and inventory shortage; restoring capacity must reduce those values over time.

### Import/export accounting is conserved
Imported delivered volume must equal gateway outbound-to-city delivered cargo after losses/cancellations; exported delivered volume must equal local cargo received by the gateway. No shipment may create duplicate inventory.

### Formation/failure is sustained and deterministic
The same seed/state under the same economic conditions must form and close the same firms on the same lifecycle evaluations. One temporary bad cycle must not close an otherwise viable firm.

### Closed firm cleanup is safe
Closing or bulldozing a firm with pending orders and active shipments must not leave duplicate jobs, orphaned reservations, or negative inventories.

### Save/load determinism
Save with active firms, inventory reservations, queued orders, active freight trucks, and non-zero trade counters; load and continue. Authoritative V6 hashes must match uninterrupted continuation.

### V5 migration is transparent
Loading a Phase 5 save must preserve Phase 5 state exactly, introduce no fabricated historical economic counters, and create the same future Phase 6 establishment state on repeated migration.

## Performance Targets
At test-city scale:
- 2,000 active establishments with inventories and lifecycle evaluation must remain comfortably within the existing simulation budget;
- 10,000 freight order matching operations should complete within a practical interactive/headless benchmark using indexed supplier/gateway candidate sets rather than all-pairs scans;
- 5,000 ticks with active firms, production, and freight vehicles must remain within the project’s current real-time budget envelope;
- route/cache reuse should prevent repeated pathfinding for identical stable-network freight OD pairs;
- acceptance tests must report representative timings but treat them as diagnostics, not cross-hardware guarantees.

## Refactoring Boundary
Phase 6 is the required point to prevent `SimulationCore` from becoming the owner of every new economic responsibility.

Allowed targeted refactor:
- add `EconomyScheduler` as the Phase 6 domain coordinator;
- extract new firm/freight systems under `src/simulation/economy/` or focused sibling directories;
- make `SimulationCore` call the scheduler and consume its immutable snapshot;
- keep the existing `EconomySystem` municipal settlement API intact unless a minimal compatibility extension is required;
- preserve proven traffic, transit, service, utility, zoning, building, and treasury systems.

No broad rewrite of prior phases is allowed.

## Explicit Non-Goals
Phase 6 does not include:
- parcels, rent, land value, developer pro formas, or endogenous building redevelopment;
- household income/skills, occupational matching, demographic cohorts, or individual worker employers;
- detailed accounting statements, banking, interest rates, credit markets, stock markets, or corporate ownership;
- dozens of commodity types or arbitrary user-defined production chains;
- construction-material demand from megaprojects;
- rail, port, airport, or intercity freight infrastructure beyond abstract road-edge gateways;
- dynamic global macroeconomic cycles;
- municipal bonds/debt;
- political subsidies or industrial-policy systems;
- tourism/university/technology-cluster specialization bonuses.

These remain later Metropolitan Era phases.

## Exit Criteria
Phase 6 is complete only when:
1. commercial and industrial employment is generated by real establishments rather than raw building job capacity;
2. establishments require labor, inputs, utilities, storage, and market/logistics access to operate;
3. production and retail inventory move through conservation-safe local or external freight chains;
4. freight trucks physically use the road network and contribute congestion;
5. congestion and accessibility measurably alter logistics cost and firm viability;
6. business formation and failure are sustained, deterministic, and inspectable;
7. imports/exports operate through capacity-constrained external gateways;
8. Economy/Freight UI exposes authoritative causes rather than invented presentation metrics;
9. Save V6 migrates from V5 and resumes identically;
10. deterministic acceptance/performance tests pass without regressing Phase 3–5 behavior.
