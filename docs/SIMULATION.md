# Simulation — Phase 4

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
