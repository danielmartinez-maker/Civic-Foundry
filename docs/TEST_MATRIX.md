# Civic Foundry Test Matrix

This matrix is the canonical map from repository contracts to local commands and CI evidence. The single permanent workflow is `.github/workflows/ci.yml`.

## Verification tiers

- **Tier 1 — Fast:** `npm run verify:fast`. Portable inner-loop gate. It does not require Chromium or the Python rasterizer runtime.
- **Tier 2 — Full portable:** `npm run verify:full`. Runs the complete portable repository acceptance contract, including build and browser/visual smoke tests. It requires the Python packages and Chromium installed by CI.
- **Tier 3 — Platform / infrastructure:** Windows packaging or launch checks, GitHub branch/ruleset administration, and any future GPU/native checks that genuinely cannot run in the portable Linux/browser environment.

`npm run verify` remains a compatibility command for existing branches and plans. It runs Tier 1 plus deterministic asset-source validation and the production build. New completion evidence should use `verify:full` when the required browser runtime is available.

## Suite matrix

| Suite | Command | CI job / step | Runtime class | Required? | Platform | Owner domain |
| --- | --- | --- | --- | --- | --- | --- |
| Formatting | `npm run format:check` | `acceptance` / Fast verification | Fast | Yes | Portable | Repository |
| ESLint | `npm run lint` | `acceptance` / Fast verification | Fast | Yes | Portable | Repository / TypeScript |
| Repository policy | `npm run policy:check` | `acceptance` / Fast verification | Fast | Yes | Portable | Repository |
| Architecture firewall | `npm run architecture:check` | `acceptance` / Fast verification | Fast | Yes | Portable | Architecture |
| Production TypeScript | `npm run typecheck` | `acceptance` / Fast verification | Fast | Yes | Portable | Production TypeScript |
| Test TypeScript | `npm run typecheck:tests` | `acceptance` / Fast verification | Fast | Yes | Portable | Test architecture |
| Node unit/integration/invariant/persistence tests | `npm test` | `acceptance` / Fast verification | Fast/medium | Yes | Portable | All simulation domains |
| Asset repository policy | `npm run assets:policy` | `acceptance` / Fast verification | Fast | Yes | Portable | Assets / repository |
| Deterministic atlas source validation | `npm run assets:check` | `acceptance` / Asset source validation | Medium | Yes | Portable + Python/Pillow | Assets |
| Production build | `npm run build` | `acceptance` / Production build | Medium | Yes | Portable | Build / presentation |
| Phase 6 browser smoke | `npm run test:smoke` | `acceptance` / Portable browser and visual acceptance | Browser | Yes | Chromium | Gameplay integration |
| Phase 7 browser smoke | `npm run test:smoke:phase7` | `acceptance` / Portable browser and visual acceptance | Browser | Yes | Chromium | Housing / land compatibility |
| Urban Fabric browser smoke | `npm run test:smoke:urban-fabric` | `acceptance` / Portable browser and visual acceptance | Browser | Yes | Chromium | Cadastre / Save V9 |
| Isometric interaction smoke | `npm run test:smoke:isometric` | `acceptance` / Portable browser and visual acceptance | Browser | Yes | Chromium | Presentation |
| Isometric visual smoke | `python tests/smoke/isometric_visual_smoke.py` | `acceptance` / Portable browser and visual acceptance | Visual | Yes | Chromium | Presentation |
| Portable smoke aggregate | `npm run test:smoke:portable` | `acceptance` / Portable browser and visual acceptance | Browser/visual | Yes | Chromium | Cross-domain |
| Full portable acceptance | `npm run verify:full` | CI is deliberately decomposed into the same constituent gates | Full | Yes for completion | Portable + Chromium | Repository-wide |
| Windows desktop launch/package | documented release check | Not in Linux CI | Platform | Release-dependent | Windows | Desktop host |
| Prism native/Rust | branch-specific until native workspace reaches `main` | Active Prism branch CI | Platform/native | Stack-specific | Native toolchain | Prism mirror |

## Test classes in the Node suite

The `tests/*.test.ts` collection contains multiple architectural classes even though they share the Node runner:

- unit tests;
- invariants and conservation tests;
- deterministic replay/continuation tests;
- persistence and migration tests;
- compatibility-oracle tests;
- cross-domain integration tests;
- architecture and repository-policy tests;
- asset-pipeline contract tests;
- performance contracts where a deterministic budget is part of acceptance.

Browser and visual tests remain separate because they validate compiled/runtime integration that Node-only tests cannot prove.

## Local prerequisites for Tier 2

Install JavaScript dependencies from the lockfile:

```bash
npm ci
```

Install the same Python browser/runtime dependencies used by CI:

```bash
python -m pip install playwright==1.55.0 Pillow==11.3.0
python -m playwright install chromium
```

On Linux CI, `python -m playwright install --with-deps chromium` also installs runner system dependencies. A normal developer machine should use the platform-appropriate Playwright installation documented by Playwright if Chromium dependencies are missing.

## Failure ownership

A failing required gate is evidence against the exact commit under test. Do not bypass or reclassify a failure as infrastructure without specific evidence. The workflow preserves `test-artifacts/` for seven days on failed acceptance runs when those artifacts exist.
