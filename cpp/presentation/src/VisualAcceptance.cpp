#include <civic/presentation/VisualAcceptance.hpp>

#include <cstdint>
#include <string>
#include <utility>

namespace civic::presentation {
namespace {

FrameSnapshot baseTerrain(RenderRevision revision = 1) {
    FrameSnapshot snapshot{};
    snapshot.revision = revision;
    snapshot.world = {16U, 16U};
    for (std::uint32_t y = 0; y < snapshot.world.height; ++y) {
        for (std::uint32_t x = 0; x < snapshot.world.width; ++x) {
            snapshot.terrain.push_back({
                "terrain:" + std::to_string(x) + ":" + std::to_string(y),
                revision,
                x,
                y,
                ((x + y) % 17U == 0U) ? TerrainBiome::Rock : TerrainBiome::Plains,
                true,
                false,
                static_cast<float>((x + y) % 4U),
                0.0F,
            });
        }
    }
    return snapshot;
}

BuildingSnapshot building(
    std::string id,
    Point2 origin,
    double width,
    double depth,
    std::uint16_t floors,
    std::vector<UseComponentSnapshot> uses,
    RenderRevision revision = 1) {
    BuildingSnapshot value{};
    value.id = std::move(id);
    value.revision = revision;
    value.parcel_id = "parcel:" + value.id;
    value.footprint = {
        origin,
        {origin.x + width, origin.y},
        {origin.x + width, origin.y + depth},
        {origin.x, origin.y + depth},
    };
    value.floors = floors;
    value.height_m = static_cast<float>(floors) * 3.2F;
    value.uses = std::move(uses);
    return value;
}

RoadSnapshot road(std::string id, Point2 from, Point2 to, RoadClass road_class, float congestion = 0.0F) {
    RoadSnapshot value{};
    value.id = std::move(id);
    value.revision = 1;
    value.road_class = road_class;
    value.from = from;
    value.to = to;
    value.lanes = road_class == RoadClass::Arterial ? 4U : 2U;
    value.condition = 0.9F;
    value.congestion = congestion;
    value.speed_ratio = 1.0F - congestion * 0.7F;
    value.volume = 400.0F + congestion * 1200.0F;
    return value;
}

void addStreetGrid(FrameSnapshot& snapshot) {
    for (int line = 2; line <= 14; line += 4) {
        snapshot.roads.push_back(road("road:h:" + std::to_string(line), {1.0, static_cast<double>(line)}, {15.0, static_cast<double>(line)}, RoadClass::Local));
        snapshot.roads.push_back(road("road:v:" + std::to_string(line), {static_cast<double>(line), 1.0}, {static_cast<double>(line), 15.0}, RoadClass::Local));
    }
}

} // namespace

std::vector<VisualAcceptanceScenario> nativeVisualAcceptanceScenarios() {
    std::vector<VisualAcceptanceScenario> scenarios;

    scenarios.push_back({"empty-terrain", "Empty terrain with rock/biome variation", baseTerrain(), {}});

    auto neighborhood = baseTerrain();
    addStreetGrid(neighborhood);
    for (int index = 0; index < 10; ++index) {
        const double x = 2.5 + static_cast<double>((index % 5) * 2);
        const double y = 3.0 + static_cast<double>((index / 5) * 5);
        neighborhood.buildings.push_back(building(
            "home:" + std::to_string(index),
            {x, y},
            1.3,
            1.3,
            2U + static_cast<std::uint16_t>(index % 2),
            {{BuildingUse::Residential, 1.0F}}));
    }
    scenarios.push_back({"developed-neighborhood", "Low-rise developed neighborhood", std::move(neighborhood), {}});

    auto dense = baseTerrain();
    addStreetGrid(dense);
    dense.buildings.push_back(building("mixed:a", {4.0, 4.0}, 3.5, 2.5, 14U, {{BuildingUse::Residential, 0.55F}, {BuildingUse::Commercial, 0.45F}}));
    dense.buildings.push_back(building("mixed:b", {8.5, 4.5}, 2.8, 3.6, 22U, {{BuildingUse::Office, 0.6F}, {BuildingUse::Commercial, 0.4F}}));
    dense.buildings.push_back(building("mixed:c", {6.0, 9.0}, 4.5, 2.5, 18U, {{BuildingUse::Residential, 0.7F}, {BuildingUse::Commercial, 0.3F}}));
    scenarios.push_back({"dense-mixed-use-core", "Dense mixed-use canonical BuildingV2 massing", std::move(dense), {}});

    auto industrial = baseTerrain();
    industrial.roads.push_back(road("freight-corridor", {1.0, 8.0}, {15.0, 8.0}, RoadClass::Arterial, 0.45F));
    industrial.buildings.push_back(building("factory:a", {3.0, 4.0}, 5.0, 3.0, 3U, {{BuildingUse::Industrial, 1.0F}}));
    industrial.buildings.push_back(building("warehouse:b", {9.0, 9.0}, 4.5, 3.0, 2U, {{BuildingUse::Industrial, 1.0F}}));
    for (int index = 0; index < 9; ++index) {
        industrial.vehicles.push_back({"freight:" + std::to_string(index), 1, VehicleKind::Freight, {2.0 + index * 1.3, 8.0}, 0.0F, 1.0F, false});
    }
    scenarios.push_back({"industrial-freight", "Industrial district with freight corridor", std::move(industrial), {}});

    auto congestion = baseTerrain();
    congestion.roads.push_back(road("congested", {1.0, 7.0}, {15.0, 7.0}, RoadClass::Arterial, 0.92F));
    for (int index = 0; index < 14; ++index) {
        congestion.vehicles.push_back({"car:" + std::to_string(index), 1, VehicleKind::PrivateCar, {1.5 + index * 0.9, 7.0}, 0.0F, 1.0F, false});
        congestion.overlays.push_back({1, OverlayMetric::TrafficCongestion, {EntityKind::Road, "congested"}, {1.5 + index * 0.9, 7.0}, 0.92F, 0.15F});
    }
    scenarios.push_back({"congestion", "Congested arterial with spatial overlay samples", std::move(congestion), {}});

    auto transit = baseTerrain();
    transit.roads.push_back(road("transit-spine", {1.0, 8.0}, {15.0, 8.0}, RoadClass::Arterial, 0.25F));
    transit.transit_stops.push_back({"metro:a", 1, TransitStopKind::MetroStation, {5.0, 8.0}, 1200.0F, 0.65F, 0.94F});
    transit.transit_stops.push_back({"metro:b", 1, TransitStopKind::MetroStation, {11.0, 8.0}, 900.0F, 0.48F, 0.96F});
    transit.vehicles.push_back({"metro:train", 1, VehicleKind::Metro, {8.0, 8.0}, 0.0F, 210.0F, false});
    scenarios.push_back({"transit", "Intentional metro representation with stations", std::move(transit), {}});

    auto flood = baseTerrain();
    for (auto& cell : flood.terrain) {
        if (cell.y >= 9U) {
            cell.water = true;
            cell.flood_depth_m = 0.6F;
            cell.biome = TerrainBiome::Water;
            flood.overlays.push_back({1, OverlayMetric::FloodExposure, {EntityKind::Terrain, cell.id}, {static_cast<double>(cell.x) + 0.5, static_cast<double>(cell.y) + 0.5}, 0.8F, cell.flood_depth_m});
        }
    }
    scenarios.push_back({"flood", "Flood and water state from real snapshot fields", std::move(flood), {}});

    auto cadastre = baseTerrain();
    cadastre.buildings.push_back(building("parcel-building", {5.0, 5.0}, 4.0, 3.0, 6U, {{BuildingUse::Mixed, 1.0F}}));
    for (int index = 0; index < 9; ++index) {
        const auto metric = index % 2 == 0 ? OverlayMetric::Cadastre : OverlayMetric::Zoning;
        cadastre.overlays.push_back({1, metric, {EntityKind::Parcel, "parcel:" + std::to_string(index)}, {3.0 + (index % 3) * 3.0, 3.0 + (index / 3) * 3.0}, 0.55F + static_cast<float>(index % 3) * 0.15F, 0.0F});
    }
    scenarios.push_back({"cadastre-zoning", "Cadastre and zoning spatial geometry", std::move(cadastre), {}});

    auto selection = baseTerrain();
    selection.buildings.push_back(building("selected-building", {6.0, 6.0}, 4.0, 3.0, 9U, {{BuildingUse::Residential, 0.7F}, {BuildingUse::Commercial, 0.3F}}));
    selection.selection = {true, {EntityKind::Building, "selected-building"}};
    scenarios.push_back({"selection", "Typed-ID selection scenario", std::move(selection), {}});

    auto miniature = baseTerrain();
    addStreetGrid(miniature);
    miniature.buildings.push_back(building("miniature:a", {4.0, 4.0}, 3.0, 3.0, 12U, {{BuildingUse::Commercial, 1.0F}}));
    miniature.buildings.push_back(building("miniature:b", {9.0, 8.0}, 3.5, 2.5, 16U, {{BuildingUse::Residential, 1.0F}}));
    PresentationSettings miniature_settings{};
    miniature_settings.visual_effects = true;
    miniature_settings.tilt_shift_strength = 0.8F;
    miniature_settings.camera_smoothing = 0.65F;
    scenarios.push_back({"miniature-camera", "Miniature/tilt-shift treatment reference", std::move(miniature), miniature_settings});

    return scenarios;
}

} // namespace civic::presentation
