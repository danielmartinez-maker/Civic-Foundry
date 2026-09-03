# Civic Foundry C++ Rewrite — TypeScript Inventory Baseline

**Status:** Frozen rewrite scope baseline
**Repository:** `danielmartinez-maker/Civic-Foundry`
**Branch:** `main`
**Baseline commit:** `61581c200b23337ca6abbe45234cbd22c9d86568`
**Manifest:** `docs/cpp/TS_REWRITE_INVENTORY_BASELINE.txt`
**Manifest SHA-256:** `35f0be46cf4659cf2e509f5971e842b679af3d32bc368e1097d4c6bcf9ceb5ef`

## Purpose

This file freezes the tracked TypeScript-family surface that the C++ rewrite must account for. It is a migration-control artifact only and does not transfer gameplay authority.

## Inclusion rule

The manifest is the sorted output of tracked Git paths matching `*.ts`, `*.tsx`, and `*.d.ts`. Tracked files are included regardless of whether they are production source, tests, support code, compatibility code, declarations, or legacy code.

## Generation command

```powershell
git ls-files '*.ts' '*.tsx' '*.d.ts' | Sort-Object
```

## Baseline counts

| Bucket | Count |
|---|---:|
| All tracked `.ts/.tsx/.d.ts` | 326 |
| `src/` | 190 |
| `tests/` | 135 |
| `.d.ts` declarations | 1 |

At this baseline, the checked-in native declaration `cpp/bindings/napi/civic_native.d.ts` is part of the rewrite/removal scope.

## Authority rule

This inventory does not imply that TypeScript authority is removed. Existing TypeScript owners remain authoritative until their native replacements pass the required parity, determinism, persistence, invariant, performance, and acceptance gates.

## Downstream control stacks

- `C002` assigns every manifest path to a target native owner, test owner, status, parity classification, and cutover dependency.
- `C003` adds a monotonic CI guard so the tracked TypeScript count cannot increase during migration.
- `X001–X010` perform final TypeScript eradication and require the tracked TypeScript-family manifest to reach zero.

## Regeneration rule

Regeneration changes this frozen baseline only when the migration-control specification explicitly calls for rebasing it. Normal rewrite progress must update the live ledger/CI count rather than rewriting history.
