#pragma once
#include "civic/core/Result.hpp"
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace civic::world {
enum class SoilClass : std::uint8_t { rock, gravel, sand, loam, clay, alluvium, peat, fill_disturbed };
enum class VegetationClass : std::uint8_t { none, grass, forest, scrub, wetland };
enum class SurfaceWaterClass : std::uint8_t { none, lake, river, coast };
struct SoilProperties final { double infiltration_mm_per_hour{}; double bearing_capacity_kpa{}; double erodibility{}; double preparation_base{}; };
[[nodiscard]] const SoilProperties& soil_properties(SoilClass soil) noexcept;
struct TerrainPhysicalSample final {
  double elevation_meters{}; double slope{}; double aspect_radians{}; SoilClass soil_class{SoilClass::loam}; double soil_depth_meters{}; double bearing_capacity_kpa{}; double bedrock_depth_meters{}; double groundwater_depth_meters{}; VegetationClass vegetation_class{VegetationClass::none}; double contamination_index{}; double land_preparation_multiplier{1}; SurfaceWaterClass surface_water{SurfaceWaterClass::none}; bool buildable{true};
};
struct TerrainField final {
  std::uint32_t width{}; std::uint32_t height{}; double meters_per_cell{30}; std::vector<TerrainPhysicalSample> samples{};
  [[nodiscard]] civic::core::Result<const TerrainPhysicalSample*> at(std::uint32_t x,std::uint32_t y) const noexcept;
};
struct LandPreparationInputs final { double slope{}; SoilClass soil_class{SoilClass::loam}; double bedrock_depth_meters{}; double groundwater_depth_meters{}; double contamination_index{}; double flood_susceptibility{}; };
[[nodiscard]] civic::core::Result<double> land_preparation_multiplier(const LandPreparationInputs&) noexcept;
}
