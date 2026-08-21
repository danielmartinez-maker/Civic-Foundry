from __future__ import annotations

import json
import mimetypes
import pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
SCREENSHOT = pathlib.Path("/tmp/civic-foundry-phase5-smoke.png")


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
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.route("http://civic.test/**", route_asset)
        # This CI sandbox blocks navigable origins, so opaque set_content pages cannot access native localStorage.
        # Install only the Storage surface; GameApp serialization/hydration and all compiled simulation code remain real.
        storage_ready = page.evaluate("""
        () => {
          const values = new Map();
          const storage = {
            get length() { return values.size; },
            clear() { values.clear(); },
            getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },
            key(index) { return [...values.keys()][Number(index)] ?? null; },
            removeItem(key) { values.delete(String(key)); },
            setItem(key, value) { values.set(String(key), String(value)); },
          };
          Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
          storage.setItem('__phase5_probe__', 'ok');
          return storage.getItem('__phase5_probe__');
        }
        """)
        assert storage_ready == "ok"
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        assert page.locator("h1").inner_text() == "CIVIC FOUNDRY"
        assert "PHASE V" in page.locator(".eyebrow").inner_text()
        assert page.locator('[data-testid="save"]').inner_text() == "Save V5"
        assert page.locator('[data-testid="transit-panel"]').is_visible()

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width = 40, height = 24;
          const cells = Array.from({length: width * height}, () => ({elevation: 0.5, water: false, buildable: true, biome: 'grass'}));
          app.core = new SimulationCore({terrain: new TerrainGrid(width, height, cells), seed: 5050, startingFunds: 2000000});

          app.tools.setTool('road-collector');
          const road = Array.from({length: 34}, (_, i) => ({x: i + 2, y: 12}));
          const roadResult = app.tools.applyPath(app.core, road);
          if (!roadResult.ok) throw new Error(`road: ${roadResult.reason}`);

          app.tools.setTool('zone-residential');
          for (let x = 3; x <= 12; x++) app.tools.applyCell(app.core, x, 11);
          app.tools.setTool('zone-commercial');
          for (let x = 24; x <= 29; x++) app.tools.applyCell(app.core, x, 11);
          app.tools.setTool('zone-industrial');
          for (let x = 30; x <= 34; x++) app.tools.applyCell(app.core, x, 11);

          for (const [tool, coords] of [
            ['power', [[3,13]]], ['water', [[10,13]]],
            ['service-fire', [[14,13]]], ['service-police', [[17,13]]], ['service-clinic', [[20,13]]],
            ['service-school', [[23,13]]], ['service-landfill', [[31,13]]], ['service-recycling', [[34,13]]],
          ]) {
            app.tools.setTool(tool);
            for (const [x,y] of coords) {
              const result = app.tools.applyCell(app.core, x, y);
              if (!result.ok) throw new Error(`${tool} ${x},${y}: ${result.reason}`);
            }
          }

          app.tools.setTool('transit-stop');
          for (const [x,y] of [[6,13],[27,13],[30,13]]) {
            const result = app.tools.applyCell(app.core, x, y);
            if (!result.ok) throw new Error(`transit-stop ${x},${y}: ${result.reason}`);
          }
          app.core.transportationGraph.rebuildIfNeeded(app.core.roads);
          app.core.clock.setSpeed(0);
          app.renderTransitPanel();
          return {roads: app.core.roads.list().length, stops: app.core.transit.listStops().map(s => s.id)};
        }
        """)
        assert setup["roads"] == 34
        assert len(setup["stops"]) == 3

        page.locator('[data-testid="transit-mode"]').select_option("brt")
        page.locator('[data-testid="transit-name"]').fill("Smoke BRT")
        page.locator('[data-testid="create-transit-line"]').click()
        line_id = page.locator('[data-testid="transit-line"]').input_value()
        assert line_id.startswith("transit-line:")

        stops = setup["stops"]
        page.locator('[data-testid="transit-origin"]').select_option(stops[0])
        page.locator('[data-testid="transit-destination"]').select_option(stops[1])
        page.locator('[data-testid="set-transit-route"]').click()
        page.locator('[data-testid="transit-append-stop"]').select_option(stops[2])
        page.locator('[data-testid="append-transit-stop"]').click()
        page.locator('[data-testid="transit-headway"]').fill("20")
        page.locator('[data-testid="transit-fare"]').fill("0")
        page.locator('[data-testid="transit-fleet"]').fill("4")
        page.locator('[data-testid="transit-enabled"]').check()
        page.locator('[data-testid="apply-transit-config"]').click()

        configured = page.evaluate("""
        () => {
          const app = window.__civicApp;
          const line = app.core.transit.listLines()[0];
          return {id:line.id, name:line.name, mode:line.mode, stops:[...line.stopIds], headway:line.headwayTicks, fare:line.fare, enabled:line.enabled, fleet:app.core.mobility.operations.snapshotLine(line.id).fleetLimit};
        }
        """)
        assert configured == {"id": line_id, "name": "Smoke BRT", "mode": "brt", "stops": stops, "headway": 20, "fare": 0, "enabled": True, "fleet": 4}

        transit_run = page.evaluate("""
        () => {
          const app = window.__civicApp;
          const line = app.core.transit.listLines()[0];
          const [a,b] = line.stopIds;
          const cohort = {
            id:'smoke-passenger:1', personTripId:'smoke-trip:1', travelerWeight:35,
            lineId:line.id, directionKey:'forward', boardingStopId:a, alightingStopId:b,
            destinationRoadNodeId:'n:27,12', enqueuedTick:app.core.clock.tick, transferLegs:[]
          };
          if (!app.core.mobility.passengers.enqueue(a, line.id, 'forward', cohort)) throw new Error('failed to enqueue smoke cohort');
          for (let i=0; i<500 && app.core.mobility.snapshot().ridership < 35; i++) app.core.step(1);
          app.core.clock.setSpeed(0);
          app.renderTransitPanel(line.id);
          return {
            vehicles:app.core.mobility.vehicles.listVehicles().length,
            dispatched:app.core.mobility.operations.snapshotLineWithVehicles(line.id, app.core.mobility.vehicles).dispatchedRuns,
            boardings:app.core.mobility.operations.snapshotLine(line.id).boardings,
            ridership:app.core.mobility.snapshot().ridership,
            wait:app.core.mobility.snapshot().meanWaitTicks,
            tick:app.core.clock.tick
          };
        }
        """)
        assert transit_run["dispatched"] > 0
        assert transit_run["boardings"] >= 35
        assert transit_run["ridership"] >= 35
        assert transit_run["tick"] > 0

        page.wait_for_timeout(100)
        assert page.locator('[data-hud="ridership"]').inner_text() not in ("—", "", "0")
        assert "Smoke BRT" in page.locator('[data-testid="transit-summary"]').inner_text()

        page.locator('[data-testid="transit-overlay"]').select_option("ridership")
        legend = page.locator("#overlay-legend").inner_text()
        assert "Ridership" in legend and any(ch.isdigit() for ch in legend)

        page.locator('[data-testid="transit-headway"]').fill("45")
        page.locator('[data-testid="transit-fare"]').fill("2.25")
        page.locator('[data-testid="apply-transit-config"]').click()
        changed = page.evaluate("""
        () => { const line=window.__civicApp.core.transit.listLines()[0]; return {headway:line.headwayTicks,fare:line.fare}; }
        """)
        assert changed == {"headway": 45, "fare": 2.25}

        page.locator('[data-testid="save"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Saved V5')")
        saved_raw = page.evaluate("() => localStorage.getItem('civic-foundry-save-v5')")
        assert saved_raw
        saved_obj = json.loads(saved_raw)
        assert saved_obj["saveVersion"] == 5
        assert saved_obj["gameVersion"] == "0.5.0-metropolitan"
        assert len(saved_obj["transit"]["network"]["stops"]) == 3
        assert len(saved_obj["transit"]["network"]["lines"]) == 1

        mutated = page.evaluate("""
        () => {
          const app=window.__civicApp;
          const firstStop=app.core.transit.listStops()[0];
          const removed=app.core.transit.removeStop(firstStop.id);
          const road=app.core.bulldozeAt(18,12);
          return {removed, road:road.ok, stops:app.core.transit.listStops().length, roads:app.core.roads.list().length};
        }
        """)
        assert mutated["removed"] is True
        assert mutated["road"] is True
        assert mutated["stops"] == 2
        assert mutated["roads"] == 33

        page.locator('[data-testid="load"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Loaded V5')")
        restored = page.evaluate("""
        async () => {
          const { serializeCore } = await import('http://civic.test/src/save/save.js');
          const app=window.__civicApp;
          return {
            exact: JSON.stringify(serializeCore(app.core)) === localStorage.getItem('civic-foundry-save-v5'),
            roads:app.core.roads.list().length,
            stops:app.core.transit.listStops().length,
            line:app.core.transit.listLines()[0],
            ridership:app.core.mobility.snapshot().ridership
          };
        }
        """)
        assert restored["exact"] is True
        assert restored["roads"] == 34
        assert restored["stops"] == 3
        assert restored["line"]["headwayTicks"] == 45
        assert restored["line"]["fare"] == 2.25
        assert restored["ridership"] >= 35

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        assert SCREENSHOT.is_file() and SCREENSHOT.stat().st_size > 20_000
        browser.close()

    if errors:
        raise AssertionError("browser page errors: " + json.dumps(errors))
    print("PHASE5_SMOKE_PASS", json.dumps({"setup": setup, "configured": configured, "transit": transit_run, "changed": changed, "mutated": mutated, "restored": restored, "screenshot": str(SCREENSHOT)}))


if __name__ == "__main__":
    main()
