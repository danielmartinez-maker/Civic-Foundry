from __future__ import annotations

import json
import mimetypes
import pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
SCREENSHOT = pathlib.Path("/tmp/civic-foundry-phase4-smoke.png")


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
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        assert page.locator("h1").inner_text() == "CIVIC FOUNDRY"
        assert "PHASE IV" in page.locator(".eyebrow").inner_text()
        assert page.locator('[data-testid="save"]').inner_text() == "Save V4"

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width = 40, height = 24;
          const cells = Array.from({length: width * height}, () => ({elevation: 0.5, water: false, buildable: true, biome: 'grass'}));
          app.core = new SimulationCore({terrain: new TerrainGrid(width, height, cells), seed: 2026, startingFunds: 1500000});

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
            ['power', [[22,13],[25,13]]], ['water', [[28,13],[31,13]]],
            ['service-fire', [[4,13]]], ['service-police', [[7,13]]], ['service-clinic', [[10,13]]],
            ['service-school', [[13,13]]], ['service-landfill', [[16,13]]], ['service-recycling', [[19,13]]],
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
          app.core.step(450);
          const target = app.core.buildings.occupied().find((building) => building.zone === 'residential');
          if (!target) throw new Error('no occupied residential building');
          app.core.incidents.createIncident('fire', target, 0.85, app.core.clock.tick, app.core.serviceDispatch);
          for (let i = 0; i < 80 && !app.core.serviceVehicles.listVehicles().some((vehicle) => vehicle.state === 'outbound'); i++) app.core.step(1);
          app.core.clock.setSpeed(0);
          return {
            roads: app.core.roads.list().length,
            buildings: app.core.buildings.occupied().length,
            population: app.core.population.population,
            facilities: app.core.services.listFacilities().length,
            serviceVehicles: app.core.serviceVehicles.listVehicles().length,
            activeServiceVehicles: app.core.serviceVehicles.listVehicles().filter(v => !['idle','unavailable'].includes(v.state)).length,
            jobs: app.core.serviceDispatch.listJobs().length,
            serviceQuality: app.core.neighborhoodSnapshot.citywideServiceQuality,
            education: app.core.educationSnapshot.educationServiceRatio,
            waste: app.core.garbageSnapshot.backlog,
          };
        }
        """)
        assert setup["roads"] == 34
        assert setup["buildings"] >= 10
        assert setup["population"] > 0
        assert setup["facilities"] == 6
        assert setup["serviceVehicles"] >= 7
        assert setup["activeServiceVehicles"] > 0
        assert setup["jobs"] > 0
        assert 0 <= setup["serviceQuality"] <= 1
        assert 0 <= setup["education"] <= 1

        page.wait_for_timeout(100)
        assert page.locator('[data-hud="service"]').inner_text() not in ("—", "")
        assert page.locator('[data-hud="service-fleet"]').inner_text() not in ("—", "")

        page.locator('[data-testid="service-overlay"]').select_option("fire")
        legend = page.locator("#overlay-legend").inner_text()
        assert "0%" in legend and "100%" in legend

        fire_budget = page.locator('[data-testid="budget-fire"]')
        fire_budget.fill("130")
        fire_budget.dispatch_event("change")
        assert page.evaluate("() => window.__civicApp.core.services.getFunding('fire')") == 130

        saved = page.evaluate("""
        () => {
          const c = window.__civicApp.core;
          return {
            tick:c.clock.tick, roads:c.roads.list().length, population:c.population.population,
            fireBudget:c.services.getFunding('fire'), facilities:c.services.listFacilities().length,
            jobs:c.serviceDispatch.listJobs().length, serviceVehicles:c.serviceVehicles.listVehicles().length,
            waste:Number(c.garbageSnapshot.backlog.toFixed(6)), quality:Number(c.neighborhoodSnapshot.citywideServiceQuality.toFixed(6))
          };
        }
        """)
        page.locator('[data-testid="save"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Saved V4')")

        mutated = page.evaluate("""
        () => {
          const app = window.__civicApp;
          const result = app.core.bulldozeAt(18, 12);
          app.core.setServiceFunding('fire', 50);
          app.core.step(2);
          return {ok:result.ok, roads:app.core.roads.list().length, fireBudget:app.core.services.getFunding('fire')};
        }
        """)
        assert mutated["ok"] is True
        assert mutated["roads"] == saved["roads"] - 1
        assert mutated["fireBudget"] == 50

        page.locator('[data-testid="load"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Loaded V4')")
        restored = page.evaluate("""
        () => {
          const c = window.__civicApp.core;
          return {
            tick:c.clock.tick, roads:c.roads.list().length, population:c.population.population,
            fireBudget:c.services.getFunding('fire'), facilities:c.services.listFacilities().length,
            jobs:c.serviceDispatch.listJobs().length, serviceVehicles:c.serviceVehicles.listVehicles().length,
            waste:Number(c.garbageSnapshot.backlog.toFixed(6)), quality:Number(c.neighborhoodSnapshot.citywideServiceQuality.toFixed(6))
          };
        }
        """)
        assert restored == saved

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        assert SCREENSHOT.is_file() and SCREENSHOT.stat().st_size > 20_000
        browser.close()

    if errors:
        raise AssertionError("browser page errors: " + json.dumps(errors))
    print("PHASE4_SMOKE_PASS", json.dumps({"setup": setup, "saved": saved, "restored": restored, "screenshot": str(SCREENSHOT)}))


if __name__ == "__main__":
    main()
