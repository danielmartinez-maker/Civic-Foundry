from __future__ import annotations

import json
import mimetypes
import pathlib
from urllib.parse import urlparse

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
SHOT_DIR = pathlib.Path("/tmp/civic-foundry-gpu-overlay-parity")


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


def changed_pixel_ratio(reference: pathlib.Path, candidate: pathlib.Path) -> float:
    with Image.open(reference).convert("RGB") as left, Image.open(candidate).convert("RGB") as right:
        if left.size != right.size:
            raise AssertionError(f"visual size mismatch: {left.size} != {right.size}")
        diff = ImageChops.difference(left, right).convert("L")
        histogram = diff.histogram()
        changed = sum(histogram[1:])
        return changed / float(left.width * left.height)


def main() -> None:
    if not (DIST / "src/main.js").is_file():
        raise RuntimeError("dist build missing; run npm run build first")

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    html = (DIST / "index.html").read_text().replace(
        "<head>", '<head><base href="http://civic.test/">', 1
    )
    errors: list[str] = []
    visual_ratios: dict[str, float] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 1720, "height": 1080})
        page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        page.on(
            "console",
            lambda message: errors.append(f"console: {message.text}")
            if message.type == "error"
            else None,
        )
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        setup = page.evaluate(
            """
            async () => {
              const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
              const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
              const app = window.__civicApp;
              const width = 40;
              const height = 24;
              const cells = Array.from({ length: width * height }, () => ({
                elevation: 0.5,
                water: false,
                buildable: true,
                biome: 'grass',
              }));
              app.core = new SimulationCore({
                terrain: new TerrainGrid(width, height, cells),
                seed: 9090,
                startingFunds: 2_000_000,
              });

              const spine = app.core.buildRoad(
                Array.from({ length: width }, (_, x) => ({ x, y: 12 })),
                'collector',
              );
              if (!spine.ok) throw new Error(spine.reason ?? 'collector spine setup failed');
              const cross = app.core.buildRoad(
                Array.from({ length: 17 }, (_, index) => ({ x: 18, y: index + 4 })),
                'local',
              );
              if (!cross.ok) throw new Error(cross.reason ?? 'cross street setup failed');

              for (let x = 4; x <= 14; x += 1) app.core.paintZone([{ x, y: 11 }], 'residential');
              for (let x = 20; x <= 27; x += 1) app.core.paintZone([{ x, y: 11 }], 'commercial');
              for (let x = 28; x <= 36; x += 1) app.core.paintZone([{ x, y: 11 }], 'industrial');

              for (const [x, y] of [[6, 13], [10, 13], [14, 13]]) app.core.placeUtility('power', x, y);
              for (const [x, y] of [[20, 13], [24, 13], [28, 13]]) app.core.placeUtility('water', x, y);
              for (const [x, y] of [[30, 13], [33, 13], [36, 13]]) app.core.placeUtility('landfill', x, y);

              const firstStop = app.core.transit.placeStop('surface_stop', 2, 13, app.core.treasury).id;
              const secondStop = app.core.transit.placeStop('surface_stop', 37, 13, app.core.treasury).id;
              if (!firstStop || !secondStop) throw new Error('transit stop setup failed');
              const lineId = app.core.transit.createLine('bus');
              app.core.transit.setLineStops(lineId, [firstStop, secondStop]);
              app.core.transit.setHeadway(lineId, 30);
              app.core.transit.setFare(lineId, 1);
              app.core.transit.setEnabled(lineId, true);

              app.core.transportationGraph.rebuildIfNeeded(app.core.roads);
              for (let ticks = 0; ticks < 3500; ticks += 25) {
                app.core.step(25);
                const economy = app.core.economyDomain.snapshot(app.core.clock.tick);
                if (
                  app.core.buildings.occupied().length > 0 &&
                  economy.activeFirms > 0 &&
                  app.core.economyDomain.freightVehicles.activeCount() > 0 &&
                  app.core.economyDomain.trade.listGateways().length > 0
                ) break;
              }

              if (app.core.economyDomain.freightVehicles.activeCount() === 0) {
                const gateways = app.core.economyDomain.trade.listGateways();
                let origin = null;
                let destination = null;
                let route = null;
                for (const candidateOrigin of gateways) {
                  for (const candidateDestination of gateways) {
                    if (candidateOrigin.id === candidateDestination.id) continue;
                    const candidateRoute = app.core.pathfinding.findRoute(
                      app.core.transportationGraph,
                      candidateOrigin.nodeId,
                      candidateDestination.nodeId,
                      { costKey: 'gpu-overlay-parity-smoke-freight' },
                    );
                    if (!candidateRoute || candidateRoute.edgeIds.length === 0) continue;
                    origin = candidateOrigin;
                    destination = candidateDestination;
                    route = candidateRoute;
                    break;
                  }
                  if (route) break;
                }
                if (!origin || !destination || !route) {
                  throw new Error('freight overlay smoke fixture could not find a gateway route');
                }
                const tick = app.core.clock.tick;
                app.core.economyDomain.freightVehicles.dispatch(
                  {
                    id: 'smoke-shipment:gpu-overlay-parity',
                    orderId: 'smoke-order:gpu-overlay-parity',
                    commodity: 'manufactured_goods',
                    quantity: 10,
                    vehicleWeight: 2,
                    originKind: 'gateway',
                    originId: origin.id,
                    destinationKind: 'gateway',
                    destinationId: destination.id,
                    originNodeId: origin.nodeId,
                    destinationNodeId: destination.nodeId,
                    createdTick: tick,
                    generalizedCost: route.totalCost,
                  },
                  route,
                  tick,
                );
              }
              app.core.clock.setSpeed(0);

              const parcel = app.core.cadastre.listParcels()[0];
              if (!parcel) throw new Error('cadastre setup produced no parcel');
              app.core.zoning.assignParcel(parcel.id, 'R5');

              await app.renderer.preloadAssets();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const economy = app.core.economyDomain.snapshot(app.core.clock.tick);
              return {
                tick: app.core.clock.tick,
                occupied: app.core.buildings.occupied().length,
                firms: economy.activeFirms,
                freight: app.core.economyDomain.freightVehicles.activeCount(),
                gateways: app.core.economyDomain.trade.listGateways().length,
                graphEdges: app.core.transportationGraph.edges.length,
                transitStops: app.core.transit.listStops().length,
                transitLines: app.core.transit.listLines().length,
                parcels: app.core.cadastre.listParcels().length,
                parcelId: parcel.id,
              };
            }
            """
        )
        assert setup["occupied"] > 0, setup
        assert setup["firms"] > 0, setup
        assert setup["freight"] > 0, setup
        assert setup["gateways"] > 0, setup
        assert setup["graphEdges"] > 0, setup
        assert setup["transitStops"] == 2, setup
        assert setup["transitLines"] == 1, setup
        assert setup["parcels"] > 0, setup

        canvas = page.locator('[data-testid="world-canvas"]')

        def select_mode(testid: str, family: str, mode: str, require_active: bool = True):
            page.locator(f'[data-testid="{testid}"]').select_option(mode)
            page.wait_for_timeout(80)
            stats = page.evaluate("() => window.__civicApp.renderer.debugOverlayStats()")
            if require_active:
                assert stats[family]["active"] > 0, (testid, family, mode, stats)
            return stats

        page.locator('[data-testid="traffic-overlay"]').select_option("none")
        page.locator('[data-testid="service-overlay"]').select_option("none")
        page.locator('[data-testid="transit-overlay"]').select_option("none")
        page.locator('[data-testid="economy-overlay"]').select_option("none")
        page.evaluate("() => window.__civicApp.renderer.setUrbanFabricOverlay('none', null)")
        page.wait_for_timeout(100)

        base_stats = page.evaluate("() => window.__civicApp.renderer.debugSceneStats()")
        base_shot = SHOT_DIR / "base.png"
        canvas.screenshot(path=str(base_shot))
        assert base_shot.stat().st_size > 10_000

        traffic_modes = ["congestion", "speed", "volume", "bottlenecks"]
        for mode in traffic_modes:
            select_mode("traffic-overlay", "traffic", mode, require_active=mode != "bottlenecks")
        traffic_first = select_mode("traffic-overlay", "traffic", "congestion")
        page.wait_for_timeout(120)
        traffic_stable = page.evaluate("() => window.__civicApp.renderer.debugOverlayStats()")
        assert traffic_stable["traffic"]["created"] == traffic_first["traffic"]["created"]
        assert traffic_stable["traffic"]["updated"] == traffic_first["traffic"]["updated"]
        traffic_shot = SHOT_DIR / "traffic-congestion.png"
        canvas.screenshot(path=str(traffic_shot))

        service_modes = ["quality", "fire", "police", "healthcare", "education", "garbage"]
        for mode in service_modes:
            select_mode("service-overlay", "service", mode)
        service_shot = SHOT_DIR / "service-quality.png"
        select_mode("service-overlay", "service", "quality")
        canvas.screenshot(path=str(service_shot))

        transit_modes = [
            "routes",
            "access",
            "ridership",
            "crowding",
            "wait",
            "reliability",
            "mode-share",
            "accessibility",
        ]
        for mode in transit_modes:
            select_mode("transit-overlay", "transit", mode)
        transit_ridership_shot = SHOT_DIR / "transit-ridership.png"
        select_mode("transit-overlay", "transit", "ridership")
        canvas.screenshot(path=str(transit_ridership_shot))
        transit_crowding_shot = SHOT_DIR / "transit-crowding.png"
        select_mode("transit-overlay", "transit", "crowding")
        canvas.screenshot(path=str(transit_crowding_shot))
        page.locator('[data-testid="transit-overlay"]').select_option("none")
        page.wait_for_timeout(80)
        transit_none = page.evaluate("() => window.__civicApp.renderer.debugOverlayStats()")
        assert transit_none["transit"]["active"] == 0, transit_none

        economy_cell_modes = ["firm-health", "jobs", "production", "shortages"]
        economy_route_modes = ["freight-volume", "freight-routes", "logistics-delay"]
        economy_gateway_modes = ["gateways", "trade-flow"]
        for mode in economy_cell_modes + economy_route_modes + economy_gateway_modes:
            select_mode("economy-overlay", "economy", mode)
        economy_freight_shot = SHOT_DIR / "economy-freight-routes.png"
        select_mode("economy-overlay", "economy", "freight-routes")
        canvas.screenshot(path=str(economy_freight_shot))
        economy_gateway_shot = SHOT_DIR / "economy-gateways.png"
        select_mode("economy-overlay", "economy", "gateways")
        canvas.screenshot(path=str(economy_gateway_shot))
        page.locator('[data-testid="economy-overlay"]').select_option("none")
        page.wait_for_timeout(80)

        cadastre_stats = page.evaluate(
            """(parcelId) => {
              const app = window.__civicApp;
              app.renderer.setUrbanFabricOverlay('cadastre', parcelId);
              app.renderer.draw(app.core, 'none', null);
              return app.renderer.debugOverlayStats();
            }""",
            setup["parcelId"],
        )
        assert cadastre_stats["cadastre"]["active"] > 0, cadastre_stats
        page.wait_for_timeout(60)
        cadastre_shot = SHOT_DIR / "cadastre.png"
        canvas.screenshot(path=str(cadastre_shot))

        zoning_stats = page.evaluate(
            """(parcelId) => {
              const app = window.__civicApp;
              app.renderer.setUrbanFabricOverlay('zoning-envelope', parcelId);
              app.renderer.draw(app.core, 'none', null);
              return app.renderer.debugOverlayStats();
            }""",
            setup["parcelId"],
        )
        assert zoning_stats["zoningEnvelope"]["active"] >= 3, zoning_stats
        page.wait_for_timeout(60)
        zoning_shot = SHOT_DIR / "zoning-envelope.png"
        canvas.screenshot(path=str(zoning_shot))

        after_modes = page.evaluate("() => window.__civicApp.renderer.debugSceneStats()")
        assert after_modes["staticCreated"] == base_stats["staticCreated"], (base_stats, after_modes)

        overlay_created_before_camera = page.evaluate(
            "() => window.__civicApp.renderer.debugOverlayStats().zoningEnvelope.created"
        )
        page.evaluate(
            """() => {
              const app = window.__civicApp;
              app.renderer.pan(17, -11);
              app.renderer.zoomBy(1.04, 420, 320);
              app.renderer.rotateQuarter(1);
              app.renderer.draw(app.core, 'none', null);
            }"""
        )
        camera_stats = page.evaluate(
            """() => ({
              scene: window.__civicApp.renderer.debugSceneStats(),
              overlays: window.__civicApp.renderer.debugOverlayStats(),
            })"""
        )
        assert camera_stats["scene"]["staticCreated"] == base_stats["staticCreated"]
        assert camera_stats["overlays"]["zoningEnvelope"]["created"] == overlay_created_before_camera
        assert camera_stats["overlays"]["zoningEnvelope"]["updated"] > zoning_stats["zoningEnvelope"]["updated"]

        visual_files = {
            "traffic": traffic_shot,
            "service": service_shot,
            "transit-ridership": transit_ridership_shot,
            "transit-crowding": transit_crowding_shot,
            "economy-freight": economy_freight_shot,
            "economy-gateways": economy_gateway_shot,
            "cadastre": cadastre_shot,
            "zoning-envelope": zoning_shot,
        }
        for name, shot in visual_files.items():
            assert shot.is_file() and shot.stat().st_size > 10_000, (name, shot)
            ratio = changed_pixel_ratio(base_shot, shot)
            visual_ratios[name] = ratio
            assert ratio > 0.00005, (name, ratio)

        browser.close()

    if errors:
        raise AssertionError("browser errors: " + json.dumps(errors))

    print(
        "GPU_OVERLAY_PARITY_SMOKE_PASS",
        json.dumps(
            {
                "setup": setup,
                "base": base_stats,
                "final": camera_stats,
                "visualRatios": visual_ratios,
                "screenshots": str(SHOT_DIR),
            },
            sort_keys=True,
        ),
    )


if __name__ == "__main__":
    main()