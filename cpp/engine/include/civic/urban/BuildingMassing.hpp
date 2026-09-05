#pragma once

#include "civic/cadastre/Cadastre.hpp"
#include "civic/urban/BuildableEnvelope.hpp"
#include "civic/urban/UrbanFabric.hpp"

#include <optional>
#include <string>
#include <vector>

namespace civic::urban {

struct UseMixEntry final {
  UseType use{UseType::residential};
  double value{};
};

struct BuildingTypology final {
  std::string id{};
  std::string name{};
  std::optional<std::string> legacy_definition_id{};
  UseType primary_use{UseType::residential};
  std::vector<UseType> allowed_uses{};
  std::vector<UseMixEntry> default_use_mix{};
  std::uint32_t preferred_stories{};
  std::uint32_t min_stories{1};
  std::uint32_t max_stories{1};
  double floor_to_floor_height_meters{};
  double efficiency_ratio{};
  double cost_per_m2{};
  double maintenance_cost_per_m2{};
  double construction_ticks_per_1000_m2{};
  double average_residential_unit_area_m2{};
  std::vector<UseMixEntry> jobs_per_1000_m2_by_use{};
  double power_demand_per_1000_m2{};
  double water_demand_per_1000_m2{};
  double garbage_per_1000_m2{};
  double tax_base_per_m2{};
  std::vector<UseMixEntry> base_rent_per_m2_by_use{};
  double operating_expense_ratio{};
  double base_vacancy{};
  double base_cap_rate{};
  double minimum_access{};
  double minimum_utility_ratio{};
  double minimum_service_quality{};
  double complexity_factor{1.0};
  double risk_weight{};
  std::optional<double> conversion_suitability{};
};

struct DevelopmentCandidate final {
  std::string id{};
  std::vector<civic::core::ParcelId> parcel_ids{};
  std::string typology_id{};
  double target_utilization{};
  civic::geometry::Polygon footprint{};
  double gross_floor_area_m2{};
  double usable_floor_area_m2{};
  double height_meters{};
  std::uint32_t stories{};
  double realized_far{};
  double coverage_ratio{};
  std::vector<BuildingFloor> floors{};
  std::vector<UseType> uses{};
  bool zoning_legal{};
};

class BuildingMassingSystem final {
public:
  [[nodiscard]] std::vector<DevelopmentCandidate> generate(
      const civic::cadastre::Parcel& parcel,
      const ParcelDevelopmentEnvelope& envelope,
      std::vector<BuildingTypology> typologies) const;
};

}  // namespace civic::urban
