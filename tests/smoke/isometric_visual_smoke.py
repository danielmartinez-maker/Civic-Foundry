from __future__ import annotations

import mimetypes
import pathlib
from io import BytesIO
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
OUTPUT = ROOT / "test-artifacts" / "isometric-pass-a"


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


def assert_screenshot_has_variance(png: bytes, scene: str) -> None:
    assert len(png) > 10_000, (scene, "screenshot unexpectedly small", len(png))
    with Image.open(BytesIO(png)) as source:
        image = source.convert("RGBA")
        width, height = image.size
        assert width > 100 and height > 100, (scene, image.size)
        step_x = max(1, width // 80)
        step_y = max(1, height // 50)
        luminance: list[float] = []
        colors: set[tuple[int, int, int]] = set()
        for y in range(step_y // 2, height, step_y):
            for x in range(step_x // 2, width, step_x):
                r, g, b, a = image.getpixel((x, y))
                if a == 0:
                    continue
                luminance.append((r + g + b) / 3)
                colors.add((r, g, b))

    assert len(luminance) > 100, (scene, "too few visible samples", len(luminance))
    assert max(luminance) - min(luminance) > 30, (scene, "insufficient luminance range", min(luminance), max(luminance))
    assert len(colors) > 20, (scene, "insufficient color variation", len(colors))


def center_on(page, x: int, y: int) -> None:
    page.evaluate(
        """([x,y]) => {
          const app=window.__civicApp;
          const p=app.renderer.worldToCanvas(x,y,app.core);
          const canvas=document.querySelector('#world');
          const rect=canvas.getBoundingClientRect();
          app.renderer.pan(rect.width*.52-p.x,rect.height*.50-p.y);
        }""",
        [x, y],
    )
    page.wait_for_timeout(60)


def capture(page, name: str, x: int, y: int) -> None:
    center_on(page, x, y)
    png = page.locator("#world").screenshot(type="png")
    assert_screenshot_has_variance(png, name)
    (OUTPUT / name).write_bytes(png)


def main() -> None:
    if not (DIST / "src/main.js").is_file():
        raise RuntimeError("dist build missing; run npm run build first")
    OUTPUT.mkdir(parents=True, exist_ok=True)
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

        page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app=window.__civicApp,width=40,height=24;
          const cells=Array.from({length:width*height},(_,i)=>({
            elevation:.5, water:false, buildable:true,
            biome: (i%37===0?'forest':i%53===0?'rock':'grass')
          }));
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:5150,startingFunds:5000000});
          app.core.clock.setSpeed(0);
          const rows=[6,10,14,18];
          for(const y of rows) app.core.buildRoad(Array.from({length:35},(_,i)=>({x:i+2,y})),'local');
          app.core.buildRoad(Array.from({length:13},(_,i)=>({x:12,y:i+6})),'collector');
          app.core.buildRoad(Array.from({length:13},(_,i)=>({x:28,y:i+6})),'arterial');

          const buildings=[];
          const defs={
            residential:['residential_cottage','residential_rowhouse','residential_apartment'],
            commercial:['commercial_shop','commercial_block','commercial_office'],
            industrial:['industrial_workshop','industrial_warehouse','industrial_plant']
          };
          const zoneRows={residential:5,commercial:9,industrial:13};
          for(const [zone,y] of Object.entries(zoneRows)){
            for(let i=0;i<9;i++){
              const x=4+i*3;
              app.core.paintZone([{x,y}],zone);
              buildings.push({
                id:`visual:${zone}:${i}`,lotId:`visual-lot:${zone}:${i}`,x,y,zone,
                definitionId:defs[zone][Math.floor(i/3)],status:'occupied',constructionStartedTick:0,completionTick:0
              });
            }
          }
          app.core.paintZone([{x:33,y:5}],'residential');
          buildings.push({
            id:'visual:construction',lotId:'visual-lot:construction',x:33,y:5,zone:'residential',
            definitionId:'residential_apartment',status:'construction',constructionStartedTick:0,completionTick:100
          });
          app.core.buildings.restore(buildings);

          for(const [type,x] of [['fire_station',5],['police_station',9],['clinic',13],['elementary_school',17],['landfill',21],['recycling_center',25]]){
            app.core.placeServiceFacility(type,x,17);
          }
          app.core.placeUtility('power',29,17);
          app.core.placeUtility('water',32,17);
          await app.renderer.preloadAssets();
          app.renderer.zoomBy(.72,500,360);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }
        """)

        capture(page, "suburban_edge.png", 6, 5)
        capture(page, "urban_mixed_density.png", 15, 7)
        capture(page, "dense_core.png", 26, 9)
        capture(page, "industrial_logistics.png", 20, 13)
        capture(page, "civic_cluster.png", 16, 17)
        capture(page, "construction.png", 33, 5)

        page.locator('[data-testid="traffic-overlay"]').select_option("volume")
        page.wait_for_timeout(80)
        capture(page, "traffic_freight.png", 25, 12)

        page.locator('[data-testid="traffic-overlay"]').select_option("none")
        page.locator('[data-testid="service-overlay"]').select_option("quality")
        page.wait_for_timeout(80)
        capture(page, "overlay.png", 16, 11)

        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))
    expected = {
        "suburban_edge.png", "urban_mixed_density.png", "dense_core.png", "industrial_logistics.png",
        "civic_cluster.png", "construction.png", "traffic_freight.png", "overlay.png",
    }
    assert {p.name for p in OUTPUT.glob("*.png")} >= expected
    print("ISOMETRIC_VISUAL_SMOKE_PASS", {"output": str(OUTPUT), "scenes": len(expected)})


if __name__ == "__main__":
    main()
