#pragma once
#include "civic/cadastre/Cadastre.hpp"
#include "civic/core/Result.hpp"
#include "civic/geometry/BooleanOps.hpp"
#include "civic/urban/Zoning.hpp"
#include <cstdint>
#include <string>
#include <vector>

namespace civic::urban {

enum class ZoningConstraintCode : std::uint8_t {
  use,
  footprint,
  far,
  height,
  stories,
  coverage,
  front_setback,
  rear_setback,
  side_setback,
  minimum_area,
  minimum_frontage,
  disconnected_envelope,
  overlay,
};

[[nodiscard]] std::string_view zoning_constraint_code_name(ZoningConstraintCode code) noexcept;

struct ZoningConstraint final {
  ZoningConstraintCode code{ZoningConstraintCode::footprint};
  double limit{};
  double actual{};
  std::string source_id{};
};

struct ParcelDevelopmentEnvelope final {
  civic::core::ParcelId parcel_id{};
  std::string district_id{};
  civic::geometry::Polygon buildable_footprint{};
  double parcel_area_m2{};
  double frontage_meters{};
  double max_footprint_area_m2{};
  double max_gross_floor_area_m2{};
  double max_height_meters{};
  std::uint32_t max_stories{};
  double allowed_far{};
  double effective_far{};
  double effective_coverage_ratio{};
  std::vector<UseType> permitted_uses{};
  std::vector<ZoningConstraint> limiting_constraints{};
};

class BuildableEnvelopeSystem final {
public:
  [[nodiscard]] civic::core::Result<ParcelDevelopmentEnvelope> evaluate(
      civic::core::ParcelId parcel_id,
      const civic::cadastre::CadastralGraph& graph,
      const EffectiveZoningControls& controls) const noexcept;
};

}  // namespace civic::urban
