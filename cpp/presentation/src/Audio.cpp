#include <civic/presentation/Audio.hpp>

#include <algorithm>

namespace civic::presentation {

AudioMix AudioPlanner::plan(const FrameSnapshot& snapshot, const PresentationSettings& requested) const noexcept {
    const auto settings = normalizeSettings(requested);
    float traffic_volume = 0.0F;
    for (const auto& road : snapshot.roads) traffic_volume += std::max(0.0F, road.volume);

    std::size_t freight = 0;
    std::size_t transit = 0;
    std::size_t emergency = 0;
    for (const auto& vehicle : snapshot.vehicles) {
        if (vehicle.out_of_service) continue;
        if (vehicle.kind == VehicleKind::Freight) ++freight;
        if (vehicle.kind == VehicleKind::Bus || vehicle.kind == VehicleKind::Brt ||
            vehicle.kind == VehicleKind::Tram || vehicle.kind == VehicleKind::Metro ||
            vehicle.kind == VehicleKind::Rail) ++transit;
        if (vehicle.kind == VehicleKind::Emergency) ++emergency;
    }

    std::size_t construction = 0;
    float industrial_weight = 0.0F;
    float neighborhood_weight = 0.0F;
    for (const auto& building : snapshot.buildings) {
        if (building.construction_progress < 0.999F) ++construction;
        for (const auto& use : building.uses) {
            const float share = std::clamp(use.share, 0.0F, 1.0F);
            if (use.use == BuildingUse::Industrial) industrial_weight += share;
            if (use.use == BuildingUse::Residential || use.use == BuildingUse::Mixed) neighborhood_weight += share;
        }
    }

    float water = 0.0F;
    for (const auto& terrain : snapshot.terrain) {
        if (terrain.water || terrain.flood_depth_m > 0.01F) water += 1.0F;
    }

    const float master = settings.master_volume;
    AudioMix mix{};
    mix.traffic = master * std::clamp(traffic_volume / 2000.0F, 0.0F, 1.0F);
    mix.freight = master * std::clamp(static_cast<float>(freight) / 8.0F, 0.0F, 1.0F);
    mix.transit = master * std::clamp(static_cast<float>(transit) / 8.0F, 0.0F, 1.0F);
    mix.construction = master * std::clamp(static_cast<float>(construction) / 6.0F, 0.0F, 1.0F);
    mix.industrial = master * std::clamp(industrial_weight / 12.0F, 0.0F, 1.0F);
    mix.neighborhood = master * std::clamp(neighborhood_weight / 18.0F, 0.0F, 1.0F);
    mix.emergency = master * std::clamp(static_cast<float>(emergency) / 3.0F, 0.0F, 1.0F);
    mix.water_weather = master * std::clamp(water / 30.0F, 0.0F, 1.0F);
    mix.music = master * settings.music_volume;
    return mix;
}

std::expected<void, std::string> NativeAudioRuntime::update(
    const FrameSnapshot& snapshot,
    const PresentationSettings& settings) {
    return output_.apply(planner_.plan(snapshot, settings));
}

} // namespace civic::presentation
