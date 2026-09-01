#pragma once
#include "Cadastre.hpp"
#include <cstdint>
#include <span>

namespace civic::cadastre {

struct LegacyTerrainCell final { std::int32_t x{}; std::int32_t y{}; bool buildable{true}; };
struct LegacyRoadCell final { std::int32_t x{}; std::int32_t y{}; std::string road_ref{}; };
struct LegacyZoningCell final { std::int32_t x{}; std::int32_t y{}; std::string zoning_district_id{}; };

struct GeneratedUrbanBlock final {
  std::string external_id{};
  civic::geometry::Polygon boundary{};
  std::vector<civic::core::ParcelId> parcel_ids{};
  std::vector<std::string> road_boundary_ids{};
};

struct ParcelGenerationSnapshot final {
  CadastralGraph graph{};
  std::vector<GeneratedUrbanBlock> blocks{};
};

class ParcelGenerationSystem final {
public:
  [[nodiscard]] civic::core::Result<ParcelGenerationSnapshot> rebuild(
      std::span<const LegacyTerrainCell> terrain,
      std::span<const LegacyRoadCell> roads,
      std::span<const LegacyZoningCell> zoning) const noexcept;
};

}  // namespace civic::cadastre
