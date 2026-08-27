# Engineering Baseline v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible, cross-platform, enforceable TypeScript repository baseline for Civic Foundry without changing gameplay, persistence, rendering semantics, or system authority.

**Architecture:** Keep the current domain-oriented repository structure and add enforcement around it rather than reorganizing gameplay code. Tooling is local and pinned, build orchestration moves to Node ESM, architecture rules are checked by a focused repository verifier, and CI delegates its core gates to one `npm run verify` contract before the existing browser/visual smoke suites.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, ESLint 9, `typescript-eslint`, Prettier 3, Node built-in test runner, GitHub Actions, Python/Playwright asset and browser smoke tooling.

**Spec:** `docs/superpowers/specs/2026-08-26-engineering-baseline-v1-design.md`

## Global Constraints

- Preserve `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.
- Do not change simulation outcomes, save schemas, canonical IDs, rendering semantics, or authority boundaries.
- Do not introduce TypeScript path aliases in this tranche.
- Keep existing browser-native ESM output.
- Keep deterministic `assets/source/*.svg` contract files and generated atlases under `dist/`.
- Do not invent CODEOWNERS personnel or GitHub teams.
- Keep browser/visual smoke suites as CI stages after the core `verify` command.

---

### Task 1: Reproducible local TypeScript/tooling baseline

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `.npmrc`
- Test: command-level package install/typecheck verification

**Interfaces:**
- Consumes: existing npm scripts and Node 22 CI runtime.
- Produces: locally pinned `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, and deterministic `npm ci` installation.

- [ ] **Step 1: Add pinned development dependencies to `package.json`**

Use exact versions and keep runtime `dependencies` unchanged:

```json
"devDependencies": {
  "@eslint/js": "9.34.0",
  "eslint": "9.34.0",
  "prettier": "3.6.2",
  "typescript": "5.8.3",
  "typescript-eslint": "8.41.0"
}
```

- [ ] **Step 2: Add deterministic npm configuration**

Create `.npmrc`:

```ini
save-exact=true
fund=false
audit=false
```

- [ ] **Step 3: Generate and commit `package-lock.json`**

Run:

```bash
npm install --ignore-scripts
```

Expected: lockfile v3 generated with the exact package versions above.

- [ ] **Step 4: Verify reproducible clean install**

Run:

```bash
rm -rf node_modules
npm ci --ignore-scripts
npx tsc --version
```

Expected: install succeeds and TypeScript reports `Version 5.8.3`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .npmrc
git commit -m "chore: pin engineering toolchain"
```

### Task 2: ESLint and Prettier enforcement

**Files:**
- Create: `eslint.config.mjs`
- Create: `.prettierignore`
- Modify: `package.json`
- Modify: `scripts/lint.mjs`
- Test: `tests/repository_policy.test.ts`

**Interfaces:**
- Consumes: TypeScript files under `src/` and `tests/`.
- Produces: `npm run lint`, `npm run format`, `npm run format:check`, and `npm run policy:check`.

- [ ] **Step 1: Write a failing repository-policy test**

Create `tests/repository_policy.test.ts` with a test that imports a new exported policy function and proves source text containing `eval(` is rejected:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSourcePolicy } from '../scripts/repository-policy.mjs';

test('repository policy rejects eval', () => {
  const failures = inspectSourcePolicy('src/example.ts', 'eval("1 + 1")');
  assert.ok(failures.some((failure) => failure.includes('eval is prohibited')));
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/repository_policy.test.ts
```

Expected: FAIL because `scripts/repository-policy.mjs` does not exist.

- [ ] **Step 3: Extract Civic Foundry-specific checks into `scripts/repository-policy.mjs`**

Move the existing source-scanning behavior out of `scripts/lint.mjs` into an exported function:

```js
export function inspectSourcePolicy(display, source) {
  const failures = [];
  if (/\bdebugger\s*;/.test(source)) failures.push(`${display}: debugger statement`);
  if (/\beval\s*\(/.test(source)) failures.push(`${display}: eval is prohibited`);
  if (/\bnew\s+Function\s*\(/.test(source)) failures.push(`${display}: Function constructor is prohibited`);
  const rawUserInterpolation = /\$\{\s*(?:line\.name|inspection\.title)\s*\}/;
  if (display === 'src/app/GameApp.ts' && rawUserInterpolation.test(source)) {
    failures.push(`${display}: user-controlled text must be escaped before HTML interpolation`);
  }
  return failures;
}
```

The executable portion recursively scans `src` and `tests`, applies `inspectSourcePolicy`, prints failures, and exits non-zero on violations.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run the same targeted Node test. Expected: PASS.

- [ ] **Step 5: Add flat ESLint config**

Create `eslint.config.mjs` using `@eslint/js` and `typescript-eslint`, targeting `src/**/*.ts` and `tests/**/*.ts`. Enable recommended TypeScript rules without requiring type-aware parser services. Explicitly enforce:

```js
'no-debugger': 'error',
'no-eval': 'error',
'no-new-func': 'error',
'prefer-const': 'error',
'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
'@typescript-eslint/no-explicit-any': 'warn'
```

Ignore `dist/**`, `node_modules/**`, `.worktrees/**`, and `test-artifacts/**`.

- [ ] **Step 6: Add Prettier config through package defaults**

Create `.prettierignore`:

```text
dist/
node_modules/
.worktrees/
test-artifacts/
assets/source/
```

Add scripts:

```json
"lint": "eslint src tests",
"policy:check": "node scripts/repository-policy.mjs",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

Delete the obsolete `scripts/lint.mjs` after its Civic-specific logic is preserved in `repository-policy.mjs`.

- [ ] **Step 7: Run formatting and lint gates**

Run:

```bash
npm run format
npm run format:check
npm run lint
npm run policy:check
```

Expected: all pass.

- [ ] **Step 8: Run repository tests**

Run `npm test`. Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add eslint.config.mjs .prettierignore package.json scripts tests package-lock.json
git commit -m "chore: enforce typescript style and policy"
```

### Task 3: Architectural dependency verifier

**Files:**
- Create: `scripts/check-architecture.mjs`
- Create: `tests/architecture_policy.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: relative TypeScript import specifiers and the repository domain paths.
- Produces: `checkArchitectureImport(importer, imported)` and `npm run architecture:check`.

- [ ] **Step 1: Write failing architecture tests**

Create tests for these cases:

```ts
assert.equal(checkArchitectureImport('src/simulation/A.ts', 'src/ui/B.ts')?.rule, 'simulation-no-ui');
assert.equal(checkArchitectureImport('src/world/A.ts', 'src/rendering/B.ts')?.rule, 'world-no-rendering');
assert.equal(checkArchitectureImport('src/rendering/A.ts', 'src/ui/B.ts')?.rule, 'rendering-no-ui');
assert.equal(checkArchitectureImport('src/app/A.ts', 'src/simulation/B.ts'), null);
```

- [ ] **Step 2: Verify RED**

Run the targeted test and confirm it fails because the architecture module is missing.

- [ ] **Step 3: Implement rule evaluation**

Export:

```js
export function checkArchitectureImport(importer, imported) {
  // Return null when allowed, otherwise { rule, importer, imported }.
}
```

Implement these exact initial rules:

- simulation → app/ui/rendering forbidden;
- world → app/ui/rendering forbidden;
- save → app/ui forbidden;
- data → app/ui forbidden;
- rendering → app/ui forbidden.

- [ ] **Step 4: Verify GREEN for rule tests**

Run targeted test. Expected: PASS.

- [ ] **Step 5: Add repository scanner**

Walk `src/**/*.ts`, parse static `import` / `export ... from` relative specifiers with a conservative regex, resolve against the importer using `node:path`, normalize `.js`/`.ts` extensions, and report each violation as:

```text
src/simulation/Foo.ts -> src/ui/Bar.ts violates simulation-no-ui
```

Dynamic imports are scanned only when the specifier is a string literal.

- [ ] **Step 6: Add npm script and run against repository**

Add:

```json
"architecture:check": "node scripts/check-architecture.mjs"
```

Run it. If pre-existing violations appear, do not restructure broad gameplay code in this tranche. Add the narrowest explicit documented exception only when the dependency is an existing compatibility seam and create a follow-up issue for removal.

- [ ] **Step 7: Run all tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-architecture.mjs tests/architecture_policy.test.ts package.json package-lock.json
git commit -m "test: enforce architecture boundaries"
```

### Task 4: Cross-platform production build orchestration

**Files:**
- Create: `scripts/build.mjs`
- Create: `tests/build_script.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `index.html`, `src/styles.css`, TypeScript compiler output, `clipper2-ts`, and the Python atlas renderer.
- Produces: the same `dist/` browser artifact layout as the current build script.

- [ ] **Step 1: Write failing build helper test**

Design `scripts/build.mjs` so its filesystem helpers are exported and the CLI is guarded by `if (import.meta.url === pathToFileURL(process.argv[1]).href)`. Test `prepareDist(tempRoot)` creates an empty `dist` directory after removing stale content.

- [ ] **Step 2: Verify RED**

Run targeted test. Expected: FAIL because `scripts/build.mjs` does not exist.

- [ ] **Step 3: Implement `prepareDist` and static-copy helpers**

Use `rm(path, { recursive: true, force: true })`, `mkdir(..., { recursive: true })`, and `copyFile` from `node:fs/promises`. No shell-specific file commands are allowed.

- [ ] **Step 4: Verify helper GREEN**

Run targeted test. Expected: PASS.

- [ ] **Step 5: Implement CLI orchestration**

Use `spawn` with `shell: false` to run:

1. local `tsc -p tsconfig.json` via the platform-specific executable under `node_modules/.bin`;
2. static file copies;
3. Clipper2 browser module copy to `dist/vendor/clipper2.min.mjs`;
4. `python tools/render_isometric_atlases.py` using `python` on Windows and `python3` fallback logic where required.

A failed child command exits non-zero and identifies the failed stage.

- [ ] **Step 6: Replace `build` npm script**

Set:

```json
"build": "node scripts/build.mjs"
```

- [ ] **Step 7: Run production build and smoke-neutral checks**

Run:

```bash
npm run build
npm test
npm run typecheck
```

Expected: PASS and existing dist layout preserved.

- [ ] **Step 8: Commit**

```bash
git add scripts/build.mjs tests/build_script.test.ts package.json package-lock.json
git commit -m "build: make production build cross platform"
```

### Task 5: Repository hygiene and binary asset policy

**Files:**
- Modify: `.gitignore`
- Create: `.gitattributes`
- Create: `scripts/check-assets.mjs`
- Create: `tests/asset_policy.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: tracked repository paths.
- Produces: `isForbiddenAssetPath(path)` and `npm run assets:policy`.

- [ ] **Step 1: Write failing asset-policy tests**

Cover:

```ts
assert.equal(isForbiddenAssetPath('assets/source/terrain.svg'), false);
assert.equal(isForbiddenAssetPath('assets/raw/terrain.png'), true);
assert.equal(isForbiddenAssetPath('assets/raw/music.wav'), true);
assert.equal(isForbiddenAssetPath('tests/fixtures/sample.png'), false);
```

- [ ] **Step 2: Verify RED**

Run targeted test. Expected: missing module failure.

- [ ] **Step 3: Implement asset policy**

Reject raw binary extensions under `assets/` (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.wav`, `.mp3`, `.ogg`, `.flac`, `.mp4`, `.mov`, `.fbx`, `.glb`, `.gltf`, `.blend`, `.obj`) unless the path is an explicitly documented fixture directory. Keep `.svg` deterministic source contracts legal.

The CLI obtains tracked paths from `git ls-files`, applies `isForbiddenAssetPath`, and exits non-zero with remediation text: generated output belongs in `dist/`; approved large binary sources require Git LFS and architectural review.

- [ ] **Step 4: Verify GREEN**

Run targeted test. Expected: PASS.

- [ ] **Step 5: Expand `.gitignore`**

Preserve existing entries and add common generated/editor/cache paths:

```text
coverage/
.tmp/
.cache/
.vscode/
.idea/
*.tsbuildinfo
Thumbs.db
```

Do not ignore `.github/`, docs, lockfiles, deterministic source contracts, or test fixtures.

- [ ] **Step 6: Add `.gitattributes`**

Normalize text:

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
```

Do not declare LFS patterns until an approved binary source actually exists.

- [ ] **Step 7: Add and run asset policy script**

Add:

```json
"assets:policy": "node scripts/check-assets.mjs"
```

Run `npm run assets:policy`. Expected: PASS for the existing deterministic source-contract pipeline.

- [ ] **Step 8: Commit**

```bash
git add .gitignore .gitattributes scripts/check-assets.mjs tests/asset_policy.test.ts package.json package-lock.json
git commit -m "chore: enforce repository asset hygiene"
```

### Task 6: Canonical verification command and CI cutover

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Tasks 1–5 scripts.
- Produces: `npm run verify` as the local/CI core gate.

- [ ] **Step 1: Add canonical verification script**

Set:

```json
"verify": "npm run format:check && npm run lint && npm run policy:check && npm run architecture:check && npm run typecheck && npm test && npm run assets:policy && npm run assets:check && npm run build"
```

- [ ] **Step 2: Run `npm run verify` locally**

Expected: PASS.

- [ ] **Step 3: Update CI dependency installation**

Replace project `npm install` plus global TypeScript installation with:

```yaml
- name: Install project dependencies
  run: npm ci --ignore-scripts --no-audit --no-fund
```

Remove the global TypeScript step.

- [ ] **Step 4: Replace duplicated core CI steps**

After Python/Playwright setup, run:

```yaml
- name: Core verification
  run: npm run verify
```

Keep all existing Phase 6/7, Urban Fabric, isometric browser, and visual smoke stages after that command.

- [ ] **Step 5: Review CI for command equivalence**

Confirm no existing smoke stage was removed and `verify` contains every former fast core gate plus formatting, policy, architecture, and asset-policy checks.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .github/workflows/ci.yml
git commit -m "ci: consolidate engineering verification"
```

### Task 7: Engineering documentation and ADR contract

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `docs/ENGINEERING_STANDARDS.md`
- Create: `docs/adr/README.md`
- Create: `docs/adr/0001-engineering-baseline.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the enforced scripts and policies from Tasks 1–6.
- Produces: contributor-facing repository contract aligned with actual automation.

- [ ] **Step 1: Write `CONTRIBUTING.md`**

Document Node 22, `npm ci`, branch naming, small Conventional Commits, issue/PR linkage, required `npm run verify`, review before merge, no direct gameplay-authority changes through presentation modules, and ADR requirement for significant architecture changes.

- [ ] **Step 2: Write engineering standards**

`docs/ENGINEERING_STANDARDS.md` must cover:

- domain-oriented modules and narrow public APIs;
- composition/data-driven design and explicit dependency passing;
- strict TypeScript and no new global mutable state;
- testing tiers and TDD;
- deterministic asset pipeline and raw binary policy;
- comments explaining rationale rather than restating code;
- performance profiling and allocation discipline;
- async loading/streaming guidance for future large assets;
- configurable logging/assertion severity expectations;
- system/domain ownership without fabricated names.

- [ ] **Step 3: Add ADR template/process**

`docs/adr/README.md` defines status, context, decision, consequences, and supersession rules. `0001-engineering-baseline.md` records why Civic Foundry uses a local pinned toolchain, browser-native ESM without path aliases, Node build orchestration, and architecture boundary checks.

- [ ] **Step 4: Update README developer commands**

Document at minimum:

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run lint
npm run verify
```

Link to `CONTRIBUTING.md`, engineering standards, architecture docs, testing docs, and ADRs.

- [ ] **Step 5: Run formatting and link/path sanity checks**

Run:

```bash
npm run format
npm run format:check
npm run verify
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md CONTRIBUTING.md docs
 git commit -m "docs: codify civic foundry engineering standards"
```

### Task 8: Final exact-head verification and review gate

**Files:**
- No production changes expected.
- Modify only defects revealed by verification, with a failing regression test first for behavioral/tooling defects.

**Interfaces:**
- Consumes: complete Engineering Baseline v1 branch.
- Produces: a review-ready exact head with evidence.

- [ ] **Step 1: Run core verification from a clean install**

```bash
rm -rf node_modules dist
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
```

Expected: PASS.

- [ ] **Step 2: Run all browser/visual smoke commands available in the repository**

Run the same commands named in `.github/workflows/ci.yml`, including the existing Phase 6/7, Urban Fabric, isometric browser, and visual smoke suites.

- [ ] **Step 3: Inspect the diff for behavior changes**

Confirm no changes to simulation algorithms, save schemas, canonical IDs, domain authority, asset manifest semantics, or renderer behavior.

- [ ] **Step 4: Open a draft PR to `main`**

PR summary must include the exact verification commands, state that runtime behavior is intentionally unchanged, identify the architecture/binary-policy checks, and state that merging requires explicit approval.

- [ ] **Step 5: Verify GitHub Actions exact head**

Wait for the PR's current-head CI result. If CI fails, diagnose the first failing gate, add a regression test when applicable, fix, and re-run until the exact head is green.

- [ ] **Step 6: Request code review**

Use the repository review workflow to inspect correctness, scope, standards alignment, and unintended behavior changes before declaring the tranche complete.
