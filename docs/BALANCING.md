# Balancing — Phase 6

## Roads

| Class | Cost/cell | Speed (cells/s) | Weighted capacity/min | Intersection service |
|---|---:|---:|---:|---:|
| Local | 40 | 1.5 | 60 | 6 |
| Collector | 65 | 2.5 | 120 | 10 |
| Arterial | 100 | 4.0 | 240 | 16 |

## Public-service facilities

| Facility | Construction | Operating | Base capacity | Vehicles |
|---|---:|---:|---:|---:|
| Fire Station | 20,000 | 300 | 2 incidents | 2 fire engines |
| Police Station | 18,000 | 260 | 3 jobs | 2 patrol cars |
| Clinic | 22,000 | 320 | 20 treatment | 1 ambulance |
| Elementary School | 16,000 | 240 | 120 students | — |
| Landfill | 10,000 | 140 | 90 processing | 2 garbage trucks |
| Recycling Center | 14,000 | 190 | 70 × 1.15 efficiency | 2 garbage trucks |

Department funding range: `50%..150%`, default 100%.

`fundingEffectiveness = clamp(0.5, 1.25, 0.35 + 0.65 * fundingRatio) × fiscalPaymentRatio`

A minimum operational floor of 0.35 is retained for partially unpaid departments; fleet activation still uses integer effective vehicle slots.

## Buildings and waste

Building balance remains:

| Zone | Construction ticks | Residents | Jobs | Power | Water | Waste rate | Tax base |
|---|---:|---:|---:|---:|---:|---:|---:|
| Residential | 50 | 10 | 0 | 6 | 5 | 2 | 120 |
| Commercial | 65 | 0 | 8 | 12 | 7 | 4 | 220 |
| Industrial | 80 | 0 | 14 | 22 | 12 | 8 | 320 |

The waste rate is applied every **50 ticks**, preserving the inherited Phase 2 balance cadence while Phase 4 handles physical truck movement at higher frequency. Pickup threshold: 6. Garbage truck capacity: 20.

## Education

School-age share: `0.18` of current population.

`educationQuality = coverage × networkAccessibility × fundingEffectiveness`

Disconnected school seats contribute zero coverage.

## Neighborhood quality

Weights: fire 22%, police 22%, healthcare 22%, education 20%, garbage 14%.

Residential service modifier: `clamp(-0.25, 0.15, (quality - 0.70) * 0.50)`.

Emergency vehicles receive 55% of congestion delay above free flow, not zero delay.

## Transit — Phase 5

| Mode | Default headway | Default fare | Vehicle capacity | Dwell | Surface running |
|---|---:|---:|---:|---:|---|
| Bus | 80 ticks | 2.00 | 60 | 6 ticks | yes |
| BRT | 60 ticks | 2.50 | 110 | 8 ticks | yes, reduced congestion penalty |
| Tram | 90 ticks | 2.50 | 140 | 10 ticks | yes |
| Metro | 50 ticks | 3.00 | 600 | 12 ticks | no |

Player-set headway is clamped to `20..600` ticks and fare to `0..20`.

Mode choice compares deterministic generalized journey cost. Transit cost includes walking, expected wait (`headway / 2` at boarding), in-vehicle time, transfer penalties, fare impedance, and capacity pressure. Car cost uses current road travel time and retains the parking-impedance hook for later phases.

Capacity pressure prevents undersupplied lines from remaining permanently attractive while queues grow:

`linePressureTicks = min(600, waitingWeight / activeVehicleCapacity × 60)`

The citywide pressure used for mode choice is the waiting-weighted mean across queued lines. One full active vehicle-load waiting therefore adds roughly 60 generalized-cost ticks; pressure is capped at 600 ticks per line. The displayed experienced wait is scheduled expected wait plus the same derived queue-pressure term.

BRT surface travel absorbs 35% of congestion delay above free flow. Bus and tram absorb the full road delay. Metro segment travel is dedicated-guideway time and is insulated from road congestion.


## Firms, production and freight — Phase 6

Phase 6 keeps the old physical commercial/industrial building capacities (8/14 jobs) as archetype-scale anchors, but jobs become active only after establishment formation.

| Archetype | Zone | Jobs | Storage | Input → output | Freight intensity |
|---|---|---:|---:|---|---:|
| Retail local | Commercial | 8 | 40 | consumer goods → retail sales | 1.0 |
| Wholesale logistics | Commercial | 8 | 80 | 2 manufactured → 2 consumer | 1.5 |
| Light manufacturing | Industrial | 14 | 90 | 2 industrial inputs → 2 manufactured | 1.5 |
| Assembly manufacturing | Industrial | 14 | 120 | 3 industrial inputs → 3 manufactured | 2.0 |

Economic cadences: production 50 ticks, replenishment 100, lifecycle 250. Default freight dispatch capacity is 100 active weighted truck cohorts and is authoritative/persisted.

Normalized prices/cost proxies: industrial inputs 8, manufactured goods 16, consumer goods 24, wage 0.35 per filled job/cycle, utility 0.08 per filled job/cycle, gateway handling 0.4/unit, route-time logistics coefficient 0.002.

Firm cash health starts at 0.60. Distress threshold: 0.28; closure threshold: 0.08 plus four sustained loss evaluations; recovery threshold: 0.45 plus two sustained recovery evaluations. Formation threshold is 0.35 and requires a reachable freight gateway. These values are gameplay-normalized operating-health constants, not accounting statements.
