# Known Issues & Technical Debt

[← Wiki Home](Home.md)

This page summarizes the current source-level bug/risk audit. It is not a claim that every item has a reproduced runtime failure; confidence varies by finding.

## P0 — protect authoritative state first

The highest-priority risks are cross-system invariant failures:

- **CF-006 / CF-007 / CF-008 / CF-009:** ordinary cadastral rebuilds can replace canonical land state, erase easements/lineage, churn parcel identity, and reset canonical building lifecycle/history.
- **SIM-013 / SIM-014 / SIM-015:** development awards, building bulldoze, and kernel ticks are not fully transactional; exceptions can leave partially committed state.
- **SIM-016 / SIM-017:** freight conservation can fail when delivery/return targets are full, causing goods to disappear.
- **SIM-007:** transit vehicle failure can remove onboard passenger cohorts without proper recovery/accounting.

These are higher priority than expanding simulation breadth because they can invalidate authoritative state or conservation guarantees.

## Major integration gaps

Urban Fabric contains substantial systems that are not fully driven in the live loop, including lifecycle, renovation, highest-and-best-use, site assembly, and property-market advancement.

Transportation has quantitative correctness risks in commuter/shopping demand generation, congestion dimensionality, transit fallback/capacity/reliability, mixed road-direction behavior, and malformed/non-finite input handling.

Save/hydration code has broad validation gaps across canonical buildings, services, transit, utilities, traffic routes, transportation graph state, passenger queues, freight vehicles/orders/inventory, firms, and cross-references.

## Presentation debt

Several GPU overlays currently collapse complex spatial data into uniform full-map tints. Urban Fabric diagnostics and canonical `BuildingV2` massing are incompletely represented in the production renderer, and transit stops/stations have presentation gaps.

## Performance debt

Key scaling concerns include expensive canonical-building reconciliation, global spatial building lookup work, full world-layer reconstruction every animation frame, and repeated freight pathfinding.

## Repository engineering risks

- local `npm run verify` does not cover every browser/visual smoke suite used by CI;
- the primary TypeScript project does not typecheck tests;
- `main` is currently unprotected.

## Systemic pattern

The dominant defect pattern is **integration-boundary failure**: cadastre↔legacy lots, parcels↔properties↔buildings, development↔economy↔housing, traffic↔transit↔services, freight↔inventory, save payloads↔live invariants, and simulation state↔GPU presentation.

The project should prioritize cross-domain invariant tests, transaction boundaries, adversarial save mutation, deterministic long-horizon soak tests, and large-city profiling.