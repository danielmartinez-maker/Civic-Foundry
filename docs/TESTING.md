# Testing — Phase 6

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```

`npm test` uses Node's built-in runner with TypeScript strip-types. Source typechecking uses strict global `tsc`; tests are excluded from `tsconfig.json` because this offline environment does not provide `@types/node`.

## Coverage groups

The Phase 1–5 deterministic, traffic, services and transit suites remain regression coverage. Phase 6 adds:

- deterministic firm assignment, forming state and firm-derived employment;
- conservation-safe inventories and input-constrained industrial/wholesale/retail production;
- stable boundary gateways, gateway-only industrial-input sourcing and generalized-cost supplier matching;
- explicit freight vehicles, route progression and weighted congestion contribution;
- `EconomyScheduler` city-loop integration and employment feedback;
- deterministic firm finance, formation, distress, recovery, closure and bulldoze cleanup;
- Save V6 exact round-trip, active-freight continuation, corrupt-reference rejection and honest V5 migration;
- Phase VI HUD/panel/firm inspection, nine economy/freight overlays and freight renderer contracts;
- 12 causal Phase 6 acceptance scenarios plus diagnostic performance tests;
- compiled Chromium Phase VI smoke with destructive V6 save/load restoration.

## Phase 6 causal acceptance

`tests/phase6-headless.test.ts` requires:

1. active establishment job capacity replaces raw building jobs;
2. manufacturing produces nothing without required industrial inputs;
3. a cheaper local source can beat imports for locally producible goods;
4. explicit freight raises real road travel time;
5. congestion-driven logistics cost worsens firm operating health;
6. better freight access helps through lower generalized cost, not a flat bonus;
7. lower freight dispatch capacity creates queues, queue delay and eventual shortages;
8. delivered imports/exports conserve cargo volume;
9. formation/closure timing is deterministic;
10. closure/bulldoze leaves no live jobs, affected orders, cargo or recreated inventory;
11. Save V6 continuation equals uninterrupted execution;
12. V5 migration starts with zero fabricated Phase 6 history.

Representative local diagnostics after the final acceptance changes: 2,000 lifecycle evaluations ≈1 ms, 10,000 two-candidate freight matches ≈6 ms, 5,000 active-economy ticks ≈0.7–0.8 s at the test-city scale, and 99/100 cache hits for repeated stable freight OD planning. These timings are diagnostic only, not cross-hardware guarantees.

## Chromium smoke

`tests/smoke/phase6_smoke.py` executes compiled ES modules in system Chromium. It builds a boundary-connected R/C/I city, steps until establishments and freight exist, checks the Economy/Freight panel, causal firm inspector and freight-route overlay, saves V6, bulldozes a firm and boundary road, reloads, and compares the current V6 serialization byte-for-byte with the saved JSON.

The sandbox blocks navigable loopback origins, so the harness retains the established `page.set_content` + routed-module strategy and installs a minimal Storage-compatible in-page shim. Only the unavailable browser storage surface is substituted; simulation, UI events, serialization and hydration are the real compiled application.

The smoke writes `/tmp/civic-foundry-phase6-smoke.png` and rejects browser page errors.
