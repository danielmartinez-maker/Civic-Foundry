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
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on("console", lambda message: errors.append(f"console: {message.text}") if message.type == "error" else None)
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width = 20;
          const height = 12;
          const cells = Array.from({ length: width * height }, () => ({
            elevation: 0.5,
            water: false,
            buildable: true,
            biome: 'grass',
          }));
          app.core = new SimulationCore({
            terrain: new TerrainGrid(width, height, cells),
            seed: 7,
            startingFunds: 300000,
          });
          const road = app.core.buildRoad(Array.from({ length: 14 }, (_, index) => ({ x: index + 2, y: 6 })), 'local');
          if (!road.ok) throw new Error(road.reason ?? 'road setup failed');
          app.core.paintZone([{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }], 'residential');
          const power = app.core.placeUtility('power', 4, 7);
          const water = app.core.placeUtility('water', 8, 7);
          if (!power.ok || !water.ok) throw new Error('utility setup failed');
          app.core.step(600);
          app.core.clock.setSpeed(0);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return {
            tick: app.core.clock.tick,
            parcelIds: app.core.cadastre.listParcels().map(parcel => parcel.id).sort(),
            buildingIds: app.core.buildings.listV2().map(building => building.id).sort(),
            legacyLotIds: app.core.lots.list().map(lot => lot.id).sort(),
          };
        }
        """)
        assert setup["tick"] == 600
        assert setup["parcelIds"], "expected at least one canonical cadastral parcel"
        assert setup["buildingIds"], "expected runtime development to materialize BuildingV2"
        assert setup["legacyLotIds"], "expected legacy lot compatibility projection"

        urban_overlay = page.locator('[data-testid="urban-fabric-overlay"]')
        assert urban_overlay.is_visible()
        urban_overlay.select_option("cadastre")
        assert page.evaluate("window.__civicApp.renderer.currentUrbanFabricOverlayMode") == "cadastre"
        assert "Cadastre" in page.locator('#overlay-legend').inner_text()

        urban_overlay.select_option("zoning-envelope")
        parcel_click = page.evaluate("""
        () => {
          const app = window.__civicApp;
          const lot = app.core.lots.list().sort((a, b) => a.id.localeCompare(b.id))[0];
          if (!lot) throw new Error('expected compatibility lot for parcel click');
          const parcelId = app.tools.parcelIdAt(app.core, lot.x, lot.y);
          if (!parcelId) throw new Error('expected canonical parcel under compatibility lot');
          const center = app.renderer.worldToCanvas(lot.x, lot.y, app.core);
          return { parcelId, x: center.x, y: center.y };
        }
        """)
        canvas_box = page.locator('[data-testid="world-canvas"]').bounding_box()
        assert canvas_box is not None
        page.mouse.click(canvas_box["x"] + parcel_click["x"], canvas_box["y"] + parcel_click["y"])
        inspector = page.locator('#inspector-content').inner_text()
        assert f"Parcel {parcel_click['parcelId']}" in inspector
        assert page.evaluate("window.__civicApp.renderer.currentUrbanFabricSelectedParcelId") == parcel_click["parcelId"]
        assert page.evaluate("window.__civicApp.renderer.currentUrbanFabricOverlayMode") == "zoning-envelope"

        save_reload = page.evaluate("""
        async () => {
          const { serializeCore, hydrateCore } = await import('http://civic.test/src/save/save.js');
          const app = window.__civicApp;
          const save = serializeCore(app.core);
          const before = {
            parcelIds: save.urbanFabric.parcels.map(parcel => parcel.id).sort(),
            buildingIds: save.buildingsV2.map(building => building.id).sort(),
          };
          app.core = hydrateCore(structuredClone(save));
          app.core.clock.setSpeed(0);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const after = {
            parcelIds: app.core.cadastre.listParcels().map(parcel => parcel.id).sort(),
            buildingIds: app.core.buildings.listV2().map(building => building.id).sort(),
          };
          return {
            saveVersion: save.saveVersion,
            gameVersion: save.gameVersion,
            before,
            after,
          };
        }
        """)
        assert save_reload["saveVersion"] == 9
        assert save_reload["gameVersion"] == "0.9.0-urban-fabric"
        assert save_reload["before"] == save_reload["after"]

        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))

    print("URBAN_FABRIC_SMOKE_PASS", {
        "setup": setup,
        "selectedParcelId": parcel_click["parcelId"],
        "saveVersion": save_reload["saveVersion"],
        "gameVersion": save_reload["gameVersion"],
    })


if __name__ == "__main__":
    main()
