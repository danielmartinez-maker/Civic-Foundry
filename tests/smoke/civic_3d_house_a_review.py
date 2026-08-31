from __future__ import annotations

import json
import mimetypes
import pathlib
from dataclasses import dataclass
from urllib.parse import urlparse

from playwright.sync_api import Page, sync_playwright

from civic_3d_house_a_smoke import assert_canvas_has_variance

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
OUTPUT = DIST / "assets" / "reviews" / "house-a"


@dataclass(frozen=True)
class ReviewScene:
    filename: str
    camera: dict[str, object]
    visual_time: str = "day"
    house_overrides: dict[str, object] | None = None


SCENES = (
    ReviewScene(
        "front_three_quarter.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 2.3561944902, "elevationRad": 0.72},
    ),
    ReviewScene(
        "rear_three_quarter.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 2.34, "elevationRad": 0.72},
    ),
    ReviewScene(
        "top_oblique.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 0.72, "elevationRad": 1.24},
    ),
    ReviewScene(
        "street_distance.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 145, "azimuthRad": 5.48, "elevationRad": 0.82},
    ),
    ReviewScene(
        "neighborhood_distance.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 360, "azimuthRad": 5.48, "elevationRad": 0.88},
    ),
    ReviewScene(
        "night.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 5.48, "elevationRad": 0.72},
        visual_time="night",
    ),
    ReviewScene(
        "worn.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 5.48, "elevationRad": 0.72},
        house_overrides={
            "lifecycle": {
                "condition": 52,
                "structuralCondition": 65,
                "systemsCondition": 58,
                "exteriorCondition": 52,
                "maintenanceBacklog": 18,
                "deferredMaintenanceTicks": 32,
                "effectiveAge": 24,
                "distressScore": 0.2,
            }
        },
    ),
    ReviewScene(
        "construction.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 5.48, "elevationRad": 0.72},
        house_overrides={
            "status": "construction",
            "project": {"phase": "foundation", "progress": 0.55, "kind": "new-build"},
        },
    ),
    ReviewScene(
        "cf_bld_res_detached_house_a_low_v01_review.png",
        {"target": {"x": 120, "y": 0, "z": 100}, "radius": 102.6, "azimuthRad": 5.48, "elevationRad": 0.72},
    ),
)


def route_asset(route, request) -> None:
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


def render_review_scene(page: Page, scene: ReviewScene) -> bytes:
    page.evaluate(
        """({ camera, visualTime, houseOverrides }) => {
          const acceptance = window.__civic3dReview;
          const base = acceptance.houseBase;
          const overrides = houseOverrides ?? {};
          const house = {
            ...base,
            ...overrides,
            lifecycle: { ...base.lifecycle, ...(overrides.lifecycle ?? {}) },
          };
          acceptance.core.buildings.restoreV2([house]);
          acceptance.core.utilitySnapshot = {
            power: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
            water: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
            perBuilding: { [house.id]: { power: 1, water: 1 } },
          };
          acceptance.renderer.setReviewCamera(camera);
          acceptance.renderer.setVisualTime(visualTime);
          acceptance.renderer.draw(acceptance.core, 'none', null);
        }""",
        {
            "camera": scene.camera,
            "visualTime": scene.visual_time,
            "houseOverrides": scene.house_overrides,
        },
    )
    page.evaluate(
        """async () => {
          const acceptance = window.__civic3dReview;
          await acceptance.renderer.whenBuildingSceneIdle();
          acceptance.renderer.draw(acceptance.core, 'none', null);
          for (let index = 0; index < 12; index += 1) acceptance.renderer.scene.render();
        }"""
    )
    page.wait_for_timeout(100)
    page.evaluate(
        """async () => {
          const scene = window.__civic3dReview.renderer.scene;
          for (let index = 0; index < 12; index += 1) {
            await new Promise(resolve => requestAnimationFrame(() => {
              scene.render();
              resolve();
            }));
          }
        }"""
    )
    return page.locator("#civic-3d-review").screenshot(type="png")


def main() -> None:
    if not (DIST / "index.html").is_file():
        raise RuntimeError("dist/index.html is missing; run npm run build first")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    html = (DIST / "index.html").read_text().replace(
        "<head>", '<head><base href="http://civic.test/">', 1
    )
    errors: list[str] = []
    outputs: dict[str, int] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
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
              canvas.id = 'civic-3d-review';
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
              const houseBase = {
                id: 'house-a-review',
                parcelIds: ['parcel:house-a-review'],
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
                developerId: 'developer:review',
                ownerId: 'owner:review',
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
              core.buildings.restoreV2([houseBase]);
              core.utilitySnapshot = {
                power: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
                water: { production: 1, demand: 1, served: 1, unserved: 0, serviceRatio: 1 },
                perBuilding: { [houseBase.id]: { power: 1, water: 1 } },
              };
              const renderer = new Civic3DWorldRenderer(canvas);
              await renderer.preloadAssets();
              renderer.zoomBy(0.12, 450, 320);
              renderer.draw(core, 'none', null);
              await renderer.whenBuildingSceneIdle();
              renderer.draw(core, 'none', null);
              window.__civic3dReview = { renderer, core, canvas, houseBase };
            }
            """
        )

        front_scene = SCENES[0]
        first_front = render_review_scene(page, front_scene)
        for scene in SCENES:
            png = first_front if scene is front_scene else render_review_scene(page, scene)
            output = OUTPUT / scene.filename
            output.write_bytes(png)
            assert_canvas_has_variance(png)
            outputs[scene.filename] = len(png)

        repeat_front = render_review_scene(page, front_scene)
        assert repeat_front == first_front, "front review camera output was not deterministic"

        diagnostics = page.evaluate(
            """() => ({
              backend: window.__civic3dReview.renderer.debugEngineBackend(),
              camera: window.__civic3dReview.renderer.reviewCameraState,
              diagnostics: window.__civic3dReview.renderer.assetDiagnostics(),
            })"""
        )
        assert diagnostics["backend"] in {"webgpu", "webgl"}, diagnostics
        assert not any("failed" in item.lower() for item in diagnostics["diagnostics"]), diagnostics
        assert not any("error" in item.lower() for item in diagnostics["diagnostics"]), diagnostics
        page.evaluate(
            """async () => {
              const renderer = window.__civic3dReview.renderer;
              renderer.dispose();
              await renderer.whenDisposed();
            }"""
        )
        browser.close()

    if errors:
        raise AssertionError("browser errors: " + repr(errors))

    print(
        "CIVIC_3D_HOUSE_A_REVIEW_PASS",
        {"backend": diagnostics["backend"], "outputs": outputs, "directory": str(OUTPUT)},
        flush=True,
    )


if __name__ == "__main__":
    main()
