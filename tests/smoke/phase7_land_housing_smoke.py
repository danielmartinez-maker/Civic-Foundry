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
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.route("http://civic.test/**", route_asset)
        page.set_content(html, wait_until="domcontentloaded")
        page.wait_for_function("() => !!window.__civicApp")

        assert page.locator('[data-testid="land-housing-panel"]').is_visible()
        assert page.locator('[data-testid="land-housing-overlay"]').is_visible()
        assert page.locator('[data-testid="land-housing-overlay-canvas"]').is_visible()
        assert page.locator('[data-testid="development-policy-controls"]').is_visible()
        assert page.locator('[data-testid="urban-fabric-overlay"]').is_visible()

        page.locator('[data-testid="urban-fabric-overlay"]').select_option("cadastre")
        assert page.locator('[data-testid="urban-fabric-overlay"]').input_value() == "cadastre"
        assert page.evaluate("window.__civicApp.urbanFabricOverlayMode") == "cadastre"
        assert page.locator('[data-testid="traffic-overlay"]').input_value() == "none"
        assert page.locator('[data-testid="service-overlay"]').input_value() == "none"
        assert page.locator('[data-testid="transit-overlay"]').input_value() == "none"
        assert page.locator('[data-testid="economy-overlay"]').input_value() == "none"
        assert page.locator('[data-testid="land-housing-overlay"]').input_value() == "none"
        assert "Cadastre" in page.locator('#overlay-legend').inner_text()

        page.locator('[data-testid="traffic-overlay"]').select_option("congestion")
        assert page.locator('[data-testid="urban-fabric-overlay"]').input_value() == "none"

        setup = page.evaluate("""
        async () => {
          const { SimulationCore } = await import('http://civic.test/src/simulation/core/SimulationCore.js');
          const { TerrainGrid } = await import('http://civic.test/src/world/terrain/TerrainGrid.js');
          const app = window.__civicApp;
          const width=40,height=24;
          const cells=Array.from({length:width*height},()=>({elevation:.5,water:false,buildable:true,biome:'grass'}));
          app.core=new SimulationCore({terrain:new TerrainGrid(width,height,cells),seed:7070,startingFunds:1000000});
          app.core.buildRoad(Array.from({length:20},(_,x)=>({x:x+2,y:12})),'local');
          for(let x=4;x<=8;x++) app.core.paintZone([{x,y:11}],'residential');
          app.core.placeUtility('power',5,13);
          app.core.placeUtility('water',8,13);
          const lots=app.core.lots.list().filter(l=>l.zone==='residential').sort((a,b)=>a.id.localeCompare(b.id));
          app.core.buildings.restore(lots.map(l=>({id:`building:${l.id}`,lotId:l.id,x:l.x,y:l.y,zone:'residential',definitionId:'residential_cottage',status:'occupied',constructionStartedTick:0,completionTick:0})));
          app.core.population.restore(20);
          app.core.step(10);
          app.core.clock.setSpeed(0);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const building=app.core.buildings.occupied().filter(b=>b.zone==='residential').sort((a,b)=>a.id.localeCompare(b.id))[0];
          app.selected={x:building.x,y:building.y};
          app.renderInspector();
          return {buildingId:building.id};
        }
        """)

        panel = page.locator('[data-testid="land-housing-panel"]').inner_text()
        for label in [
            "Residential market", "Physical capacity", "Affordability", "High-pressure parcels",
            "Renter share", "Owner share", "Rental vacancy", "Ownership vacancy",
            "Average asking rent", "Average owner cost", "Moved this cycle", "Displaced this cycle",
            "Rehoused displaced", "Failed searches", "Lower-income affordable slack",
        ]:
            assert label in panel

        inspector = page.locator('#inspector-content').inner_text()
        for label in [
            "Housing occupancy", "Affordability", "Average rent burden", "Tenure mix",
            "Rental occupancy", "Ownership occupancy", "Asking rent", "Owner monthly cost",
            "Moved in this cycle", "Moved out this cycle", "Displaced this cycle",
            "Redevelopment pressure", "Redevelopment status",
        ]:
            assert label in inspector

        page.locator('[data-testid="urban-fabric-overlay"]').select_option("zoning-envelope")
        parcel_click = page.evaluate("""
        () => {
          const app = window.__civicApp;
          const lot = app.core.lots.list().filter(item => item.zone === 'residential').sort((a,b)=>a.id.localeCompare(b.id))[0];
          if (!lot) throw new Error('expected residential lot');
          const parcelId = app.tools.parcelIdAt(app.core, lot.x, lot.y);
          if (!parcelId) throw new Error('expected cadastral parcel');
          const center = app.renderer.worldToCanvas(lot.x, lot.y, app.core);
          return { parcelId, x: center.x, y: center.y };
        }
        """)
        canvas_box = page.locator('[data-testid="world-canvas"]').bounding_box()
        assert canvas_box is not None
        page.mouse.click(canvas_box["x"] + parcel_click["x"], canvas_box["y"] + parcel_click["y"])
        parcel_inspector = page.locator('#inspector-content').inner_text()
        assert f"Parcel {parcel_click['parcelId']}" in parcel_inspector
        for label in ["Area", "Frontage", "District", "Allowed FAR", "Effective FAR", "Height", "Coverage", "Lineage"]:
            assert label in parcel_inspector
        assert page.evaluate("window.__civicApp.renderer.currentUrbanFabricSelectedParcelId") == parcel_click["parcelId"]

        page.locator('[data-testid="policy-density-bonus"]').select_option("1")
        page.locator('[data-testid="policy-affordable-share"]').fill("20")
        page.locator('[data-testid="policy-development-fee"]').fill("5")
        page.locator('[data-testid="policy-permitting-incentive"]').fill("25")
        page.locator('[data-testid="policy-redevelopment-floor"]').fill("95")
        page.locator('[data-testid="policy-lower-income-relocation"]').fill("90")
        page.locator('[data-testid="apply-development-policy"]').click()
        policy = page.evaluate("window.__civicApp.core.developmentPolicySnapshot")
        assert policy == {
            "densityBonus": 1,
            "affordableHousingShare": 0.2,
            "developmentFeeRate": 0.05,
            "permittingCostReduction": 0.25,
            "redevelopmentAffordableFloor": 0.95,
            "lowerIncomeRelocationProtection": 0.9,
        }
        assert "Policy applied" in page.locator('[data-policy-status]').inner_text()

        page.locator('[data-testid="economy-overlay"]').select_option("firm-health")
        page.locator('[data-testid="land-housing-overlay"]').select_option("affordability")
        assert page.locator('[data-testid="economy-overlay"]').input_value() == "none"
        assert "Housing affordability" in page.locator('#overlay-legend').inner_text()

        page.locator('[data-testid="land-housing-overlay"]').select_option("tenure")
        assert "Housing tenure" in page.locator('#overlay-legend').inner_text()
        page.locator('[data-testid="land-housing-overlay"]').select_option("relocation-pressure")
        assert "Relocation pressure" in page.locator('#overlay-legend').inner_text()

        save_load = page.evaluate("""
        async () => {
          const { serializeCore, hydrateCore } = await import('http://civic.test/src/save/save.js');
          const app = window.__civicApp;
          const save = serializeCore(app.core);
          const before = JSON.stringify(save.housingState);
          app.core = hydrateCore(structuredClone(save));
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const after = JSON.stringify(app.core.housingRelocation.snapshotState());
          return {same: before === after, policy: app.core.developmentPolicySnapshot};
        }
        """)
        assert save_load["same"] is True
        assert save_load["policy"]["lowerIncomeRelocationProtection"] == 0.9

        displacement = page.evaluate("""
        async () => {
          const app = window.__civicApp;
          const target = Object.values(app.core.housingRelocationSnapshot.byBuilding)
            .filter(item => item.assignedResidents > 0)
            .sort((a,b)=>a.buildingId.localeCompare(b.buildingId))[0];
          if (!target) throw new Error('expected assigned residential building');
          const building = app.core.buildings.getById(target.buildingId);
          if (!building) throw new Error('expected residential building');
          const result = app.core.bulldozeAt(building.x, building.y);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return {result, relocation: app.core.housingRelocationSnapshot};
        }
        """)
        assert displacement["result"]["ok"] is True
        assert displacement["result"]["kind"] == "building"
        assert displacement["relocation"]["displacedResidentsThisCycle"] > 0
        represented = displacement["relocation"]["housedResidents"] + displacement["relocation"]["unplacedResidents"]
        assert abs(represented - displacement["relocation"]["population"]) < 1e-6

        page.locator('[data-testid="traffic-overlay"]').select_option("congestion")
        assert page.locator('[data-testid="land-housing-overlay"]').input_value() == "none"
        assert "Congestion" in page.locator('#overlay-legend').inner_text()

        browser.close()

    if errors:
        raise AssertionError("browser page errors: " + repr(errors))
    print("PHASE7_TENURE_RELOCATION_SMOKE_PASS", {
        "setup": setup,
        "policy": policy,
        "save_load": save_load,
        "displaced": displacement["relocation"]["displacedResidentsThisCycle"],
    })


if __name__ == "__main__":
    main()