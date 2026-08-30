# Civic Foundry — Platforms, Build & Release

## Current platform status

### Windows desktop — production target

Civic Foundry currently targets GPU-rendered Windows desktop play through a hardened Electron host around the local built application.

### Browser — development and smoke-test target

The browser build remains important for development, automated smoke testing and rapid verification. It should not automatically be described as the primary shipping experience.

### Other platforms

macOS, Linux, console and mobile support are **not implied commitments** by the current architecture. Any additional platform requires an explicit product decision, compatibility assessment and acceptance plan.

## One application runtime

The current direction intentionally keeps desktop and browser development on the same built TypeScript application and simulation.

Conceptually:

```text
TypeScript source
→ production build in dist/
→ local browser-native ESM application
   ├─ browser development/smoke host
   └─ Electron Windows host
```

The Electron main process does not become a second simulation implementation.

## Current core toolchain

The root README and engineering standards are authoritative for exact versions. Current accepted stack includes:

- Node.js 22;
- TypeScript 5.8.3 with strict ES-module configuration;
- Node built-in test runner with TypeScript strip-types;
- ESLint and Prettier;
- PixiJS 8.20.1 / WebGL;
- Electron 44;
- `clipper2-ts` for cadastral geometry operations;
- Python Playwright + Chromium for compiled smoke tests;
- deterministic atlas generation/validation.

Use the committed lockfile and `npm ci` for reproducible dependency installation.

## Canonical verification

`npm run verify` is the main repository gate. The root README documents the current command set.

A release-quality change should keep applicable gates green, including:

- formatting;
- lint/static policy;
- architecture policy;
- strict typechecking;
- tests;
- asset validation;
- production build;
- relevant browser/visual smoke tests.

## Build artifacts

Generated `dist/` output is a build product, not an alternative source of truth.

The production build also prepares required local runtime dependencies/assets such as the pinned PixiJS ESM module and deterministic atlases.

Runtime startup should avoid CDN dependence for core application modules.

## Desktop security boundary

The Electron host should remain a narrow local shell.

Current direction:

- load local application content;
- Node integration disabled for renderer content;
- context isolation enabled;
- sandbox enabled;
- unexpected navigation/window creation denied;
- no generic unrestricted IPC surface.

Any future native integration should expose the smallest typed surface required rather than granting arbitrary filesystem/process access to game UI code.

## Versioning

Civic Foundry has several relevant version concepts:

### Save version

Controls persistence schema compatibility. Current default is Save V9.

A release does not need a new save version unless authoritative persisted schema/semantics require it.

### Game/version label

Current Save V9 uses `gameVersion: '0.9.0-urban-fabric'` in the accepted persistence envelope.

Future release-semver/product naming should be coordinated with actual shipped milestones rather than aspirational roadmap phase numbers alone.

### Data/content version

As data-driven content expands, stable IDs and schema compatibility may require their own validation/version strategy without forcing a save format bump for every balance edit.

## Save compatibility as a release requirement

A build that cannot correctly load supported prior saves is not release-ready unless the project explicitly announces a compatibility break.

Release validation should include:

- loading current save version;
- migration from supported previous fixtures;
- save/load round-trip;
- deterministic continuation;
- corruption rejection;
- missing/invalid reference handling.

## Performance release gates

A release candidate should be tested on defined representative hardware and city sizes.

Track separately:

- simulation time/cadence cost;
- memory;
- save/load cost;
- GPU/render frame time;
- startup/build issues;
- long-run stability.

A smooth empty map is not sufficient performance evidence.

## Packaging expectations — Target maturation

As the desktop product approaches distributable builds, define explicit packaging for:

- application executable/installer;
- local runtime assets;
- save directories;
- crash/log locations;
- version metadata;
- clean update/uninstall behavior;
- code signing if used;
- platform-specific dependencies.

Do not scatter platform paths through simulation domains. Keep platform services behind narrow application/host boundaries.

## Release channels — Target

A practical future release process may distinguish:

- developer/local builds;
- automated CI artifacts;
- internal/playtest builds;
- public alpha/beta;
- stable releases.

Each channel should have clear expectations for save compatibility and telemetry/debug behavior.

## Logging and crash diagnostics

Release builds need enough deterministic diagnostic information to reproduce serious simulation defects without exposing unnecessary user information.

Useful diagnostic context may include:

- game/build version;
- save version;
- deterministic seed/command checkpoint where appropriate;
- system/invariant failure;
- platform/GPU basics;
- stack trace.

Diagnostic logging must not alter authoritative simulation ordering.

## Distribution and online dependencies

The core city simulation should remain local-first unless a future feature explicitly requires online services.

Do not introduce always-online dependencies merely for implementation convenience. If cloud saves, workshop/mod distribution, multiplayer or telemetry are pursued, each requires a separate product/security/privacy design.

## Release completion rule

A feature being merged is not equivalent to a product release. A releasable build requires coherent gameplay state, validated saves, stable controls/presentation, performance, packaging and regression evidence across the supported production environment.