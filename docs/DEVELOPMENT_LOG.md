# Civic Foundry — Development Log

## 2026-08-21 — Phase 1–3 fresh reimplementation

### Why this rebuild exists

The earlier temporary ChatGPT execution workspace reached a verified Phase 3 checkpoint named `f0bb3d6`, but that mounted Git/source tree expired before the project was moved to GitHub. Only design documents/screenshots survived.

The current `rebuild-phase3` work is therefore a **fresh reimplementation from preserved requirements**, not recovered historical source. This provenance distinction is intentional and permanent.

### Durability rule introduced

`danielmartinez-maker/Civic-Foundry` is the canonical source of truth. Stable implementation milestones are published to GitHub before proceeding. No future phase may rely on a temporary worktree as the only copy of source/test/config/documentation files.

### Rebuilt milestones

- deterministic simulation foundation
- roads, zoning, lots, buildings, bounded population
- employment, R/C/I demand, taxes, road-connected power/water, garbage, recurring economy
- local/collector/arterial road hierarchy and transportation graph
- deterministic A*, route cache, weighted commute/shopping trips, intersection queues
- active traffic vehicles, congestion, rolling accessibility analytics, demand feedback, stale-edge cleanup
- Save V3 with deterministic continuation and V2 migration
- Canvas 2D browser presentation, HUD, inspector, build tools, traffic overlays
- headless causal comparison and browser smoke acceptance

### Acceptance evidence

A deterministic comparison of otherwise-equivalent cities produced:

- local roads: average commute about 148.22 ticks, average job accessibility about 0.389
- arterial roads: average commute about 64.09 ticks, average job accessibility about 0.734

The local-road city also measured materially higher sampled congestion and lower residential demand.

A 10,000-query repeated-route benchmark produced 9,999 route-cache hits (99.99% hit ratio) in the latest local run. A 5,000-tick active-city measurement is recorded by the headless test output rather than enforced as an arbitrary threshold.

### Offline tooling

The rebuild uses TypeScript, browser Canvas 2D, Node built-in tests, global `tsc`, and Python Playwright/system Chromium. It does not claim Vite/PixiJS/Vitest runtime dependencies.

### Next target

Phase 4 — Public Services, using the approved `docs/superpowers/specs/2026-08-21-city-simulator-phase-4-design.md` after the completed Phase 3 rebuild is fully mirrored and audited on GitHub.
