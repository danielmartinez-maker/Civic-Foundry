#pragma once

#include "civic/cadastre/Cadastre.hpp"
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/geometry/Geometry.hpp"
#include "civic/urban/Zoning.hpp"

#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace civic::urban {

enum class BuildingStatus : std::uint8_t {
  proposed,
  entitlement,
  demolition,
  construction,
  occupied,
  renovation,
  vacant,
  abandoned,
};

struct FloorUseAllocation final {
  UseType use{UseType::residential};
  double floor_area_m2{};
  std::uint32_t residential_units{};
  std::uint32_t jobs{};
  std::uint32_t hotel_rooms{};
  double storage_capacity{};
};

struct BuildingFloor final {
  std::uint32_t level{};
  double elevation_meters{};
  double gross_area_m2{};
  double usable_area_m2{};
  std::vector<FloorUseAllocation> uses{};
};

struct BuildingLifecycle final {
  std::uint64_t age_ticks{};
  double condition{100.0};
  double structural_condition{100.0};
  double systems_condition{100.0};
  double exterior_condition{100.0};
  double maintenance_backlog{};
  std::uint64_t deferred_maintenance_ticks{};
  std::optional<std::uint64_t> last_major_renovation_tick{};
  double effective_age{};
  double vacancy_duration_ticks{};
  double distress_score{};
};

struct BuildingEntitlement final {
  std::uint64_t approval_tick{};
  std::string zoning_district_id{};
  double approved_far{};
  double approved_height_meters{};
  std::vector<UseType> approved_uses{};
  bool legal_nonconforming{};
};

enum class BuildingProjectPhase : std::uint8_t {
  none,
  entitlement,
  relocation,
  demolition,
  foundation,
  structure,
  enclosure,
  fit_out,
  lease_up,
};

enum class BuildingProjectKind : std::uint8_t {
  new_build,
  renovation,
  adaptive_reuse,
  demolition,
};

enum class BuildingRenovationScope : std::uint8_t {
  light,
  major,
  gut,
};

struct BuildingProjectState final {
  BuildingProjectPhase phase{BuildingProjectPhase::none};
  std::optional<std::uint64_t> started_tick{};
  std::optional<std::uint64_t> completion_tick{};
  double progress{};
  std::optional<BuildingProjectKind> kind{};
  std::optional<BuildingRenovationScope> renovation_scope{};
  std::optional<double> target_condition{};
  std::optional<double> target_structural_condition{};
  std::optional<double> target_systems_condition{};
  std::optional<double> target_exterior_condition{};
  std::optional<double> target_effective_age{};
  std::optional<UseType> destination_use{};
};

struct BuildingV2 final {
  civic::core::BuildingId id{};
  std::string external_id{};
  civic::core::ParcelId parcel_id{};
  std::vector<civic::core::ParcelId> parcel_ids{};
  std::string typology_id{};
  civic::geometry::Polygon footprint{};
  double gross_floor_area_m2{};
  double usable_floor_area_m2{};
  double height_meters{};
  std::uint32_t stories{};
  double realized_far{};
  double coverage_ratio{};
  std::vector<BuildingFloor> floors{};
  BuildingStatus status{BuildingStatus::proposed};
  std::int32_t year_built{};
  std::optional<std::string> developer_id{};
  std::optional<std::string> owner_id{};
  double project_cost{};
  BuildingEntitlement entitlement{};
  BuildingLifecycle lifecycle{};
  std::optional<BuildingProjectState> project{};
};

[[nodiscard]] civic::core::BuildingId building_id_from_external(std::string_view external_id) noexcept;

class UrbanFabricStore final {
public:
  UrbanFabricStore() = default;
  explicit UrbanFabricStore(const civic::cadastre::CadastralGraph* cadastre) : cadastre_(cadastre) {}

  void bind_cadastre(const civic::cadastre::CadastralGraph& graph) noexcept { cadastre_ = &graph; }
  void register_parcel(civic::core::ParcelId id) { fallback_parcels_.insert(id); }

  [[nodiscard]] civic::core::Result<void> upsert_building(BuildingV2 building) noexcept;
  [[nodiscard]] civic::core::Result<void> restore_buildings(std::span<const BuildingV2> buildings) noexcept;
  [[nodiscard]] civic::core::Result<void> validate() const noexcept;

  [[nodiscard]] const BuildingV2* find_building(civic::core::BuildingId id) const noexcept;
  [[nodiscard]] const std::map<civic::core::BuildingId, BuildingV2>& buildings() const noexcept {
    return buildings_;
  }

private:
  [[nodiscard]] civic::core::Result<BuildingV2> normalize_building(BuildingV2 building) const noexcept;

  const civic::cadastre::CadastralGraph* cadastre_{};
  std::set<civic::core::ParcelId> fallback_parcels_{};
  std::map<civic::core::BuildingId, BuildingV2> buildings_{};
};

}  // namespace civic::urban
