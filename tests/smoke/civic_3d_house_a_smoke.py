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
        "size": (width, height),
        "sample_count": len(luminance),
        "luminance_min": min(luminance) if luminance else None,
        "luminance_max": max(luminance) if luminance else None,
        "luminance_span": (max(luminance) - min(luminance)) if luminance else None,
        "color_count": len(colors),
    }
    print("CIVIC_3D_VISUAL_METRICS", metrics, flush=True)

    assert width >= 600 and height >= 400, ("canvas too small", metrics)
    assert len(luminance) > 100, ("too few visible samples", metrics)
    assert max(luminance) - min(luminance) > 20, (
        "insufficient 3d luminance range",
        metrics,
    )
    assert len(colors) > 12, ("insufficient 3d color variation", metrics)


def main() -> None:
    required = [
        DIST / "src/rendering/3d/Civic3DWorldRenderer.js",
        DIST / "assets/manifests/catalog-v2.json",
        DIST / "assets/models/cf_bld_res_detached_house_a_low_v01_lod0.glb",
        DIST / "assets/models/cf_bld_res_detached_house_a_low_v01_lod1.glb",
        DIST / "assets/models/cf_bld_res_detached_house_a_low_v01_lod2.glb",
        DIST / "assets/collisions/cf_bld_res_detached_house_a_low_v01_collision.glb",
    ]
    for path in required:
        if not path.is_file() or path.stat().st_size <= 0:
            raise RuntimeError(f"required 3D acceptance artifact missing or empty: {path}")

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
              const [{ Civic3DWorldRenderer }, { SimulationCore }, { serializeCore }, { resolvePresentationBackend }] = await Promise.all([
                import('http://civic.test/src/rendering/3d/Civic3DWorldRenderer.js'),
                import('http://civic.test/src/simulation/core/SimulationCore.js'),
                import('http://civic.test/src/save/save.js'),
                import('http://civic.test/src/rendering/PresentationRendererFactory.js'),
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
                id: 'house-a-calibration-1',
                parcelIds: ['parcel:house-a-calibration-1'],
                typologyId: 'typology:residential_cottage',
                footprint: [
                  { x: 115.5, y: 94 },
                  { x: 124.5, y: 94 },
                  { x: 124.5, y: 106 },
                  { x: 115.5, y: 106 },
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
              const houseB = {
                ...house,
                id: 'house-a-calibration-2',
                parcelIds: ['parcel:house-a-calibration-2'],
                footprint: [
                  { x: 99.5, y: 94 },
                  { x: 108.5, y: 94 },
                  { x: 108.5, y: 106 },
                  { x: 99.5, y: 106 },
                ],
              };
              core.buildings.restoreV2([house, houseB]);
              core.utilitySnapshot = {
                power: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
                water: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
                perBuilding: Object.freeze({
                  [house.id]: { power: 1, water: 1 },
                  [houseB.id]: { power: 1, water: 1 },
                }),
              };

              const renderer = new Civic3DWorldRenderer(canvas);
              await renderer.preloadAssets();
              renderer.zoomBy(0.12, 450, 320);
              renderer.draw(core, 'none', null);
              await renderer.whenBuildingSceneIdle();
              renderer.draw(core, 'none', null);
              window.__civic3dAcceptance = {
                renderer,
                core,
                canvas,
                serializeCore,
                resolvePresentationBackend,
                saveBeforeCamera: JSON.stringify(serializeCore(core)),
              };
            }
            """
        )

        page.wait_for_function(
            """() => {
              const acceptance = window.__civic3dAcceptance;
              if (!acceptance) return false;
              acceptance.renderer.draw(acceptance.core, 'none', null);
              const stats = acceptance.renderer.debugSceneStats();
              return stats.loadedPrototypes >= 1 && stats.buildingInstances === 2;
            }""",
            timeout=15_000,
        )

        stats = page.evaluate("() => window.__civic3dAcceptance.renderer.debugSceneStats()")
        building_debug = page.evaluate(
            "() => window.__civic3dAcceptance.renderer.debugBuildingState('building:house-a-calibration-1')"
        )
        building_b_debug = page.evaluate(
            "() => window.__civic3dAcceptance.renderer.debugBuildingState('building:house-a-calibration-2')"
        )
        engine_backend = page.evaluate(
            "() => window.__civic3dAcceptance.renderer.debugEngineBackend()"
        )
        backend_from_query = page.evaluate(
            "() => window.__civic3dAcceptance.resolvePresentationBackend('?renderer=civic-3d')"
        )
        assert stats["backend"] == "civic-3d", stats
        assert engine_backend in {"webgpu", "webgl"}, engine_backend
        assert backend_from_query == "civic-3d", backend_from_query
        assert stats["loadedPrototypes"] == 1, stats
        assert stats["buildingInstances"] == 2, stats
        assert stats["fallbackBuildings"] == 0, stats
        assert stats["assetRequests"] >= 1, stats
        assert stats["cacheMisses"] >= 1, stats
        assert building_debug is not None, building_debug
        assert building_debug["assetId"] == "cf_bld_res_detached_house_a_low_v01", building_debug
        assert building_debug["lod"] in {"lod0", "lod1", "lod2"}, building_debug
        assert isinstance(building_debug["variationSeed"], int), building_debug
        assert building_debug["structuralHandleId"].startswith("building:house-a-calibration-1:structural:"), building_debug
        assert building_b_debug is not None, building_b_debug
        assert building_b_debug["assetId"] == building_debug["assetId"], (building_debug, building_b_debug)
        assert building_b_debug["lod"] == building_debug["lod"], (building_debug, building_b_debug)

        before = page.evaluate(
            """() => ({
              zoom: window.__civic3dAcceptance.renderer.zoom,
              turns: window.__civic3dAcceptance.renderer.quarterTurns,
            })"""
        )
        page.evaluate(
            """async () => {
              const { renderer, core } = window.__civic3dAcceptance;
              renderer.rotate(1);
              renderer.zoomBy(0.95, 450, 320);
              renderer.draw(core, 'none', null);
              await renderer.whenBuildingSceneIdle();
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

        pick = page.evaluate(
            """() => {
              const { renderer, core } = window.__civic3dAcceptance;
              const point = renderer.worldToCanvas(120, 100, core);
              return {
                point,
                id: renderer.pickPresentationEntity(point.x, point.y),
              };
            }"""
        )
        assert pick["id"] == "building:house-a-calibration-1", pick

        save_before_camera = page.evaluate(
            "() => window.__civic3dAcceptance.saveBeforeCamera"
        )
        save_before_camera_object = json.loads(save_before_camera)
        assert save_before_camera_object["saveVersion"] == 9, save_before_camera_object
        assert save_before_camera_object["gameVersion"] == "0.9.0-urban-fabric", save_before_camera_object
        assert "babylon" not in save_before_camera.lower(), save_before_camera
        assert "structuralhandleid" not in save_before_camera.lower(), save_before_camera
        assert "pipeline" not in save_before_camera.lower(), save_before_camera

        save_after_camera = page.evaluate(
            "() => JSON.stringify(window.__civic3dAcceptance.serializeCore(window.__civic3dAcceptance.core))"
        )
        assert save_after_camera == save_before_camera, "camera interaction mutated Save V9 authority"

        rebuild_baseline = page.evaluate(
            """() => ({
              camera: window.__civic3dAcceptance.renderer.reviewCameraState,
              a: window.__civic3dAcceptance.renderer.debugBuildingState('building:house-a-calibration-1'),
              b: window.__civic3dAcceptance.renderer.debugBuildingState('building:house-a-calibration-2'),
            })"""
        )
        page.evaluate(
            """async ({ camera }) => {
              const acceptance = window.__civic3dAcceptance;
              acceptance.renderer.dispose();
              await acceptance.renderer.whenDisposed();
              const { Civic3DWorldRenderer } = await import('http://civic.test/src/rendering/3d/Civic3DWorldRenderer.js');
              const renderer = new Civic3DWorldRenderer(acceptance.canvas);
              await renderer.preloadAssets();
              renderer.setReviewCamera(camera);
              renderer.draw(acceptance.core, 'none', null);
              await renderer.whenBuildingSceneIdle();
              renderer.draw(acceptance.core, 'none', null);
              acceptance.renderer = renderer;
            }""",
            {"camera": rebuild_baseline["camera"]},
        )
        page.wait_for_function(
            "() => window.__civic3dAcceptance.renderer.debugSceneStats().buildingInstances === 2",
            timeout=15_000,
        )
        rebuilt_a = page.evaluate(
            "() => window.__civic3dAcceptance.renderer.debugBuildingState('building:house-a-calibration-1')"
        )
        rebuilt_b = page.evaluate(
            "() => window.__civic3dAcceptance.renderer.debugBuildingState('building:house-a-calibration-2')"
        )
        rebuilt_stats = page.evaluate(
            "() => window.__civic3dAcceptance.renderer.debugSceneStats()"
        )
        assert rebuilt_stats["loadedPrototypes"] == 1, rebuilt_stats
        assert rebuilt_a["assetId"] == rebuild_baseline["a"]["assetId"], (rebuild_baseline, rebuilt_a)
        assert rebuilt_a["lod"] == rebuild_baseline["a"]["lod"], (rebuild_baseline, rebuilt_a)
        assert rebuilt_a["variationSeed"] == rebuild_baseline["a"]["variationSeed"], (rebuild_baseline, rebuilt_a)
        assert rebuilt_b["assetId"] == rebuild_baseline["b"]["assetId"], (rebuild_baseline, rebuilt_b)
        assert rebuilt_b["lod"] == rebuild_baseline["b"]["lod"], (rebuild_baseline, rebuilt_b)
        assert rebuilt_b["variationSeed"] == rebuild_baseline["b"]["variationSeed"], (rebuild_baseline, rebuilt_b)
        save_after_rebuild = page.evaluate(
            "() => JSON.stringify(window.__civic3dAcceptance.serializeCore(window.__civic3dAcceptance.core))"
        )
        assert save_after_rebuild == save_before_camera, "renderer rebuild mutated Save V9 authority"

        page.wait_for_timeout(100)
        page.evaluate(
            """() => {
              const scene = window.__civic3dAcceptance.renderer.scene;
              for (let index = 0; index < 12; index += 1) scene.render();
            }"""
        )
        png = page.locator("#civic-3d-acceptance").screenshot(type="png")
        screenshot_path = OUTPUT / "house_a_browser.png"
        screenshot_path.write_bytes(png)

        scene_diagnostics = page.evaluate(
            """() => {
              const { renderer, core } = window.__civic3dAcceptance;
              const scene = renderer.scene;
              const camera = renderer.camera;
              if (!scene || !camera) return { missingScene: true };
              const presentationId = 'building:house-a-calibration-1';
              const nodes = [...scene.transformNodes, ...scene.meshes]
                .filter(node => node.metadata?.presentationEntityId === presentationId)
                .map(node => {
                  node.computeWorldMatrix?.(true);
                  let bounds = null;
                  if (typeof node.getBoundingInfo === 'function') {
                    const box = node.getBoundingInfo().boundingBox;
                    bounds = {
                      minimumWorld: { x: box.minimumWorld.x, y: box.minimumWorld.y, z: box.minimumWorld.z },
                      maximumWorld: { x: box.maximumWorld.x, y: box.maximumWorld.y, z: box.maximumWorld.z },
                    };
                  }
                  const absolute = typeof node.getAbsolutePosition === 'function'
                    ? node.getAbsolutePosition()
                    : null;
                  return {
                    name: node.name,
                    className: node.getClassName?.() ?? 'unknown',
                    isEnabled: node.isEnabled?.() ?? null,
                    isVisible: typeof node.isVisible === 'boolean' ? node.isVisible : null,
                    visibility: typeof node.visibility === 'number' ? node.visibility : null,
                    totalVertices: typeof node.getTotalVertices === 'function' ? node.getTotalVertices() : null,
                    absolutePosition: absolute ? { x: absolute.x, y: absolute.y, z: absolute.z } : null,
                    bounds,
                  };
                });
              const projectedCenter = renderer.worldToCanvas(120, 100, core);
              return {
                publicBuildingState: renderer.debugBuildingState(presentationId),
                engineBackend: renderer.debugEngineBackend(),
                camera: {
                  alpha: camera.alpha,
                  beta: camera.beta,
                  radius: camera.radius,
                  target: { x: camera.target.x, y: camera.target.y, z: camera.target.z },
                  position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                },
                projectedCenter,
                sceneMeshCount: scene.meshes.length,
                sceneTransformNodeCount: scene.transformNodes.length,
                presentationNodeCount: nodes.length,
                nodes,
              };
            }"""
        )
        print("CIVIC_3D_SCENE_DIAGNOSTICS", scene_diagnostics, flush=True)
        (OUTPUT / "runtime_geometry.json").write_text(
            json.dumps(scene_diagnostics, indent=2, sort_keys=True), encoding="utf-8"
        )
        assert_canvas_has_variance(png)

        diagnostics = page.evaluate(
            "() => [...window.__civic3dAcceptance.renderer.assetDiagnostics()]"
        )
        print(
            "CIVIC_3D_RUNTIME_DIAGNOSTICS",
            {
                "stats": stats,
                "building": building_debug,
                "engine": engine_backend,
                "diagnostics": diagnostics,
                "browser_errors": errors,
            },
            flush=True,
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
