#include "civic/urban/UrbanFabric.hpp"

#include "civic/geometry/BooleanOps.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace civic::urban {
namespace {

constexpr double kAreaToleranceM2 = 0.01;
constexpr double kNumericTolerance = 1e-9;

[[nodiscard]] bool finite_non_negative(double value) noexcept {
  return std::isfinite(value) && value >= 0.0;
}

[[nodiscard]] bool bounded_percent(double value) noexcept {
  return std::isfinite(value) && value >= 0.0 && value <= 100.0;
}

[[nodiscard]] civic::core::Result<void> validate_lifecycle(const BuildingLifecycle& lifecycle) noexcept {
  if (!bounded_percent(lifecycle.condition) ||
      !bounded_percent(lifecycle.structural_condition) ||
      !bounded_percent(lifecycle.systems_condition) ||
      !bounded_percent(lifecycle.exterior_condition) ||
      !bounded_percent(lifecycle.distress_score) ||
      !finite_non_negative(lifecycle.maintenance_backlog) ||
      !finite_non_negative(lifecycle.effective_age)) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invariant_failure,
        "invalid BuildingV2 lifecycle state"));
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> validate_project(const BuildingProjectState& project) noexcept {
  if (!std::isfinite(project.progress) || project.progress < 0.0 || project.progress > 1.0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building project progress must be within [0, 1]"));
  }
  const std::optional<double> values[]{
      project.target_condition,
      project.target_structural_condition,
      project.target_systems_condition,
      project.target_exterior_condition,
      project.target_effective_age,
  };
  for (const auto& value : values) {
    if (value && (!std::isfinite(*value) || *value < 0.0)) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "building project target must be finite and non-negative"));
    }
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> validate_floor(const BuildingFloor& floor) noexcept {
  if (floor.level == 0 || !finite_non_negative(floor.elevation_meters) ||
      !finite_non_negative(floor.gross_area_m2) || !finite_non_negative(floor.usable_area_m2) ||
      floor.usable_area_m2 > floor.gross_area_m2 + kNumericTolerance) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "invalid BuildingV2 floor dimensions"));
  }
  double allocated = 0.0;
  for (const auto& allocation : floor.uses) {
    if (!finite_non_negative(allocation.floor_area_m2) ||
        !finite_non_negative(allocation.storage_capacity)) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "invalid BuildingV2 floor-use allocation"));
    }
    allocated += allocation.floor_area_m2;
  }
  if (allocated > floor.usable_area_m2 + kAreaToleranceM2) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "floor-use allocation exceeds usable floor area"));
  }
  return {};
}

}  // namespace

civic::core::BuildingId building_id_from_external(std::string_view external_id) noexcept {
  return civic::core::BuildingId{civic::cadastre::stable_id_from_key(external_id)};
}

civic::core::Result<BuildingV2> UrbanFabricStore::normalize_building(BuildingV2 building) const noexcept {
  if (building.id.value() == 0) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building id must be non-zero"));
  }

  if (building.parcel_ids.empty()) building.parcel_ids.push_back(building.parcel_id);
  building.parcel_ids = civic::cadastre::canonical_ids(std::move(building.parcel_ids));
  if (building.parcel_ids.empty() ||
      std::find(building.parcel_ids.begin(), building.parcel_ids.end(), building.parcel_id) == building.parcel_ids.end()) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_state,
        "building primary parcel must be included in parcel_ids"));
  }

  const auto parcel_exists = [this](civic::core::ParcelId id) {
    return cadastre_ != nullptr ? cadastre_->contains_live(id) : fallback_parcels_.contains(id);
  };
  for (const auto parcel_id : building.parcel_ids) {
    if (!parcel_exists(parcel_id)) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_state,
          "building references non-live parcel"));
    }
  }

  if (building.external_id.empty() || building.id != building_id_from_external(building.external_id)) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building identity does not match external id"));
  }
  if (building.typology_id.empty()) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building typology id must not be empty"));
  }
  if (!finite_non_negative(building.gross_floor_area_m2) ||
      !finite_non_negative(building.usable_floor_area_m2) ||
      building.usable_floor_area_m2 > building.gross_floor_area_m2 + kNumericTolerance ||
      !finite_non_negative(building.height_meters) ||
      !finite_non_negative(building.realized_far) ||
      !finite_non_negative(building.coverage_ratio) ||
      !finite_non_negative(building.project_cost)) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "invalid BuildingV2 numeric state"));
  }

  if (building.footprint.vertices.size() < 3) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "building footprint must contain at least three vertices"));
  }
  auto canonical = civic::geometry::canonicalize(building.footprint);
  if (!canonical) return std::unexpected(canonical.error());
  building.footprint = std::move(*canonical);

  for (const auto& floor : building.floors) {
    auto valid = validate_floor(floor);
    if (!valid) return std::unexpected(valid.error());
  }
  auto lifecycle_valid = validate_lifecycle(building.lifecycle);
  if (!lifecycle_valid) return std::unexpected(lifecycle_valid.error());
  if (!finite_non_negative(building.entitlement.approved_far) ||
      !finite_non_negative(building.entitlement.approved_height_meters)) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::invalid_argument,
        "invalid BuildingV2 entitlement"));
  }
  if (building.project) {
    auto project_valid = validate_project(*building.project);
    if (!project_valid) return std::unexpected(project_valid.error());
  }

  if (cadastre_ != nullptr) {
    civic::geometry::MultiPolygon outside{building.footprint};
    for (const auto parcel_id : building.parcel_ids) {
      const auto* parcel = cadastre_->find(parcel_id);
      if (parcel == nullptr || !parcel->live) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::invalid_state,
            "building references non-live parcel"));
      }
      auto remainder = civic::geometry::polygon_difference(
          std::span<const civic::geometry::Polygon>{outside.data(), outside.size()},
          parcel->boundary);
      if (!remainder) return std::unexpected(remainder.error());
      outside = std::move(*remainder);
      if (outside.empty()) break;
    }
    if (civic::geometry::total_area_square_meters(outside) > kAreaToleranceM2) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invariant_failure,
          "building footprint extends outside canonical parcel union"));
    }
  }

  return building;
}

civic::core::Result<void> UrbanFabricStore::upsert_building(BuildingV2 building) noexcept {
  auto normalized = normalize_building(std::move(building));
  if (!normalized) return std::unexpected(normalized.error());
  buildings_[normalized->id] = std::move(*normalized);
  return {};
}

civic::core::Result<void> UrbanFabricStore::restore_buildings(std::span<const BuildingV2> buildings) noexcept {
  std::map<civic::core::BuildingId, BuildingV2> staged;
  for (const auto& building : buildings) {
    auto normalized = normalize_building(building);
    if (!normalized) return std::unexpected(normalized.error());
    if (staged.contains(normalized->id)) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::conflict,
          "duplicate canonical building id"));
    }
    staged.emplace(normalized->id, std::move(*normalized));
  }
  buildings_.swap(staged);
  return {};
}

const BuildingV2* UrbanFabricStore::find_building(civic::core::BuildingId id) const noexcept {
  const auto iterator = buildings_.find(id);
  return iterator == buildings_.end() ? nullptr : &iterator->second;
}

civic::core::Result<void> UrbanFabricStore::validate() const noexcept {
  for (const auto& [id, building] : buildings_) {
    if (id != building.id) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invariant_failure,
          "building map key does not match canonical id"));
    }
    auto normalized = normalize_building(building);
    if (!normalized) return std::unexpected(normalized.error());
  }
  return {};
}

}  // namespace civic::urban
