# Stack 1 Task 16 — Property & Development Authority Classification

Task: **HBU, Property Market and Site Assembly**

This note classifies the C++ migration behavior against the accepted TypeScript Urban Fabric 2R implementation. Task 16 originally introduced the native authority candidates; Stack 1 Tasks 19–20 now activate the production authority boundary described below when the native Urban bridge is enabled.

## Classification

| Behavior | Classification | Native rule |
| --- | --- | --- |
| Highest-and-best-use strategy evaluation | `PARITY` | Preserve hold / renovate / convert / redevelop / assemble alternatives, risk-adjusted hurdle eligibility, net-value selection, and deterministic strategy-order tie breaking. |
| Property holdings and V9 transaction history | `PARITY` | Preserve owner/reservation records, sequential `property:tx:N` IDs, land + improvement value accounting, atomic multi-parcel transfer, canonical parcel ordering, and historical parcel references during restore. |
| Site assembly candidate discovery/economics | `PARITY` | Preserve connected same-block/same-zoning enumeration, four-parcel bound, 2% transaction cost, 1% carrying cost, reservation-value acquisition premium, demolition friction, return hurdle, and deterministic candidate ordering. |
| Production physical-development HBU bypass (CF-003) | `CORRECTION` | Native `DevelopmentAuthority` requires a physical candidate to pass zoning and have `redevelop` selected by HBU before a newly materialized `BuildingV2` can enter native authority. A merely feasible/high-value physical candidate cannot bypass HBU. |

## Evidence for the correction

The accepted TypeScript runtime constructed `HighestBestUseSystem`, but the physical vacant-development path historically proceeded from cadastre → buildable envelope → building massing → physical development feasibility and then returned those opportunities to the developer market without invoking HBU. Reproducing that omission in C++ would preserve a documented integration defect rather than accepted game rules.

The correction remains intentionally narrow. The compatibility runtime computes explicit parcel economics from physical feasibility, filters developer-market opportunities through HBU, and carries those exact HBU inputs with the first `buildings.reconcile` command for a newly materialized canonical building. Native `DevelopmentAuthority::evaluate()` independently re-evaluates the candidate, parcel set, zoning legality, hold value, redevelopment value, expected return, risk, and developer hurdle. Native authority rejects the new `BuildingV2` unless `redevelop` is the selected eligible strategy.

The developer hurdle is derived from the active developer market as the minimum current market-entry hurdle. No unrelated citywide hurdle constant or fabricated economic history is introduced.

## Authority boundary after Tasks 19–20

When native Urban authority is enabled on this branch:

- C++ owns canonical cadastral state, parcel zoning, `BuildingV2`, lifecycle/renovation state, and property state;
- TypeScript physical/economic systems may compute deterministic development proposals, but C++ validates HBU before admitting a new canonical building;
- TypeScript legacy lots and one-cell buildings are projections rebuilt from native snapshots;
- Save V9 is patched from native canonical Urban Fabric state without changing the V9 schema/version.

The production order is:

```text
canonical parcel/building state
→ physical feasibility
→ HBU / assembly decision
→ native DevelopmentAuthority validation
→ developer market / award proposal
→ native BuildingV2 admission
→ native lifecycle scheduler
→ compatibility projections
```

Any compatibility projection remains downstream and read-only with respect to canonical land/building/property facts. See `docs/cpp-rewrite/STACK_1_AUTHORITY_TRANSFER.md` for the full Stack 1 ownership and persistence contract.
