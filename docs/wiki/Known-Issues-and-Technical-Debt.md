# Known Issues & Technical Debt

[← Wiki Home](Home.md)

This page summarizes the current source-level bug/risk audit. It is not a claim that every remaining item has a reproduced runtime failure; confidence varies by finding.

## Stack 0 — authoritative-state findings resolved

The Stack 0 stabilization pass closes the P0 cross-system invariant findings that previously blocked further Transportation 3R work:

- **CF-006 / CF-007 / CF-008 / CF-009:** legacy road/zoning rebuilds now reconcile against canonical parcel authority, preserve geometry-stable parcel identity plus owner/history, preserve canonical easements/lineage, and reject protected topology changes transactionally. Canonical building projection is reconciled only after the cadastral transaction commits.
- **SIM-001 / SIM-002:** commute and shopping trip cohorts now use exact proportional weights so aggregate generated demand equals the requested employed/shopper pools. The frozen legacy compatibility engine explicitly retains its historical rounded weighting.
- **SIM-007:** failed transit runs recover onboard passenger cohorts into the authoritative passenger queues before vehicle deletion, preserving cohort identity, weight, destination, and transfer state.
- **SIM-013 / SIM-014 / SIM-015:** compound development/bulldoze operations and kernel ticks now have explicit rollback boundaries. Kernel rollback restores clock, pending commands, event journal, random streams, and registered authoritative domain participants before fail-stop state is recorded.
- **SIM-016 / SIM-017:** delivery and cancellation of already-conserved in-transit freight restore cargo without storage-capacity clipping, preventing goods from disappearing at a full destination/return inventory.
- **Save V9 hydration hardening:** adversarial duplicate, dangling, stale, malformed, and non-finite state is rejected at the existing cadastre, service/utility/traffic, transit, firm/freight/order/inventory, and property/building ownership seams without changing the Save V9 schema or game version.

Regression coverage includes cadastral identity/history preservation and protected-change rejection, exact trip/freight conservation, forced compound rollback, transit passenger recovery, adversarial Save V9 hydration, deterministic continuation, and the frozen V7 compatibility oracle.

## Major integration gaps

Urban Fabric still contains substantial systems that are not fully driven in the live loop, including lifecycle, renovation, highest-and-best-use, site assembly, and property-market advancement.

Transportation still has correctness and integration work beyond Stack 0, including congestion dimensionality, broader transit fallback/capacity/reliability behavior, mixed road-direction behavior, and future Transportation 3R scope.

Save/hydration validation is materially stronger after Stack 0, but future schema versions and newly introduced domains must continue adding cross-reference validation at their authoritative ownership seams.

## Presentation debt

Several GPU overlays currently collapse complex spatial data into uniform full-map tints. Urban Fabric diagnostics and canonical `BuildingV2` massing are incompletely represented in the production renderer, and transit stops/stations have presentation gaps.

## Performance debt

Key scaling concerns include expensive canonical-building reconciliation, global spatial building lookup work, full world-layer reconstruction every animation frame, and repeated freight pathfinding.

## Repository engineering risks

- local `npm run verify` does not cover every browser/visual smoke suite used by CI;
- the primary TypeScript project does not typecheck tests;
- `main` is currently unprotected.

## Systemic pattern

The dominant defect pattern remains **integration-boundary failure**: cadastre↔legacy lots, parcels↔properties↔buildings, development↔economy↔housing, traffic↔transit↔services, freight↔inventory, save payloads↔live invariants, and simulation state↔GPU presentation.

The project should continue prioritizing cross-domain invariant tests, transaction boundaries, adversarial save mutation, deterministic long-horizon soak tests, and large-city profiling.
