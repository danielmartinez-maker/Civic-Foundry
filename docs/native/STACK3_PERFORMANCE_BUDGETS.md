# Stack 3 Native Socioeconomic Performance Budgets

These budgets are the acceptance reference for the representative Stack 3 socioeconomic workload. They are targets, not fabricated measurements; CI/runtime telemetry records the observed values separately.

## Representative workload

- 100,000 socioeconomic entities
- 5,000 route/pathfinding queries per measured update
- 8 MiB immutable socioeconomic snapshot
- 3 benchmark iterations per sample
- authoritative build: standard deterministic floating-point settings; no fast-math

## Initial Alpha budgets

| Metric | Alpha budget |
| --- | ---: |
| Socioeconomic update CPU time | <= 16.0 ms/update |
| Derived accessibility/routing work | <= 8.0 ms/update |
| Snapshot publication payload | <= 8 MiB representative target |
| Save + load socioeconomic extension | <= 250 ms |
| Authoritative allocations in hot update path | trend downward; investigate regressions > 10% |
| 1-thread vs N-thread authoritative hash | exact equality required |

## Interpretation

The timing budgets are regression guardrails rather than permission to change simulation semantics. A faster run that changes authoritative ordering, money/inventory/labor conservation, person identity, or replay hashes is a failure. Measurements must identify platform/build configuration before being compared longitudinally.

Windows/MSVC remains the first-class production measurement. Clang sanitizer CI is a correctness gate and is expected to be materially slower, so sanitizer timings are diagnostic rather than release-budget measurements.
