#pragma once
#include "civic/core/Result.hpp"
#include "Terrain.hpp"
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace civic::world {
inline constexpr double hydrology_epsilon=1e-9;
struct ChannelSegment final { std::string id; std::uint32_t from_index{}; std::uint32_t to_index{}; double accumulation{}; double capacity_volume_m3{}; };
struct WatershedRecord final { std::string id; std::uint32_t outlet_index{}; std::uint32_t member_count{}; double upstream_area_cells{}; std::optional<std::string> primary_channel_id{}; };
struct HydrologyState final { std::uint32_t width{};std::uint32_t height{};std::vector<double> conditioned_elevation_meters;std::vector<std::optional<std::uint32_t>> receiver;std::vector<WatershedRecord> watersheds;std::vector<ChannelSegment> channels;std::vector<double> flow_accumulation;std::vector<std::string> watershed_ids;std::vector<double> flood_susceptibility; };
[[nodiscard]] civic::core::Result<std::vector<double>> resolve_depressions(std::uint32_t width,std::uint32_t height,const std::vector<double>& raw,const std::vector<std::uint8_t>& permanent_water) noexcept;
[[nodiscard]] civic::core::Result<HydrologyState> build_hydrology(const TerrainField& terrain,const std::vector<double>& conditioned) noexcept;
struct DesignStormEvent final { std::string id;double rainfall_mm{};double duration_hours{};double saturation_factor{1}; };
struct FloodResult final { std::string event_id;std::vector<double> depth_meters;double rainfall_volume{};double infiltration_volume{};double retained_channel_surface_volume{};double overbank_flood_volume{};double exported_volume{};double balance_error{}; };
[[nodiscard]] civic::core::Result<FloodResult> run_design_storm(const DesignStormEvent&,const TerrainField&,const HydrologyState&,const std::vector<double>* impervious_fraction=nullptr) noexcept;
}
