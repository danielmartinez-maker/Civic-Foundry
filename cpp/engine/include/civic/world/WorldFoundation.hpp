#pragma once
#include "civic/core/Random.hpp"
#include "civic/core/Result.hpp"
#include "civic/geometry/Geometry.hpp"
#include "civic/world/Hydrology.hpp"
#include "civic/world/Terrain.hpp"
#include <cstdint>
#include <string>
#include <vector>

namespace civic::world {
enum class WorldPreset : std::uint8_t { plain, river_valley, basin, rolling_uplands, ridge_edge, coastal_lowland };
struct WorldConfig final {
  std::uint32_t width{40};
  std::uint32_t height{24};
  double meters_per_cell{30.0};
  WorldPreset preset{WorldPreset::rolling_uplands};
};
enum class GeographyKind : std::uint8_t { region, municipality, district, neighborhood, block };
struct GeographyEntity final {
  std::string id;
  GeographyKind kind{GeographyKind::region};
  std::string parent_id;
  civic::geometry::Polygon boundary;
  std::string sort_key;
};
struct GeographyHierarchy final { std::vector<GeographyEntity> entities; };
struct WorldSnapshot final {
  std::uint32_t seed{};
  WorldConfig config{};
  TerrainField terrain{};
  GeographyHierarchy geography{};
  HydrologyState hydrology{};
};
class WorldFoundation final {
public:
  [[nodiscard]] static civic::core::Result<WorldFoundation> generate(std::uint32_t seed, const WorldConfig& config) noexcept;
  [[nodiscard]] static civic::core::Result<WorldFoundation> restore(WorldSnapshot snapshot) noexcept;
  [[nodiscard]] const TerrainField& terrain() const noexcept { return snapshot_.terrain; }
  [[nodiscard]] const GeographyHierarchy& geography() const noexcept { return snapshot_.geography; }
  [[nodiscard]] const HydrologyState& hydrology() const noexcept { return snapshot_.hydrology; }
  [[nodiscard]] const WorldSnapshot& snapshot() const noexcept { return snapshot_; }
  [[nodiscard]] std::uint64_t deterministic_hash() const noexcept;
private:
  explicit WorldFoundation(WorldSnapshot snapshot) : snapshot_(std::move(snapshot)) {}
  WorldSnapshot snapshot_{};
};
}
