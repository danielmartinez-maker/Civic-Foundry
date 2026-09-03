#include <civic/core/NativeEngine.hpp>
#include <civic/presentation/Presentation.hpp>
#include <civic/presentation/RenderPipeline.hpp>
#include <civic/presentation/SceneGeometry.hpp>

#include <chrono>
#include <cstdint>
#include <iostream>
#include <string>

using namespace civic::presentation;

namespace {
using Clock = std::chrono::steady_clock;

template <typename Function>
std::int64_t measureMicros(Function&& function) {
    const auto start = Clock::now();
    function();
    return std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - start).count();
}

FrameSnapshot largeSnapshot() {
    FrameSnapshot snapshot{};
    snapshot.revision = 1;
    snapshot.world = {96U, 96U};

    snapshot.terrain.reserve(static_cast<std::size_t>(snapshot.world.width) * snapshot.world.height);
    for (std::uint32_t y = 0; y < snapshot.world.height; ++y) {
        for (std::uint32_t x = 0; x < snapshot.world.width; ++x) {
            TerrainCellSnapshot cell{};
            cell.id = "terrain:" + std::to_string(x) + ":" + std::to_string(y);
            cell.revision = 1;
            cell.x = x;
            cell.y = y;
            cell.biome = ((x + y) % 23U == 0U) ? TerrainBiome::Rock : TerrainBiome::Plains;
            cell.flood_depth_m = ((x + 3U * y) % 101U == 0U) ? 0.15F : 0.0F;
            snapshot.terrain.push_back(std::move(cell));
        }
    }

    for (std::uint32_t index = 0; index < 768U; ++index) {
        RoadSnapshot road{};
        road.id = "road:" + std::to_string(index);
        road.revision = 1;
        road.road_class = index % 8U == 0U ? RoadClass::Arterial : RoadClass::Local;
        road.from = {static_cast<double>(index % 96U), static_cast<double>((index * 7U) % 96U)};
        road.to = {std::min(95.0, road.from.x + 8.0), road.from.y};
        road.lanes = road.road_class == RoadClass::Arterial ? 4U : 2U;
        road.condition = 0.85F;
        road.congestion = static_cast<float>(index % 10U) / 10.0F;
        road.volume = static_cast<float>((index * 31U) % 1600U);
        snapshot.roads.push_back(std::move(road));
    }

    for (std::uint32_t index = 0; index < 1400U; ++index) {
        const double x = static_cast<double>((index * 5U) % 92U);
        const double y = static_cast<double>((index * 11U) % 92U);
        BuildingSnapshot building{};
        building.id = "building:" + std::to_string(index);
        building.revision = 1;
        building.parcel_id = "parcel:" + std::to_string(index);
        building.footprint = {{x, y}, {x + 2.0, y}, {x + 2.0, y + 1.5}, {x, y + 1.5}};
        building.floors = static_cast<std::uint16_t>(2U + index % 18U);
        building.height_m = static_cast<float>(building.floors) * 3.2F;
        building.uses = {{index % 5U == 0U ? BuildingUse::Industrial : BuildingUse::Residential, 1.0F}};
        snapshot.buildings.push_back(std::move(building));
    }

    for (std::uint32_t index = 0; index < 6000U; ++index) {
        VehicleSnapshot vehicle{};
        vehicle.id = "vehicle:" + std::to_string(index);
        vehicle.revision = 1;
        vehicle.kind = index % 17U == 0U ? VehicleKind::Freight : VehicleKind::PrivateCar;
        vehicle.position = {static_cast<double>((index * 13U) % 96U), static_cast<double>((index * 19U) % 96U)};
        snapshot.vehicles.push_back(std::move(vehicle));
    }

    for (std::uint32_t index = 0; index < 256U; ++index) {
        OverlaySample sample{};
        sample.revision = 1;
        sample.metric = OverlayMetric::TrafficCongestion;
        sample.entity = {EntityKind::Road, "road:" + std::to_string(index)};
        sample.position = {static_cast<double>((index * 3U) % 96U), static_cast<double>((index * 5U) % 96U)};
        sample.value = static_cast<float>(index % 100U) / 100.0F;
        snapshot.overlays.push_back(std::move(sample));
    }
    return snapshot;
}
} // namespace

int main() {
    auto engine = civic::NativeEngine::create({.seed = 91U});
    if (!engine) return 10;
    const auto hash_before = (*engine)->domainHash("kernel");
    if (!hash_before) return 11;

    auto snapshot = largeSnapshot();
    RetainedScene retained{};
    SceneUpdateStats initial_stats{};
    SceneUpdateStats unchanged_stats{};
    const auto initial_retained_us = measureMicros([&] { initial_stats = retained.apply(snapshot); });
    const auto unchanged_retained_us = measureMicros([&] { unchanged_stats = retained.apply(snapshot); });

    RenderPacket packet{};
    RenderPacketBuilder packet_builder{};
    const auto packet_us = measureMicros([&] {
        packet = packet_builder.build(snapshot, {0.0, 0.0, 96.0, 96.0});
    });

    SceneGeometry geometry{};
    SceneGeometryBuilder geometry_builder{};
    IsometricCamera camera{};
    const auto geometry_us = measureMicros([&] {
        geometry = geometry_builder.build(packet, camera, snapshot.world, {1920U, 1080U});
    });

    snapshot.revision = 2;
    snapshot.buildings.front().revision = 2;
    SceneUpdateStats delta_stats{};
    const auto delta_retained_us = measureMicros([&] { delta_stats = retained.apply(snapshot); });

    const auto hash_after = (*engine)->domainHash("kernel");
    if (!hash_after) return 12;
    const bool hash_equal = hash_before->value == hash_after->value;
    const bool retained_noop = unchanged_stats.totalRebuilt() == 0U;
    const bool narrow_delta = delta_stats.buildings_rebuilt == 1U && delta_stats.totalRebuilt() == 1U;
    if (!hash_equal || !retained_noop || !narrow_delta || geometry.opaque.empty()) return 13;

    std::cout
        << "{\n"
        << "  \"terrainCells\": " << packet.terrain.size() << ",\n"
        << "  \"roads\": " << packet.roads.size() << ",\n"
        << "  \"buildings\": " << packet.buildings.size() << ",\n"
        << "  \"vehicles\": " << packet.vehicles.size() << ",\n"
        << "  \"initialRetainedMicros\": " << initial_retained_us << ",\n"
        << "  \"unchangedRetainedMicros\": " << unchanged_retained_us << ",\n"
        << "  \"deltaRetainedMicros\": " << delta_retained_us << ",\n"
        << "  \"packetBuildMicros\": " << packet_us << ",\n"
        << "  \"geometryBuildMicros\": " << geometry_us << ",\n"
        << "  \"initialObjectsRebuilt\": " << initial_stats.totalRebuilt() << ",\n"
        << "  \"unchangedObjectsRebuilt\": " << unchanged_stats.totalRebuilt() << ",\n"
        << "  \"deltaObjectsRebuilt\": " << delta_stats.totalRebuilt() << ",\n"
        << "  \"authoritativeHashEqual\": true\n"
        << "}\n";
    return 0;
}
