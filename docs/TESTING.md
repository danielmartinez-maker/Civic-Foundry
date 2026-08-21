# Testing — Phase 3 Rebuild

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

- deterministic core: RNG, terrain, treasury, clock
- Phase 1 city foundation: roads, zoning, lots, buildings, population, `SimulationCore` orchestration
- Phase 2 city loop: employment, taxes, utilities, garbage, demand, economy, managed/unmanaged growth
- Phase 3 graph/routing: road hierarchy, graph derivation, A*, route cache, weighted trips, intersection queues
- Phase 3 traffic: movement, congestion, stale-edge safety, analytics, demand feedback, core traffic scheduler
- Save V3: exact round-trip, deterministic continuation, corrupt-reference rejection, V2 migration
- presentation contracts: HUD, inspector, overlays, tool-controller mutations
- headless acceptance: local-vs-arterial consequence comparison, deterministic V3 hash, pathfinding cache benchmark, active-tick performance sample
- browser smoke: real compiled ES modules in system Chromium, deterministic city setup, live traffic/HUD/overlay, paused V3 save, destructive edit, exact load restoration

## Browser sandbox strategy

This execution environment may block top-level localhost/file navigation. The smoke harness opens an `about:blank` document, injects a `<base href="http://civic.test/">`, and routes `http://civic.test/**` subresources to compiled `dist/` files. The browser executes the actual compiled ES modules; the harness does not replace simulation behavior.

## Performance policy

Performance measurements are recorded but no arbitrary wall-clock pass/fail threshold is imposed yet. Correctness requires finite state, bounded rolling histories/queues, deterministic results, and no stranded traffic after topology changes.
