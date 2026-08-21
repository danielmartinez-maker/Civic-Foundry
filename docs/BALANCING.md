# Balancing — Phase 4

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
