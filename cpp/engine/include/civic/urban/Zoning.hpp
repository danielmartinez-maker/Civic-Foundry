#pragma once
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include <array>
#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace civic::urban {

enum class UseType : std::uint8_t {
  residential,
  retail,
  office,
  hospitality,
  light_industrial,
  heavy_industrial,
  logistics,
  civic,
};

[[nodiscard]] std::string_view use_type_name(UseType use) noexcept;

struct ZoningDistrict final {
  std::string id{};
  std::vector<UseType> permitted_uses{};
  std::vector<UseType> conditional_uses{};
  double max_far{};
  double max_height_meters{};
  std::uint32_t max_stories{};
  double max_coverage_ratio{};
  double front_setback_meters{};
  double rear_setback_meters{};
  double side_setback_meters{};
  double min_parcel_area_m2{};
  double min_frontage_meters{};
  std::optional<double> max_residential_units_per_hectare{};
};

[[nodiscard]] const std::array<ZoningDistrict, 6>& zoning_district_catalog() noexcept;
[[nodiscard]] const ZoningDistrict* find_zoning_district(std::string_view id) noexcept;
[[nodiscard]] std::string_view district_for_legacy_zone(std::string_view legacy_zone) noexcept;

enum class ZoningOverlayKind : std::uint8_t {
  floodplain,
  historic,
  airport_height,
  transit_oriented,
  waterfront,
  environmental,
  downtown_bonus,
  affordable_housing_bonus,
};

[[nodiscard]] std::string_view zoning_overlay_kind_name(ZoningOverlayKind kind) noexcept;

struct ZoningOverlay final {
  std::string id{};
  ZoningOverlayKind kind{ZoningOverlayKind::floodplain};
  std::vector<civic::core::ParcelId> parcel_ids{};
  std::optional<double> max_far_multiplier{};
  std::optional<double> max_height_meters{};
  std::optional<double> max_coverage_ratio{};
  std::optional<double> additional_front_setback_meters{};
  std::optional<double> additional_rear_setback_meters{};
  std::optional<double> additional_side_setback_meters{};
  std::vector<UseType> permitted_use_additions{};
  std::vector<UseType> prohibited_uses{};
};

struct ParcelZoningAssignment final {
  civic::core::ParcelId parcel_id{};
  std::string district_id{};
  std::vector<std::string> overlay_ids{};
};

struct EffectiveZoningControls final {
  civic::core::ParcelId parcel_id{};
  std::string district_id{};
  std::vector<std::string> overlay_ids{};
  double max_far{};
  double max_height_meters{};
  std::uint32_t max_stories{};
  double max_coverage_ratio{};
  double front_setback_meters{};
  double rear_setback_meters{};
  double side_setback_meters{};
  double min_parcel_area_m2{};
  double min_frontage_meters{};
  std::optional<double> max_residential_units_per_hectare{};
  std::vector<UseType> permitted_uses{};
};

class ZoningStore final {
public:
  [[nodiscard]] civic::core::Result<void> assign(
      civic::core::ParcelId parcel_id,
      std::string district_id,
      std::vector<std::string> overlay_ids = {}) noexcept;
  [[nodiscard]] bool clear(civic::core::ParcelId parcel_id) noexcept;
  [[nodiscard]] const ParcelZoningAssignment* find_assignment(civic::core::ParcelId parcel_id) const noexcept;
  [[nodiscard]] const std::map<civic::core::ParcelId, ParcelZoningAssignment>& assignments() const noexcept {
    return assignments_;
  }

  [[nodiscard]] civic::core::Result<void> restore_assignments(
      std::span<const ParcelZoningAssignment> assignments) noexcept;

  [[nodiscard]] civic::core::Result<void> upsert_overlay(ZoningOverlay overlay) noexcept;
  [[nodiscard]] const ZoningOverlay* find_overlay(std::string_view id) const noexcept;
  [[nodiscard]] const std::map<std::string, ZoningOverlay>& overlays() const noexcept { return overlays_; }

  [[nodiscard]] civic::core::Result<EffectiveZoningControls> effective_controls(
      civic::core::ParcelId parcel_id) const noexcept;

private:
  std::map<civic::core::ParcelId, ParcelZoningAssignment> assignments_{};
  std::map<std::string, ZoningOverlay> overlays_{};
};

}  // namespace civic::urban
