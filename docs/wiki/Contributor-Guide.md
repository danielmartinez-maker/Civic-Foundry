# Contributor Guide

[← Wiki Home](Home.md)

## Source-of-truth hierarchy

When documentation disagrees, prefer:

1. accepted current code plus fresh verification evidence;
2. root `README.md`, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, accepted ADRs;
3. current-state and authority documentation;
4. explanatory game documentation;
5. active approved phase specification;
6. implementation plans;
7. superseded specifications and development logs.

A detailed design document does not prove implementation.

## Before changing the project

1. Read the root README.
2. Read the current architecture.
3. Read the save format if authoritative state is affected.
4. Read the relevant domain manual/specification.
5. Inspect the real source files and tests.
6. Identify the authoritative owner and compatibility seams.
7. Determine required verification commands.

Use **Implemented**, **Transitional**, and **Target** precisely.

## Architecture rules

Do not create a second terrain authority, second legal parcel authority, renderer-owned simulation fact, UI-owned history, duplicate property ownership, incompatible ID space, or hidden mutation outside domain boundaries.

Prefer focused modules, explicit interfaces, composition, stable names, deterministic operations, data-driven validated content, and a strict presentation/simulation boundary.

## Verification

The canonical general gate is:

```bash
npm run verify
```

Useful commands include:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run policy:check
npm run architecture:check
npm run format:check
npm run assets:policy
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
npm run dev
npm run desktop
```

Presentation changes may require browser/isometric/visual smoke suites beyond the core verify command.

## Testing expectations

Material behavior changes should use deterministic fixtures, invariants, integration chains, save/load continuation, migration fixtures, fuzz/property tests for topology/transactions, and performance gates where scale matters.

Do not claim tests passed without fresh output.

## Documentation maintenance

Update docs in the same tranche when runtime truth changes. Authority changes update architecture/authority maps; save changes update persistence/migration docs; phase completion updates roadmap/current-state docs; presentation changes update rendering/art docs; player-facing mechanics update the game/player manual.

Prefer links to canonical technical authority over copying low-level specification into many files.