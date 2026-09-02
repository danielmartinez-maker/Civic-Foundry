# Stack 1 Task 16 — Property & Development Authority Classification

Task: **HBU, Property Market and Site Assembly**

This note classifies the C++ migration behavior against the accepted TypeScript Urban Fabric 2R implementation. It does not transfer live authority early; Stack 1 Tasks 19–20 remain the authority-transfer boundary.

## Classification

| Behavior | Classification | Native rule |
| --- | --- | --- |
| Highest-and-best-use strategy evaluation | `PARITY` | Preserve hold / renovate / convert / redevelop / assemble alternatives, risk-adjusted hurdle eligibility, net-value selection, and deterministic strategy-order tie breaking. |
| Property holdings and V9 transaction history | `PARITY` | Preserve owner/reservation records, sequential `property:tx:N` IDs, land + improvement value accounting, atomic multi-parcel transfer, canonical parcel ordering, and historical parcel references during restore. |
| Site assembly candidate discovery/economics | `PARITY` | Preserve connected same-block/same-zoning enumeration, four-parcel bound, 2% transaction cost, 1% carrying cost, reservation-value acquisition premium, demolition friction, return hurdle, and deterministic candidate ordering. |
| Production physical-development HBU bypass (CF-003) | `CORRECTION` | Native `DevelopmentAuthority` requires a physical candidate to pass zoning and have `redevelop` selected by HBU before it is eligible for the developer-market boundary. A merely feasible/high-value physical candidate cannot bypass HBU. |

## Evidence for the correction

The accepted TypeScript runtime constructs `HighestBestUseSystem`, but the current physical vacant-development path proceeds from cadastre → buildable envelope → building massing → physical development feasibility and then returns those opportunities to the developer market without invoking HBU. Reproducing that omission in C++ would preserve a documented integration defect rather than accepted game rules.

The native correction is intentionally narrow: `DevelopmentAuthority::evaluate()` is the gate between a physical redevelopment candidate and downstream developer-market eligibility. It does not invent a citywide hurdle rate or derive HBU economics from incomplete data; callers must provide the explicit HBU input produced by the authoritative economics pipeline.

## Authority boundary

During Task 16, the native property/development implementation is an **authority candidate** under tests. TypeScript remains the live production authority until the explicit Stack 1 authority-transfer tasks. No Save V9 schema/version change is introduced by this task.

At cutover, the required order is:

```text
canonical parcel/building state
→ physical feasibility
→ HBU / assembly decision
→ DevelopmentAuthority gate
→ developer market
→ acquisition / redevelopment execution
```

Any compatibility projection remains downstream and read-only with respect to canonical land/building/property facts.
