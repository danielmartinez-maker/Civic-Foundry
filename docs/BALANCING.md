# Balancing — Phase 3 Rebuild

## Roads

| Class | Cost/cell | Speed (cells/s) | Weighted capacity/min | Intersection service | Render width |
|---|---:|---:|---:|---:|---:|
| Local | 40 | 1.5 | 60 | 6 | 0.50 |
| Collector | 65 | 2.5 | 120 | 10 | 0.68 |
| Arterial | 100 | 4.0 | 240 | 16 | 0.86 |

## Buildings

| Zone | Construction ticks | Residents | Jobs | Power | Water | Garbage | Tax base |
|---|---:|---:|---:|---:|---:|---:|---:|
| Residential | 50 | 10 | 0 | 6 | 5 | 2 | 120 |
| Commercial | 65 | 0 | 8 | 12 | 7 | 4 | 220 |
| Industrial | 80 | 0 | 14 | 22 | 12 | 8 | 320 |

## Utilities

| Facility | Construction | Operating | Capacity |
|---|---:|---:|---:|
| Power | 18,000 | 260 | 180 |
| Water | 12,000 | 170 | 150 |
| Landfill | 10,000 | 140 | 90 |

Default starting funds in `SimulationCore`: 125,000. Browser scenario starts at 250,000.

Tax rates default to 10% and clamp to 0–25%.

## Traffic

Traffic acceptable-time constants:

- commute: 240 ticks
- shopping: 180 ticks

Congestion delay multiplier:

`1 + 3 * utilization^4`

Trip generation cadence: 100 ticks. Commute cohort weight is based on employed workers divided across occupied homes. Shopping pool is 25% of population divided across occupied homes.

Rolling analytics window: 128 outcomes.
