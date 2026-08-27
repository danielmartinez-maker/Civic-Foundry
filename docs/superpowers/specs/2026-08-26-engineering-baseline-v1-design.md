# Engineering Baseline v1 Design

## Purpose

Civic Foundry needs an enforceable engineering baseline for a large TypeScript game repository without destabilizing active gameplay work. This tranche establishes repository-wide standards for tooling, architecture, assets, testing, documentation, and collaboration while preserving runtime behavior, save compatibility, and existing authority boundaries.

## Scope

Engineering Baseline v1 is behavior-neutral. It must not change simulation outcomes, save schemas, canonical IDs, rendering semantics, Urban Fabric authority, World Foundation authority, or transportation ownership.

It will:

- make local and CI tooling reproducible;
- replace Linux-only build shell commands with cross-platform Node orchestration;
- introduce ESLint and Prettier as the primary TypeScript/style enforcement layer;
- retain Civic Foundry-specific lint/safety checks that are not cleanly expressed in generic lint rules;
- define and automatically verify architectural dependency boundaries;
- formalize repository hygiene, asset policy, module/API policy, performance discipline, testing tiers, and contribution rules;
- consolidate verification behind one canonical command;
- preserve the existing deterministic generated-asset pipeline.

## Repository strategy

Use trunk-based development with short-lived feature branches around `main`. Engineering Baseline v1 is developed on `chore/engineering-baseline-v1` and is isolated from Urban Fabric 2.0 and other gameplay stacks until independently reviewed and green.

The repository keeps its current domain-oriented source layout (`app`, `data`, `rendering`, `save`, `simulation`, `ui`, `world`) rather than performing a broad folder rewrite. New or modified subsystems should expose narrow public APIs and keep implementation details local to their feature/domain folder.

## TypeScript and module policy

Preserve the current strict compiler posture, including:

- `strict: true`;
- `noUncheckedIndexedAccess: true`;
- `exactOptionalPropertyTypes: true`.

Do not introduce TypeScript `paths` aliases in this tranche because Civic Foundry currently ships browser-native ESM compiled directly by TypeScript. Aliases that the compiler accepts but the browser cannot resolve would create runtime-only failures unless a bundler/import-map strategy is introduced separately.

Favor composition and data-driven services over deep inheritance. New mutable global state and ad-hoc singletons are prohibited. Systems receive dependencies explicitly through constructors, factory arguments, or typed context objects. Public modules should expose only intentional APIs; internal helpers remain unexported or local to the domain folder.

## Toolchain and dependency policy

Pin TypeScript and all engineering tools as local `devDependencies` and commit the npm lockfile. CI installs Node dependencies through `npm ci`; it must not depend on a globally installed TypeScript compiler.

Use ESLint for TypeScript-aware static analysis and Prettier for deterministic formatting. Civic Foundry-specific repository assertions remain in a dedicated policy script where generic lint rules would be brittle or less expressive.

## Build system

The production build must be cross-platform. Replace shell-specific `rm`, `cp`, and `mkdir` orchestration with a Node ESM build script using `node:fs/promises` and `node:path`.

The build continues to:

1. recreate `dist/`;
2. compile TypeScript;
3. copy browser entry/static files;
4. copy the pinned Clipper2 browser module;
5. run the deterministic atlas renderer.

The asset renderer remains Python because it is already part of Civic Foundry's deterministic art pipeline.

## Architectural boundaries

Add a repository architecture verifier over TypeScript imports. Initial dependency rules are intentionally conservative and map to existing authority boundaries:

- `src/simulation/**`, `src/world/**`, `src/save/**`, and `src/data/**` may not import from `src/app/**` or `src/ui/**`;
- `src/simulation/**` and `src/world/**` may not import from `src/rendering/**`;
- `src/rendering/**` may not import from `src/app/**` or `src/ui/**`;
- tests may import any production domain;
- the architecture verifier reports the importing file, imported target, and violated rule.

These rules prevent presentation/application code from becoming simulation authority while avoiding a speculative full dependency graph rewrite.

## Asset policy

Preserve the current deterministic source-contract pipeline. Tiny checked-in `assets/source/*.svg` files remain legal because they define deterministic sheet contracts and are not runtime texture binaries. Authored world geometry remains generated from source-controlled code, and runtime atlases remain generated under `dist/`.

Repository policy prohibits committing new raw raster textures, audio, video, or 3D model binaries outside explicitly approved fixtures. Large unavoidable binary sources must use Git LFS and require architectural review. Generated assets stay out of Git.

Asset references remain type-safe through the existing TypeScript manifest model. This tranche adds repository validation around asset/source placement but does not create a duplicate asset registry.

## Verification contract

Create one canonical `npm run verify` command. It must run the fast deterministic engineering gates in a fixed order:

1. formatting check;
2. ESLint;
3. Civic Foundry repository policy checks;
4. architecture dependency checks;
5. TypeScript typecheck;
6. unit tests;
7. asset source validation;
8. production build.

Existing browser/visual smoke suites remain explicit CI stages after the core `verify` gate because they require Python/Playwright setup and are slower. CI and local development share the same core verification command.

## Testing and TDD

New behavior is test-first. Repository tooling receives focused tests using Node's built-in test runner where practical. Configuration-only changes are verified through the commands they configure.

Testing tiers are documented as:

- unit: deterministic pure/domain behavior;
- integration: subsystem boundaries, persistence, and authority contracts;
- browser/functional: playable compiled behavior;
- visual smoke: presentation regressions;
- performance/benchmark: fixed scenario budgets and hot-path regression checks.

## Performance policy

Hot paths must avoid unnecessary per-frame/per-tick allocation and repeated global scans. Prefer cached indexes, reusable buffers, preallocated arrays, and typed arrays when profiling demonstrates value. Performance changes require measurement before and after; this tranche does not rewrite healthy simulation code speculatively.

Performance budgets should be attached to representative deterministic scenarios and kept separate from correctness assertions where wall-clock noise would make CI flaky.

## Documentation and collaboration

Add or update repository documentation covering:

- installation, build, test, and verification commands;
- contribution flow and Conventional Commit format;
- architectural ownership and public API rules;
- asset-source policy and generated-output policy;
- testing tiers and TDD expectations;
- performance profiling expectations;
- ADR process for significant architectural changes;
- PR review expectations and issue linkage.

No CODEOWNERS file is added with invented personnel. Ownership is documented by system/domain and can be mapped to actual GitHub teams or contributors later.

## Acceptance criteria

Engineering Baseline v1 is acceptable when:

- npm dependencies install reproducibly from the committed lockfile;
- local TypeScript is used by scripts and CI;
- formatting, ESLint, repository policy, and architecture checks pass;
- the production build uses cross-platform Node orchestration;
- all pre-existing tests pass;
- typecheck passes with the strict settings preserved;
- deterministic asset validation/build passes;
- all existing browser and visual smoke suites remain green in CI;
- no gameplay/save/runtime authority behavior changes;
- documentation clearly states the enforced engineering contract.
