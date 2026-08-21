# Testing — Phase 4

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
- Phase 4 facility placement, budgets, fiscal effectiveness and fleet availability
- service demand and transportation-graph accessibility
- dispatch jobs, service vehicles, emergency queue priority and topology mutation
- seeded fire/police/medical incidents and bounded fire spread
- routed garbage pickup/cargo/processing plus education capacity/access
- neighborhood quality, service-demand feedback and full `SimulationCore` scheduler
- Save V4 exact round-trip, deterministic continuation, corruption rejection and V3 migration
- service HUD/inspector/build tools/overlays/service-vehicle render positioning
- Phase 4 headless causal comparison, deterministic hash, service-route cache and active-tick benchmark
- Chromium smoke: real compiled Phase IV UI, service facilities/vehicles, service overlay, budget mutation, V4 save, destructive edit and exact load restoration

## Phase 4 acceptance evidence

The headless comparison holds buildings, facilities, funding and seed constant and changes only road class. In the latest verified run:

- local-road fire arrival: 94 ticks
- arterial fire arrival: 46 ticks
- local service quality: ~0.49
- arterial service quality: ~0.71
- local processed waste: 186
- arterial processed waste: 354
- local backlog: 446
- arterial backlog: 284

The repeated 5,000 service-access request benchmark records at least 4,999 cache hits (99.98%). Performance measurements are reported rather than enforced against an arbitrary machine-specific wall-clock limit.

## Browser sandbox strategy

The smoke harness injects `<base href="http://civic.test/">` into the compiled document and routes `http://civic.test/**` to `dist/`. System Chromium executes the actual compiled ES modules; the harness does not replace simulation behavior.
