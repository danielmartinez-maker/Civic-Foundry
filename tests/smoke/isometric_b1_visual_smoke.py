from __future__ import annotations

import mimetypes
import pathlib
from io import BytesIO
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
OUTPUT = ROOT / "test-artifacts" / "isometric-pass-b1"
B1_ATLAS = DIST / "assets" / "atlases" / "urban_depth_buildings.png"


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
    page.wait_for_timeout(80)


def capture(page, name: str, x: int, y: int) -> None:
    center_on(page, x, y)
    png = page.locator("#world").screenshot(type="png")
    assert_screenshot_has_variance(png, name)
    (OUTPUT / name).write_bytes(png)


def main() -> None:
    if not (DIST / "src/main.js").is_file():
        raise RuntimeError("dist build missing; run npm run build first")
    if not B1_ATLAS.is_file() or B1_ATLAS.stat().st_size < 1_000:
        raise RuntimeError(f"missing or empty Pass B1 runtime atlas: {B1_ATLAS}")

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
          const { PASS_B1_COMPOSED_ASSET_MANIFEST } = await import('http://civic.test/src/rendering/assets/PassB1AssetManifest.js');
          const { buildingVariantKey } = await import('http://civic.test/src/rendering/assets/BuildingVisualResolver.js');
          const app=window.__civicApp,width=38,height=22;
          const cells=Array.from({length:width*height},(_,i)=>({
            elevation:.5, water:false, buildable:true,
            biome:i%47===0?'forest':'grass'
          }));
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:81025,startingFunds:5000000});
          app.core.clock.setSpeed(0);

          for(const y of [6,11,16]){
            app.core.buildRoad(Array.from({length:34},(_,i)=>({x:i+2,y})),'local');
          }

          const specs=[];
          const legacy=[];
          const add=(id,x,y,zone,definitionId,typologyId,condition,status='occupied')=>{
            app.core.paintZone([{x,y}],zone);
            legacy.push({
              id,lotId:`lot:${id}`,x,y,zone,definitionId,status:'occupied',
              constructionStartedTick:0,completionTick:0
            });
            specs.push({id,x,y,zone,typologyId,condition,status});
          };

          [5,9,13,17,21,25].forEach((x,i)=>add(
            `b1:main:${i}`,x,5,'commercial','commercial_block','main_street_mixed_use',78
          ));
          [7,12,17,22,27].forEach((x,i)=>add(
            `b1:podium:${i}`,x,10,'commercial','commercial_office','podium_mixed_use',94
          ));
          const conditions=[95,75,55,30,10];
          [7,12,17,22,27].forEach((x,i)=>add(
            `b1:condition:${i}`,x,15,'residential','residential_apartment','typology:residential_apartment',
            conditions[i],i===4?'abandoned':'occupied'
          ));

          app.core.buildings.restore(legacy);
          const cellSize=LEGACY_CELL_SIZE_METERS;
          app.core.buildings.restoreV2(specs.map(spec=>{
            const minX=spec.x*cellSize,minY=spec.y*cellSize,maxX=minX+cellSize,maxY=minY+cellSize;
            const approvedUses=spec.typologyId.includes('mixed_use')
              ? ['residential','retail','office']
              : [spec.zone==='residential'?'residential':'office'];
            return {
              id:`canonical:${spec.id}`,
              parcelIds:[`parcel:${spec.id}`],
              typologyId:spec.typologyId,
              footprint:[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}],
              grossFloorAreaM2:1200,
              usableFloorAreaM2:960,
              heightMeters:spec.typologyId==='podium_mixed_use'?38:18,
              stories:spec.typologyId==='podium_mixed_use'?12:5,
              realizedFAR:2.2,
              coverageRatio:.65,
              floors:[],
              status:spec.status,
              yearBuilt:0,
              projectCost:100000,
              entitlement:{
                approvalTick:0,zoningDistrictId:spec.zone,approvedFAR:4,
                approvedHeightMeters:60,approvedUses
              },
              lifecycle:{...NEW_BUILDING_LIFECYCLE,exteriorCondition:spec.condition},
            };
          }));

          await app.renderer.preloadAssets();
          app.renderer.zoomBy(.78,500,360);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

          const keys=specs.map(spec=>{
            const canonical=app.core.buildings.getV2At(spec.x,spec.y);
            if(!canonical) throw new Error(`canonical building disappeared at ${spec.x},${spec.y}`);
            return {id:spec.id,key:buildingVariantKey(canonical),status:canonical.status,condition:canonical.lifecycle.exteriorCondition};
          });
          return {
            entries:RUNTIME_ASSET_MANIFEST.entries.length,
            atlases:RUNTIME_ASSET_MANIFEST.atlases.length,
            b1_entries:PASS_B1_COMPOSED_ASSET_MANIFEST.entries.length,
            b1_atlases:PASS_B1_COMPOSED_ASSET_MANIFEST.atlases.length,
            diagnostics:app.renderer.assetDiagnostics(),
            keys,
          };
        }
        """)

        assert evidence["b1_entries"] == 299, evidence
        assert evidence["b1_atlases"] == 9, evidence
        assert evidence["entries"] == 389, evidence
        assert evidence["atlases"] == 10, evidence
        assert evidence["diagnostics"] == [], evidence["diagnostics"]
        main_keys = [item["key"] for item in evidence["keys"] if item["id"].startswith("b1:main:")]
        podium_keys = [item["key"] for item in evidence["keys"] if item["id"].startswith("b1:podium:")]
        condition_keys = [item["key"] for item in evidence["keys"] if item["id"].startswith("b1:condition:")]
        assert all(key.startswith("mix_mainstreet_") and key.endswith("__maintained") for key in main_keys), main_keys
        assert all(key.startswith("mix_podium_") and key.endswith("__new") for key in podium_keys), podium_keys
        expected_suffixes = ["__new", "", "__aging", "__neglected", "__abandoned"]
        for key, suffix in zip(condition_keys, expected_suffixes, strict=True):
            if suffix:
                assert key.endswith(suffix), condition_keys
            else:
                assert "__" not in key, condition_keys

        capture(page, "mixed_use_main_street.png", 15, 5)
        capture(page, "podium_mixed_use_district.png", 17, 10)
        capture(page, "condition_progression.png", 17, 15)
        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))
    expected = {"mixed_use_main_street.png", "podium_mixed_use_district.png", "condition_progression.png"}
    assert {path.name for path in OUTPUT.glob("*.png")} >= expected
    print("ISOMETRIC_B1_VISUAL_SMOKE_PASS", {"output": str(OUTPUT), "scenes": len(expected), "entries": evidence["entries"]})


if __name__ == "__main__":
    main()
