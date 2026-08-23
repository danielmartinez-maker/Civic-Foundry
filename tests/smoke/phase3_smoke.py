from __future__ import annotations

import json
import mimetypes
import pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
SCREENSHOT = pathlib.Path("/tmp/civic-foundry-phase3-rebuild-smoke.png")


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

    html = (DIST / "index.html").read_text()
    html = html.replace("<head>", '<head><base href="http://civic.test/">', 1)

    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        assert page.locator("h1").inner_text() == "CIVIC FOUNDRY"
        assert "PHASE III" in page.locator(".eyebrow").inner_text()

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width = 40, height = 24;
          const cells = Array.from({length: width * height}, () => ({elevation: 0.5, water: false, buildable: true, biome: 'grass'}));
          app.core = new SimulationCore({terrain: new TerrainGrid(width, height, cells), seed: 2026, startingFunds: 750000});

          app.tools.setTool('road-collector');
          const road = Array.from({length: 34}, (_, i) => ({x: i + 2, y: 12}));
          const roadResult = app.tools.applyPath(app.core, road);
          if (!roadResult.ok) throw new Error(`road: ${roadResult.reason}`);

          app.tools.setTool('zone-residential');
          for (let x = 3; x <= 12; x++) if (!app.tools.applyCell(app.core, x, 11).ok) throw new Error(`residential ${x}`);
          app.tools.setTool('zone-commercial');
          for (let x = 24; x <= 28; x++) if (!app.tools.applyCell(app.core, x, 11).ok) throw new Error(`commercial ${x}`);
          app.tools.setTool('zone-industrial');
          for (let x = 29; x <= 33; x++) if (!app.tools.applyCell(app.core, x, 11).ok) throw new Error(`industrial ${x}`);

          for (const [tool, coords] of [
            ['power', [[5,13],[8,13],[11,13]]],
            ['water', [[14,13],[17,13],[20,13]]],
            ['landfill', [[23,13],[26,13],[29,13]]],
          ]) {
            app.tools.setTool(tool);
            for (const [x,y] of coords) {
              const result = app.tools.applyCell(app.core, x, y);
              if (!result.ok) throw new Error(`${tool} ${x},${y}: ${result.reason}`);
            }
          }

          app.core.taxes.setRate('residential', 0.12);
          app.core.taxes.setRate('commercial', 0.12);
          app.core.taxes.setRate('industrial', 0.12);
          app.core.step(250);
          for (let i = 0; i < 40 && app.core.traffic.activeVehicles.length === 0; i++) app.core.step(10);
          app.core.clock.setSpeed(0);
          return {
            roads: app.core.roads.list().length,
            buildings: app.core.buildings.occupied().length,
            population: app.core.population.population,
            vehicles: app.core.traffic.activeVehicles.length,
            completed: app.core.traffic.completedTrips,
            power: app.core.utilitySnapshot.power.serviceRatio,
            water: app.core.utilitySnapshot.water.serviceRatio,
            garbage: app.core.garbageSnapshot.serviceRatio,
            saveVersion: 3,
          };
        }
        """)
        assert setup["roads"] == 34
        assert setup["buildings"] >= 10
        assert setup["population"] > 0
        assert setup["vehicles"] > 0 or setup["completed"] > 0
        assert setup["power"] == 1 and setup["water"] == 1 and setup["garbage"] == 1

        page.wait_for_timeout(100)
        hud_population = page.locator('[data-hud="population"]').inner_text()
        assert hud_population not in ("—", "0")

        page.locator('[data-testid="traffic-overlay"]').select_option("congestion")
        assert "Congestion:" in page.locator("#overlay-legend").inner_text()

        saved = page.evaluate("""
        () => {
          const c = window.__civicApp.core;
          return {tick:c.clock.tick, roads:c.roads.list().length, population:c.population.population, vehicles:c.traffic.activeVehicles.length, tax:c.taxes.getRate('residential')};
        }
        """)
        page.locator('[data-testid="save"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Saved V3')")

        mutated = page.evaluate("""
        () => {
          const app = window.__civicApp;
          const result = app.core.bulldozeAt(18, 12);
          app.core.step(2);
          return {ok:result.ok, roads:app.core.roads.list().length};
        }
        """)
        assert mutated["ok"] is True
        assert mutated["roads"] == saved["roads"] - 1

        page.locator('[data-testid="load"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Loaded V3')")
        restored = page.evaluate("""
        () => {
          const c = window.__civicApp.core;
          return {tick:c.clock.tick, roads:c.roads.list().length, population:c.population.population, vehicles:c.traffic.activeVehicles.length, tax:c.taxes.getRate('residential')};
        }
        """)
        assert restored == saved

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        assert SCREENSHOT.is_file() and SCREENSHOT.stat().st_size > 20_000
        browser.close()

    if errors:
        raise AssertionError("browser page errors: " + json.dumps(errors))
    print("PHASE3_SMOKE_PASS", json.dumps({"setup": setup, "saved": saved, "restored": restored, "screenshot": str(SCREENSHOT)}))


if __name__ == "__main__":
    main()
