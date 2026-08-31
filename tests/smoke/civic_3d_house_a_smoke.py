from __future__ import annotations

import mimetypes
import pathlib
from io import BytesIO
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
OUTPUT = ROOT / "test-artifacts" / "civic-3d-house-a"


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


def assert_canvas_has_variance(png: bytes) -> None:
    assert len(png) > 8_000, ("3d canvas screenshot unexpectedly small", len(png))
    with Image.open(BytesIO(png)) as source:
        image = source.convert("RGBA")
        width, height = image.size
        assert width >= 600 and height >= 400, image.size
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

    assert len(luminance) > 100, ("too few visible samples", len(luminance))
    assert max(luminance) - min(luminance) > 20, (
        "insufficient 3d luminance range",
        min(luminance),
        max(luminance),
    )
    assert len(colors) > 12, ("insufficient 3d color variation", len(colors))


def main() -> None:
    if not (DIST / "src/rendering/3d/Civic3DWorldRenderer.js").is_file():
        raise RuntimeError("3D renderer build missing; run npm run build first")
    if not (DIST / "assets/manifests/catalog-v2.json").is_file():
        raise RuntimeError("3D asset catalog missing; run npm run build first")
    if not (DIST / "assets/models/cf_bld_res_detached_house_a_low_v01_lod0.glb").is_file():
        raise RuntimeError("House A LOD0 missing; run npm run build first")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    html = (DIST / "index.html").read_text().replace(
        "<head>", '<head><base href="http://civic.test/">', 1
    )
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        page.evaluate(
            """
            async () => {
              const [{ Civic3DWorldRenderer }, { SimulationCore }] = await Promise.all([
                import('http://civic.test/src/rendering/3d/Civic3DWorldRenderer.js'),
                import('http://civic.test/src/simulation/core/SimulationCore.js'),
              ]);

              const canvas = document.createElement('canvas');
              canvas.id = 'civic-3d-acceptance';
              canvas.width = 900;
              canvas.height = 640;
              canvas.style.width = '900px';
              canvas.style.height = '640px';
              canvas.style.position = 'fixed';
              canvas.style.left = '20px';
              canvas.style.top = '20px';
              canvas.style.zIndex = '9999';
              document.body.appendChild(canvas);

              const core = new SimulationCore({ width: 12, height: 10, seed: 108, startingFunds: 500000 });
              const house = {
                id: 'browser-house-a',
                parcelIds: ['parcel:browser-house-a'],
                typologyId: 'typology:residential_cottage',
                footprint: [
                  { x: 49.5, y: 39 },
                  { x: 58.5, y: 39 },
                  { x: 58.5, y: 51 },
                  { x: 49.5, y: 51 },
                ],
                grossFloorAreaM2: 150,
                usableFloorAreaM2: 129,
                heightMeters: 7.6,
                stories: 2,
                realizedFAR: 1.39,
                coverageRatio: 0.72,
                floors: [
                  {
                    level: 0,
                    elevationMeters: 0,
                    grossAreaM2: 75,
                    usableAreaM2: 64.5,
                    uses: [{ use: 'residential', floorAreaM2: 64.5, residentialUnits: 1 }],
                  },
                  {
                    level: 1,
                    elevationMeters: 3.2,
                    grossAreaM2: 75,
                    usableAreaM2: 64.5,
                    uses: [{ use: 'residential', floorAreaM2: 64.5, residentialUnits: 1 }],
                  },
                ],
                status: 'occupied',
                yearBuilt: 2026,
                developerId: 'developer:browser',
                ownerId: 'owner:browser',
                projectCost: 250000,
                entitlement: {
                  approvalTick: 0,
                  zoningDistrictId: 'R1',
                  approvedFAR: 2,
                  approvedHeightMeters: 10,
                  approvedUses: ['residential'],
                },
                lifecycle: {
                  ageTicks: 0,
                  condition: 92,
                  structuralCondition: 95,
                  systemsCondition: 90,
                  exteriorCondition: 92,
                  maintenanceBacklog: 0,
                  deferredMaintenanceTicks: 0,
                  effectiveAge: 0,
                  vacancyDurationTicks: 0,
                  distressScore: 0,
                },
              };
              core.buildings.restoreV2([house]);
              core.utilitySnapshot = {
                power: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
                water: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
                perBuilding: Object.freeze({
                  [house.id]: { power: 1, water: 1 },
                }),
              };

              const renderer = new Civic3DWorldRenderer(canvas);
              await renderer.preloadAssets();
              renderer.zoomBy(0.12, 450, 320);
              renderer.draw(core, 'none', null);
              window.__civic3dAcceptance = { renderer, core, canvas };
            }
            """
        )

        page.wait_for_function(
            """() => {
              const acceptance = window.__civic3dAcceptance;
              if (!acceptance) return false;
              acceptance.renderer.draw(acceptance.core, 'none', null);
              const stats = acceptance.renderer.debugSceneStats();
              return stats.loadedPrototypes >= 1 && stats.buildingInstances === 1;
            }""",
            timeout=15_000,
        )

        stats = page.evaluate("() => window.__civic3dAcceptance.renderer.debugSceneStats()")
        assert stats["backend"] == "civic-3d", stats
        assert stats["loadedPrototypes"] == 1, stats
        assert stats["buildingInstances"] == 1, stats
        assert stats["fallbackBuildings"] == 0, stats
        assert stats["assetRequests"] >= 1, stats
        assert stats["cacheMisses"] >= 1, stats

        before = page.evaluate(
            """() => ({
              zoom: window.__civic3dAcceptance.renderer.zoom,
              turns: window.__civic3dAcceptance.renderer.quarterTurns,
            })"""
        )
        page.evaluate(
            """() => {
              const { renderer, core } = window.__civic3dAcceptance;
              renderer.rotate(1);
              renderer.zoomBy(0.8, 450, 320);
              renderer.draw(core, 'none', null);
            }"""
        )
        after = page.evaluate(
            """() => ({
              zoom: window.__civic3dAcceptance.renderer.zoom,
              turns: window.__civic3dAcceptance.renderer.quarterTurns,
            })"""
        )
        assert after["turns"] == (before["turns"] + 1) % 4, (before, after)
        assert after["zoom"] > before["zoom"], (before, after)

        page.wait_for_timeout(250)
        png = page.locator("#civic-3d-acceptance").screenshot(type="png")
        assert_canvas_has_variance(png)
        (OUTPUT / "house_a_browser.png").write_bytes(png)

        diagnostics = page.evaluate(
            "() => [...window.__civic3dAcceptance.renderer.assetDiagnostics()]"
        )
        assert not any("failed" in item.lower() for item in diagnostics), diagnostics
        assert not any("error" in item.lower() for item in diagnostics), diagnostics

        page.evaluate(
            """async () => {
              const renderer = window.__civic3dAcceptance.renderer;
              renderer.dispose();
              await renderer.whenDisposed();
            }"""
        )
        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))

    print(
        "CIVIC_3D_HOUSE_A_SMOKE_PASS",
        {"stats": stats, "output": str(OUTPUT / "house_a_browser.png")},
    )


if __name__ == "__main__":
    main()
