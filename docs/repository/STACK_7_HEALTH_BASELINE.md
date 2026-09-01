# Stack 7 Repository Health Baseline

**Captured:** 2026-08-31
**Repository:** `danielmartinez-maker/Civic-Foundry`
**Canonical baseline:** `main@6e1b98704635c1c66927453f458cdc6b4ad6877b`
**Baseline CI:** GitHub Actions run `33446753769` — success
**Repository API size signal:** 3216 KiB
**Gameplay authority changes in this baseline:** none
**Save V9 changes in this baseline:** none

This document is the machine-reviewable safety baseline required before Stack 7 performs any destructive repository cleanup. It records current repository state; it does not claim that old branches are safe to delete merely because their names look temporary.

## Health scorecard

| Area | Current State | Risk | Target State |
|---|---|---|---|
| Main branch safety | `main` reports `protected: false`; repository rulesets list is empty | High | PR-only merges with required acceptance checks and no force push |
| PR hygiene | 20 open PRs, including active stacks, old design/forward-port work, and explicitly disposable verification PRs | High | Every PR classified with an explicit action |
| Branch hygiene | 176 remote branches including `main`; large Phase 0B profiling/gate tail | High | Active/baseline/history retained; deletion only after proof |
| CI reliability | One canonical `ci.yml`; latest `main` run green | Medium | One canonical workflow with cheap checks first and exact-head evidence |
| Local/CI parity | `npm run verify` omits all browser/visual smokes | High | `verify:fast` + portable `verify:full` |
| Type safety | Production `src/**/*.ts` typechecked; tests excluded | Medium | Separate test TypeScript project |
| Test architecture | Node tests + multiple Python browser/visual smokes; no permanent matrix | Medium | Documented suite/command/platform matrix |
| Dependency health | Lockfile v3; direct runtime deps are `clipper2-ts@2.0.1-18`, `pixi.js@8.20.1`; dev toolchain pinned | Low/Medium | Audited direct usage, lockfile preserved |
| Security posture | Desktop hardening documented; main protection absent | High | Source policy + documented/admin protection contract |
| Repository size | API size 3216 KiB; binary/source asset policy exists but generated-output policy is narrow | Medium | Explicit generated/large-file policy |
| Generated artifacts | `dist`/runtime outputs intended to be generated; ignore policy currently minimal | Medium | Deterministic forbidden-artifact checks |
| Dead code | No destructive dead-code pass has been proven safe in Stack 7 baseline | Medium | Candidates classified, category-1 only removed |
| Documentation truthfulness | Strong authority docs, but local/CI command contract is stale/incomplete | Medium | Canonical commands and test matrix aligned with CI |
| Cross-platform tooling | Windows desktop target, Linux CI, Python smoke tooling | Medium | Portable checks separated from platform-only gates |
| Developer onboarding | README/CONTRIBUTING/docs exist; commands are fragmented | Medium | One documented verification route |

## Canonical workflow and command baseline

Current permanent workflow count on `main`: **1** (`.github/workflows/ci.yml`).

Current CI sequence:

1. checkout;
2. Node 22 setup with npm cache;
3. `npm ci --ignore-scripts --no-audit --no-fund`;
4. install `playwright==1.55.0` and `Pillow==11.3.0`, then Chromium;
5. `npm run verify`;
6. Phase 6 smoke;
7. Phase 7 smoke;
8. Urban Fabric smoke;
9. Isometric Pass A browser smoke;
10. Isometric visual smoke.

Current `npm run verify` performs format, lint, repository policy, architecture policy, production typecheck, Node tests, asset policy/check, and build. It does **not** run browser or visual smokes.

Latest `main` CI observed: run `33446753769`, start `2026-08-31T22:33:26Z`, completion `2026-08-31T22:37:25Z`, approximately **3m59s**, conclusion **success**.

## TypeScript baseline

`tsconfig.json` includes only `src/**/*.ts`. Tests execute through Node 22 strip-types but are not part of the production TypeScript project. The lockfile currently contains `@types/node@24.13.3` transitively, so a separate test project can use Node APIs without changing the lockfile.

## Direct dependency baseline

| Package | Kind | Version | Baseline disposition |
|---|---|---:|---|
| `clipper2-ts` | runtime | `2.0.1-18` | retain; geometry dependency |
| `pixi.js` | runtime | `8.20.1` | retain; production renderer |
| `@eslint/js` | dev | `10.0.1` | retain |
| `electron` | dev | `44.0.0` | retain; Windows desktop host |
| `eslint` | dev | `10.9.0` | retain |
| `prettier` | dev | `3.9.6` | retain |
| `typescript` | dev | `5.8.3` | retain |
| `typescript-eslint` | dev | `8.67.0` | retain |

No dependency upgrade is required to implement Stack 7. Major upgrades are explicitly out of scope.

## Rust / Prism baseline

No `Cargo.toml` is present on current `main`. Prism Rust/native work exists on active Prism branches and must not be treated as current `main` authority. Stack 7 therefore does not add, remove, or transfer Prism authority.

## Open PR classification

| PR | Purpose | Canonical Stack/Phase | Classification | Required action |
|---|---|---|---|---|
| #114 | Stack 3 3D presentation/assets | Stack 3 | Active implementation | Preserve draft; do not merge without authorization |
| #106 | Prism P2A world/cadastre mirror | Prism | Active implementation | Preserve; non-authoritative mirror |
| #110 | Trip-demand conservation RED/GREEN fix | Bug-fix tranche | Active implementation | Preserve |
| #109 | Freight conservation RED/GREEN fix | Bug-fix tranche | Active implementation | Preserve |
| #104 | Cadastral-integrity tranche | Bug-fix tranche | Active implementation | Preserve |
| #103 | Specialized GPU overlays | Older presentation program | Superseded semantic donor | Preserve until Stack 3 donor review completes, then owner decision |
| #99 | GPU retained scene | Older presentation program | Superseded semantic donor | Preserve until Stack 3 donor review completes, then owner decision |
| #88 | 3R-B intersection control | Transportation 3R | Active design / blocked by roadmap reconciliation | Preserve; retarget/reclassify before implementation |
| #97 | Disposable main→Phase0B sync | Phase 0B | Historical / should be closed | Close after this baseline; do not merge to `main` |
| #91 | Isometric B1 | Older presentation program | Superseded semantic donor | Preserve until Stack 3 donor review completes |
| #96 | Isometric B2 | Older presentation program | Superseded semantic donor | Preserve until Stack 3 donor review completes |
| #72 | Personhood incorrectly labeled Phase 3R | Human simulation / roadmap conflict | Should be renamed/reclassified; blocked | Preserve code/history; do not merge under 3R label |
| #89 | Phase 0B forward-port | Phase 0B | Historical / superseded | Preserve until EntityRegistry owner decision |
| #20 | Original Phase 0B entity registry | Phase 0B | Historical / superseded | Preserve until forward-port history is settled |
| #41 | Old Semantic Urban Depth B1 | Pre-accepted Urban Fabric history | Historical / superseded | Preserve as evidence; no merge |
| #77 | Disposable patch runner | Phase 0B | Historical / should be closed | Close; body explicitly says do not merge |
| #75 | Disposable profiler | Phase 0B | Historical / should be closed | Close; body explicitly says do not merge |
| #71 | Personhood implementation plan | Human simulation | Historical design/plan | Preserve; roadmap owner decision |
| #69 | Full Individual Sim roadmap | Human simulation | Active design / roadmap proposal | Preserve; design-only |
| #59 | Disposable GREEN gate | Phase 0B | Historical / should be closed | Close; body explicitly says do not merge |
| #16 | Temporary Phase 0A browser smoke | Phase 0A | Historical / should be closed | Close; explicitly temporary/not for merge |
| #14 | Phase 8A utility networks | Legacy roadmap numbering | Historical / blocked | Preserve; must be reconciled with canonical roadmap before reuse |

> Search returned 22 open PR records in the current repository state. The explicit table above includes all records returned during Stack 7 inventory; the repository's open-issue count also includes non-PR issues and may differ.

## Remote branch classification

The remote branch inventory contains 176 branches including `main`. The exact branch list is classified below. No branch is deleted by this baseline.

### Active implementation

- `feature/stack-3-3d-presentation-asset-scaleup`
- `feature/prism-p2a`
- `fix/cadastral-integrity-tranche-1`
- `fix/conservation-state-loss`
- `fix/trip-demand-conservation`
- `feature/transportation-engine-3r-b-intersection-control`
- `civic-2.0-3r-b-intersection-control`

### Active design

- `design/full-individual-sim-roadmap`
- `design/prism-engine-v5.1`
- `design/windows-desktop-babylon-migration`
- `design/3d-presentation-asset-program`
- `civic-2.0-phase-0b-design`
- `civic-2.0-phase-0c-design-handoff`
- `plan/phase-3r-personhood-core`
- `plan/phase-3r-personhood-core-final`
- `plan/phase-3r-personhood-core-final2`
- `plan/phase-3r-personhood-core-final3`
- `plan/phase-3r-personhood-core-real`
- `plan/phase-3r-personhood-core-real2`
- `plan/phase-3r-personhood-core-v2`
- `plan/phase-3r-personhood-core-v3`
- `plan/phase-3r-personhood-core-v4`
- `plan/phase-3r-personhood-core-v5`
- `plan/phase-3r-v9-restack`
- `plan/phase-3r-v9-restack-final`
- `plan/phase-3r-v9-restack-final2`
- `plan/phase-3r-v9-restack-final3`
- `plan/phase-3r-v9-restack-final4`
- `plan/phase-3r-v9-restack-final5`
- `plan/phase-3r-v9-restack-final6`
- `plan/phase-3r-v9-restack-final7`
- `plan/phase-3r-v9-restack-final8`
- `plan/phase-3r-v9-restack-final9`
- `plan/phase-3r-v9-restack-final10`
- `plan/phase-3r-v9-restack-final11`
- `plan/phase-3r-v9-restack-final12`
- `plan/phase-3r-v9-restack-final13`

These repeated Personhood plan branches are preserved but should be collapsed only after an owner selects the canonical plan.

### Accepted baseline required by an active stack

- `feature/3d-runtime-foundation-house-a`
- `feature/gpu-parity-retained-scene`
- `feature/gpu-specialized-overlay-parity`
- `feature/isometric-pass-a`
- `feature/isometric-pass-b1-urban-depth`
- `feature/isometric-pass-b2-public-realm`
- `feature/prism-p0`
- `feature/prism-p1`
- `design/urban-depth-b1`
- `feature/urban-depth-b1`

### Historical archive / explicit backup

- `archive/phase-3r-personhood-core-pre-v9`
- `backup/isometric-pass-b1-pre-main-restack-20260827`
- `backup/phase-0b-forward-port-pre-main-sync-20260827`
- `backup/3r-b-pre-urban-fabric-restack-20260827`
- `restack/isometric-pass-b1-main-20260827`
- `restack/3r-b-urban-fabric-v10-20260827`

### Merged and candidate for safe deletion after merge/dependency proof

- `chore/engineering-baseline-v1`
- `feat/1r-world-foundation-2`
- `feature/desktop-gpu-runtime`
- `feature/urban-fabric-2.0`
- `fix/stack-0-authoritative-state-stabilization`
- `docs/civic-foundry-wiki`
- `docs/civic-foundry-knowledge-base`

Stack 7 records these as candidates; it does not delete them without a dedicated merged/reference check.

### Superseded / disposable verification families

All of the following are preserved as historical evidence for now and are candidates for cleanup only after PR/reference checks:

- `civic-2.0-phase-0a-inline`
- `civic-2.0-phase-0b-forward-port`
- `civic-2.0-phase-0b-inline`
- `integration/b1-uf-941a9d5-verify`
- `integration/b1-uf-941a9d5-verify-2`
- `integration/b1-uf-941a9d5-verify-3`
- `integration/b1-uf-941a9d5-verify-4`
- `integration/b1-uf-941a9d5-verify-5`
- `integration/b1-uf-941a9d5-verify-6`
- `integration/b1-uf-941a9d5-verify-7`
- `integration/b1-uf-941a9d5-verify-9`
- `integration/n3-phase0b-main-clean`
- `phase0a-browser-smoke`
- `phase0a-perf-post`
- `phase0a-perf-pre`
- `verify-phase0a-browser-smoke`
- `phase0b-current-profile`
- `phase0b-current-profile2`
- `phase0b-global-revision-fastpath-red`
- `phase0b-green-focus`
- `phase0b-incremental-integrity-green-gate`
- `phase0b-incremental-integrity-red`
- `phase0b-integrity-profile`
- `phase0b-integrity-profile2`
- `phase0b-layer-profile`
- `phase0b-method-profile`
- `phase0b-optimized-method-profile`
- `phase0b-outer-noop-patch-runner`
- `phase0b-outer-noop-red`
- `phase0b-partition-index-apply`
- `phase0b-partition-index-red`
- `phase0b-perf-anchor-rerun`
- `phase0b-perf-base-anchor`
- `phase0b-perf-paired-optimized`
- `phase0b-perf-paired-runner`
- `phase0b-perf-paired-source-delta`
- `phase0b-perf-post`
- `phase0b-perf-post2`
- `phase0b-perf-post3`
- `phase0b-perf-post-rerun`
- `phase0b-perf-pre`
- `phase0b-perf-profile`
- `phase0b-record-green`
- `phase0b-record-red`
- `phase0b-record-red2`
- `phase0b-red-focus`
- `phase0b-reference-delta-red`
- `phase0b-source-delta-cycle-a-gate`
- `phase0b-source-delta-cycle-b-gate`
- `phase0b-source-delta-profile`
- `phase0b-task1-green-gate`
- `phase0b-task2-green-gate`
- `phase0b-task2-green-gate2`
- `phase0b-task2-red-gate`
- `phase0b-task3-green-gate`
- `phase0b-task3-red-gate`
- `phase0b-task4-green-gate`
- `phase0b-task4-red-gate`
- `phase0b-task5-green-gate`
- `phase0b-task5-red-gate`
- `phase0b-task6-green-gate`
- `phase0b-task6-red-gate`
- `phase0b-top-level-revision-red`
- `phase0b-top-level-revision-red2`
- `phase0b-top-revision-apply`
- `phase0b-traffic-identity-green-gate`
- `phase0b-traffic-identity-perf`
- `phase0b-traffic-identity-red`
- `phase0b-validation-fastpath-profile`
- `phase0b-validation-fastpath-profile2`
- `phase0b-validation-fastpath-red`
- `sync/main-into-phase-0b-forward-port`
- `sync/main-into-phase-0b-forward-port-clean`
- `sync/main-into-phase-0b-forward-port-exact`
- `sync/main-into-phase-0b-forward-port-final`
- `sync/main-into-phase-0b-forward-port-final-final`
- `sync/main-into-phase-0b-forward-port-last`
- `sync/main-into-phase-0b-forward-port-merge`
- `sync/main-into-phase-0b-forward-port-merge-main`
- `sync/main-into-phase-0b-forward-port-one`
- `sync/main-into-phase-0b-forward-port-pr`
- `sync/main-into-phase-0b-forward-port-use-this`
- `sync/phase0b-reconcile-v4`
- `sync/phase0b-reconcile-v5`
- `temp/phase-0b-ci-base`
- `temp/phase-0b-delta-index-green`
- `temp/phase-0b-delta-index-red`
- `temp/14r-a-final-verify`
- `temp/14r-a-final-verify-2`

### Historical implementation branches retained pending owner decision

- `civic-2.0-3r-a-network-semantics`
- `feature/developer-pro-forma`
- `feature/phase7-housing-market`
- `feature/phase-3r-personhood-core`
- `feature/14r-a-multimodal-foundation`
- `fix/comprehensive-audit-2026-08-24`
- `fix/naming-consistency-pass`
- `fix/stale-repository-state-20260827`
- `phase4-final-audit`
- `phase4-public-services`
- `phase5-publish-staging`
- `phase6-execution`
- `phase6-plan-staging`
- `phase6-source-export`
- `phase7-housing-choice-redevelopment`
- `phase7-housing-development-policy-controls`
- `phase7-land-housing-intelligence-ui`
- `phase7-land-housing-intelligence-ui-red`
- `phase7-land-housing-market`
- `phase7-redevelopment-execution`
- `phase7-tenure-relocation`
- `phase8a-utility-networks`
- `sync/main-into-urban-fabric-2.0`
- `sync/urban-fabric-lock`

### Unknown — requires owner decision

- `metropolitan-era`
- `rebuild-phase3`

## Protection baseline

GitHub currently reports:

- `main.protected = false`;
- protection enforcement off;
- repository rulesets = `[]`.

Stack 7 must not report main protection as enabled until a fresh API read proves it.

## Safety statement

This baseline makes no gameplay, simulation, Save V9, rendering, transportation, economy, world, cadastre, or Prism authority change.
