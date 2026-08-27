# ADR 0001: Engineering Baseline v1

- Status: Accepted
- Date: 2026-08-26

## Context

Civic Foundry has grown into a multi-domain deterministic TypeScript game with active stacked feature branches. Its existing strict compiler settings, test suite, browser smoke coverage, and deterministic asset pipeline are strong foundations, but repository tooling was partly bespoke and Linux-specific: TypeScript was installed globally in CI, the build used shell `rm`/`cp`, linting was a narrow source scanner, and dependency/architecture policies were mostly documented rather than enforceable.

A broad source reorganization or formatting rewrite would create unnecessary conflicts with active gameplay tranches. The engineering baseline therefore needs to improve reproducibility and enforcement without changing runtime authority or creating a large whitespace-only integration burden.

## Decision

Civic Foundry adopts the following repository baseline:

1. Node.js 22 is the supported repository-tooling runtime.
2. TypeScript 5.8.3 and engineering tools are exact local development dependencies recorded in `package-lock.json`; CI uses `npm ci` rather than global compiler installation.
3. ESLint is the primary TypeScript static-analysis layer. Civic Foundry-specific source safety checks remain in a dedicated repository-policy script.
4. Prettier is the deterministic formatter for repository/tooling/test/documentation surfaces in this tranche. Gameplay-source formatting migrates incrementally to avoid high-conflict whitespace rewrites across active stacks.
5. Production build orchestration uses Node ESM filesystem/process APIs and does not rely on Unix-only shell commands.
6. Conservative automated import-boundary checks protect simulation/world/save/data/rendering authority from dependencies on higher presentation/application layers.
7. The deterministic `assets/source/*.svg` contracts remain tracked. New raw raster/audio/video/3D source binaries under `assets/` are prohibited unless explicitly approved and managed through Git LFS when large.
8. `npm run verify` is the canonical core repository gate, followed in CI by the established browser and visual smoke suites.
9. Civic Foundry remains browser-native ESM. TypeScript `paths` aliases are not introduced because the browser runtime cannot resolve compiler-only aliases without an additional bundler or import-map design.

## Consequences

Local and CI verification use the same pinned JavaScript toolchain. Windows/macOS/Linux build orchestration shares one Node implementation. Authority violations and forbidden asset additions fail before merge. The repository gains an explicit ADR/contribution process without touching simulation/save behavior.

Prettier does not immediately reformat all gameplay TypeScript, so source-wide formatting consistency remains an incremental migration rather than a one-time enforcement cutover. A future decision to add a bundler, import map, source-wide formatting migration, hot-reload server, or large binary source pipeline requires a separate ADR and compatibility/performance review.
