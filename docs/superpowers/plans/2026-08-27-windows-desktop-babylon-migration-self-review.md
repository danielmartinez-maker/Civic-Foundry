# Windows Desktop + Babylon Migration — Final Plan Self-Review

This file is a mandatory execution companion to `2026-08-27-windows-desktop-babylon-migration.md`. It records the final mechanical corrections found after the plan was committed. The approved design is unchanged.

## 1. Task 4 `DesktopApp` snippet

Use `this.root`, not an unbound `root` identifier:

```ts
export class DesktopApp {
  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.root.innerHTML = desktopLayoutHtml();
    document.documentElement.dataset.desktopReady = 'true';
  }
}
```

The focused `desktop_layout.test.ts` plus `npm run typecheck` must pass before committing Task 4.

## 2. Task 22 inherited build/policy tests

The D4 removal task must explicitly update or delete tests whose only purpose was to enforce the retired static-browser/atlas build contract. Inventory at minimum:

- `tests/build_script.test.ts`
- `tests/asset_policy.test.ts`
- isometric/browser smoke tests under `tests/smoke/`

Keep repository/asset policy coverage, but rewrite it to require the desktop asset manifest/build contract rather than Python atlas generation. Do not leave tests disabled or skipped.

## 3. D4 package commands run on Windows

`electron-builder --win nsis`, packaged `.exe` smoke, D2 relaunch smoke against the packaged executable, and final NSIS assertions are Windows gates. Cross-platform developer runs may use the installed-Electron harness for D1/D2 interaction tests, but D4 package acceptance must execute on the Windows CI job/reference machine.

## 4. electron-vite custom entries are locked

Use the `build.rollupOptions.input` form already shown in Task 1. This matches electron-vite 5's documented customization path for nonstandard main/preload source locations. Do not change the repository layout merely to use electron-vite defaults.

## 5. Final self-review result

- No `TODO`/`TBD` implementation requirements remain.
- Save authority remains V9; no desktop-only Save V10 is introduced.
- Import file paths remain main-process-only.
- Presentation revision handles paused authoritative edits.
- Performance fixture `props` are part of the locked snapshot/delta interfaces.
- Rendering policy becomes canonical only after legacy Canvas code is removed, so no mergeable intermediate head is intentionally red.
- D0–D4 remain presentation/platform work; 3R authority is not pulled forward.
