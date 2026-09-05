#include "civic/urban/BuildingMassing.hpp"

#include "civic/geometry/BooleanOps.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

namespace civic::urban {
namespace {

constexpr std::array<double, 4> kUtilizationTargets{0.55, 0.75, 0.90, 1.00};
constexpr double kEpsilon = 1e-9;
constexpr double kAreaToleranceM2 = 0.01;

[[nodiscard]] bool contains_use(const std::vector<UseType>& uses, UseType use) {
  return std::find(uses.begin(), uses.end(), use) != uses.end();
}

[[nodiscard]] double configured_value(const std::vector<UseMixEntry>& entries, UseType use) {
  const auto iterator = std::find_if(entries.begin(), entries.end(), [use](const UseMixEntry& entry) {
    return entry.use == use;
  });
  return iterator == entries.end() ? 0.0 : iterator->value;
}

void validate_typology(const BuildingTypology& typology) {
  if (typology.id.empty()) throw std::invalid_argument("building typology id must not be empty");
  if (typology.allowed_uses.empty()) throw std::invalid_argument("building typology must allow at least one use");
  if (!contains_use(typology.allowed_uses, typology.primary_use)) {
    throw std::invalid_argument("building typology primary use must be allowed");
  }
  if (typology.min_stories < 1 || typology.max_stories < typology.min_stories ||
      typology.preferred_stories < typology.min_stories || typology.preferred_stories > typology.max_stories) {
    throw std::invalid_argument("invalid building typology story range");
  }
  if (!std::isfinite(typology.floor_to_floor_height_meters) || typology.floor_to_floor_height_meters <= 0.0) {
    throw std::invalid_argument("building typology floor height must be positive and finite");
  }
  if (!std::isfinite(typology.efficiency_ratio) || typology.efficiency_ratio <= 0.0 ||
      typology.efficiency_ratio > 1.0) {
    throw std::invalid_argument("building typology efficiency must be within (0, 1]");
  }
  for (const auto& entry : typology.default_use_mix) {
    if (!std::isfinite(entry.value) || entry.value < 0.0) {
      throw std::invalid_argument("building typology use mix must be finite and non-negative");
    }
  }
}

[[nodiscard]] std::vector<UseMixEntry> normalized_use_mix(
    const BuildingTypology& typology,
    const std::vector<UseType>& legal_uses) {
  std::vector<UseMixEntry> result;
  double total = 0.0;
  for (const auto use : legal_uses) {
    const double weight = configured_value(typology.default_use_mix, use);
    if (!std::isfinite(weight) || weight < 0.0) {
      throw std::invalid_argument("building typology use mix must be finite and non-negative");
    }
    if (weight > 0.0) {
      result.push_back(UseMixEntry{use, weight});
      total += weight;
    }
  }
  if (total <= kEpsilon) {
    const auto fallback = contains_use(legal_uses, typology.primary_use) ? typology.primary_use : legal_uses.front();
    return {UseMixEntry{fallback, 1.0}};
  }
  for (auto& entry : result) entry.value /= total;
  std::sort(result.begin(), result.end(), [](const UseMixEntry& left, const UseMixEntry& right) {
    return left.use < right.use;
  });
  return result;
}

[[nodiscard]] civic::geometry::Polygon scaled_footprint(
    const civic::geometry::Polygon& source,
    double target_area_m2) {
  const double source_area_m2 = civic::geometry::area_square_meters(source);
  if (!std::isfinite(target_area_m2) || target_area_m2 <= kEpsilon || source_area_m2 <= kEpsilon) {
    throw std::invalid_argument("buildable footprint must have positive finite area");
  }
  const double scale = std::min(1.0, std::sqrt(target_area_m2 / source_area_m2));
  const auto center_result = civic::geometry::centroid(source);
  if (!center_result) throw std::invalid_argument(center_result.error().message);
  const auto center = *center_result;

  civic::geometry::Polygon scaled;
  scaled.vertices.reserve(source.vertices.size());
  for (const auto point : source.vertices) {
    const double x = static_cast<double>(center.x) +
        static_cast<double>(point.x - center.x) * scale;
    const double y = static_cast<double>(center.y) +
        static_cast<double>(point.y - center.y) * scale;
    scaled.vertices.push_back(civic::geometry::Point{
        static_cast<civic::geometry::Coordinate>(std::llround(x)),
        static_cast<civic::geometry::Coordinate>(std::llround(y)),
    });
  }
  auto canonical = civic::geometry::canonicalize(scaled);
  if (!canonical) throw std::invalid_argument(canonical.error().message);
  return *canonical;
}

[[nodiscard]] std::vector<FloorUseAllocation> allocations_for_area(
    double usable_area_m2,
    const std::vector<UseMixEntry>& use_mix) {
  std::vector<FloorUseAllocation> allocations;
  allocations.reserve(use_mix.size());
  double remaining = usable_area_m2;
  for (std::size_t index = 0; index < use_mix.size(); ++index) {
    const double area = index + 1 == use_mix.size()
        ? remaining
        : usable_area_m2 * use_mix[index].value;
    allocations.push_back(FloorUseAllocation{
        .use = use_mix[index].use,
        .floor_area_m2 = area,
    });
    remaining -= area;
  }
  return allocations;
}

[[nodiscard]] std::vector<BuildingFloor> create_floors(
    std::uint32_t stories,
    double gross_floor_area_m2,
    double usable_floor_area_m2,
    double floor_height_meters,
    const std::vector<UseMixEntry>& use_mix) {
  std::vector<BuildingFloor> floors;
  floors.reserve(stories);
  double remaining_gross = gross_floor_area_m2;
  double remaining_usable = usable_floor_area_m2;
  for (std::uint32_t level = 1; level <= stories; ++level) {
    const double gross = level == stories
        ? remaining_gross
        : gross_floor_area_m2 / static_cast<double>(stories);
    const double usable = level == stories
        ? remaining_usable
        : usable_floor_area_m2 / static_cast<double>(stories);
    floors.push_back(BuildingFloor{
        .level = level,
        .elevation_meters = static_cast<double>(level - 1U) * floor_height_meters,
        .gross_area_m2 = gross,
        .usable_area_m2 = usable,
        .uses = allocations_for_area(usable, use_mix),
    });
    remaining_gross -= gross;
    remaining_usable -= usable;
  }
  return floors;
}

[[nodiscard]] std::vector<UseType> unique_uses(const std::vector<BuildingFloor>& floors) {
  std::vector<UseType> uses;
  for (const auto& floor : floors) {
    for (const auto& allocation : floor.uses) uses.push_back(allocation.use);
  }
  std::sort(uses.begin(), uses.end());
  uses.erase(std::unique(uses.begin(), uses.end()), uses.end());
  return uses;
}

[[nodiscard]] bool candidate_is_legal(
    const DevelopmentCandidate& candidate,
    const ParcelDevelopmentEnvelope& envelope) {
  if (candidate.realized_far > envelope.effective_far + kEpsilon ||
      candidate.coverage_ratio > envelope.effective_coverage_ratio + kEpsilon ||
      candidate.height_meters > envelope.max_height_meters + kEpsilon ||
      candidate.stories > envelope.max_stories) {
    return false;
  }
  for (const auto use : candidate.uses) {
    if (!contains_use(envelope.permitted_uses, use)) return false;
  }
  auto outside = civic::geometry::polygon_difference(candidate.footprint, envelope.buildable_footprint);
  return outside && civic::geometry::total_area_square_meters(*outside) <= kAreaToleranceM2;
}

}  // namespace

std::vector<DevelopmentCandidate> BuildingMassingSystem::generate(
    const civic::cadastre::Parcel& parcel,
    const ParcelDevelopmentEnvelope& envelope,
    std::vector<BuildingTypology> typologies) const {
  if (envelope.parcel_id != parcel.id) {
    throw std::invalid_argument("parcel and envelope identifiers must match");
  }
  if (envelope.buildable_footprint.vertices.size() < 3 ||
      !std::isfinite(envelope.parcel_area_m2) || envelope.parcel_area_m2 <= 0.0 ||
      !std::isfinite(envelope.max_gross_floor_area_m2) || envelope.max_gross_floor_area_m2 <= 0.0 ||
      !std::isfinite(envelope.max_footprint_area_m2) || envelope.max_footprint_area_m2 <= 0.0) {
    return {};
  }

  std::sort(typologies.begin(), typologies.end(), [](const BuildingTypology& left, const BuildingTypology& right) {
    return left.id < right.id;
  });

  const double parcel_area_m2 = envelope.parcel_area_m2;
  const double source_footprint_area_m2 = civic::geometry::area_square_meters(envelope.buildable_footprint);
  const double max_gfa = std::min(
      envelope.max_gross_floor_area_m2,
      std::max(0.0, envelope.effective_far) * parcel_area_m2);
  const double max_footprint = std::min({
      envelope.max_footprint_area_m2,
      std::max(0.0, envelope.effective_coverage_ratio) * parcel_area_m2,
      source_footprint_area_m2,
  });
  if (max_gfa <= kEpsilon || max_footprint <= kEpsilon) return {};

  std::vector<DevelopmentCandidate> candidates;
  for (const auto& typology : typologies) {
    validate_typology(typology);

    std::vector<UseType> legal_uses;
    for (const auto use : typology.allowed_uses) {
      if (contains_use(envelope.permitted_uses, use)) legal_uses.push_back(use);
    }
    std::sort(legal_uses.begin(), legal_uses.end());
    legal_uses.erase(std::unique(legal_uses.begin(), legal_uses.end()), legal_uses.end());
    if (legal_uses.empty()) continue;
    const auto use_mix = normalized_use_mix(typology, legal_uses);

    const auto height_story_limit = static_cast<std::uint32_t>(std::floor(
        envelope.max_height_meters / typology.floor_to_floor_height_meters));
    const std::uint32_t max_stories = std::min({envelope.max_stories, typology.max_stories, height_story_limit});
    const std::uint32_t min_stories = std::max<std::uint32_t>(1U, typology.min_stories);
    if (max_stories < min_stories) continue;

    for (const double utilization : kUtilizationTargets) {
      const double target_gfa = max_gfa * utilization;
      const std::uint32_t preferred_stories = std::clamp(
          typology.preferred_stories,
          min_stories,
          max_stories);
      const double target_footprint_area = std::min(
          max_footprint,
          target_gfa / static_cast<double>(preferred_stories));
      if (target_footprint_area <= kEpsilon) continue;

      const auto calculated_stories = static_cast<std::uint32_t>(std::ceil(target_gfa / target_footprint_area));
      const std::uint32_t stories = std::clamp(calculated_stories, min_stories, max_stories);
      const double gross_floor_area_m2 = std::min({
          target_gfa,
          target_footprint_area * static_cast<double>(stories),
          max_gfa,
      });
      const double actual_footprint_target = std::min(
          target_footprint_area,
          gross_floor_area_m2 / static_cast<double>(stories));
      auto footprint = scaled_footprint(envelope.buildable_footprint, actual_footprint_target);
      const double realized_footprint_area_m2 = civic::geometry::area_square_meters(footprint);
      const double usable_floor_area_m2 = gross_floor_area_m2 * typology.efficiency_ratio;
      auto floors = create_floors(
          stories,
          gross_floor_area_m2,
          usable_floor_area_m2,
          typology.floor_to_floor_height_meters,
          use_mix);
      auto uses = unique_uses(floors);

      DevelopmentCandidate candidate{
          .id = "candidate:" + parcel.external_id + ":" + typology.id + ":" +
              std::to_string(static_cast<int>(std::lround(utilization * 100.0))),
          .parcel_ids = {parcel.id},
          .typology_id = typology.id,
          .target_utilization = utilization,
          .footprint = std::move(footprint),
          .gross_floor_area_m2 = gross_floor_area_m2,
          .usable_floor_area_m2 = usable_floor_area_m2,
          .height_meters = static_cast<double>(stories) * typology.floor_to_floor_height_meters,
          .stories = stories,
          .realized_far = gross_floor_area_m2 / parcel_area_m2,
          .coverage_ratio = realized_footprint_area_m2 / parcel_area_m2,
          .floors = std::move(floors),
          .uses = std::move(uses),
          .zoning_legal = true,
      };
      candidate.zoning_legal = candidate_is_legal(candidate, envelope);
      if (candidate.zoning_legal) candidates.push_back(std::move(candidate));
    }
  }
  return candidates;
}

}  // namespace civic::urban
