# Contributing to Civic Foundry

Civic Foundry uses focused branches around `main`, strict TypeScript, deterministic simulation contracts, and automated repository gates. Changes should preserve system authority and remain independently reviewable.

## Setup

Use Node.js 22 and Python 3.

```bash
npm ci
npm run verify:fast
```

`verify:fast` is the inner-loop gate. The full portable acceptance gate is:

```bash
npm run verify:full
```

Browser and visual smoke tests require the Python packages and Chromium setup documented in `docs/TEST_MATRIX.md` and used by `.github/workflows/ci.yml`.

`npm run verify` remains a compatibility command for existing branches and plans. It runs the fast gate plus deterministic asset validation and the production build. New completion evidence should use `verify:full` when the portable browser runtime is available.

## Branches and commits

Create a focused branch from the correct integration base. Prefer purpose-first names such as:

- `feature/...`
- `fix/...`
- `design/...`
- `docs/...`
- `chore/...`
- `archive/...`

Do not invent or reuse phase numbers when the number no longer matches the canonical roadmap. Branch names are metadata and must not imply that a target architecture is current runtime authority. Temporary profiling, synchronization, RED/GREEN gate, and backup branches must be explicitly classified before cleanup.

Do not mix unrelated gameplay, tooling, documentation, and refactor work in one change.

Use small Conventional Commit messages, for example:

- `feat: add parcel frontage query`
- `fix: preserve save v8 migration order`
- `test: enforce rendering authority boundary`
- `chore: pin engineering toolchain`

Link pull requests to the relevant issue, design, or implementation plan when one exists. Every merge requires review and green CI. Do not merge a draft or bypass a failing gate to advance another tranche.

## Required verification

Before requesting review, run the strongest applicable local tier:

```bash
npm run verify:fast
```

Before declaring a portable tranche complete, run:

```bash
npm run verify:full
```

The canonical test and command ownership matrix is `docs/TEST_MATRIX.md`.

- Tier 1 (`verify:fast`) covers changed-file formatting, ESLint, repository policy, architecture boundaries, production TypeScript, test TypeScript, Node tests, and asset repository policy.
- `npm run verify` adds deterministic atlas/source validation and the production build for backward compatibility with existing plans.
- Tier 2 (`verify:full`) adds all portable browser and visual smoke suites.
- Tier 3 is reserved for genuinely platform/infrastructure-specific acceptance such as Windows packaging/launch, GitHub administrative policy, or future native/GPU checks that cannot run portably.

A CI failure should ordinarily be reproducible through one of these documented commands. Do not classify a failed gate as infrastructure without specific evidence.

## Main branch safety

Target repository policy for `main` is:

- pull requests required;
- the canonical `acceptance` CI job required;
- direct pushes disabled except explicit emergency/admin override;
- stale approvals dismissed after material changes;
- branch up-to-date before merge where practical;
- force pushes disabled;
- branch deletion disabled;
- at least one review required while the project has a single primary owner;
- merge method standardized by repository policy.

Source policy can document and test these expectations, but GitHub branch protection/rulesets are administrative state. Never claim this policy is enabled unless GitHub reports it enabled. See `docs/repository/MAIN_BRANCH_PROTECTION.md`.

## Architecture rules

Respect the authority model documented in `docs/ARCHITECTURE.md`.

- `WorldFoundation` is the sole physical/geographic authority.
- `CadastralGraph` is the canonical legal-land authority.
- Save V9 remains the current persistence envelope unless an approved migration deliberately changes it.
- Current transportation remains transitional until Transportation Engine 2.0 earns authority.
- Rendering is a read-only presentation consumer and must not manufacture simulation outcomes.
- Prism is a target/mirror program until a reviewed migration explicitly transfers authority.
- Simulation/world/save/data code must not depend on application or UI implementation details.
- Simulation and world code must not depend on rendering.
- Prefer composition, narrow typed interfaces, and explicit dependency passing over deep inheritance or new mutable globals.
- Keep internal helpers private to their module/domain unless they are an intentional public API.
- Do not change save ownership, canonical identity, or system authority as an incidental part of another feature.

Significant changes to module boundaries, persistence ownership, build architecture, asset authority, or public APIs require an ADR or design/RFC before implementation.

## Tests and TDD

Behavior changes and bug fixes are test-first: add a focused failing test, verify the expected failure, implement the minimum change, then run the broader gate. Tests should assert real behavior rather than implementation details.

Use the appropriate class:

- unit tests for deterministic logic and utilities;
- invariant tests for conservation and reference integrity;
- integration tests for subsystem contracts and persistence;
- migration/replay tests for authoritative continuation;
- browser/functional tests for compiled playable flows;
- visual smoke tests for presentation regressions;
- benchmarks for measured performance budgets;
- repository/architecture policy tests for engineering contracts.

Tests are typechecked separately through `tsconfig.tests.json`; successful execution through Node strip-types is not a substitute for test TypeScript validity.

## Formatting

`npm run format:check` covers every supported text file changed relative to the integration base. TypeScript, JavaScript/MJS, JSON, and YAML use Prettier. Markdown uses a deterministic trailing-whitespace/final-newline contract so large historical tables are not reformatted solely for column alignment. Generated/build outputs are excluded.

Run:

```bash
npm run format
```

only to format files changed in the current tranche.

## Assets and generated outputs

Generated runtime assets belong in `dist/` and are never authoritative source files. The deterministic `assets/source/*.svg` sheet contracts are intentionally tracked. Do not commit new raw raster textures, audio, video, or 3D-model binaries under `assets/`. Approved large source binaries require Git LFS and architectural review.

Repository policy also rejects tracked build/cache/evidence directories such as `dist/`, Rust `target/`, coverage, Playwright reports, test artifacts, and common caches. Tracked binary files over 5 MiB are rejected by the general repository gate; the existing asset policy remains stricter for asset binaries.

## Dependencies and supply chain

Preserve `package-lock.json` determinism and install with `npm ci`. Remove a dependency only after usage search and verification. Major framework/runtime upgrades belong in dedicated tranches unless a security issue makes the upgrade necessary for repository health.

GitHub Actions use explicit stable versions. Changes to workflow actions should be justified by runner compatibility, security, or a concrete maintenance requirement.

## Performance

Profile before optimizing. In measured hot paths, avoid unnecessary per-frame/per-tick allocations and repeated global scans. Prefer cached indexes, reusable buffers, preallocated structures, or typed arrays when benchmarks demonstrate a benefit. Performance work must retain deterministic behavior.

## Review

Review for correctness, determinism, save compatibility, architecture, performance implications, tests, repository policy, and scope. Comments should explain rationale, constraints, workarounds, or non-obvious algorithms rather than restating the code.
