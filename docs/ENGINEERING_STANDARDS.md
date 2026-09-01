# Civic Foundry Engineering Standards

This document defines the repository-wide engineering baseline for Civic Foundry. Automated checks enforce the mechanically verifiable parts; architectural review covers the parts that require judgment.

## Repository organization

Keep production TypeScript under `src/`, tests under `tests/`, build/repository orchestration under `scripts/`, deterministic asset tooling under `tools/`, source-controlled asset contracts under `assets/source/`, generated output under `dist/`, and documentation under `docs/`.

Production code remains grouped by domain (`app`, `data`, `rendering`, `save`, `simulation`, `ui`, `world`) rather than by generic file type. Add locally cohesive submodules as systems grow. Avoid repository-wide folder moves unless an approved architecture change requires them.

Generated/cache/evidence paths such as `dist/`, Rust `target/`, coverage, Playwright reports, `test-artifacts/`, Python caches, and temporary/cache roots must remain untracked. `.gitignore` prevents normal accidental additions and `npm run policy:check` rejects forbidden tracked paths.

## TypeScript

The production compiler baseline keeps `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` enabled. Define explicit interfaces/types for persistent data, configuration, system boundaries, messages, and asset references. Avoid `any`; where external or untrusted data enters the system, validate and narrow it before use.

Production code and test/tooling code have separate compiler boundaries:

- `tsconfig.json` typechecks production `src/**/*.ts`;
- `tsconfig.tests.json` typechecks `tests/**/*.ts` and the MJS repository tooling imported by tests with `noEmit`.

Tests executing through Node strip-types must still pass `npm run typecheck:tests`.

Civic Foundry compiles to browser-native ES modules. Do not introduce TypeScript `paths` aliases that the browser cannot resolve. ADR 0002 permits the narrow local import map used to resolve pinned browser ESM runtime dependencies such as PixiJS; broader bundler or dependency-resolution changes require a separate ADR and runtime verification.

## Formatting and static analysis

Use ESLint for semantic/static checks. Formatting is incremental against the integration base so active feature stacks are not hit by repository-wide whitespace rewrites.

`npm run format:check` covers every changed maintained file with a supported text type:

- TypeScript;
- JavaScript/MJS/CJS;
- JSON;
- YAML;
- Markdown.

TypeScript, JavaScript/MJS/CJS, JSON, and YAML use Prettier. Markdown uses deterministic trailing-whitespace removal and exactly one final newline; this deliberately avoids reflowing large historical audit tables solely for visual column alignment. Generated/build outputs are excluded.

Run `npm run format` to normalize only the changed managed files in the current tranche.

Python has no adopted formatter in the current baseline. Do not introduce one incidentally; a Python formatting/lint ecosystem should be adopted only with an explicit project decision and measurable maintenance value.

## Architecture and composition

Prefer composition and data-driven systems over deep inheritance. Entities should be assembled from small capabilities/data structures, with logic operating through narrow typed contracts. New inheritance hierarchies deeper than a simple specialization require explicit justification.

Avoid new mutable global state and ad-hoc singletons. Pass dependencies through constructors, factories, or typed context objects. A system should make its dependencies visible at the boundary.

Export only intentional public APIs. Helpers that exist only to implement a module stay private. Consumers should not reach through a domain to manipulate another system's internal stores.

Automated architecture checks enforce the first conservative dependency rules:

- `simulation` cannot import `app`, `ui`, or `rendering`;
- `world` cannot import `app`, `ui`, or `rendering`;
- `save` and `data` cannot import `app` or `ui`;
- `rendering` cannot import `app` or `ui`.

These checks support the authority model in `docs/ARCHITECTURE.md`; they do not replace architectural review.

## Authority and persistence

The current authoritative map is intentionally explicit:

- `WorldFoundation` owns physical/geographic state;
- `CadastralGraph` owns legal parcels/topology;
- `LotSystem` remains a derived compatibility facade;
- Save V9 is the current Urban Fabric persistence envelope;
- transportation remains transitional until Transportation Engine 2.0 earns authority;
- `GpuWorldRenderer` is presentation-only;
- Prism remains a target/mirror program until a reviewed migration transfers authority.

Simulation changes must preserve deterministic ordering and explicit authority. Presentation code reads simulation state; it does not create authoritative outcomes. Save-format changes require dedicated migration, round-trip, corruption, and continuation tests. Never repurpose an existing save version for a different ownership model.

Use plain serializable data at persistence boundaries. Validate IDs/references during hydration before committing candidate state. Failed hydration or transactional mutation must not leave partially updated authoritative state.

Repository-maintenance work must not remove a compatibility seam merely because a future replacement exists. Authority cutover belongs to the relevant simulation stack.

## Testing

Use test-first development for behavior changes and repository/tooling contracts. The minimum cycle is failing contract, observed RED, minimal GREEN, broader regression gate, then refactor while green.

Testing classes include:

1. **Unit** — math, deterministic utilities, rules, transforms, validation, serialization helpers.
2. **Invariant** — conservation, identity, ownership, topology, capacity, and reference integrity.
3. **Integration** — subsystem authority, persistence, migration, and cross-system contracts.
4. **Replay/continuation** — deterministic future from equivalent authoritative input.
5. **Browser/functional** — compiled playable scenarios and UI-to-simulation wiring.
6. **Visual smoke** — deterministic presentation scenes and interaction coverage.
7. **Performance** — fixed scenarios that measure budgets separately from correctness assertions.
8. **Repository/architecture policy** — deterministic engineering contracts.

The permanent suite/command/platform matrix is `docs/TEST_MATRIX.md`.

Tests should assert observable behavior and invariants, not incidental implementation details.

## Verification tiers

Civic Foundry uses three verification tiers.

### Tier 1 — Fast

```bash
npm run verify:fast
```

Runs changed-file formatting, ESLint, repository policy, architecture policy, production typecheck, test typecheck, Node tests, and asset repository policy. CI runs this before installing Chromium so cheap deterministic failures surface early.

### Compatibility core gate

```bash
npm run verify
```

Retained for existing plans/branches. It runs Tier 1 plus deterministic atlas/source validation and the production build.

### Tier 2 — Full portable

```bash
npm run verify:full
```

Runs the complete portable acceptance contract: the compatibility core gate plus Phase 6, Phase 7, Urban Fabric, isometric interaction, and isometric visual browser smokes.

### Tier 3 — Platform / infrastructure

Reserved for checks that genuinely require a non-portable environment, such as Windows desktop packaging/launch, GitHub administrative rules, or future native/GPU runtime checks. Ordinary browser/visual tests are not CI-only; they have a canonical local command.

Do not bypass a failing check by weakening the assertion unless the underlying contract itself was deliberately changed and reviewed.

## Repository policy

`npm run policy:check` combines source-safety checks with tracked-file hygiene. It rejects:

- tracked generated/build/cache/evidence directories;
- `debugger`, `eval`, and `Function` constructor usage covered by the existing source policy;
- unescaped protected `GameApp` interpolation patterns;
- tracked binary files over 5 MiB.

This general binary threshold does not weaken the stricter asset policy. Approved unavoidable large binary sources still require Git LFS and architectural review.

Policy checks should remain simple, deterministic, and actionable. Do not turn repository policy into a hidden architecture engine.

## Main branch safety

The required administrative target for `main` is documented in `docs/repository/MAIN_BRANCH_PROTECTION.md`. Repository source cannot prove that GitHub protection is enabled; verify live GitHub state before claiming it.

Required semantics include pull requests, the canonical acceptance check, review, stale-approval dismissal, no force push, no deletion, and tightly scoped emergency/admin override.

## Logging and assertions

Engine/repository diagnostics should use explicit severity (`debug`, `info`, `warn`, `error`) when a logging layer is introduced or extended. Assertions are appropriate for programmer invariants; recoverable content/user errors should return typed failures or diagnostics rather than crashing the simulation loop. Persistent diagnostics must be deterministic if they influence tests or saved state.

## Performance

Measure early enough to prevent architectural dead ends, but do not rewrite healthy systems speculatively. Establish budgets around representative deterministic scenarios.

In hot loops:

- avoid avoidable object/array creation every frame or tick;
- avoid repeated full-store scans when a stable index can answer the query;
- reuse buffers and temporary structures where profiling shows allocation pressure;
- use preallocated arrays or typed arrays when numeric bulk processing benefits from them;
- batch contiguous/data-oriented processing when it improves measured throughput;
- keep rendering caches presentation-only and prevent them from becoming authority.

Every optimization must preserve correctness, determinism, and maintainable ownership boundaries.

Repository tooling has the same performance rule. Expensive browser/runtime setup should occur after cheap deterministic gates, and redundant full-suite executions should not be added without a distinct acceptance purpose.

## Assets

The current deterministic isometric pipeline is canonical:

- `assets/source/*.svg` contains small sheet/layout contracts;
- authored procedural geometry lives in source-controlled tooling;
- `tools/render_isometric_atlases.py` validates/rasterizes;
- runtime atlases are generated into `dist/`.

Do not commit new raw `.png`, `.jpg`, `.webp`, audio/video, or 3D-model sources under `assets/`. Approved unavoidable large binary sources require Git LFS and architecture review. Runtime asset references should remain typed through the TypeScript manifest model; do not create a second asset registry with competing identity.

Asset loading should remain asynchronous where I/O is involved. Large future worlds/assets should support staged loading or streaming rather than blocking the main thread. Development hot-reload may be added through a dedicated development server, provided it cannot alter production authority or persistence semantics.

## Build and dependencies

Node.js 22 is the supported JavaScript runtime for repository tooling. TypeScript, ESLint, Prettier, and TypeScript ESLint are exact local development dependencies recorded in `package-lock.json`. CI uses `npm ci`; do not depend on globally installed compilers or linters.

Build orchestration is cross-platform Node ESM. Child processes run with `shell: false`; filesystem operations use Node APIs rather than Unix-only `rm`, `cp`, or `mkdir` commands. Python remains a supported deterministic asset/browser-test dependency.

Third-party dependencies must have a clear ownership/performance reason, compatible licensing, and explicit versioning. Prefer small well-understood dependencies to broad frameworks when Civic Foundry only needs a narrow capability. Remove dependencies only after repository-wide usage evidence and verification. Major dependency upgrades should be isolated unless required for security or repository health.

GitHub Actions should use explicit stable versions compatible with the current hosted runner runtime. Dependency/security auditing should report findings rather than automatically applying behavior-changing upgrades.

## Documentation and architectural decisions

Keep setup/build/test instructions current in the README and contributor guide. Public or cross-domain APIs should use JSDoc where the type signature alone does not communicate lifecycle, ownership, units, side effects, or determinism requirements.

Significant architecture choices are recorded under `docs/adr/`. Larger feature programs may also use the existing design/spec/RFC workflow. Documentation should explain ownership, constraints, invariants, and the reason for non-obvious decisions.

A branch, plan, or design document does not establish implementation. Use **Implemented**, **Transitional**, and **Target** status language consistently.

## Ownership and collaboration

Each major domain should have a responsible owner or small review group before the project scales to a larger team. Ownership is recorded by domain, not fabricated usernames. Current domains include world/geometry, simulation/kernel, persistence, rendering/assets, UI/application, and repository/tooling.

Track bugs/features through issues or approved plans. Link material commits and pull requests to the relevant issue/design when one exists. Significant boundary changes require discussion/design before implementation. AI-generated changes follow the same test, review, CI, performance, and architecture requirements as human-generated changes.
