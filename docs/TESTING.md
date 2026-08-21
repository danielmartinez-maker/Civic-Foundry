# Testing — Phase 5

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
```

`npm test` uses Node's built-in test runner with TypeScript strip-types. Source typechecking uses strict global `tsc`; tests are intentionally excluded from `tsconfig.json` because this offline environment does not provide `@types/node`.

## Coverage groups

- Phase 1 deterministic foundation and city construction
- Phase 2 employment/tax/utilities/garbage/demand/economy
- Phase 3 graph, A*, route cache, traffic, congestion, stale-edge safety and accessibility feedback
- Phase 4 public facilities, dispatch, explicit service vehicles, incidents, waste, education and neighborhood quality
- transit topology validation, deterministic IDs and restore round-trip
- multimodal graph construction, transfers, generalized-cost routing and cache invalidation
- weighted person trips and deterministic car/transit/unmet mode choice
- FIFO passenger queues, partial boarding, transfer queues and capacity constraints
- explicit transit vehicle dispatch/progression/dwell, road interaction, metro insulation and fleet shortages
- integrated mobility scheduler effects on car traffic, person accessibility, demand and finance
- Save V5 exact round-trip, active-transit deterministic continuation, corruption rejection and V4 migration
- Phase V HUD, stop/line/vehicle inspection, commands, transit overlays and vehicle rendering
- headless strong/poor/capacity transit scenarios plus route-cache and active-tick diagnostics
- Chromium smoke through the compiled Phase V UI with destructive V5 save/load restoration

## Phase 5 acceptance and performance

Equivalent corridor scenarios hold road geometry, origin/destination and trip weights constant while varying transit quality and capacity.

Current acceptance checks require:

- frequent, low-fare BRT to reduce weighted car traffic and improve person accessibility versus the car-only corridor;
- slow, high-fare transit to lose mode choice instead of receiving artificial preference;
- a low fleet limit to create larger passenger queues, higher experienced wait, lower transit mode share and lower person accessibility than an otherwise-identical high-capacity service;
- 10,000 stable mixed-mode journey plans to exceed a 95% cache-hit ratio;
- 5,000 active-transit ticks to keep vehicle, queue, mode-choice, accessibility and performance diagnostics finite.

A representative run recorded 9,998 route-plan cache hits from 10,000 requests (99.98%). Wall-clock benchmark values are diagnostic only because they vary by hardware and runtime load.

`tests/phase5-headless.test.ts` prints `PHASE5_COMPARISON`, `PHASE5_CAPACITY`, `PHASE5_JOURNEY_BENCHMARK` and `PHASE5_TICK_BENCHMARK` JSON records so balance/performance changes remain visible in CI output.

## Chromium smoke

`tests/smoke/phase5_smoke.py` executes the compiled `dist/` ES modules in system Chromium. It builds a road/service corridor, creates and configures a BRT line through Phase V controls, injects an authoritative weighted passenger cohort, verifies dispatch/boarding/ridership, checks the numeric ridership overlay, edits headway/fare, saves V5, removes a transit stop and road segment, reloads and compares current serialization exactly with the saved JSON.

The execution sandbox used for automated verification blocks all navigable HTTP origins, including loopback. The harness therefore keeps the established `page.set_content` + routed-module strategy and installs a minimal Storage-compatible in-page shim before application startup. This substitutes only the unavailable browser storage surface; simulation, UI commands, save serialization and hydration are the actual compiled application code.

The smoke writes a full-page screenshot to `/tmp/civic-foundry-phase5-smoke.png` and rejects browser page errors.
