from __future__ import annotations

import json
import mimetypes
import pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
SCREENSHOT = pathlib.Path("/tmp/civic-foundry-phase6-smoke.png")


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
        page = browser.new_page(viewport={"width": 1680, "height": 1050})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.route("http://civic.test/**", route_asset)
        storage_ready = page.evaluate("""
        () => {
          const values = new Map();
          const storage = {
            get length() { return values.size; }, clear() { values.clear(); },
            getItem(key) { key=String(key); return values.has(key) ? values.get(key) : null; },
            key(index) { return [...values.keys()][Number(index)] ?? null; },
            removeItem(key) { values.delete(String(key)); },
            setItem(key,value) { values.set(String(key),String(value)); },
          };
          Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
          storage.setItem('__phase6_probe__','ok');
          return storage.getItem('__phase6_probe__');
        }
        """)
        assert storage_ready == "ok"
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        assert page.locator("h1").inner_text() == "CIVIC FOUNDRY"
        assert page.locator(".eyebrow").inner_text() == "URBAN FABRIC 2.0 · DESKTOP GPU RUNTIME"
        assert page.locator('[data-testid="save"]').inner_text() == "Save V9"
        assert page.locator('[data-testid="economy-panel"]').is_visible()

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width=40,height=24;
          const cells=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass'}));
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:6060,startingFunds:2000000});
          app.core.buildRoad(Array.from({length:40},(_,x)=>({x,y:12})),'collector');
          for(let x=4;x<=14;x++) app.core.paintZone([{x,y:11}],'residential');
          for(let x=20;x<=27;x++) app.core.paintZone([{x,y:11}],'commercial');
          for(let x=28;x<=36;x++) app.core.paintZone([{x,y:11}],'industrial');
          for(const [x,y] of [[6,13],[10,13],[14,13]]) app.core.placeUtility('power',x,y);
          for(const [x,y] of [[18,13],[22,13],[26,13]]) app.core.placeUtility('water',x,y);
          for(const [x,y] of [[30,13],[33,13],[36,13]]) app.core.placeUtility('landfill',x,y);
          app.core.transportationGraph.rebuildIfNeeded(app.core.roads);
          for(let i=0;i<3500;i+=25){
            app.core.step(25);
            if(app.core.economyDomain.snapshot(app.core.clock.tick).activeFirms>0 && app.core.economyDomain.freightVehicles.activeCount()>0) break;
          }
          app.core.clock.setSpeed(0);
          app.renderEconomyPanel();
          const firm=app.core.economyDomain.firms.list().find(f=>f.status==='operating'||f.status==='distressed');
          if(!firm) throw new Error('no active firm formed');
          const building=app.core.buildings.getById(firm.buildingId);
          if(!building) throw new Error('active firm building missing');
          app.selected={x:building.x,y:building.y};
          app.renderInspector();
          const snapshot=app.core.economyDomain.snapshot(app.core.clock.tick);
          return {tick:app.core.clock.tick,roads:app.core.roads.list().length,firmId:firm.id,building:{x:building.x,y:building.y},activeFirms:snapshot.activeFirms,freight:app.core.economyDomain.freightVehicles.activeCount(),imports:snapshot.cumulativeImports,exports:snapshot.cumulativeExports};
        }
        """)
        assert setup["roads"] == 40
        assert setup["activeFirms"] > 0
        assert setup["freight"] > 0
        panel = page.locator('[data-testid="economy-panel"]').inner_text()
        assert "Active firms" in panel and "Freight in transit" in panel and any(ch.isdigit() for ch in panel)
        inspector = page.locator('#inspector-content').inner_text()
        assert setup["firmId"] in inspector
        assert "Firm jobs:" in inspector and "Cash health:" in inspector and "Inventory" in inspector

        page.locator('[data-testid="economy-overlay"]').select_option("freight-routes")
        legend = page.locator('#overlay-legend').inner_text()
        assert "Freight routes" in legend

        page.locator('[data-testid="save"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Saved V9')")
        saved_raw = page.evaluate("() => localStorage.getItem('civic-foundry-save-v7')")
        assert saved_raw
        saved_obj = json.loads(saved_raw)
        assert saved_obj["saveVersion"] == 9
        assert saved_obj["gameVersion"] == "0.9.0-urban-fabric"
        assert len(saved_obj["economyDomain"]["firms"]["firms"]) > 0
        assert len(saved_obj["economyDomain"]["freightVehicles"]["vehicles"]) > 0

        mutated = page.evaluate("""
        () => {
          const app=window.__civicApp;
          const firm=app.core.economyDomain.firms.list().find(f=>f.status==='operating'||f.status==='distressed');
          const building=firm ? app.core.buildings.getById(firm.buildingId) : null;
          if(building) app.core.bulldozeAt(building.x,building.y);
          app.core.bulldozeAt(0,12);
          app.core.step(150);
          return {roads:app.core.roads.list().length,activeFirms:app.core.economyDomain.snapshot(app.core.clock.tick).activeFirms,freight:app.core.economyDomain.freightVehicles.activeCount()};
        }
        """)
        assert mutated["roads"] < setup["roads"]

        page.locator('[data-testid="load"]').click()
        page.wait_for_function("() => document.querySelector('#notification')?.textContent?.includes('Loaded V9')")
        restored = page.evaluate("""
        async () => {
          const { serializeCore } = await import('http://civic.test/src/save/save.js');
          const app=window.__civicApp;
          const raw=localStorage.getItem('civic-foundry-save-v7');
          const snapshot=app.core.economyDomain.snapshot(app.core.clock.tick);
          return {exact:JSON.stringify(serializeCore(app.core))===raw,roads:app.core.roads.list().length,activeFirms:snapshot.activeFirms,freight:app.core.economyDomain.freightVehicles.activeCount(),saveVersion:serializeCore(app.core).saveVersion};
        }
        """)
        assert restored["exact"] is True
        assert restored["roads"] == setup["roads"]
        assert restored["activeFirms"] == setup["activeFirms"]
        assert restored["freight"] == setup["freight"]
        assert restored["saveVersion"] == 9

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        assert SCREENSHOT.is_file() and SCREENSHOT.stat().st_size > 20_000
        browser.close()

    if errors:
        raise AssertionError("browser page errors: " + json.dumps(errors))
    print("PHASE6_SMOKE_PASS", json.dumps({"setup":setup,"mutated":mutated,"restored":restored,"screenshot":str(SCREENSHOT)}))


if __name__ == "__main__":
    main()
