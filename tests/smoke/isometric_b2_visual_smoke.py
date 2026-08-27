from __future__ import annotations

import mimetypes
import pathlib
from io import BytesIO
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
OUTPUT = ROOT / "test-artifacts" / "isometric-pass-b2"
B2_ATLAS = DIST / "assets" / "atlases" / "public_realm.png"


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
    assert len(luminance) > 100, (scene, "too few visible samples")
    assert max(luminance) - min(luminance) > 30, (scene, "insufficient luminance range")
    assert len(colors) > 20, (scene, "insufficient color variation")


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
    page.wait_for_timeout(80)


def capture(page, name: str, x: int, y: int) -> None:
    center_on(page, x, y)
    page.wait_for_timeout(80)
    png = page.locator("#world").screenshot(type="png")
    assert_screenshot_has_variance(png, name)
    (OUTPUT / name).write_bytes(png)


def main() -> None:
    if not (DIST / "src/main.js").is_file():
        raise RuntimeError("dist build missing; run npm run build first")
    if not B2_ATLAS.is_file() or B2_ATLAS.stat().st_size < 1_000:
        raise RuntimeError(f"missing or empty Pass B2 runtime atlas: {B2_ATLAS}")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    html = (DIST / "index.html").read_text().replace("<head>", '<head><base href="http://civic.test/">', 1)
    errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1720, "height": 1080})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        evidence = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const { NEW_BUILDING_LIFECYCLE } = await import('http://civic.test/src/simulation/buildings/BuildingTypes.js');
          const { LEGACY_CELL_SIZE_METERS } = await import('http://civic.test/src/world/cadastre/Geometry.js');
          const { RUNTIME_ASSET_MANIFEST } = await import('http://civic.test/src/rendering/assets/RuntimeAssetManifest.js');
          const { PASS_B2_ASSET_MANIFEST } = await import('http://civic.test/src/rendering/assets/PassB2AssetManifest.js');
          const { PublicRealmPresentationCache } = await import('http://civic.test/src/rendering/public-realm/PublicRealmPresentationCache.js');
          const app=window.__civicApp,width=38,height=18;
          const cells=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass'}));
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:82026,startingFunds:5000000});
          app.core.clock.setSpeed(0);
          app.core.buildRoad(Array.from({length:34},(_,i)=>({x:i+2,y:6})),'collector');

          const specs=[
            {id:'urban',x:5,y:5,zone:'commercial',definitionId:'commercial_office',typologyId:'podium_mixed_use',stories:12,far:4.2,coverage:.70,uses:['residential','retail']},
            {id:'main',x:10,y:5,zone:'commercial',definitionId:'commercial_block',typologyId:'main_street_mixed_use',stories:5,far:2.1,coverage:.65,uses:['residential','retail']},
            {id:'res',x:15,y:5,zone:'residential',definitionId:'residential_cottage',typologyId:'typology:residential_cottage',stories:2,far:.7,coverage:.45,uses:['residential']},
            {id:'suburban',x:20,y:5,zone:'commercial',definitionId:'commercial_shop',typologyId:'typology:commercial_shop',stories:1,far:.3,coverage:.30,uses:['retail']},
            {id:'industrial',x:25,y:5,zone:'industrial',definitionId:'industrial_warehouse',typologyId:'typology:industrial_warehouse',stories:1,far:.6,coverage:.55,uses:['logistics']},
          ];
          for(const spec of specs) app.core.paintZone([{x:spec.x,y:spec.y}],spec.zone);
          const legacy=specs.map(spec=>({
            id:`legacy:${spec.id}`,lotId:`lot:${spec.id}`,x:spec.x,y:spec.y,zone:spec.zone,
            definitionId:spec.definitionId,status:'occupied',constructionStartedTick:0,completionTick:0,
          }));
          app.core.buildings.restore(legacy);
          const cellSize=LEGACY_CELL_SIZE_METERS;
          app.core.buildings.restoreV2(specs.map(spec=>({
            id:`canonical:${spec.id}`,parcelIds:[`parcel:${spec.x},${spec.y}`],typologyId:spec.typologyId,
            footprint:[{x:spec.x*cellSize,y:spec.y*cellSize},{x:(spec.x+1)*cellSize,y:spec.y*cellSize},{x:(spec.x+1)*cellSize,y:(spec.y+1)*cellSize},{x:spec.x*cellSize,y:(spec.y+1)*cellSize}],
            grossFloorAreaM2:1000*spec.far,usableFloorAreaM2:800*spec.far,heightMeters:spec.stories*3.2,
            stories:spec.stories,realizedFAR:spec.far,coverageRatio:spec.coverage,
            floors:[{level:1,elevationMeters:0,grossAreaM2:800,uses:spec.uses.map((use,i)=>({use,floorAreaM2:800/spec.uses.length}))}],
            status:'occupied',yearBuilt:0,projectCost:100000,
            entitlement:{approvalTick:0,zoningDistrictId:spec.zone,approvedFAR:6,approvedHeightMeters:90,approvedUses:spec.uses},
            lifecycle:{...NEW_BUILDING_LIFECYCLE},
          })));
          const civic=app.core.placeServiceFacility('fire_station',30,5);
          if(!civic.ok) throw new Error(`failed to place civic fixture: ${civic.reason}`);

          await app.renderer.preloadAssets();
          app.renderer.zoomBy(.82,500,360);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

          const snapshot=new PublicRealmPresentationCache().resolve(app.core);
          return {
            runtime_entries:RUNTIME_ASSET_MANIFEST.entries.length,
            runtime_atlases:RUNTIME_ASSET_MANIFEST.atlases.length,
            b2_entries:PASS_B2_ASSET_MANIFEST.entries.length,
            profiles:[...new Set(snapshot.descriptors.map(item=>item.profile))].sort(),
            parking:snapshot.descriptors.map(item=>item.parkingForm).sort(),
            diagnostics:app.renderer.assetDiagnostics(),
          };
        }
        """)

        assert evidence["runtime_entries"] == 389, evidence
        assert evidence["runtime_atlases"] == 10, evidence
        assert evidence["b2_entries"] == 90, evidence
        assert evidence["profiles"] == [
            "civic-public-space", "industrial-logistics", "main-street",
            "residential-green", "suburban-auto-oriented", "urban-core",
        ], evidence
        assert evidence["diagnostics"] == [], evidence["diagnostics"]

        capture(page, "urban_core_o0.png", 5, 5)
        capture(page, "main_street_o0.png", 10, 5)
        capture(page, "residential_green_o0.png", 15, 5)
        capture(page, "suburban_auto_o0.png", 20, 5)
        capture(page, "industrial_logistics_o0.png", 25, 5)
        capture(page, "civic_public_space_o0.png", 30, 5)
        page.evaluate("window.__civicApp.renderer.rotate(1)")
        capture(page, "mixed_profiles_o1.png", 17, 5)
        page.evaluate("window.__civicApp.renderer.rotate(1)")
        capture(page, "mixed_profiles_o2.png", 17, 5)
        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))
    expected = {
        "urban_core_o0.png", "main_street_o0.png", "residential_green_o0.png", "suburban_auto_o0.png",
        "industrial_logistics_o0.png", "civic_public_space_o0.png", "mixed_profiles_o1.png", "mixed_profiles_o2.png",
    }
    assert {path.name for path in OUTPUT.glob("*.png")} >= expected
    print("ISOMETRIC_B2_VISUAL_SMOKE_PASS", {"output": str(OUTPUT), "scenes": len(expected), "entries": evidence["runtime_entries"]})


if __name__ == "__main__":
    main()
