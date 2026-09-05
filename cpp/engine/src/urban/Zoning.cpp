#include "civic/urban/Zoning.hpp"
#include <algorithm>
#include <cmath>
#include <set>

namespace civic::urban {
namespace {
using civic::core::ErrorCode;
using civic::core::ParcelId;

const std::array<ZoningDistrict, 6> kDistricts{{
    ZoningDistrict{
        "C6",
        {UseType::retail, UseType::office, UseType::hospitality},
        {},
        6.0,
        60.0,
        16U,
        0.80,
        0.0,
        3.0,
        0.0,
        180.0,
        8.0,
        std::nullopt,
    },
    ZoningDistrict{
        "IND",
        {UseType::light_industrial, UseType::heavy_industrial, UseType::logistics},
        {},
        2.0,
        24.0,
        5U,
        0.80,
        5.0,
        5.0,
        3.0,
        500.0,
        15.0,
        std::nullopt,
    },
    ZoningDistrict{
        "MU4",
        {UseType::residential, UseType::retail, UseType::office, UseType::hospitality},
        {},
        4.0,
        30.0,
        8U,
        0.75,
        0.0,
        3.0,
        0.0,
        150.0,
        6.0,
        std::nullopt,
    },
    ZoningDistrict{
        "MU8",
        {UseType::residential, UseType::retail, UseType::office, UseType::hospitality},
        {},
        8.0,
        90.0,
        25U,
        0.80,
        0.0,
        3.0,
        0.0,
        250.0,
        10.0,
        std::nullopt,
    },
    ZoningDistrict{
        "R2",
        {UseType::residential},
        {},
        1.5,
        12.0,
        2U,
        0.55,
        4.0,
        5.0,
        2.0,
        250.0,
        8.0,
        std::nullopt,
    },
    ZoningDistrict{
        "R5",
        {UseType::residential},
        {},
        4.0,
        30.0,
        8U,
        0.70,
        2.0,
        4.0,
        1.5,
        180.0,
        7.0,
        std::nullopt,
    },
}};

std::vector<std::string> canonical_strings(std::vector<std::string> values) {
  std::sort(values.begin(), values.end());
  values.erase(std::unique(values.begin(), values.end()), values.end());
  return values;
}

std::vector<ParcelId> canonical_parcels(std::vector<ParcelId> values) {
  std::sort(values.begin(), values.end());
  values.erase(std::unique(values.begin(), values.end()), values.end());
  return values;
}

std::vector<UseType> canonical_uses(std::vector<UseType> values) {
  std::sort(values.begin(), values.end(), [](UseType left, UseType right) {
    return use_type_name(left) < use_type_name(right);
  });
  values.erase(std::unique(values.begin(), values.end()), values.end());
  return values;
}

bool finite_nonnegative(double value) {
  return std::isfinite(value) && value >= 0.0;
}

civic::core::Result<void> validate_optional_nonnegative(
    const std::optional<double>& value,
    std::string_view field,
    std::string_view overlay_id) {
  if (!value || finite_nonnegative(*value)) return {};
  return std::unexpected(civic::core::error(
      ErrorCode::invalid_argument,
      "invalid " + std::string{field} + " in overlay " + std::string{overlay_id}));
}

bool applies_to(const ZoningOverlay& overlay, ParcelId parcel_id) {
  return std::find(overlay.parcel_ids.begin(), overlay.parcel_ids.end(), parcel_id) !=
         overlay.parcel_ids.end();
}
}  // namespace

std::string_view use_type_name(UseType use) noexcept {
  switch (use) {
    case UseType::residential: return "residential";
    case UseType::retail: return "retail";
    case UseType::office: return "office";
    case UseType::hospitality: return "hospitality";
    case UseType::light_industrial: return "light-industrial";
    case UseType::heavy_industrial: return "heavy-industrial";
    case UseType::logistics: return "logistics";
    case UseType::civic: return "civic";
  }
  return "unknown";
}

const std::array<ZoningDistrict, 6>& zoning_district_catalog() noexcept {
  return kDistricts;
}

const ZoningDistrict* find_zoning_district(std::string_view id) noexcept {
  const auto it = std::lower_bound(
      kDistricts.begin(), kDistricts.end(), id,
      [](const ZoningDistrict& district, std::string_view target) {
        return district.id < target;
      });
  if (it == kDistricts.end() || it->id != id) return nullptr;
  return &*it;
}

std::string_view district_for_legacy_zone(std::string_view legacy_zone) noexcept {
  if (legacy_zone == "residential") return "R2";
  if (legacy_zone == "commercial") return "C6";
  if (legacy_zone == "industrial") return "IND";
  return {};
}

std::string_view zoning_overlay_kind_name(ZoningOverlayKind kind) noexcept {
  switch (kind) {
    case ZoningOverlayKind::floodplain: return "floodplain";
    case ZoningOverlayKind::historic: return "historic";
    case ZoningOverlayKind::airport_height: return "airport-height";
    case ZoningOverlayKind::transit_oriented: return "transit-oriented";
    case ZoningOverlayKind::waterfront: return "waterfront";
    case ZoningOverlayKind::environmental: return "environmental";
    case ZoningOverlayKind::downtown_bonus: return "downtown-bonus";
    case ZoningOverlayKind::affordable_housing_bonus: return "affordable-housing-bonus";
  }
  return "unknown";
}

civic::core::Result<void> ZoningStore::assign(
    ParcelId parcel_id,
    std::string district_id,
    std::vector<std::string> overlay_ids) noexcept {
  try {
    if (parcel_id.value() == 0) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "parcel zoning assignment requires parcel id"));
    }
    if (find_zoning_district(district_id) == nullptr) {
      return std::unexpected(civic::core::error(
          ErrorCode::not_found, "unknown zoning district: " + district_id));
    }
    assignments_[parcel_id] = ParcelZoningAssignment{
        parcel_id,
        std::move(district_id),
        canonical_strings(std::move(overlay_ids)),
    };
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

bool ZoningStore::clear(ParcelId parcel_id) noexcept {
  return assignments_.erase(parcel_id) != 0U;
}

const ParcelZoningAssignment* ZoningStore::find_assignment(ParcelId parcel_id) const noexcept {
  const auto it = assignments_.find(parcel_id);
  return it == assignments_.end() ? nullptr : &it->second;
}

civic::core::Result<void> ZoningStore::restore_assignments(
    std::span<const ParcelZoningAssignment> assignments) noexcept {
  try {
    std::map<ParcelId, ParcelZoningAssignment> staged;
    for (const auto& source : assignments) {
      if (source.parcel_id.value() == 0) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument, "restored zoning assignment requires parcel id"));
      }
      if (find_zoning_district(source.district_id) == nullptr) {
        return std::unexpected(civic::core::error(
            ErrorCode::not_found, "restored zoning assignment references unknown district"));
      }
      if (staged.contains(source.parcel_id)) {
        return std::unexpected(civic::core::error(
            ErrorCode::conflict, "duplicate restored parcel zoning assignment"));
      }
      auto copy = source;
      copy.overlay_ids = canonical_strings(std::move(copy.overlay_ids));
      staged.emplace(copy.parcel_id, std::move(copy));
    }
    assignments_ = std::move(staged);
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

civic::core::Result<void> ZoningStore::upsert_overlay(ZoningOverlay overlay) noexcept {
  try {
    if (overlay.id.empty()) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "zoning overlay requires stable id"));
    }
    for (const auto parcel_id : overlay.parcel_ids) {
      if (parcel_id.value() == 0) {
        return std::unexpected(civic::core::error(
            ErrorCode::invalid_argument, "zoning overlay contains invalid parcel id"));
      }
    }
    if (auto result = validate_optional_nonnegative(
            overlay.max_far_multiplier, "FAR multiplier", overlay.id); !result) {
      return result;
    }
    if (auto result = validate_optional_nonnegative(
            overlay.max_height_meters, "height", overlay.id); !result) {
      return result;
    }
    if (overlay.max_coverage_ratio &&
        (!std::isfinite(*overlay.max_coverage_ratio) ||
         *overlay.max_coverage_ratio < 0.0 || *overlay.max_coverage_ratio > 1.0)) {
      return std::unexpected(civic::core::error(
          ErrorCode::invalid_argument, "invalid coverage ratio in overlay " + overlay.id));
    }
    if (auto result = validate_optional_nonnegative(
            overlay.additional_front_setback_meters, "front setback", overlay.id); !result) {
      return result;
    }
    if (auto result = validate_optional_nonnegative(
            overlay.additional_rear_setback_meters, "rear setback", overlay.id); !result) {
      return result;
    }
    if (auto result = validate_optional_nonnegative(
            overlay.additional_side_setback_meters, "side setback", overlay.id); !result) {
      return result;
    }

    overlay.parcel_ids = canonical_parcels(std::move(overlay.parcel_ids));
    overlay.permitted_use_additions = canonical_uses(std::move(overlay.permitted_use_additions));
    overlay.prohibited_uses = canonical_uses(std::move(overlay.prohibited_uses));
    overlays_[overlay.id] = std::move(overlay);
    return {};
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

const ZoningOverlay* ZoningStore::find_overlay(std::string_view id) const noexcept {
  const auto it = overlays_.find(std::string{id});
  return it == overlays_.end() ? nullptr : &it->second;
}

civic::core::Result<EffectiveZoningControls> ZoningStore::effective_controls(
    ParcelId parcel_id) const noexcept {
  try {
    const auto* assignment = find_assignment(parcel_id);
    if (assignment == nullptr) {
      return std::unexpected(civic::core::error(
          ErrorCode::not_found, "parcel has no zoning assignment"));
    }
    const auto* district = find_zoning_district(assignment->district_id);
    if (district == nullptr) {
      return std::unexpected(civic::core::error(
          ErrorCode::invariant_failure, "parcel assignment references unknown zoning district"));
    }

    EffectiveZoningControls controls{
        .parcel_id = parcel_id,
        .district_id = district->id,
        .overlay_ids = assignment->overlay_ids,
        .max_far = district->max_far,
        .max_height_meters = district->max_height_meters,
        .max_stories = district->max_stories,
        .max_coverage_ratio = district->max_coverage_ratio,
        .front_setback_meters = district->front_setback_meters,
        .rear_setback_meters = district->rear_setback_meters,
        .side_setback_meters = district->side_setback_meters,
        .min_parcel_area_m2 = district->min_parcel_area_m2,
        .min_frontage_meters = district->min_frontage_meters,
        .max_residential_units_per_hectare = district->max_residential_units_per_hectare,
        .permitted_uses = district->permitted_uses,
    };

    std::set<UseType> uses(controls.permitted_uses.begin(), controls.permitted_uses.end());
    for (const auto& overlay_id : controls.overlay_ids) {
      const auto* overlay = find_overlay(overlay_id);
      if (overlay == nullptr) {
        return std::unexpected(civic::core::error(
            ErrorCode::not_found, "zoning assignment references unknown overlay: " + overlay_id));
      }
      if (!applies_to(*overlay, parcel_id)) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure,
            "zoning assignment references overlay that does not apply to parcel: " + overlay_id));
      }
      if (overlay->max_far_multiplier) controls.max_far *= *overlay->max_far_multiplier;
      if (overlay->max_height_meters) {
        controls.max_height_meters = std::min(controls.max_height_meters, *overlay->max_height_meters);
      }
      if (overlay->max_coverage_ratio) {
        controls.max_coverage_ratio = std::min(controls.max_coverage_ratio, *overlay->max_coverage_ratio);
      }
      controls.front_setback_meters += overlay->additional_front_setback_meters.value_or(0.0);
      controls.rear_setback_meters += overlay->additional_rear_setback_meters.value_or(0.0);
      controls.side_setback_meters += overlay->additional_side_setback_meters.value_or(0.0);
      for (const auto use : overlay->permitted_use_additions) uses.insert(use);
      for (const auto use : overlay->prohibited_uses) uses.erase(use);
    }

    controls.permitted_uses.assign(uses.begin(), uses.end());
    controls.permitted_uses = canonical_uses(std::move(controls.permitted_uses));
    return controls;
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

}  // namespace civic::urban
