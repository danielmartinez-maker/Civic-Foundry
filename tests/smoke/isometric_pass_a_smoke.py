from __future__ import annotations

import mimetypes
import pathlib
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
ATLAS_NAMES = ("terrain", "roads", "buildings", "construction", "civic", "utilities", "vegetation", "vehicles")


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


def page_point(page, x: int, y: int) -> tuple[float, float]:
    point = page.evaluate(
        "([x,y]) => window.__civicApp.renderer.worldToCanvas(x,y,window.__civicApp.core)",
        [x, y],
    )
    box = page.locator("#world").bounding_box()
    if not box:
        raise AssertionError("world canvas has no bounding box")
    return box["x"] + point["x"], box["y"] + point["y"]


def main() -> None:
    if not (DIST / "src/main.js").is_file():
        raise RuntimeError("dist build missing; run npm run build first")
    for name in ATLAS_NAMES:
        path = DIST / "assets" / "atlases" / f"{name}.png"
        if not path.is_file() or path.stat().st_size < 100:
            raise RuntimeError(f"missing or empty runtime atlas: {path}")

    html = (DIST / "index.html").read_text().replace("<head>", '<head><base href="http://civic.test/">', 1)
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1720, "height": 1080})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")
        page.wait_for_timeout(150)

        page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const width=40,height=24;
          const cells=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass'}));
          const app=window.__civicApp;
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:4242,startingFunds:1000000});
          app.core.clock.setSpeed(0);
          await app.renderer.preloadAssets();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }
        """)

        metrics = page.evaluate("""() => {
          const r=window.__civicApp.renderer;
          return {tileWidth:r.tileWidth,tileHeight:r.tileHeight,zoom:r.zoom,turn:r.quarterTurns,diagnostics:r.assetDiagnostics()};
        }""")
        assert metrics["tileWidth"] == 64
        assert metrics["tileHeight"] == 32
        assert metrics["zoom"] == 1
        assert metrics["turn"] == 0
        assert metrics["diagnostics"] == []

        retained_before = page.evaluate("""() => {
          const app=window.__civicApp;
          app.renderer.draw(app.core,'none',null);
          return app.renderer.debugSceneStats();
        }""")
        page.evaluate("""() => {
          const app=window.__civicApp;
          app.renderer.draw(app.core,'none',null);
          app.renderer.draw(app.core,'none',null);
        }""")
        retained_after = page.evaluate("() => window.__civicApp.renderer.debugSceneStats()")
        assert retained_before["staticActive"] > 0
        assert retained_after["staticActive"] == retained_before["staticActive"]
        assert retained_after["staticCreated"] == retained_before["staticCreated"]
        assert retained_after["staticUpdated"] == retained_before["staticUpdated"]

        created_before_pan = retained_after["staticCreated"]
        page.evaluate("""() => {
          const app=window.__civicApp;
          app.renderer.pan(12,-7);
          app.renderer.draw(app.core,'none',null);
        }""")
        retained_after_pan = page.evaluate("() => window.__civicApp.renderer.debugSceneStats()")
        assert retained_after_pan["staticCreated"] == created_before_pan

        page.locator('[data-testid="tool-zone-residential"]').click()
        x, y = page_point(page, 6, 6)
        page.mouse.click(x, y)
        assert page.evaluate("() => window.__civicApp.core.zoning.get(6,6)") == "residential"

        page.keyboard.press("e")
        assert page.evaluate("() => window.__civicApp.renderer.quarterTurns") == 1
        page.locator('[data-testid="tool-zone-commercial"]').click()
        x, y = page_point(page, 7, 6)
        page.mouse.click(x, y)
        assert page.evaluate("() => window.__civicApp.core.zoning.get(7,6)") == "commercial"

        page.locator('[data-testid="tool-road-local"]').click()
        sx, sy = page_point(page, 3, 3)
        ex, ey = page_point(page, 8, 6)
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(ex, ey, steps=8)
        page.mouse.up()
        expected = {(x, 3) for x in range(3, 9)} | {(8, y) for y in range(4, 7)}
        roads = page.evaluate("() => window.__civicApp.core.roads.list().map(r=>[r.x,r.y])")
        road_set = {tuple(item) for item in roads}
        assert expected.issubset(road_set), (expected, road_set)

        graph_edges = page.evaluate("""() => {
          const app=window.__civicApp;
          app.core.step(1);
          return app.core.transportationGraph.edges.length;
        }""")
        assert graph_edges > 0, "traffic overlay smoke fixture requires graph edges after road seeding"

        overlay_gate = page.evaluate("""() => {
          const app=window.__civicApp;
          const r=app.renderer;
          const baseBefore=r.debugSceneStats();
          r.draw(app.core,'congestion',null);
          const first=r.debugOverlayStats();
          const baseAfterFirst=r.debugSceneStats();
          r.draw(app.core,'congestion',null);
          const stable=r.debugOverlayStats();
          r.draw(app.core,'volume',null);
          const volume=r.debugOverlayStats();
          r.draw(app.core,'congestion',null);
          const cycled=r.debugOverlayStats();
          const baseAfterCycle=r.debugSceneStats();
          return {baseBefore,baseAfterFirst,baseAfterCycle,first,stable,volume,cycled};
        }""")
        assert overlay_gate["first"]["traffic"]["active"] > 0
        assert overlay_gate["baseAfterFirst"]["staticCreated"] == overlay_gate["baseBefore"]["staticCreated"]
        assert overlay_gate["stable"]["traffic"]["created"] == overlay_gate["first"]["traffic"]["created"]
        assert overlay_gate["stable"]["traffic"]["updated"] == overlay_gate["first"]["traffic"]["updated"]
        assert overlay_gate["volume"]["traffic"]["active"] == overlay_gate["first"]["traffic"]["active"]
        assert overlay_gate["cycled"]["traffic"]["created"] == overlay_gate["first"]["traffic"]["created"]
        assert overlay_gate["cycled"]["traffic"]["recycled"] > overlay_gate["first"]["traffic"]["recycled"]
        assert overlay_gate["baseAfterCycle"]["staticCreated"] == overlay_gate["baseBefore"]["staticCreated"]

        parcel_gate = page.evaluate("""() => {
          const app=window.__civicApp;
          const r=app.renderer;
          const parcel=app.core.cadastre.listParcels()[0] ?? null;
          if (!parcel) return null;
          r.setUrbanFabricOverlay('cadastre',null);
          r.draw(app.core,'none',null);
          const before=r.debugOverlayStats();
          const baseBefore=r.debugSceneStats();
          r.setUrbanFabricOverlay('cadastre',parcel.id);
          r.draw(app.core,'none',null);
          const after=r.debugOverlayStats();
          const baseAfter=r.debugSceneStats();
          r.setUrbanFabricOverlay('none',null);
          return {parcelId:parcel.id,before,after,baseBefore,baseAfter};
        }""")
        assert parcel_gate is not None
        assert parcel_gate["after"]["cadastre"]["active"] > 0
        assert parcel_gate["after"]["cadastre"]["created"] == parcel_gate["before"]["cadastre"]["created"]
        assert parcel_gate["after"]["cadastre"]["updated"] > parcel_gate["before"]["cadastre"]["updated"]
        assert parcel_gate["baseAfter"]["staticCreated"] == parcel_gate["baseBefore"]["staticCreated"]

        before = page.evaluate("""() => ({
          roads: JSON.stringify(window.__civicApp.core.roads.list()),
          zoning: JSON.stringify(window.__civicApp.core.zoning.list()),
          p: window.__civicApp.renderer.worldToCanvas(6,6,window.__civicApp.core)
        })""")
        page.evaluate("() => window.__civicApp.renderer.pan(45,-25)")
        after_pan = page.evaluate("""() => ({
          roads: JSON.stringify(window.__civicApp.core.roads.list()),
          zoning: JSON.stringify(window.__civicApp.core.zoning.list()),
          p: window.__civicApp.renderer.worldToCanvas(6,6,window.__civicApp.core)
        })""")
        assert before["roads"] == after_pan["roads"]
        assert before["zoning"] == after_pan["zoning"]
        assert before["p"] != after_pan["p"]

        page.evaluate("() => window.__civicApp.renderer.zoomBy(1.12,400,300)")
        zoom = page.evaluate("() => window.__civicApp.renderer.zoom")
        assert 0.45 <= zoom <= 2.5

        page.locator('[data-testid="traffic-overlay"]').select_option("congestion")
        page.wait_for_timeout(50)
        page.locator('[data-testid="economy-overlay"]').select_option("jobs")
        page.wait_for_timeout(50)
        page.locator('[data-testid="land-housing-overlay"]').select_option("affordability")
        page.wait_for_timeout(50)
        assert page.locator('[data-testid="traffic-overlay"]').input_value() == "none"
        assert page.locator('[data-testid="economy-overlay"]').input_value() == "none"

        page.locator('[data-testid="save"]').click()
        page.evaluate("() => window.__civicApp.core.paintZone([{x:10,y:10}],'industrial')")
        assert page.evaluate("() => window.__civicApp.core.zoning.get(10,10)") == "industrial"
        page.locator('[data-testid="load"]').click()
        page.wait_for_timeout(50)
        assert page.evaluate("() => window.__civicApp.core.zoning.get(10,10) ?? null") is None
        assert page.evaluate("() => window.__civicApp.core.zoning.get(6,6)") == "residential"

        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))
    print(
        "ISOMETRIC_PASS_A_SMOKE_PASS",
        {
            "metrics": metrics,
            "roads": len(roads),
            "zoom": zoom,
            "retained": retained_after_pan,
            "overlays": overlay_gate["cycled"],
            "parcel": parcel_gate["parcelId"],
        },
    )


if __name__ == "__main__":
    main()
