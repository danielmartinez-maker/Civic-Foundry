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

    html = (DIST / "index.html").read_text().replace("<head>", '<head><base href="http://civic.test/">', 1)
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1680, "height": 1050})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        assert page.locator('[data-testid="land-housing-panel"]').is_visible()
        assert page.locator('[data-testid="land-housing-overlay"]').is_visible()
        assert page.locator('[data-testid="land-housing-overlay-canvas"]').is_visible()

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width=40,height=24;
          const cells=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass'}));
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:7070,startingFunds:1000000});
          app.core.buildRoad(Array.from({length:20},(_,x)=>({x:x+2,y:12})),'local');
          for(let x=4;x<=8;x++) app.core.paintZone([{x,y:11}],'residential');
          app.core.placeUtility('power',5,13);
          app.core.placeUtility('water',8,13);
          const lots=app.core.lots.list().filter(l=>l.zone==='residential').sort((a,b)=>a.id.localeCompare(b.id));
          app.core.buildings.restore(lots.map(l=>({id:`building:${l.id}`,lotId:l.id,x:l.x,y:l.y,zone:'residential',definitionId:'residential_cottage',status:'occupied',constructionStartedTick:0,completionTick:0})));
          app.core.population.restore(20);
          app.core.step(10);
          app.core.clock.setSpeed(0);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const building=app.core.buildings.occupied().filter(b=>b.zone==='residential').sort((a,b)=>a.id.localeCompare(b.id))[0];
          app.selected={x:building.x,y:building.y};
          app.renderInspector();
          return {buildingId:building.id};
        }
        """)

        panel = page.locator('[data-testid="land-housing-panel"]').inner_text()
        for label in ["Residential market", "Physical capacity", "Affordability", "High-pressure parcels"]:
            assert label in panel

        inspector = page.locator('#inspector-content').inner_text()
        for label in ["Housing occupancy", "Affordability", "Average rent burden", "Redevelopment pressure", "Redevelopment status"]:
            assert label in inspector

        page.locator('[data-testid="economy-overlay"]').select_option("firm-health")
        page.locator('[data-testid="land-housing-overlay"]').select_option("affordability")
        assert page.locator('[data-testid="economy-overlay"]').input_value() == "none"
        assert "Housing affordability" in page.locator('#overlay-legend').inner_text()

        page.locator('[data-testid="traffic-overlay"]').select_option("congestion")
        assert page.locator('[data-testid="land-housing-overlay"]').input_value() == "none"
        assert "Congestion" in page.locator('#overlay-legend').inner_text()

        browser.close()

    if errors:
        raise AssertionError("browser page errors: " + repr(errors))
    print("PHASE7_LAND_HOUSING_SMOKE_PASS", setup)


if __name__ == "__main__":
    main()
