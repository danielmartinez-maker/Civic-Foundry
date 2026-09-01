#include "civic/urban/BuildableEnvelope.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <optional>
#include <set>

namespace civic::urban {
namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::Parcel;
using civic::cadastre::ParcelBoundary;
using civic::core::ErrorCode;
using civic::geometry::Coordinate;
using civic::geometry::MultiPolygon;
using civic::geometry::Point;
using civic::geometry::Polygon;
using civic::geometry::Segment;

constexpr double kFloorToFloorMeters = 3.2;
constexpr double kCapacityEpsilon = 1e-9;
constexpr long double kCentimetersPerMeter = 100.0L;

enum class EdgeRole : std::uint8_t { front, rear, side };

bool finite_nonnegative(double value) noexcept {
  return std::isfinite(value) && value >= 0.0;
}

civic::core::Result<void> validate_controls(
    civic::core::ParcelId parcel_id,
    const EffectiveZoningControls& controls) noexcept {
  if (controls.parcel_id != parcel_id) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "zoning controls reference a different parcel"));
  }
  if (controls.district_id.empty()) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "zoning controls require district identity"));
  }
  if (!finite_nonnegative(controls.max_far) ||
      !finite_nonnegative(controls.max_height_meters) ||
      !std::isfinite(controls.max_coverage_ratio) || controls.max_coverage_ratio < 0.0 ||
      controls.max_coverage_ratio > 1.0 ||
      !finite_nonnegative(controls.front_setback_meters) ||
      !finite_nonnegative(controls.rear_setback_meters) ||
      !finite_nonnegative(controls.side_setback_meters) ||
      !finite_nonnegative(controls.min_parcel_area_m2) ||
      !finite_nonnegative(controls.min_frontage_meters) ||
      (controls.max_residential_units_per_hectare &&
       !finite_nonnegative(*controls.max_residential_units_per_hectare))) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "zoning controls contain non-finite or invalid dimensions"));
  }
  const auto max_setback = std::max({
      controls.front_setback_meters,
      controls.rear_setback_meters,
      controls.side_setback_meters,
  });
  const long double max_coordinate =
      static_cast<long double>(std::numeric_limits<Coordinate>::max());
  if (static_cast<long double>(max_setback) * kCentimetersPerMeter > max_coordinate / 4.0L) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "zoning setback exceeds legal coordinate range"));
  }
  return {};
}

long double segment_length_cm(Segment segment) noexcept {
  const long double dx = static_cast<long double>(segment.b.x) - segment.a.x;
  const long double dy = static_cast<long double>(segment.b.y) - segment.a.y;
  return std::hypotl(dx, dy);
}

double segment_length_meters(Segment segment) noexcept {
  return static_cast<double>(segment_length_cm(segment) / kCentimetersPerMeter);
}

bool same_segment(Segment left, Segment right) noexcept {
  return (left.a == right.a && left.b == right.b) ||
         (left.a == right.b && left.b == right.a);
}

const ParcelBoundary* boundary_for_segment(
    const Parcel& parcel,
    const CadastralGraph& graph,
    Segment segment) noexcept {
  for (const auto& boundary_id : parcel.boundaries) {
    const auto* boundary = graph.find_boundary(boundary_id);
    if (boundary != nullptr && same_segment(boundary->geometry, segment)) return boundary;
  }
  return nullptr;
}

long double perpendicular_distance_cm(Point point, Segment line) noexcept {
  const long double dx = static_cast<long double>(line.b.x) - line.a.x;
  const long double dy = static_cast<long double>(line.b.y) - line.a.y;
  const long double length = std::hypotl(dx, dy);
  if (length <= 0.0L) return 0.0L;
  const long double px = static_cast<long double>(point.x) - line.a.x;
  const long double py = static_cast<long double>(point.y) - line.a.y;
  return std::abs(dx * py - dy * px) / length;
}

Point midpoint(Segment segment) noexcept {
  return Point{
      static_cast<Coordinate>((static_cast<long double>(segment.a.x) + segment.b.x) / 2.0L),
      static_cast<Coordinate>((static_cast<long double>(segment.a.y) + segment.b.y) / 2.0L),
  };
}

std::map<std::string, EdgeRole> classify_edge_roles(
    const Parcel& parcel,
    const CadastralGraph& graph) {
  std::map<std::string, EdgeRole> roles;
  const std::set<std::string> frontage_ids(
      parcel.frontage_boundary_ids.begin(), parcel.frontage_boundary_ids.end());
  for (const auto& id : frontage_ids) roles[id] = EdgeRole::front;

  std::vector<const ParcelBoundary*> non_frontage;
  std::vector<const ParcelBoundary*> frontage;
  for (const auto& boundary_id : parcel.boundaries) {
    const auto* boundary = graph.find_boundary(boundary_id);
    if (boundary == nullptr) continue;
    if (frontage_ids.contains(boundary_id)) frontage.push_back(boundary);
    else non_frontage.push_back(boundary);
  }

  if (non_frontage.empty()) return roles;
  if (frontage.empty()) {
    for (const auto* boundary : non_frontage) roles[boundary->id] = EdgeRole::side;
    return roles;
  }

  std::sort(frontage.begin(), frontage.end(), [](const ParcelBoundary* left, const ParcelBoundary* right) {
    const auto left_length = segment_length_cm(left->geometry);
    const auto right_length = segment_length_cm(right->geometry);
    if (left_length != right_length) return left_length > right_length;
    return left->id < right->id;
  });
  const auto primary = frontage.front()->geometry;

  const ParcelBoundary* rear = nullptr;
  long double rear_distance = -1.0L;
  for (const auto* boundary : non_frontage) {
    const auto distance = perpendicular_distance_cm(midpoint(boundary->geometry), primary);
    if (rear == nullptr || distance > rear_distance ||
        (distance == rear_distance && boundary->id < rear->id)) {
      rear = boundary;
      rear_distance = distance;
    }
  }

  for (const auto* boundary : non_frontage) {
    roles[boundary->id] = boundary == rear ? EdgeRole::rear : EdgeRole::side;
  }
  return roles;
}

double setback_for_role(EdgeRole role, const EffectiveZoningControls& controls) noexcept {
  switch (role) {
    case EdgeRole::front: return controls.front_setback_meters;
    case EdgeRole::rear: return controls.rear_setback_meters;
    case EdgeRole::side: return controls.side_setback_meters;
  }
  return 0.0;
}

civic::core::Result<Coordinate> meters_to_cm(double meters) noexcept {
  if (!finite_nonnegative(meters)) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "setback must be finite and non-negative"));
  }
  const long double value = static_cast<long double>(meters) * kCentimetersPerMeter;
  if (value > static_cast<long double>(std::numeric_limits<Coordinate>::max())) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "setback exceeds legal coordinate range"));
  }
  return static_cast<Coordinate>(std::llround(value));
}

long double polygon_extent_cm(const Polygon& polygon) noexcept {
  if (polygon.vertices.empty()) return 1.0L;
  Coordinate min_x = polygon.vertices.front().x;
  Coordinate max_x = min_x;
  Coordinate min_y = polygon.vertices.front().y;
  Coordinate max_y = min_y;
  for (const auto point : polygon.vertices) {
    min_x = std::min(min_x, point.x);
    max_x = std::max(max_x, point.x);
    min_y = std::min(min_y, point.y);
    max_y = std::max(max_y, point.y);
  }
  return std::max<long double>({
      static_cast<long double>(max_x) - min_x,
      static_cast<long double>(max_y) - min_y,
      1.0L,
  });
}

civic::core::Result<Point> rounded_point(long double x, long double y) noexcept {
  const long double minimum = static_cast<long double>(std::numeric_limits<Coordinate>::min());
  const long double maximum = static_cast<long double>(std::numeric_limits<Coordinate>::max());
  if (!std::isfinite(x) || !std::isfinite(y) || x < minimum || x > maximum || y < minimum || y > maximum) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "setback geometry exceeds legal coordinate range"));
  }
  return Point{static_cast<Coordinate>(std::llround(x)), static_cast<Coordinate>(std::llround(y))};
}

civic::core::Result<Polygon> inward_exclusion_strip(
    Segment edge,
    Coordinate setback_cm,
    long double extent_cm,
    bool counter_clockwise) noexcept {
  const long double dx = static_cast<long double>(edge.b.x) - edge.a.x;
  const long double dy = static_cast<long double>(edge.b.y) - edge.a.y;
  const long double length = std::hypotl(dx, dy);
  if (length <= 0.0L || setback_cm <= 0) {
    return std::unexpected(civic::core::error(
        ErrorCode::invalid_argument, "setback strip requires non-zero edge and setback"));
  }
  const long double tangent_x = dx / length;
  const long double tangent_y = dy / length;
  const long double left_normal_x = -tangent_y;
  const long double left_normal_y = tangent_x;
  const long double normal_x = counter_clockwise ? left_normal_x : -left_normal_x;
  const long double normal_y = counter_clockwise ? left_normal_y : -left_normal_y;

  const long double outer_start_x = static_cast<long double>(edge.a.x) - tangent_x * extent_cm;
  const long double outer_start_y = static_cast<long double>(edge.a.y) - tangent_y * extent_cm;
  const long double outer_end_x = static_cast<long double>(edge.b.x) + tangent_x * extent_cm;
  const long double outer_end_y = static_cast<long double>(edge.b.y) + tangent_y * extent_cm;
  const long double inner_end_x = outer_end_x + normal_x * setback_cm;
  const long double inner_end_y = outer_end_y + normal_y * setback_cm;
  const long double inner_start_x = outer_start_x + normal_x * setback_cm;
  const long double inner_start_y = outer_start_y + normal_y * setback_cm;

  auto outer_start = rounded_point(outer_start_x, outer_start_y);
  if (!outer_start) return std::unexpected(outer_start.error());
  auto outer_end = rounded_point(outer_end_x, outer_end_y);
  if (!outer_end) return std::unexpected(outer_end.error());
  auto inner_end = rounded_point(inner_end_x, inner_end_y);
  if (!inner_end) return std::unexpected(inner_end.error());
  auto inner_start = rounded_point(inner_start_x, inner_start_y);
  if (!inner_start) return std::unexpected(inner_start.error());

  return civic::geometry::canonicalize(Polygon{{*outer_start, *outer_end, *inner_end, *inner_start}});
}

const Polygon* largest_polygon(const MultiPolygon& polygons) noexcept {
  if (polygons.empty()) return nullptr;
  return &*std::max_element(polygons.begin(), polygons.end(), [](const Polygon& left, const Polygon& right) {
    const auto left_area = civic::geometry::area_square_meters(left);
    const auto right_area = civic::geometry::area_square_meters(right);
    if (left_area != right_area) return left_area < right_area;
    return civic::geometry::deterministic_hash(left) > civic::geometry::deterministic_hash(right);
  });
}

ZoningConstraint constraint(
    ZoningConstraintCode code,
    double limit,
    double actual,
    std::string source_id) {
  return ZoningConstraint{code, limit, actual, std::move(source_id)};
}

std::uint32_t height_story_limit(double max_height_meters) noexcept {
  const double raw = std::floor(max_height_meters / kFloorToFloorMeters);
  if (raw <= 1.0) return 1U;
  if (raw >= static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
    return std::numeric_limits<std::uint32_t>::max();
  }
  return static_cast<std::uint32_t>(raw);
}
}  // namespace

std::string_view zoning_constraint_code_name(ZoningConstraintCode code) noexcept {
  switch (code) {
    case ZoningConstraintCode::use: return "use";
    case ZoningConstraintCode::footprint: return "footprint";
    case ZoningConstraintCode::far: return "far";
    case ZoningConstraintCode::height: return "height";
    case ZoningConstraintCode::stories: return "stories";
    case ZoningConstraintCode::coverage: return "coverage";
    case ZoningConstraintCode::front_setback: return "front-setback";
    case ZoningConstraintCode::rear_setback: return "rear-setback";
    case ZoningConstraintCode::side_setback: return "side-setback";
    case ZoningConstraintCode::minimum_area: return "minimum-area";
    case ZoningConstraintCode::minimum_frontage: return "minimum-frontage";
    case ZoningConstraintCode::disconnected_envelope: return "disconnected-envelope";
    case ZoningConstraintCode::overlay: return "overlay";
  }
  return "unknown";
}

civic::core::Result<ParcelDevelopmentEnvelope> BuildableEnvelopeSystem::evaluate(
    civic::core::ParcelId parcel_id,
    const CadastralGraph& graph,
    const EffectiveZoningControls& controls) const noexcept {
  try {
    if (auto validation = validate_controls(parcel_id, controls); !validation) {
      return std::unexpected(validation.error());
    }
    const auto* parcel = graph.find(parcel_id);
    if (parcel == nullptr || !parcel->live) {
      return std::unexpected(civic::core::error(
          ErrorCode::not_found, "buildable envelope requires a live canonical parcel"));
    }

    const double parcel_area = parcel->area_m2;
    double frontage_meters = 0.0;
    for (const auto& boundary_id : parcel->frontage_boundary_ids) {
      const auto* boundary = graph.find_boundary(boundary_id);
      if (boundary == nullptr ||
          (boundary->left_parcel_id != parcel_id && boundary->right_parcel_id != parcel_id)) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure, "parcel frontage references invalid canonical boundary"));
      }
      frontage_meters += segment_length_meters(boundary->geometry);
    }

    ParcelDevelopmentEnvelope envelope{
        .parcel_id = parcel_id,
        .district_id = controls.district_id,
        .buildable_footprint = {},
        .parcel_area_m2 = parcel_area,
        .frontage_meters = frontage_meters,
        .max_footprint_area_m2 = 0.0,
        .max_gross_floor_area_m2 = 0.0,
        .max_height_meters = controls.max_height_meters,
        .max_stories = 0U,
        .allowed_far = controls.max_far,
        .effective_far = 0.0,
        .effective_coverage_ratio = 0.0,
        .permitted_uses = controls.permitted_uses,
        .limiting_constraints = {},
    };

    const bool area_eligible = parcel_area + kCapacityEpsilon >= controls.min_parcel_area_m2;
    const bool frontage_eligible = frontage_meters + kCapacityEpsilon >= controls.min_frontage_meters;
    if (!area_eligible) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::minimum_area,
          controls.min_parcel_area_m2,
          parcel_area,
          controls.district_id));
    }
    if (!frontage_eligible) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::minimum_frontage,
          controls.min_frontage_meters,
          frontage_meters,
          controls.district_id));
    }

    const auto height_stories = height_story_limit(controls.max_height_meters);
    const auto story_limit = controls.max_stories == 0U
        ? height_stories
        : std::min(height_stories, controls.max_stories);
    envelope.max_stories = story_limit;

    if (!area_eligible || !frontage_eligible) return envelope;

    MultiPolygon current{parcel->boundary};
    const auto roles = classify_edge_roles(*parcel, graph);
    const auto max_setback_meters = std::max({
        controls.front_setback_meters,
        controls.rear_setback_meters,
        controls.side_setback_meters,
    });
    auto max_setback_cm = meters_to_cm(max_setback_meters);
    if (!max_setback_cm) return std::unexpected(max_setback_cm.error());
    const long double extent = polygon_extent_cm(parcel->boundary) +
                               static_cast<long double>(*max_setback_cm) + 100.0L;
    const bool counter_clockwise = civic::geometry::signed_double_area(parcel->boundary) >= 0;

    for (std::size_t index = 0; index < parcel->boundary.vertices.size(); ++index) {
      const Segment segment{
          parcel->boundary.vertices[index],
          parcel->boundary.vertices[(index + 1U) % parcel->boundary.vertices.size()]};
      const auto* boundary = boundary_for_segment(*parcel, graph, segment);
      if (boundary == nullptr) {
        return std::unexpected(civic::core::error(
            ErrorCode::invariant_failure, "canonical parcel segment lacks boundary identity"));
      }
      const auto role_it = roles.find(boundary->id);
      const EdgeRole role = role_it == roles.end() ? EdgeRole::side : role_it->second;
      const double setback_meters = setback_for_role(role, controls);
      if (setback_meters <= 0.0) continue;
      auto setback_cm = meters_to_cm(setback_meters);
      if (!setback_cm) return std::unexpected(setback_cm.error());
      if (*setback_cm == 0) continue;
      auto strip = inward_exclusion_strip(segment, *setback_cm, extent, counter_clockwise);
      if (!strip) return std::unexpected(strip.error());
      auto reduced = civic::geometry::polygon_difference(current, *strip);
      if (!reduced) return std::unexpected(reduced.error());
      current = std::move(*reduced);
      if (current.empty()) break;
    }

    if (current.size() > 1U) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::disconnected_envelope,
          1.0,
          static_cast<double>(current.size()),
          controls.district_id));
    }

    const auto* largest = largest_polygon(current);
    if (largest != nullptr) envelope.buildable_footprint = *largest;
    const double geometry_floorplate = largest == nullptr
        ? 0.0
        : civic::geometry::area_square_meters(*largest);
    const double coverage_floorplate = parcel_area * controls.max_coverage_ratio;
    const double max_footprint = std::min(coverage_floorplate, geometry_floorplate);
    const double zoning_floor_area = parcel_area * controls.max_far;
    const double height_floor_area = max_footprint * static_cast<double>(story_limit);
    const double max_gross_floor_area = std::min(zoning_floor_area, height_floor_area);

    envelope.max_footprint_area_m2 = max_footprint;
    envelope.max_gross_floor_area_m2 = max_gross_floor_area;
    envelope.effective_far = parcel_area > 0.0 ? max_gross_floor_area / parcel_area : 0.0;
    envelope.effective_coverage_ratio = parcel_area > 0.0 ? max_footprint / parcel_area : 0.0;

    if (controls.front_setback_meters > 0.0) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::front_setback,
          controls.front_setback_meters,
          controls.front_setback_meters,
          controls.district_id));
    }
    if (controls.rear_setback_meters > 0.0) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::rear_setback,
          controls.rear_setback_meters,
          controls.rear_setback_meters,
          controls.district_id));
    }
    if (controls.side_setback_meters > 0.0) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::side_setback,
          controls.side_setback_meters,
          controls.side_setback_meters,
          controls.district_id));
    }
    if (coverage_floorplate <= geometry_floorplate + kCapacityEpsilon) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::coverage,
          controls.max_coverage_ratio,
          envelope.effective_coverage_ratio,
          controls.district_id));
    }
    if (zoning_floor_area <= height_floor_area + kCapacityEpsilon) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::far,
          controls.max_far,
          envelope.effective_far,
          controls.district_id));
    } else {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::height,
          controls.max_height_meters,
          controls.max_height_meters,
          controls.district_id));
    }
    if (controls.max_stories != 0U && controls.max_stories < height_stories) {
      envelope.limiting_constraints.push_back(constraint(
          ZoningConstraintCode::stories,
          static_cast<double>(controls.max_stories),
          static_cast<double>(story_limit),
          controls.district_id));
    }

    return envelope;
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(ErrorCode::internal_error, exception.what()));
  }
}

}  // namespace civic::urban
