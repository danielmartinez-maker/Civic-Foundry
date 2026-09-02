from __future__ import annotations

import mimetypes
import pathlib
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"


def route_asset(route, request):
    parsed = urlparse(request.url)
    rel = parsed.path.lstrip("/") or "index.html"
    path = (DIST / rel).resolve()
    if DIST.resolve() not in path.parents and path != DIST.resolve():
        route.abort()
        return
    if not path.is_file():
        route.fulfill(status=404, body="not found")
        return
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    route.fulfill(status=200, body=path.read_bytes(), headers={"Content-Type": content_type})


def main() -> None:
    if not (DIST / "src/main.js").is_file():
        raise RuntimeError("dist build missing; run npm run build first")

    html = (DIST / "index.html").read_text().replace(
        "<head>", '<head><base href="http://civic.test/">', 1
    )
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on(
            "console",
            lambda message: errors.append(f"console: {message.text}")
            if message.type == "error"
            else None,
        )
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicRuntime && !!window.__civicApp")

        result = page.evaluate(
            """
            async () => {
              if (typeof window.__restartCivicRuntime !== 'function') {
                throw new Error('missing Stack 8 runtime restart hook');
              }

              const observations = [];
              for (let iteration = 0; iteration < 4; iteration += 1) {
                const previousRuntime = window.__civicRuntime;
                const previousApp = window.__civicApp;
                await previousApp.renderer.preloadAssets();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                const beforeMetrics = previousApp.core.diagnostics.snapshot().performance;
                observations.push({
                  shellCount: document.querySelectorAll('.game-shell').length,
                  canvasCount: document.querySelectorAll('#world').length,
                  rendererRebuildCalls: beforeMetrics['renderer.reconstruct-world']?.calls ?? 0,
                  rendererAssetCalls: beforeMetrics['renderer.asset-initialize']?.calls ?? 0,
                });

                const nextRuntime = await window.__restartCivicRuntime();
                if (nextRuntime === previousRuntime) throw new Error('runtime identity was reused');
                if (window.__civicApp === previousApp) throw new Error('app identity was reused');
                if (window.__civicRuntime !== nextRuntime) throw new Error('runtime global was not refreshed');
                await window.__civicApp.renderer.preloadAssets();
              }

              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const finalMetrics = window.__civicApp.core.diagnostics.snapshot().performance;
              return {
                observations,
                finalShellCount: document.querySelectorAll('.game-shell').length,
                finalCanvasCount: document.querySelectorAll('#world').length,
                finalRendererRebuildCalls: finalMetrics['renderer.reconstruct-world']?.calls ?? 0,
                finalRendererAssetCalls: finalMetrics['renderer.asset-initialize']?.calls ?? 0,
                finalFaulted: window.__civicApp.core.diagnostics.snapshot().simulation.faulted,
              };
            }
            """
        )

        for observation in result["observations"]:
            assert observation["shellCount"] == 1
            assert observation["canvasCount"] == 1
            assert observation["rendererRebuildCalls"] > 0
            assert observation["rendererAssetCalls"] > 0
        assert result["finalShellCount"] == 1
        assert result["finalCanvasCount"] == 1
        assert result["finalRendererRebuildCalls"] > 0
        assert result["finalRendererAssetCalls"] > 0
        assert result["finalFaulted"] is False
        assert not errors, "\n".join(errors)
        browser.close()


if __name__ == "__main__":
    main()
