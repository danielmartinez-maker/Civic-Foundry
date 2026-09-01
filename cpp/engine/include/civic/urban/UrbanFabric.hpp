#pragma once
#include "civic/cadastre/Cadastre.hpp"
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include "civic/geometry/Geometry.hpp"
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>
namespace civic::urban {
enum class BuildingStatus : std::uint8_t { proposed, entitlement, demolition, construction, occupied, renovation, vacant, abandoned };
struct BuildingLifecycle final {std::uint64_t age_ticks{};double condition{100};double structural_condition{100};double systems_condition{100};double exterior_condition{100};double maintenance_backlog{};std::uint64_t deferred_maintenance_ticks{};double effective_age{};std::uint64_t vacancy_duration_ticks{};double distress_score{};};
struct BuildingV2 final {civic::core::BuildingId id{};std::string external_id{};civic::core::ParcelId parcel_id{};std::vector<civic::core::ParcelId> parcel_ids{};std::string typology_id{};civic::geometry::Polygon footprint{};double gross_floor_area_m2{};double usable_floor_area_m2{};double height_meters{};std::uint32_t stories{};double realized_far{};double coverage_ratio{};BuildingStatus status{BuildingStatus::proposed};std::int32_t year_built{};double project_cost{};BuildingLifecycle lifecycle{};};
class UrbanFabricStore final {
public:
  UrbanFabricStore()=default; explicit UrbanFabricStore(const civic::cadastre::CadastralGraph* cadastre):cadastre_(cadastre){}
  void bind_cadastre(const civic::cadastre::CadastralGraph& graph) noexcept{cadastre_=&graph;}
  void register_parcel(civic::core::ParcelId id) { fallback_parcels_.insert(id); }
  [[nodiscard]] civic::core::Result<void> upsert_building(BuildingV2 building) noexcept;
  [[nodiscard]] civic::core::Result<void> validate() const noexcept;
  [[nodiscard]] const std::map<civic::core::BuildingId,BuildingV2>& buildings() const noexcept{return buildings_;}
private:const civic::cadastre::CadastralGraph* cadastre_{};std::set<civic::core::ParcelId> fallback_parcels_{};std::map<civic::core::BuildingId,BuildingV2> buildings_{};
};
}
