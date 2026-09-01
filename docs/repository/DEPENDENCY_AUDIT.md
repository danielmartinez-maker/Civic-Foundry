# Stack 7 Dependency and Supply-Chain Audit

**Baseline:** `main@6e1b98704635c1c66927453f458cdc6b4ad6877b`

## Direct JavaScript dependencies

| Dependency | Version | Kind | Usage evidence | Stack 7 action |
| --- | --- | --- | --- | --- |
| `clipper2-ts` | `2.0.1-18` | runtime | imported by `src/world/cadastre/Geometry.ts`; copied by `scripts/build.mjs`; resolved by the browser import map | Retain |
| `pixi.js` | `8.20.1` | runtime | imported by `src/rendering/gpu/GpuWorldRenderer.ts`; copied by `scripts/build.mjs`; resolved by the browser import map | Retain |
| `@eslint/js` | `10.0.1` | dev | ESLint configuration/toolchain | Retain |
| `electron` | `44.0.0` | dev/runtime host | imported by `desktop/main.mjs`; required by `npm run desktop` and desktop runtime tests | Retain |
| `eslint` | `10.9.0` | dev | `npm run lint` / canonical fast gate | Retain |
| `prettier` | `3.9.6` | dev | imported by `scripts/format-changed.mjs`; changed-file formatting contract | Retain |
| `typescript` | `5.8.3` | dev | production and test compiler projects | Retain |
| `typescript-eslint` | `8.67.0` | dev | TypeScript ESLint integration | Retain |

No direct package dependency is removed or framework/runtime-upgraded by Stack 7. The lockfile is preserved unchanged.

## Test Node typings

`tsconfig.tests.json` uses the Node type package already installed by the current locked dependency graph. Stack 7 does not rewrite the lockfile merely to promote that transitive package into a new direct dependency. If the Electron/tooling dependency graph later stops providing Node typings, `@types/node` should be added explicitly in a dedicated lockfile change.

## Python tooling

Canonical CI pins:

- `playwright==1.55.0`;
- `Pillow==11.3.0`.

These remain CI/tooling dependencies rather than application runtime dependencies. Stack 7 does not introduce a new Python formatter or package-management layer.

## GitHub Actions

Canonical workflow actions are explicit stable versions:

- `actions/checkout@v7.0.1`;
- `actions/setup-node@v7.0.0`;
- `actions/upload-artifact@v6.0.0`.

Stack 7 upgraded `upload-artifact` from `v4.6.2` after the hosted runner reported that the old action targeted deprecated Node 20 compatibility. v6 uses Node 24 on current GitHub runners.

## Security audit

`npm run security:audit` runs:

```bash
npm audit --audit-level=high
```

It is network-backed and therefore remains separate from the offline-capable fast verification tier. Canonical CI executes it before expensive browser setup. Stack 7 reports the exact result from the final accepted head rather than applying automated dependency upgrades blindly.

## Licensing and reproducibility

Stack 7 does not identify a new licensing change because no package dependency is added or upgraded. Reproducibility continues to rely on:

- exact direct versions in `package.json`;
- committed lockfile v3;
- `npm ci` in CI and contributor instructions;
- pinned Python CI dependencies;
- explicit GitHub Action versions.

Any future major dependency upgrade should be isolated from gameplay/system changes unless a security issue makes the upgrade necessary.
