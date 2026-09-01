# Civic Foundry

Civic Foundry is a systems-heavy city, metropolitan, and regional simulation built around deterministic authoritative state and inspectable causal systems. The production presentation target is GPU-rendered Windows desktop play; the browser build remains a development and smoke-test target.

Start with the [Civic Foundry Wiki](docs/wiki/Home.md) for product orientation. Canonical technical authority remains current code plus fresh verification evidence, this README, `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, accepted ADRs, and the current-state/domain documentation linked from `docs/README.md`.

## Current runtime

The current accepted runtime is progressive rather than a clean-slate rewrite:

```text
Electron desktop host
  → GameApp
    → SimulationCore facade
      → SimulationKernel
      → WorldFoundation
      → CadastralGraph
      → Urban Fabric systems
      → transitional gameplay domains
    → GpuWorldRenderer
      → PixiJS / WebGL
```

Current milestone status:

- Phase 0A — deterministic kernel foundation: **Implemented**
- 1R — World Foundation 2.0: **Implemented**
- 2R — Urban Fabric 2.0: **Implemented**
- Desktop GPU runtime: **Implemented**
- 3R — Transportation Engine 2.0: **Target / next major authority replacement**

The default persistence envelope remains:

```text
saveVersion: 9
gameVersion: 0.9.0-urban-fabric
```

Stack-specific designs, plans, and feature branches do not become current authority until their acceptance and migration gates pass.

## Authority map

Civic Foundry uses one authoritative owner per fact.

- `WorldFoundation` is the sole physical/geographic authority for terrain, geography, hydrology, and related physical-world state.
- `CadastralGraph` is the canonical legal-land authority for parcels, topology, frontage/access, easements, ownership identity, and lineage.
- `LotSystem` is a derived compatibility facade for inherited cell-based consumers; it is not a second land authority.
- Canonical Urban Fabric building state is represented by `BuildingV2`; inherited building records remain only where compatibility still requires them.
- Save V9 is the current accepted Urban Fabric persistence envelope.
- Current transportation, transit, economy, housing, services, utilities, tax, and treasury systems remain playable through compatibility seams where their deeper 2.0 replacements have not yet earned authority.
- `GpuWorldRenderer` is presentation-only. It reads authoritative state and cannot manufacture simulation outcomes or save facts.
- Electron owns window/application hosting, not simulation state.
- Prism is an architectural target/mirror program until a reviewed migration explicitly transfers authority; there is no current repository-level authoritative `PrismEngine` object on `main`.

See `docs/ARCHITECTURE.md`, `docs/SAVE_FORMAT.md`, and the current roadmap/contributor documentation for the complete ownership model.

## Implemented foundations

### World Foundation 2.0

The accepted 1R foundation includes deterministic physical geography, irregular administrative geometry, engineering terrain/soils, namespaced RNG streams, hydrology/drainage, flood simulation, spatial indexing, terrain-aware costs, compatibility projection, and Save V8 migration support.

### Urban Fabric 2.0

The accepted 2R foundation includes canonical cadastral parcels/topology, dimensional parcel zoning, buildable envelopes, mixed-use `BuildingV2`, lifecycle/condition, development economics and property state, parcel split/assembly/right-of-way/easement mutation, cross-domain cadastral transactions, diagnostics, and Save V9.

### Desktop GPU runtime

The production `GameApp` world path uses PixiJS 8 with WebGL and the existing isometric camera contract. Electron hosts the same local `dist/` application used by browser development. Node integration is disabled in the renderer context, context isolation and sandboxing are enabled, and unexpected navigation/window creation is denied.

Legacy Canvas2D presentation sources can remain as migration references where active stacks still depend on their semantics, but they are not the production world-rendering authority.

## Transitional gameplay baseline

The preserved playable layer currently includes treasury/taxation, roads and pathfinding, traffic, transit, firms/freight, housing/relocation, utilities, public services, incidents, municipal budgets, and related compatibility systems.

These systems must remain playable until their replacements pass parity, determinism, persistence, performance, and player-facing acceptance gates. Repository cleanup must not remove a compatibility seam merely because a future replacement exists.

## Toolchain

The repository baseline uses:

- Node.js 22;
- TypeScript 5.8.3 with strict production settings;
- a separate no-emit test TypeScript project;
- Node's built-in test runner with TypeScript strip-types;
- ESLint 10 plus TypeScript ESLint;
- Prettier 3 for changed TypeScript/JavaScript/JSON/YAML files;
- deterministic Markdown whitespace/final-newline formatting without audit-table reflow;
- `clipper2-ts` behind controlled cadastral geometry boundaries;
- PixiJS 8.20.1;
- Electron 44;
- Python Playwright 1.55.0 + Chromium for browser smoke testing;
- Pillow 11.3.0 for deterministic visual/asset tooling.

Install JavaScript dependencies from the committed lockfile:

```bash
npm ci
```

## Canonical verification

### Tier 1 — fast inner loop

```bash
npm run verify:fast
```

Covers changed-file formatting, lint, repository policy, architecture policy, production TypeScript, test TypeScript, Node tests, and asset repository policy.

### Compatibility core gate

```bash
npm run verify
```

Retained for existing branches/plans. It runs the fast tier plus deterministic asset-source validation and the production build.

### Tier 2 — full portable acceptance

Install the browser runtime when needed:

```bash
python -m pip install playwright==1.55.0 Pillow==11.3.0
python -m playwright install chromium
```

Then run:

```bash
npm run verify:full
```

This adds the complete portable browser/visual acceptance stack. CI runs the same constituent commands and installs Linux browser dependencies with Playwright's `--with-deps` option.

### Supply-chain audit

```bash
npm run security:audit
```

This network-backed npm audit is separate from the fast offline-capable tier and runs in canonical CI before expensive browser setup.

### Common focused commands

```bash
npm test
npm run typecheck
npm run typecheck:tests
npm run lint
npm run policy:check
npm run architecture:check
npm run format:check
npm run assets:policy
npm run assets:check
npm run build
npm run test:smoke
npm run test:smoke:phase7
npm run test:smoke:urban-fabric
npm run test:smoke:isometric
npm run test:smoke:portable
npm run dev
npm run desktop
```

The permanent suite/command/platform ownership map is `docs/TEST_MATRIX.md`.

## Build and run

`npm run build` compiles the application into `dist/`, copies pinned local browser runtime dependencies, and generates deterministic atlases. `npm run dev` serves the compiled browser build on port 5173. `npm run desktop` performs a production build and launches the local build inside the hardened Electron desktop host.

Generated output belongs outside version control. Repository policy and `.gitignore` cover `dist/`, Rust `target/`, coverage, Playwright reports, test artifacts, common caches, and temporary outputs. The existing asset policy remains stricter for source/runtime asset binaries.

## Repository engineering policy

- `main` is the canonical integration branch.
- New work uses purpose-first branch names such as `feature/...`, `fix/...`, `design/...`, `docs/...`, `chore/...`, or `archive/...`.
- Do not reuse a historical phase number when it conflicts with the canonical roadmap.
- Draft PRs are never merged without explicit authorization.
- Branches and compatibility paths are not deleted merely because they look old; dependency/integration/history evidence is required first.
- Generated output and oversized tracked binaries are rejected by repository policy.
- Dependency upgrades are isolated when they could alter runtime behavior.
- Formatting is incremental to avoid whitespace-only conflict storms across active stacked branches.
- Tests and repository/tooling contracts use observed RED → minimal GREEN → broader verification.

The target `main` protection settings are documented in `docs/repository/MAIN_BRANCH_PROTECTION.md`. GitHub administrative protection is separate from repository source and must be verified live before it is described as enabled.

## Documentation map

- `CONTRIBUTING.md` — contributor workflow and merge safety
- `docs/ENGINEERING_STANDARDS.md` — repository-wide engineering rules
- `docs/TEST_MATRIX.md` — canonical suite/command/platform matrix
- `docs/TESTING.md` — test architecture and current acceptance details
- `docs/ARCHITECTURE.md` — runtime ownership and dependency architecture
- `docs/SAVE_FORMAT.md` — persistence authority and migrations
- `docs/repository/STACK_7_HEALTH_BASELINE.md` — repository-health baseline
- `docs/repository/BRANCH_PR_CLASSIFICATION.md` — branch/PR classification and cleanup boundary
- `docs/repository/MAIN_BRANCH_PROTECTION.md` — required GitHub protection settings
- `docs/adr/` — accepted architecture decisions

## Roadmap

The near-term sequence remains:

1. Phase 0A — Kernel Skeleton & Deterministic Scheduling — **Implemented**
2. 1R — World Foundation 2.0 — **Implemented**
3. 2R — Urban Fabric 2.0 — **Implemented**
4. Desktop GPU Runtime — **Implemented**
5. 3R — Transportation Engine 2.0 — **Target**
6. Later Civic Foundry 2.0 systems proceed through progressive replacement rather than automatic roadmap-to-runtime promotion.

A detailed future specification is design evidence, not implementation evidence. Use **Implemented**, **Transitional**, and **Target** precisely.
