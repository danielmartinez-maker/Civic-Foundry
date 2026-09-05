#pragma once
#include "civic/core/Random.hpp"
#include "civic/core/Result.hpp"
#include "civic/geometry/Geometry.hpp"
#include "civic/world/Hydrology.hpp"
#include "civic/world/Terrain.hpp"
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
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
struct GeographyHierarchy final {
  std::vector<GeographyEntity> entities;
  [[nodiscard]] const GeographyEntity* find(std::string_view id) const noexcept;
  [[nodiscard]] const GeographyEntity* parent_of(std::string_view id) const noexcept;
  [[nodiscard]] std::vector<const GeographyEntity*> children_of(std::string_view id) const;
};
struct GeographySpatialIndexEntry final {
  std::size_t entity_index{};
  civic::geometry::Bounds bounds{};
};
class GeographySpatialIndex final {
public:
  [[nodiscard]] static civic::core::Result<GeographySpatialIndex> build(const GeographyHierarchy&) noexcept;
  [[nodiscard]] const GeographyEntity* entity_at(
      const GeographyHierarchy&,
      civic::geometry::Point,
      std::optional<GeographyKind> kind = std::nullopt) const noexcept;
  [[nodiscard]] std::size_t size() const noexcept { return entries_.size(); }
private:
  explicit GeographySpatialIndex(std::vector<GeographySpatialIndexEntry> entries)
      : entries_(std::move(entries)) {}
  std::vector<GeographySpatialIndexEntry> entries_{};
};

struct ScenarioPoint final { double x{}; double y{}; };
struct ScenarioPolygon final { std::vector<ScenarioPoint> points; };
struct ScenarioGenerationOverrides final {
  std::optional<std::uint32_t> width;
  std::optional<std::uint32_t> height;
  std::optional<double> meters_per_cell;
  std::optional<WorldPreset> preset;
};
struct ScenarioElevationOverride final {
  std::int64_t x{};
  std::int64_t y{};
  double elevation_meters{};
};
struct ScenarioPermanentWaterRegion final {
  SurfaceWaterClass surface_water{SurfaceWaterClass::lake};
  ScenarioPolygon polygon;
};
struct ScenarioSoilRegion final {
  SoilClass soil_class{SoilClass::loam};
  ScenarioPolygon polygon;
};
struct ScenarioGroundwaterRegion final {
  double depth_meters{};
  ScenarioPolygon polygon;
};
struct ScenarioContaminationRegion final {
  double index{};
  ScenarioPolygon polygon;
};
struct ScenarioWorldDefinition final {
  std::string id;
  std::optional<ScenarioGenerationOverrides> generation;
  std::optional<ScenarioPolygon> root_boundary;
  std::vector<ScenarioElevationOverride> elevation_overrides;
  std::vector<ScenarioPermanentWaterRegion> permanent_water_regions;
  std::vector<ScenarioSoilRegion> soil_regions;
  std::vector<ScenarioGroundwaterRegion> groundwater_regions;
  std::vector<ScenarioContaminationRegion> contamination_regions;
  std::optional<GeographyHierarchy> administrative_boundaries;
};

struct WorldSnapshot final {
  std::uint32_t seed{};
  WorldConfig config{};
  TerrainField terrain{};
  GeographyHierarchy geography{};
  HydrologyState hydrology{};
  std::optional<std::string> scenario_id{};
};
class WorldFoundation final {
public:
  [[nodiscard]] static civic::core::Result<WorldFoundation> generate(std::uint32_t seed, const WorldConfig& config) noexcept;
  [[nodiscard]] static civic::core::Result<WorldFoundation> generate(std::uint32_t seed, const WorldConfig& config, const ScenarioWorldDefinition& scenario) noexcept;
  [[nodiscard]] static civic::core::Result<WorldFoundation> restore(WorldSnapshot snapshot) noexcept;
  [[nodiscard]] static civic::core::Result<WorldFoundation> restore_with_flood(WorldSnapshot snapshot, std::optional<FloodResult> last_flood_result) noexcept;
  [[nodiscard]] const TerrainField& terrain() const noexcept { return snapshot_.terrain; }
  [[nodiscard]] const GeographyHierarchy& geography() const noexcept { return snapshot_.geography; }
  [[nodiscard]] const HydrologyState& hydrology() const noexcept { return snapshot_.hydrology; }
  [[nodiscard]] const WorldSnapshot& snapshot() const noexcept { return snapshot_; }
  [[nodiscard]] const std::optional<FloodResult>& last_flood_result() const noexcept { return last_flood_result_; }
  [[nodiscard]] civic::core::Result<FloodResult> run_design_storm(const DesignStormEvent&, const std::vector<double>* impervious_fraction = nullptr) noexcept;
  [[nodiscard]] std::uint64_t deterministic_hash() const noexcept;
private:
  explicit WorldFoundation(WorldSnapshot snapshot, std::optional<FloodResult> last_flood_result = std::nullopt)
      : snapshot_(std::move(snapshot)), last_flood_result_(std::move(last_flood_result)) {}
  WorldSnapshot snapshot_{};
  std::optional<FloodResult> last_flood_result_{};
};
}