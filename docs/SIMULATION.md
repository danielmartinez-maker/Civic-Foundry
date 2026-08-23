# Simulation — Phase 6

## Deterministic cadence

Each logical tick:

1. advance clock
2. rebuild transportation graph when road revision changes
3. synchronize service fleets with funding/fiscal availability
4. reroute or fail service vehicles whose topology became invalid
5. service emergency/normal intersection queues
6. advance service vehicles and apply arrivals/returns/completions
7. update routed garbage pickup/unloading and incident response state
8. advance commuter traffic including service-vehicle edge load
9. recompute traffic analytics
10. advance building construction

Every 10 ticks:

- synchronize detailed building waste state
- on the inherited 50-tick waste cadence, generate new building waste
- derive public-service demand/risk
- create eligible incidents and garbage jobs
- assign waiting jobs by graph travel cost/capacity
- recompute service accessibility
- recompute education and neighborhood service quality
- evaluate building development

Every 50 ticks:

- evaluate power/water, employment, taxes, R/C/I demand, public-service operating obligations and migration
- update department fiscal-payment effectiveness

Every 100 ticks:

- derive weighted commute/shopping requests and route them
- incident generation may materialize deterministic risk exposure through the incident RNG stream

## Traffic and emergency response

Road classes are `local`, `collector`, and `arterial`. Traffic congestion is derived from weighted occupancy/capacity. Service vehicles add real edge load.

Emergency vehicles (`fire_engine`, `patrol_car`, `ambulance`) use the same network as commuters. Their congestion penalty is reduced to 55% of the delay above free flow and intersection queues prioritize emergency entries deterministically. Congestion therefore still increases response time.

Garbage trucks use normal priority and contribute weight 2 to active edge load.

## Public-service accessibility

For each occupied building and department, accessibility selects the lowest deterministic route-cost eligible facility. Disconnected facilities provide zero coverage.

`serviceAccess = normalizedTravelAccessibility × availableCapacityFactor`

Useful travel-time bounds:

- fire: 180 ticks
- police: 220
- healthcare: 240
- education: 300
- garbage: 300

Funding and unpaid obligations reduce effective staffing/capacity and can deactivate fleet slots.

## Incidents

Fire/police/medical incidents materialize from real demand exposure using a dedicated seeded RNG. Fire grows before response, accumulates damage, can spread only to cardinal adjacent occupied buildings after the intensity threshold, and is suppressed while responders service the incident.

Outcomes retain response time and success; recent outcome scores feed neighborhood service quality.

## Garbage and education

Detailed waste is stored per occupied building. The inherited building waste rate is generated every 50 ticks; collection jobs are created once pickup thresholds are crossed. Trucks physically travel, collect cargo, return and unload into finite landfill/recycling processing capacity.

Education uses aggregate school-age share `0.18`, effective reachable seats, network travel time and education funding. Disconnected seats do not count.

## Neighborhood quality and growth

Per-building service quality combines:

`0.22 fire + 0.22 police + 0.22 healthcare + 0.20 education + 0.14 garbage`

Residential service-demand modifier:

`clamp(-0.25, 0.15, (quality - 0.70) * 0.50)`

Commercial service modifier uses police safety and garbage cleanliness.

Power/water remain instantaneous essential-utility migration gates. Routed garbage is intentionally not treated as an instantaneous utility hard-stop; its consequences flow through garbage service ratio, health demand, cleanliness, neighborhood quality and development attractiveness.

## Phase 5 multimodal scheduling

Phase 5 inserts person mobility and transit operations into the deterministic tick order without replacing the Phase 3 road graph:

1. rebuild the road graph when road topology changes;
2. synchronize and advance public-service vehicles;
3. rebuild the derived multimodal graph when road/transit topology or the cost epoch changes;
4. dispatch/advance transit vehicles, process alighting, boarding, dwell, and capacity-limited queues;
5. generate weighted person trips on the existing 100-tick city cadence;
6. plan car and transit alternatives and choose the lower deterministic generalized cost;
7. submit car cohorts into road traffic or enqueue transit cohorts at their boarding stop;
8. merge service and road-running transit edge loads into traffic congestion;
9. update traffic and mobility analytics;
10. feed person accessibility and transit fiscal deltas into the existing 50-tick city/economy loop.

`MultimodalRoutingGraph` is derived state. It connects road nodes to adjacent transit stops with 8-tick walking connectors and adds deterministic boarding, ride, alighting, and transfer edges. `JourneyPlanner` caches by graph revision, cost key, mode, impedance settings, and endpoints; stable topology therefore reuses plans aggressively.

### Capacity feedback

Passenger queues are authoritative weighted cohorts. Vehicles board FIFO up to physical capacity and leave excess weight waiting. Before each new mode-choice decision, `MobilityScheduler` derives queue pressure from waiting weight relative to active capacity. That penalty enters transit generalized cost, so chronically undersupplied service becomes less attractive to later travelers instead of accumulating cost-free queues indefinitely.

`meanWaitTicks` combines scheduled wait recorded on transit decisions with the current derived capacity-pressure term. `personAccessibility` remains bounded to `0..1` through the existing commute/shopping acceptable-cost thresholds and therefore feeds demand without creating a new unbounded growth channel.


## Phase 6 establishment economy

`EconomyScheduler` is ticked from `SimulationCore` and owns the economic update order. Road topology revision changes first rebuild derived boundary gateways. Active freight vehicles then advance every tick using current road travel times and contribute weighted edge load to the shared traffic calculation.

Economic work is cadence-gated:

- every **50 ticks**: allocate labor, run manufacturing/wholesale/retail production, accrue wages, utility burden and shortage penalties;
- every **100 ticks**: create replenishment/export orders, match suppliers/gateways by generalized freight cost and dispatch trucks up to the authoritative freight dispatch capacity;
- every **250 ticks**: synchronize eligible buildings, score formation, settle accrued firm operating margin, and evaluate sustained distress/recovery/closure.

Commercial/industrial buildings are physical shells only. In V6 an occupied shell creates no authoritative jobs until a viable establishment forms. Employment snapshots are then derived from active firm job capacities and filled jobs.

### Goods and freight

The detailed local chain is:

`gateway industrial_inputs → industrial manufactured_goods → wholesale consumer_goods → retail household-equivalent consumption`

`industrial_inputs` have no local producer in Phase 6. Local suppliers can beat imports for locally producible goods only when their generalized logistics cost is lower. Dispatch-limited orders remain waiting; their age contributes `queueDelay`, while delayed replenishment creates real inventory shortages and downstream output/sales pressure.

Cargo is conserved through shipment ownership. Dispatch removes local source stock or creates an external-import cargo token. Exactly one terminal path receives, exports or cancels that cargo. Closing/bulldozing a firm cancels affected orders and in-flight vehicles/cargo before its inventory records are removed, preventing late deliveries from recreating closed-firm stock.

### Firm finance and lifecycle

Each production/lifecycle window accrues sales/export revenue, input purchases, wage proxy, utility burden, tax burden, logistics cost and shortage penalties. `cashHealth` is bounded and separate from municipal treasury cash. Distress and closure require sustained bad cycles; recovery likewise requires sustained improvement. No arbitrary random bankruptcy is used.
