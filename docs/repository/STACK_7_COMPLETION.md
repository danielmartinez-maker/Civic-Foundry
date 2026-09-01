# Stack 7 Completion Record

**Repository:** `danielmartinez-maker/Civic-Foundry`
**Baseline:** `main@6e1b98704635c1c66927453f458cdc6b4ad6877b`
**Accepted implementation head:** `f63984e20dcb8b1812df4bdda18ca3dc648924b9`
**Accepted implementation workflow:** GitHub Actions run `33471579071`
**Pull request:** #115 — `Stack 7 — Repository Health & Hygiene`
**Integration state:** draft and unmerged pending explicit authorization

## Delivered

Stack 7 completed the repository-engineering work defined by the approved plan without changing Civic Foundry runtime authority or gameplay semantics.

### Repository inventory and hygiene

- Captured the pre-change repository-health baseline and branch/PR inventory.
- Classified active implementation, design, accepted donor/baseline, historical, superseded, deletable-candidate, backup, and unknown branch/PR families conservatively.
- Closed five pull requests whose own descriptions explicitly identified them as temporary, disposable, or not intended for merge: #97, #77, #75, #59, and #16.
- Preserved every associated remote branch and all uncertain/history-bearing refs.
- Recorded the separately occurring closure of PR #114 without attributing that action to Stack 7.
- Added purpose-first branch naming guidance and destructive-cleanup rules.

### Generated-output and large-file policy

- Expanded repository policy from source-content checks to tracked-file hygiene.
- Rejects tracked generated/cache output such as `dist/`, Rust `target/`, `node_modules/`, coverage data, browser/test artifacts, and common Python caches.
- Adds a 5 MiB tracked-binary threshold for selected binary extensions.
- Preserves the existing stricter asset policy that rejects raw raster/audio/video/3D-model sources under `assets/`.
- Expanded `.gitignore` / `.prettierignore` coverage for generated and cache outputs.

### Formatting governance

- Replaced the hand-maintained formatting file list with `scripts/format-changed.mjs`.
- Managed TypeScript, JavaScript, JSON, YAML, and Markdown surfaces are evaluated from the comparison base.
- Existing repository-wide formatting debt is grandfathered only when the base file was already non-normalized; new formatting regressions fail.
- This avoids a high-conflict whitespace rewrite of hundreds of untouched legacy files while preventing new unmanaged formatting drift.

### TypeScript and tests

- Added `tsconfig.tests.json` so tests compile under the production strictness contract.
- Added `npm run typecheck:tests` to the fast gate.
- Repaired strict test-fixture/type errors without changing production source or weakening compiler options.
- Preserved Node strip-types executable tests while adding compile-time test coverage.

### Verification contract

- Added `verify:fast` for deterministic static/unit/repository checks.
- Kept `verify` backward-compatible as the core gate plus deterministic assets/build.
- Added `verify:full` for the complete local acceptance stack, including browser/visual smokes.
- Consolidated permanent GitHub Actions acceptance into one canonical workflow/job with explicit tiers:
  1. dependency install;
  2. fast verification;
  3. high-severity dependency audit;
  4. browser/runtime setup;
  5. deterministic asset validation;
  6. production build;
  7. browser and visual acceptance;
  8. failure-artifact preservation.

### Dependency and dead-code audits

- Documented direct dependency ownership and exact pinning.
- Added `npm audit --audit-level=high` as an explicit CI gate.
- Avoided dependency upgrades without defect/security evidence.
- Documented dead-code candidates conservatively; no source deletion was performed merely because a path appears old or currently unreferenced.

## Authority firewall

The accepted implementation diff contains no production files under `src/`.

Stack 7 did not change:

- Save V9 schema, version, migration, or ownership;
- `WorldFoundation` authority;
- `CadastralGraph` authority;
- transportation, economy, service, or personhood simulation authority;
- presentation authority;
- Prism authority;
- runtime dependency versions or `package-lock.json`.

All implementation changes are repository tooling, CI/configuration, documentation, or test-fixture strictness repairs.

## TDD and verification evidence

### RED

The repository-hygiene policy contracts were committed before their implementation. RED head `f6890871ed2d0a7801bf8c48389b845489a903c1` failed Core verification as expected, with downstream browser/visual gates skipped.

### GREEN implementation acceptance

Exact implementation head `f63984e20dcb8b1812df4bdda18ca3dc648924b9` passed GitHub Actions run `33471579071` with every acceptance step successful:

- checkout;
- Node 22 setup;
- dependency install;
- fast verification;
- high-severity dependency audit;
- Playwright/Pillow/Chromium setup;
- deterministic asset-source validation;
- production build;
- complete browser and visual acceptance;
- failure-artifact step.

This is the accepted implementation evidence. Any documentation-only reconciliation commit after this record must receive its own exact-head CI result before the final branch is described as green.

## Repository cleanup result

Stack 7 closed PRs #97, #77, #75, #59, and #16 and deleted no remote branches.

At the time of this completion record, 17 pull requests remain open, including Stack 7 PR #115. Active, donor/baseline, historical, and uncertain work remains preserved for owner review rather than being deleted based on age or naming alone.

## Remaining administrative blocker

`main` remains unprotected and the repository still has no GitHub rulesets. The target policy is documented in `docs/repository/MAIN_BRANCH_PROTECTION.md`.

The GitHub write surface available during Stack 7 does not expose branch-protection/ruleset administration, so this control cannot be enabled safely from the current execution environment. Stack 7 records this as an explicit administrative follow-up instead of claiming protection exists.

## Before / after scorecard

| Area | Before Stack 7 | After Stack 7 |
| --- | --- | --- |
| Test TypeScript | Production project only | Separate strict test TS project in the fast gate |
| Repository policy | Source-content checks | Source checks + tracked-output/cache + large-binary checks |
| Formatting | Hand-maintained file list; broad legacy debt | Incremental managed-file gate with explicit grandfathering |
| CI | One workflow but split implicit core/smoke contract | One explicit acceptance pipeline with fast, audit, build, browser/visual tiers |
| Supply-chain check | No explicit high-severity audit gate | `npm audit --audit-level=high` in CI |
| PR clutter | 22 open before Stack 7 | Five explicitly disposable PRs closed; 17 currently open including #115 |
| Remote-branch cleanup | Large mixed-purpose branch inventory | Classified conservatively; zero destructive branch deletions |
| Runtime authority | Save V9 / current simulation authority | Unchanged; no `src/` diff |
| `main` protection | Unprotected; no rulesets | Still administrative blocker; target policy documented |

## Integration state

PR #115 remains draft and unmerged. Stack 7 must not be merged to `main` without explicit authorization and a green exact-head reconciliation gate.
