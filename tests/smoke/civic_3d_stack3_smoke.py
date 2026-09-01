from __future__ import annotations

import json
import mimetypes
import pathlib
from io import BytesIO
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
OUTPUT = ROOT / "test-artifacts" / "civic-3d-stack3"

ASSET_IDS = (
    "cf_bld_res_detached_house_a_low_v01",
    "cf_bld_res_rowhouse_a_med_v01",
    "cf_bld_com_corner_shop_a_low_v01",
    "cf_bld_mix_mainstreet_a_med_v01",
    "cf_bld_ind_light_workshop_a_low_v01",
    "cf_fac_fire_station_a_v01",
    "cf_prop_street_furniture_a_v01",
    "cf_veh_compact_car_a_v01",
    "cf_transit_bus_stop_a_v01",
    "cf_veg_deciduous_tree_a_v01",
    "cf_prop_pocket_park_a_v01",
    "cf_construction_basic_kit_a_v01",
    "cf_condition_basic_kit_a_v01",
    "cf_landmark_water_tower_a_v01",
)
EXPECTED_BLOCK_ENTITIES = 112
MAX_ESTIMATED_GPU_BYTES = 64 * 1024 * 1024


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


def assert_canvas_has_variance(png: bytes, label: str) -> None:
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

    metrics = {
        "label": label,
        "size": (width, height),
        "sample_count": len(luminance),
        "luminance_span": (max(luminance) - min(luminance)) if luminance else None,
        "color_count": len(colors),
    }
    print("CIVIC_3D_STACK3_VISUAL_METRICS", metrics, flush=True)
    assert width >= 600 and height >= 400, ("canvas too small", metrics)
    assert len(luminance) > 100, ("too few visible samples", metrics)
    assert max(luminance) - min(luminance) > 20, ("insufficient 3D luminance range", metrics)
    assert len(colors) > 12, ("insufficient 3D color variation", metrics)


def main() -> None:
    required = [
        DIST / "src/rendering/3d/Civic3DWorldRenderer.js",
        DIST / "src/rendering/3d/presentation/Stack3AcceptanceDistrict.js",
        DIST / "assets/manifests/catalog-v2.json",
    ]
    for asset_id in ASSET_IDS:
        required.append(DIST / "assets/models" / f"{asset_id}_lod0.glb")
        required.append(DIST / "assets/models" / f"{asset_id}_lod1.glb")
        required.append(DIST / "assets/models" / f"{asset_id}_lod2.glb")
    for path in required:
        if not path.is_file() or path.stat().st_size <= 0:
            raise RuntimeError(f"required Stack 3 acceptance artifact missing or empty: {path}")

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
              const [{ Civic3DWorldRenderer }, { SimulationCore }, { serializeCore }] = await Promise.all([
                import('http://civic.test/src/rendering/3d/Civic3DWorldRenderer.js'),
                import('http://civic.test/src/simulation/core/SimulationCore.js'),
                import('http://civic.test/src/save/save.js'),
              ]);

              const canvas = document.createElement('canvas');
              canvas.id = 'civic-3d-stack3';
              canvas.width = 960;
              canvas.height = 680;
              canvas.style.width = '960px';
              canvas.style.height = '680px';
              canvas.style.position = 'fixed';
              canvas.style.left = '20px';
              canvas.style.top = '20px';
              canvas.style.zIndex = '9999';
              document.body.appendChild(canvas);

              const core = new SimulationCore({ width: 24, height: 24, seed: 314159, startingFunds: 500000 });
              const renderer = new Civic3DWorldRenderer(canvas);
              await renderer.preloadAssets();
              const saveBefore = JSON.stringify(serializeCore(core));

              // RED by design until the Stack 3 production browser seam is implemented.
              await renderer.loadStack3AcceptanceDistrict('block');

              window.__civic3dStack3 = {
                renderer,
                core,
                canvas,
                serializeCore,
                saveBefore,
              };
            }
            """
        )

        initial = page.evaluate(
            """() => {
              const { renderer } = window.__civic3dStack3;
              return {
                stats: renderer.debugProductionSceneStats(),
                digest: renderer.debugProductionReconstructionDigest(),
                picks: renderer.debugProductionPickIdentities(),
                camera: renderer.reviewCameraState,
              };
            }"""
        )
        assert initial["stats"]["active"] == EXPECTED_BLOCK_ENTITIES, initial
        assert initial["stats"]["created"] == EXPECTED_BLOCK_ENTITIES, initial
        assert initial["stats"]["uniquePrototypes"] == len(ASSET_IDS), initial
        assert 0 < initial["stats"]["estimatedGpuBytes"] <= MAX_ESTIMATED_GPU_BYTES, initial
        assert len(initial["picks"]) == EXPECTED_BLOCK_ENTITIES, initial
        assert len({entry["presentationId"] for entry in initial["picks"]}) == EXPECTED_BLOCK_ENTITIES, initial
        assert len({entry["canonicalId"] for entry in initial["picks"]}) == EXPECTED_BLOCK_ENTITIES, initial
        assert initial["digest"], initial

        district_png = page.locator("#civic-3d-stack3").screenshot(path=str(OUTPUT / "district.png"))
        assert_canvas_has_variance(district_png, "district")

        unchanged = page.evaluate(
            """async () => {
              const { renderer } = window.__civic3dStack3;
              await renderer.loadStack3AcceptanceDistrict('block');
              return {
                stats: renderer.debugProductionSceneStats(),
                digest: renderer.debugProductionReconstructionDigest(),
                picks: renderer.debugProductionPickIdentities(),
              };
            }"""
        )
        assert unchanged["stats"]["created"] == 0, unchanged
        assert unchanged["stats"]["removed"] == 0, unchanged
        assert unchanged["stats"]["replaced"] == 0, unchanged
        assert unchanged["stats"]["unchanged"] == EXPECTED_BLOCK_ENTITIES, unchanged
        assert unchanged["digest"] == initial["digest"], (initial, unchanged)
        assert unchanged["picks"] == initial["picks"], (initial, unchanged)

        camera_after = page.evaluate(
            """async () => {
              const { renderer } = window.__civic3dStack3;
              const before = { zoom: renderer.zoom, turns: renderer.quarterTurns };
              renderer.rotate(1);
              renderer.zoomBy(0.82, 480, 340);
              await renderer.loadStack3AcceptanceDistrict('block');
              return {
                before,
                after: { zoom: renderer.zoom, turns: renderer.quarterTurns },
              };
            }"""
        )
        assert camera_after["after"]["turns"] == (camera_after["before"]["turns"] + 1) % 4, camera_after
        assert camera_after["after"]["zoom"] > camera_after["before"]["zoom"], camera_after
        front_png = page.locator("#civic-3d-stack3").screenshot(path=str(OUTPUT / "front.png"))
        assert_canvas_has_variance(front_png, "front")

        page.evaluate(
            """async () => {
              const { renderer } = window.__civic3dStack3;
              const camera = renderer.reviewCameraState;
              renderer.setReviewCamera({ ...camera, elevationRad: 1.38, radius: camera.radius * 1.08 });
              await renderer.loadStack3AcceptanceDistrict('block');
            }"""
        )
        top_png = page.locator("#civic-3d-stack3").screenshot(path=str(OUTPUT / "top.png"))
        assert_canvas_has_variance(top_png, "top")

        page.evaluate(
            """async () => {
              const { renderer } = window.__civic3dStack3;
              renderer.setVisualTime('night');
              await renderer.loadStack3AcceptanceDistrict('block');
            }"""
        )
        night_png = page.locator("#civic-3d-stack3").screenshot(path=str(OUTPUT / "night.png"))
        assert_canvas_has_variance(night_png, "night")

        save_after = page.evaluate(
            "() => JSON.stringify(window.__civic3dStack3.serializeCore(window.__civic3dStack3.core))"
        )
        assert save_after == page.evaluate("() => window.__civic3dStack3.saveBefore"), (
            "Stack 3 presentation acceptance mutated Save V9 authority"
        )
        save_object = json.loads(save_after)
        assert save_object["saveVersion"] == 9, save_object
        lowered = save_after.lower()
        for forbidden in (
            "productionpresentationentityid",
            "semanticfamily",
            "estimatedgpubytes",
            "reconstructiondigest",
            "babylon",
        ):
            assert forbidden not in lowered, (forbidden, save_object)

        rebuilt = page.evaluate(
            """async () => {
              const acceptance = window.__civic3dStack3;
              const previousDigest = acceptance.renderer.debugProductionReconstructionDigest();
              const previousPicks = acceptance.renderer.debugProductionPickIdentities();
              const camera = acceptance.renderer.reviewCameraState;
              acceptance.renderer.dispose();
              await acceptance.renderer.whenDisposed();
              const { Civic3DWorldRenderer } = await import('http://civic.test/src/rendering/3d/Civic3DWorldRenderer.js');
              const renderer = new Civic3DWorldRenderer(acceptance.canvas);
              await renderer.preloadAssets();
              renderer.setReviewCamera(camera);
              renderer.setVisualTime('night');
              await renderer.loadStack3AcceptanceDistrict('block');
              acceptance.renderer = renderer;
              return {
                previousDigest,
                previousPicks,
                digest: renderer.debugProductionReconstructionDigest(),
                picks: renderer.debugProductionPickIdentities(),
                stats: renderer.debugProductionSceneStats(),
              };
            }"""
        )
        assert rebuilt["digest"] == rebuilt["previousDigest"], rebuilt
        assert rebuilt["picks"] == rebuilt["previousPicks"], rebuilt
        assert rebuilt["stats"]["active"] == EXPECTED_BLOCK_ENTITIES, rebuilt
        assert rebuilt["stats"]["uniquePrototypes"] == len(ASSET_IDS), rebuilt

        final_save = page.evaluate(
            "() => JSON.stringify(window.__civic3dStack3.serializeCore(window.__civic3dStack3.core))"
        )
        assert final_save == save_after, "renderer reconstruction mutated Save V9 authority"

        if errors:
            raise AssertionError(f"browser console/page errors: {errors}")

        page.evaluate("() => window.__civic3dStack3.renderer.dispose()")
        page.evaluate("() => window.__civic3dStack3.renderer.whenDisposed()")
        browser.close()


if __name__ == "__main__":
    main()
