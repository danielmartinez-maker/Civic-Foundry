# Stack 7 Repository Health & Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Civic Foundry easier and safer to verify, maintain, and extend without changing gameplay, Save V9, rendering authority, transportation authority, economy authority, cadastre authority, or Prism authority.

**Architecture:** Treat repository health as a first-class acceptance layer around the existing runtime. Preserve the single canonical CI workflow, add explicit fast/full verification tiers, typecheck tests separately from production, strengthen deterministic repository-policy checks, and document branch/PR/test ownership rather than deleting uncertain history. Administrative protection remains evidence-backed and separate from source changes.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Node test runner, ESLint 10, Prettier 3, Python/Playwright/Pillow smoke tooling, GitHub Actions, Electron 44, PixiJS 8.

**Spec:** `STACK_7_REPOSITORY_HEALTH_AND_HYGIENE(1).md` (user-provided execution specification)

## Global Constraints

- Start from actual current `main` at `6e1b98704635c1c66927453f458cdc6b4ad6877b`.
- Repository engineering only; gameplay and simulation semantics remain unchanged.
- Save V9 (`saveVersion: 9`, `gameVersion: 0.9.0-urban-fabric`) remains unchanged.
- No authority transfer to Prism.
- No test, policy, architecture, asset, browser-smoke, or visual-smoke weakening.
- Preserve Windows desktop, Linux CI, browser development, TypeScript, Python smoke, and current Electron toolchains.
- No destructive branch cleanup without proof and classification.
- Keep every cleanup change independently reversible.

---

### Task 1: Commit the repository-health baseline

**Files:**
- Create: `docs/repository/STACK_7_HEALTH_BASELINE.md`

**Interfaces:**
- Consumes: current GitHub branch/PR/workflow/ruleset inventory and current repository scripts/configuration.
- Produces: the committed baseline required before any destructive cleanup.

- [ ] Record current main SHA, branch count, open PR inventory, workflow inventory, protection/ruleset state, package scripts, TypeScript boundaries, dependency baseline, generated-artifact policy, and repository-size signal.
- [ ] Classify every open PR and branch family conservatively; use `Unknown — requires owner decision` where proof is incomplete.
- [ ] Include a health scorecard and explicit non-authority statement.
- [ ] Commit baseline before closing or deleting anything.

### Task 2: Add test-compilation and verification-tier contracts

**Files:**
- Create: `tsconfig.tests.json`
- Modify: `package.json`
- Test: existing full test tree under `tests/*.test.ts`

**Interfaces:**
- Produces: `npm run typecheck:tests`, `npm run verify:fast`, `npm run verify:full`, and one composite portable smoke command.

- [ ] Add `tsconfig.tests.json` extending production compiler settings, including `tests/**/*.ts` and `scripts/**/*.mjs` only where TypeScript needs imported declarations, excluding `dist`, generated artifacts, and runtime outputs, with `noEmit`.
- [ ] Add `typecheck:tests` without changing production `typecheck`.
- [ ] Define `verify:fast` as deterministic static/unit feedback.
- [ ] Keep `verify` as a compatibility alias to the fast gate so existing branches do not break unexpectedly.
- [ ] Define `test:smoke:portable` for Phase 6, Phase 7, Urban Fabric, isometric interaction, and visual smoke.
- [ ] Define `verify:full` as fast gate + production build + portable smoke suite.

### Task 3: Make formatting coverage explicit and maintainable

**Files:**
- Modify: `package.json`
- Modify: `.prettierignore`

**Interfaces:**
- Produces: deterministic `format`/`format:check` across maintained text sources without formatting generated assets or build output.

- [ ] Replace hand-picked formatting paths with explicit maintained globs for TypeScript, JavaScript/MJS, JSON, Markdown, YAML, and GitHub workflow files.
- [ ] Expand `.prettierignore` for generated/runtime/build outputs and machine evidence where formatting would be inappropriate.
- [ ] Keep Python unformatted unless/until the project intentionally adopts a Python formatter.

### Task 4: Strengthen repository policy with contract-first tests

**Files:**
- Modify: `tests/repository_policy.test.ts`
- Modify: `scripts/repository-policy.mjs`

**Interfaces:**
- Produces: deterministic policy failures for forbidden generated directories/files, accidental large binaries, temporary evidence, and unauthorized save-version ownership patterns.

- [ ] Write failing tests for forbidden repository paths and file-size policy helpers.
- [ ] Add pure policy helpers that classify paths and sizes without filesystem side effects.
- [ ] Walk maintained repository roots deterministically and reject forbidden generated/cache/temp artifacts.
- [ ] Reject oversized newly tracked binaries outside approved asset/source/runtime policy locations.
- [ ] Preserve existing source-safety checks (`eval`, `Function`, `debugger`, interpolation guard).
- [ ] Keep save-version checks narrow enough to avoid false positives in tests/docs; do not alter save semantics.

### Task 5: Reconcile canonical CI with the local/full contract

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `verify:fast` and `verify:full`.
- Produces: one canonical CI workflow with cheap deterministic failures first and expensive browser evidence second.

- [ ] Keep one permanent CI workflow.
- [ ] Run `npm run verify:fast` before installing browser runtime.
- [ ] Install Playwright/Pillow only after fast checks pass.
- [ ] Run portable build/smoke acceptance through the same commands documented for developers.
- [ ] Preserve all existing browser/visual coverage.
- [ ] Upload smoke/visual diagnostic artifacts on failure if the existing tests generate them in stable paths.

### Task 6: Create the permanent test matrix and engineering workflow docs

**Files:**
- Create: `docs/TEST_MATRIX.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/ENGINEERING_STANDARDS.md`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Produces: canonical onboarding, branch naming, verification tiers, platform boundaries, authority reminders, and suite ownership.

- [ ] Document install, fast verify, full portable verify, build, browser run, desktop run, and smoke commands.
- [ ] Document test matrix columns: Suite, Command, CI Job/Step, Runtime Class, Required, Platform, Owner Domain.
- [ ] Document branch naming and explicit rule against misleading legacy phase labels.
- [ ] Re-state authority map: WorldFoundation, CadastralGraph, Save V9, transitional transportation, presentation-only renderer, non-authoritative Prism mirror.
- [ ] Document the administrative `main` protection settings required if the API cannot configure them.

### Task 7: Classify branch/PR hygiene without unsafe deletion

**Files:**
- Create: `docs/repository/BRANCH_PR_CLASSIFICATION.md`

**Interfaces:**
- Produces: the Stack 7 branch/PR action matrix and a conservative cleanup boundary.

- [ ] Classify every open PR explicitly.
- [ ] Classify all remote branches by exact branch or defensible branch family.
- [ ] Mark clearly disposable temporary PRs as `should be closed` only when their own description says they are disposable/do-not-merge.
- [ ] Do not delete remote branches where open PR dependencies, historical evidence, or active stacked bases remain.
- [ ] Record which merged branches are candidates for later deletion after owner review.

### Task 8: Final audit, CI evidence, and completion report

**Files:**
- Create: `docs/repository/STACK_7_COMPLETION.md`

**Interfaces:**
- Produces: before/after scorecard and exact-head evidence.

- [ ] Run/obtain exact-head CI for the Stack 7 branch.
- [ ] Verify `npm run verify:fast`, test typecheck, production typecheck, build, browser smokes, visual smoke, asset checks, architecture policy, and repository policy through canonical CI.
- [ ] Record workflow/job result and exact head SHA.
- [ ] Record repository-size impact from the source diff; do not invent clone-history savings.
- [ ] Record protection status as enabled only if verified; otherwise document the administrative blocker.
- [ ] State explicitly: gameplay semantics changed = NO; Save V9 changed = NO; authority changed = NO.
