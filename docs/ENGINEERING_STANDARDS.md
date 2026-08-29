# Civic Foundry Engineering Standards

This document defines the repository-wide engineering baseline for Civic Foundry. Automated checks enforce the mechanically verifiable parts; architectural review covers the parts that require judgment.

## Repository organization

Keep production TypeScript under `src/`, tests under `tests/`, build/repository orchestration under `scripts/`, deterministic asset tooling under `tools/`, source-controlled asset contracts under `assets/source/`, generated output under `dist/`, and documentation under `docs/`.

Production code remains grouped by domain (`app`, `data`, `rendering`, `save`, `simulation`, `ui`, `world`) rather than by generic file type. Add locally cohesive submodules as systems grow. Avoid repository-wide folder moves unless an approved architecture change requires them.

## TypeScript

The compiler baseline keeps `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` enabled. Define explicit interfaces/types for persistent data, configuration, system boundaries, messages, and asset references. Avoid `any`; where external or untrusted data enters the system, validate and narrow it before use.

Civic Foundry compiles to browser-native ES modules. Do not introduce TypeScript `paths` aliases that the browser cannot resolve. ADR 0002 permits the narrow local import map used to resolve pinned browser ESM runtime dependencies such as PixiJS; broader bundler or dependency-resolution changes require a separate ADR and runtime verification.

Use ESLint for semantic/static checks and Prettier for deterministic formatting of repository/tooling surfaces. Gameplay source formatting is migrated incrementally to avoid creating high-conflict whitespace-only diffs across active feature stacks; new or substantially edited source should follow the prevailing formatted style.

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

## Determinism, state, and persistence

Simulation changes must preserve deterministic ordering and explicit authority. Presentation code reads simulation state; it does not create authoritative outcomes. Save-format changes require dedicated migration, round-trip, corruption, and continuation tests. Never repurpose an existing save version for a different ownership model.

Use plain serializable data at persistence boundaries. Validate IDs/references during hydration before committing candidate state. Failed hydration or transactional mutation must not leave partially updated authoritative state.

## Testing

Use test-first development for behavior changes and bug fixes. The minimum cycle is failing contract, observed RED, minimal GREEN, broader regression gate, then refactor while green.

Testing tiers:

1. **Unit** — math, deterministic utilities, rules, transforms, validation, serialization helpers.
2. **Integration** — subsystem authority, persistence, migration, and cross-system contracts.
3. **Browser/functional** — compiled playable scenarios and UI-to-simulation wiring.
4. **Visual smoke** — deterministic presentation scenes and interaction coverage.
5. **Performance** — fixed scenarios that measure budgets separately from correctness assertions.

Tests should assert observable behavior and invariants, not incidental implementation details.

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

## Assets

The current deterministic isometric pipeline is canonical:

- `assets/source/*.svg` contains small sheet/layout contracts;
- authored procedural geometry lives in source-controlled tooling;
- `tools/render_isometric_atlases.py` validates/rasterizes;
- runtime atlases are generated into `dist/`.

Do not commit new raw `.png`, `.jpg`, `.webp`, audio/video, or 3D-model sources under `assets/`. Approved unavoidable large binary sources require Git LFS and architecture review. Runtime asset references should remain typed through the TypeScript manifest model; do not create a second asset registry with competing identity.

Asset loading should remain asynchronous where I/O is involved. Large future worlds/assets should support staged loading or streaming rather than blocking the main thread. Development hot-reload may be added through a dedicated development server, provided it cannot alter production authority or persistence semantics.

## Native Prism / Rust

Prism production code lives under `engine/prism/`. P0 pins Rust 1.98.0, Rust 2024 edition, Cargo resolver 3, and a committed `engine/prism/Cargo.lock`.

P0 Rust uses the standard library only and forbids unsafe code. New Rust dependencies or any relaxation of the unsafe-code rule require explicit architecture review with ownership, performance, licensing, and determinism rationale.

Use deterministic ordered collections when iteration order can affect authoritative output. Thread completion order, wall-clock time, hash-table iteration, locale, and filesystem enumeration must not become authoritative ordering inputs.

`npm run prism:verify` is the native Prism gate. During progressive migration, `npm run verify:all` is the combined local gate and runs the existing TypeScript verification followed by Prism verification. Windows-native host behavior additionally requires the `prism-windows` CI job.

## Build and dependencies

Node.js 22 is the supported JavaScript runtime for repository tooling. TypeScript, ESLint, Prettier, and TypeScript ESLint are exact local development dependencies recorded in `package-lock.json`. CI uses `npm ci`; do not depend on globally installed compilers or linters.

Build orchestration is cross-platform Node ESM. Child processes run with `shell: false`; filesystem operations use Node APIs rather than Unix-only `rm`, `cp`, or `mkdir` commands. Python remains a supported deterministic asset/browser-test dependency.

Third-party dependencies must have a clear ownership/performance reason, compatible licensing, and explicit versioning. Prefer small well-understood dependencies to broad frameworks when Civic Foundry only needs a narrow capability.

## Verification

`npm run verify` remains the canonical legacy authoritative-runtime gate. It runs formatting checks, ESLint, Civic Foundry policy checks, architecture checks, strict typechecking, tests, asset policy/validation, and a production build. CI runs the browser and visual smoke tiers after that core gate.

From Prism P0 onward, `npm run verify:all` is the full transitional repository gate. It runs the existing TypeScript verification followed by `npm run prism:verify`. The Windows-only `prism-windows` CI job additionally proves the native executable startup contract.

Do not bypass a failing check by weakening the assertion unless the underlying contract itself was deliberately changed and reviewed.

## Documentation and architectural decisions

Keep setup/build/test instructions current in the README and contributor guide. Public or cross-domain APIs should use JSDoc where the type signature alone does not communicate lifecycle, ownership, units, side effects, or determinism requirements.

Significant architecture choices are recorded under `docs/adr/`. Larger feature programs may also use the existing design/spec/RFC workflow. Documentation should explain ownership, constraints, invariants, and the reason for non-obvious decisions.

## Ownership and collaboration

Each major domain should have a responsible owner or small review group before the project scales to a larger team. Ownership is recorded by domain, not fabricated usernames. Current domains include world/geometry, simulation/kernel, persistence, rendering/assets, UI/application, and repository/tooling.

Track bugs/features through issues or approved plans. Link material commits and pull requests to the relevant issue/design when one exists. Significant boundary changes require discussion/design before implementation. AI-generated changes follow the same test, review, CI, performance, and architecture requirements as human-generated changes.
