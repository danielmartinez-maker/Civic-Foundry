# Contributing to Civic Foundry

Civic Foundry uses short-lived branches around `main`, strict TypeScript, deterministic simulation contracts, and automated repository gates. Changes should preserve system authority and remain independently reviewable.

## Setup

Use Node.js 22 and Python 3.

```bash
npm ci
npm run verify
```

Browser and visual smoke tests additionally require the Python packages and Chromium setup used by `.github/workflows/ci.yml`.

## Branches and commits

Create a focused branch from the correct integration base. Prefer names such as `feature/...`, `fix/...`, `chore/...`, `test/...`, or `docs/...`. Do not mix unrelated gameplay, tooling, documentation, and refactor work in one change.

Use small Conventional Commit messages, for example:

- `feat: add parcel frontage query`
- `fix: preserve save v8 migration order`
- `test: enforce rendering authority boundary`
- `chore: pin engineering toolchain`

Link pull requests to the relevant issue, design, or implementation plan when one exists. Every merge requires review and green CI. Do not merge a draft or bypass a failing gate to advance another tranche.

## Required verification

Before requesting review, run:

```bash
npm run verify
```

This covers formatting, ESLint, Civic Foundry repository policy, architecture boundaries, strict TypeScript, unit/integration tests, asset policy, asset validation, and the production build. Pull requests also run the existing browser and visual smoke suites in CI.

## Architecture rules

Respect the authority model documented in `docs/ARCHITECTURE.md`.

- Simulation/world/save/data code must not depend on application or UI implementation details.
- Simulation and world code must not depend on rendering.
- Rendering is a read-only presentation consumer and must not manufacture simulation outcomes.
- Prefer composition, narrow typed interfaces, and explicit dependency passing over deep inheritance or new mutable globals.
- Keep internal helpers private to their module/domain unless they are an intentional public API.
- Do not change save ownership, canonical identity, or system authority as an incidental part of another feature.

Significant changes to module boundaries, persistence ownership, build architecture, asset authority, or public APIs require an ADR or design/RFC before implementation.

## Tests and TDD

Behavior changes and bug fixes are test-first: add a focused failing test, verify the expected failure, implement the minimum change, then run the broader gate. Tests should assert real behavior rather than implementation details.

Use the appropriate tier:

- unit tests for deterministic logic and utilities;
- integration tests for subsystem contracts and persistence;
- browser/functional tests for compiled playable flows;
- visual smoke tests for presentation regressions;
- benchmarks for measured performance budgets.

## Assets

Generated runtime assets belong in `dist/` and are never authoritative source files. The deterministic `assets/source/*.svg` sheet contracts are intentionally tracked. Do not commit new raw raster textures, audio, video, or 3D-model binaries under `assets/`. Approved large source binaries require Git LFS and architectural review.

## Performance

Profile before optimizing. In measured hot paths, avoid unnecessary per-frame/per-tick allocations and repeated global scans. Prefer cached indexes, reusable buffers, preallocated structures, or typed arrays when benchmarks demonstrate a benefit. Performance work must retain deterministic behavior.

## Review

Review for correctness, determinism, save compatibility, architecture, performance implications, tests, and scope. Comments should explain rationale, constraints, workarounds, or non-obvious algorithms rather than restating the code.
