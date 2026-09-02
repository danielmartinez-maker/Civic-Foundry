#include "civic/world/WorldFoundation.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <numbers>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace civic::world {
namespace {
constexpr double kEpsilon = 1e-9;

[[nodiscard]] bool nearly_equal(double lhs, double rhs) noexcept {
  return std::abs(lhs - rhs) <= kEpsilon;
}

[[nodiscard]] bool same_point(const ScenarioPoint& lhs, const ScenarioPoint& rhs) noexcept {
  return nearly_equal(lhs.x, rhs.x) && nearly_equal(lhs.y, rhs.y);
}

[[nodiscard]] double cross(const ScenarioPoint& a, const ScenarioPoint& b, const ScenarioPoint& c) noexcept {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

[[nodiscard]] bool point_on_segment(const ScenarioPoint& point, const ScenarioPoint& a, const ScenarioPoint& b) noexcept {
  if (std::abs(cross(a, b, point)) > kEpsilon) return false;
  return point.x >= std::min(a.x, b.x) - kEpsilon &&
         point.x <= std::max(a.x, b.x) + kEpsilon &&
         point.y >= std::min(a.y, b.y) - kEpsilon &&
         point.y <= std::max(a.y, b.y) + kEpsilon;
}

[[nodiscard]] bool segments_intersect(
    const ScenarioPoint& a,
    const ScenarioPoint& b,
    const ScenarioPoint& c,
    const ScenarioPoint& d) noexcept {
  const auto ab_c = cross(a, b, c);
  const auto ab_d = cross(a, b, d);
  const auto cd_a = cross(c, d, a);
  const auto cd_b = cross(c, d, b);
  if (((ab_c > kEpsilon && ab_d < -kEpsilon) || (ab_c < -kEpsilon && ab_d > kEpsilon)) &&
      ((cd_a > kEpsilon && cd_b < -kEpsilon) || (cd_a < -kEpsilon && cd_b > kEpsilon))) {
    return true;
  }
  return point_on_segment(c, a, b) || point_on_segment(d, a, b) ||
         point_on_segment(a, c, d) || point_on_segment(b, c, d);
}

[[nodiscard]] civic::core::Result<ScenarioPolygon> normalize_polygon(const ScenarioPolygon& input) noexcept {
  ScenarioPolygon output = input;
  for (const auto& point : output.points) {
    if (!std::isfinite(point.x) || !std::isfinite(point.y)) {
      return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario polygon coordinates must be finite"));
    }
  }
  if (output.points.size() > 1U && same_point(output.points.front(), output.points.back())) {
    output.points.pop_back();
  }
  if (output.points.size() < 3U) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario polygon requires at least three unique vertices"));
  }
  for (std::size_t first = 0; first < output.points.size(); ++first) {
    for (std::size_t second = first + 1; second < output.points.size(); ++second) {
      if (same_point(output.points[first], output.points[second])) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario polygon contains duplicate vertex"));
      }
    }
  }
  for (std::size_t first = 0; first < output.points.size(); ++first) {
    const auto first_next = (first + 1U) % output.points.size();
    for (std::size_t second = first + 1U; second < output.points.size(); ++second) {
      if (second == first + 1U || (first == 0U && second == output.points.size() - 1U)) continue;
      const auto second_next = (second + 1U) % output.points.size();
      if (segments_intersect(
              output.points[first],
              output.points[first_next],
              output.points[second],
              output.points[second_next])) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario polygon self-intersection"));
      }
    }
  }
  double twice_area = 0.0;
  for (std::size_t index = 0; index < output.points.size(); ++index) {
    const auto& a = output.points[index];
    const auto& b = output.points[(index + 1U) % output.points.size()];
    twice_area += a.x * b.y - b.x * a.y;
  }
  if (std::abs(twice_area) <= 2.0 * kEpsilon) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario polygon has zero area"));
  }
  if (twice_area < 0.0) std::reverse(output.points.begin(), output.points.end());
  return output;
}

[[nodiscard]] bool point_in_polygon(const ScenarioPoint& point, const ScenarioPolygon& polygon) noexcept {
  bool inside = false;
  for (std::size_t i = 0, j = polygon.points.size() - 1U; i < polygon.points.size(); j = i++) {
    const auto& a = polygon.points[j];
    const auto& b = polygon.points[i];
    if (point_on_segment(point, a, b)) return true;
    const bool crosses = (a.y > point.y) != (b.y > point.y);
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

[[nodiscard]] bool blank_id(const std::string& id) noexcept {
  return id.empty() || std::all_of(id.begin(), id.end(), [](char ch) {
    return std::isspace(static_cast<unsigned char>(ch)) != 0;
  });
}

[[nodiscard]] WorldConfig resolve_config(const WorldConfig& base, const ScenarioWorldDefinition& scenario) noexcept {
  auto config = base;
  if (!scenario.generation.has_value()) return config;
  const auto& overrides = *scenario.generation;
  if (overrides.width.has_value()) config.width = *overrides.width;
  if (overrides.height.has_value()) config.height = *overrides.height;
  if (overrides.meters_per_cell.has_value()) config.meters_per_cell = *overrides.meters_per_cell;
  if (overrides.preset.has_value()) config.preset = *overrides.preset;
  return config;
}

[[nodiscard]] civic::core::Result<ScenarioPolygon> resolved_root(
    const WorldConfig& config,
    const ScenarioWorldDefinition& scenario) noexcept {
  ScenarioPolygon raw{};
  if (scenario.root_boundary.has_value()) {
    raw = *scenario.root_boundary;
  } else {
    raw.points = {
        {0.0, 0.0},
        {static_cast<double>(config.width), 0.0},
        {static_cast<double>(config.width), static_cast<double>(config.height)},
        {0.0, static_cast<double>(config.height)},
    };
  }
  auto root = normalize_polygon(raw);
  if (!root) return std::unexpected(root.error());
  for (std::uint32_t y = 0; y < config.height; ++y) {
    for (std::uint32_t x = 0; x < config.width; ++x) {
      if (!point_in_polygon(
              {static_cast<double>(x) + 0.5, static_cast<double>(y) + 0.5},
              *root)) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::invalid_argument,
            "scenario root boundary must contain all cell centers"));
      }
    }
  }
  return root;
}

template <class Callback>
[[nodiscard]] civic::core::Result<void> for_cells_in_polygon(
    TerrainField& terrain,
    const ScenarioPolygon& raw,
    Callback callback) noexcept {
  auto polygon = normalize_polygon(raw);
  if (!polygon) return std::unexpected(polygon.error());
  for (std::uint32_t y = 0; y < terrain.height; ++y) {
    for (std::uint32_t x = 0; x < terrain.width; ++x) {
      if (point_in_polygon(
              {static_cast<double>(x) + 0.5, static_cast<double>(y) + 0.5},
              *polygon)) {
        callback(terrain.samples[static_cast<std::size_t>(y) * terrain.width + x]);
      }
    }
  }
  return {};
}

[[nodiscard]] civic::core::Result<void> recompute_derived_terrain(TerrainField& terrain) noexcept {
  const auto count = static_cast<std::size_t>(terrain.width) * terrain.height;
  if (terrain.samples.size() != count || terrain.width == 0U || terrain.height == 0U ||
      !std::isfinite(terrain.meters_per_cell) || terrain.meters_per_cell <= 0.0) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_state, "invalid scenario terrain dimensions"));
  }
  std::vector<double> elevations;
  elevations.reserve(count);
  for (const auto& sample : terrain.samples) elevations.push_back(sample.elevation_meters);
  for (std::uint32_t y = 0; y < terrain.height; ++y) {
    for (std::uint32_t x = 0; x < terrain.width; ++x) {
      const auto index = static_cast<std::size_t>(y) * terrain.width + x;
      const auto left_x = x == 0U ? x : x - 1U;
      const auto right_x = std::min(terrain.width - 1U, x + 1U);
      const auto up_y = y == 0U ? y : y - 1U;
      const auto down_y = std::min(terrain.height - 1U, y + 1U);
      const auto left = elevations[static_cast<std::size_t>(y) * terrain.width + left_x];
      const auto right = elevations[static_cast<std::size_t>(y) * terrain.width + right_x];
      const auto up = elevations[static_cast<std::size_t>(up_y) * terrain.width + x];
      const auto down = elevations[static_cast<std::size_t>(down_y) * terrain.width + x];
      const auto x_span = (x == 0U || x == terrain.width - 1U) ? 1.0 : 2.0;
      const auto y_span = (y == 0U || y == terrain.height - 1U) ? 1.0 : 2.0;
      const auto gx = (right - left) / (x_span * terrain.meters_per_cell);
      const auto gy = (down - up) / (y_span * terrain.meters_per_cell);
      auto& sample = terrain.samples[index];
      sample.slope = std::hypot(gx, gy);
      sample.aspect_radians = std::atan2(gy, gx);
      auto preparation = land_preparation_multiplier({
          sample.slope,
          sample.soil_class,
          sample.bedrock_depth_meters,
          sample.groundwater_depth_meters,
          sample.contamination_index,
          0.0,
      });
      if (!preparation) return std::unexpected(preparation.error());
      sample.land_preparation_multiplier = *preparation;
    }
  }
  return {};
}

[[nodiscard]] civic::core::Result<HydrologyState> rebuild_hydrology(const TerrainField& terrain) noexcept {
  std::vector<double> elevations;
  std::vector<std::uint8_t> permanent_water;
  elevations.reserve(terrain.samples.size());
  permanent_water.reserve(terrain.samples.size());
  for (const auto& sample : terrain.samples) {
    elevations.push_back(sample.elevation_meters);
    permanent_water.push_back(sample.surface_water == SurfaceWaterClass::none ? 0U : 1U);
  }
  auto conditioned = resolve_depressions(terrain.width, terrain.height, elevations, permanent_water);
  if (!conditioned) return std::unexpected(conditioned.error());
  return build_hydrology(terrain, *conditioned);
}

struct DPoint final { double x{}; double y{}; };
using DRing = std::vector<DPoint>;

[[nodiscard]] double d_area(const DRing& ring) noexcept {
  double total = 0.0;
  for (std::size_t index = 0; index < ring.size(); ++index) {
    const auto& a = ring[index];
    const auto& b = ring[(index + 1U) % ring.size()];
    total += a.x * b.y - b.x * a.y;
  }
  return std::abs(total) * 0.5;
}

[[nodiscard]] DPoint d_centroid(const DRing& ring) {
  long double twice_area = 0.0;
  long double x_sum = 0.0;
  long double y_sum = 0.0;
  for (std::size_t index = 0; index < ring.size(); ++index) {
    const auto& a = ring[index];
    const auto& b = ring[(index + 1U) % ring.size()];
    const auto factor = static_cast<long double>(a.x) * b.y - static_cast<long double>(b.x) * a.y;
    twice_area += factor;
    x_sum += (a.x + b.x) * factor;
    y_sum += (a.y + b.y) * factor;
  }
  if (std::abs(twice_area) <= kEpsilon) throw std::runtime_error("scenario geography polygon has zero area");
  return {
      static_cast<double>(x_sum / (3.0L * twice_area)),
      static_cast<double>(y_sum / (3.0L * twice_area)),
  };
}

[[nodiscard]] DRing clean_ring(DRing input) {
  DRing output;
  for (const auto& point : input) {
    if (output.empty() || !nearly_equal(output.back().x, point.x) || !nearly_equal(output.back().y, point.y)) {
      output.push_back(point);
    }
  }
  if (output.size() > 1U && nearly_equal(output.front().x, output.back().x) &&
      nearly_equal(output.front().y, output.back().y)) {
    output.pop_back();
  }
  return output;
}

[[nodiscard]] DRing clip_half_plane(
    const DRing& polygon,
    double nx,
    double ny,
    double c,
    bool keep_positive) {
  DRing output;
  const auto distance = [&](const DPoint& point) { return nx * point.x + ny * point.y - c; };
  const auto inside = [&](double value) {
    return keep_positive ? value >= -kEpsilon : value <= kEpsilon;
  };
  for (std::size_t index = 0; index < polygon.size(); ++index) {
    const auto& a = polygon[index];
    const auto& b = polygon[(index + 1U) % polygon.size()];
    const auto da = distance(a);
    const auto db = distance(b);
    const auto a_inside = inside(da);
    const auto b_inside = inside(db);
    if (a_inside) output.push_back(a);
    if (a_inside != b_inside) {
      const auto denominator = da - db;
      const auto t = std::abs(denominator) <= kEpsilon ? 0.5 : da / denominator;
      output.push_back({a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t});
    }
  }
  return clean_ring(std::move(output));
}

[[nodiscard]] std::optional<std::pair<DRing, DRing>> try_split(
    const DRing& polygon,
    double angle,
    double offset) {
  const auto center = d_centroid(polygon);
  const auto nx = std::cos(angle);
  const auto ny = std::sin(angle);
  const auto c = nx * center.x + ny * center.y + offset;
  auto first = clip_half_plane(polygon, nx, ny, c, false);
  auto second = clip_half_plane(polygon, nx, ny, c, true);
  if (first.size() < 3U || second.size() < 3U) return std::nullopt;
  const auto minimum = d_area(polygon) * 0.08;
  if (d_area(first) < minimum || d_area(second) < minimum) return std::nullopt;
  return std::pair<DRing, DRing>{std::move(first), std::move(second)};
}

[[nodiscard]] std::pair<DRing, DRing> split_polygon(DRing polygon, civic::core::SeededRandom& random) {
  auto min_x = polygon.front().x;
  auto max_x = min_x;
  auto min_y = polygon.front().y;
  auto max_y = min_y;
  for (const auto& point : polygon) {
    min_x = std::min(min_x, point.x);
    max_x = std::max(max_x, point.x);
    min_y = std::min(min_y, point.y);
    max_y = std::max(max_y, point.y);
  }
  const auto width = max_x - min_x;
  const auto height = max_y - min_y;
  const auto base_angle = width >= height ? 0.0 : std::numbers::pi / 2.0;
  const auto scale = std::max(width, height);
  for (int attempt = 0; attempt < 8; ++attempt) {
    const auto angle = base_angle + (random.next() - 0.5) * 0.9;
    const auto offset = (random.next() - 0.5) * scale * 0.16;
    if (auto split = try_split(polygon, angle, offset)) return *split;
  }
  if (auto split = try_split(polygon, base_angle, 0.0)) return *split;
  throw std::runtime_error("failed deterministic administrative split");
}

[[nodiscard]] std::vector<DRing> partition(DRing polygon, std::uint32_t count, civic::core::SeededRandom& random) {
  std::vector<DRing> parts{std::move(polygon)};
  while (parts.size() < count) {
    std::size_t largest = 0;
    for (std::size_t index = 1; index < parts.size(); ++index) {
      if (d_area(parts[index]) > d_area(parts[largest])) largest = index;
    }
    auto source = std::move(parts[largest]);
    parts.erase(parts.begin() + static_cast<std::ptrdiff_t>(largest));
    auto [first, second] = split_polygon(std::move(source), random);
    parts.push_back(std::move(first));
    parts.push_back(std::move(second));
  }
  std::sort(parts.begin(), parts.end(), [](const DRing& lhs, const DRing& rhs) {
    const auto left = d_centroid(lhs);
    const auto right = d_centroid(rhs);
    return left.x < right.x || (left.x == right.x && left.y < right.y);
  });
  return parts;
}

[[nodiscard]] civic::geometry::Polygon to_legal(const DRing& ring) {
  civic::geometry::Polygon polygon{};
  polygon.vertices.reserve(ring.size());
  for (const auto& point : ring) {
    polygon.vertices.push_back({
        static_cast<civic::geometry::Coordinate>(std::llround(point.x * 100.0)),
        static_cast<civic::geometry::Coordinate>(std::llround(point.y * 100.0)),
    });
  }
  auto canonical = civic::geometry::canonicalize(polygon);
  if (!canonical) throw std::runtime_error(canonical.error().message);
  return *canonical;
}

[[nodiscard]] std::string padded(std::uint32_t value) {
  std::ostringstream stream;
  stream.width(3);
  stream.fill('0');
  stream << value;
  return stream.str();
}

[[nodiscard]] GeographyHierarchy generate_geography_from_root(
    std::uint32_t seed,
    const WorldConfig& config,
    const ScenarioPolygon& root) {
  civic::core::RandomStreamRegistry registry{seed};
  auto& random = registry.stream("world.boundaries");
  DRing root_meters;
  root_meters.reserve(root.points.size());
  for (const auto& point : root.points) {
    root_meters.push_back({point.x * config.meters_per_cell, point.y * config.meters_per_cell});
  }
  GeographyHierarchy hierarchy{};
  const auto emit = [&](GeographyKind kind,
                        std::string id,
                        std::string parent,
                        const DRing& boundary,
                        std::string sort_key) {
    hierarchy.entities.push_back({
        std::move(id), kind, std::move(parent), to_legal(boundary), std::move(sort_key)});
  };
  emit(GeographyKind::region, "region:0", "", root_meters, ".000");
  const std::string municipality = "municipality:region:0:000";
  emit(GeographyKind::municipality, municipality, "region:0", root_meters, ".000.000");
  const auto district_draw = random.next_int(3);
  if (!district_draw) throw std::runtime_error(district_draw.error().message);
  auto districts = partition(root_meters, 2U + *district_draw, random);
  for (std::uint32_t district_index = 0; district_index < districts.size(); ++district_index) {
    const auto district_id = "district:" + municipality + ":" + padded(district_index);
    const auto district_key = ".000.000." + padded(district_index);
    emit(GeographyKind::district, district_id, municipality, districts[district_index], district_key);
    const auto neighborhood_draw = random.next_int(3);
    if (!neighborhood_draw) throw std::runtime_error(neighborhood_draw.error().message);
    auto neighborhoods = partition(districts[district_index], 2U + *neighborhood_draw, random);
    for (std::uint32_t neighborhood_index = 0; neighborhood_index < neighborhoods.size(); ++neighborhood_index) {
      const auto neighborhood_id = "neighborhood:" + district_id + ":" + padded(neighborhood_index);
      const auto neighborhood_key = district_key + "." + padded(neighborhood_index);
      emit(
          GeographyKind::neighborhood,
          neighborhood_id,
          district_id,
          neighborhoods[neighborhood_index],
          neighborhood_key);
      const auto block_draw = random.next_int(5);
      if (!block_draw) throw std::runtime_error(block_draw.error().message);
      auto blocks = partition(neighborhoods[neighborhood_index], 2U + *block_draw, random);
      for (std::uint32_t block_index = 0; block_index < blocks.size(); ++block_index) {
        emit(
            GeographyKind::block,
            "block:" + neighborhood_id + ":" + padded(block_index),
            neighborhood_id,
            blocks[block_index],
            neighborhood_key + "." + padded(block_index));
      }
    }
  }
  return hierarchy;
}

[[nodiscard]] civic::core::Result<void> validate_administrative_boundaries(
    const GeographyHierarchy& hierarchy) noexcept {
  if (hierarchy.entities.empty()) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario administrative hierarchy must not be empty"));
  }
  std::unordered_map<std::string, const GeographyEntity*> by_id;
  std::size_t region_count = 0;
  for (const auto& entity : hierarchy.entities) {
    if (entity.id.empty() || !by_id.emplace(entity.id, &entity).second) {
      return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario administrative hierarchy contains duplicate or empty id"));
    }
    if (entity.boundary.vertices.size() < 3U || civic::geometry::signed_double_area(entity.boundary) == 0) {
      return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario administrative hierarchy contains invalid boundary"));
    }
    if (entity.kind == GeographyKind::region) ++region_count;
  }
  if (region_count != 1U) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario administrative hierarchy requires exactly one region"));
  }
  const auto expected_parent_kind = [](GeographyKind kind) -> std::optional<GeographyKind> {
    switch (kind) {
      case GeographyKind::region: return std::nullopt;
      case GeographyKind::municipality: return GeographyKind::region;
      case GeographyKind::district: return GeographyKind::municipality;
      case GeographyKind::neighborhood: return GeographyKind::district;
      case GeographyKind::block: return GeographyKind::neighborhood;
    }
    return std::nullopt;
  };
  for (const auto& entity : hierarchy.entities) {
    const auto parent_kind = expected_parent_kind(entity.kind);
    if (!parent_kind.has_value()) {
      if (!entity.parent_id.empty()) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario region must not have a parent"));
      }
      continue;
    }
    const auto parent = by_id.find(entity.parent_id);
    if (parent == by_id.end() || parent->second->kind != *parent_kind) {
      return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario administrative hierarchy contains orphan or wrong parent kind"));
    }
    for (const auto& vertex : entity.boundary.vertices) {
      if (!civic::geometry::point_in_polygon(vertex, parent->second->boundary)) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario administrative child lies outside parent"));
      }
    }
  }
  return {};
}
}  // namespace

civic::core::Result<WorldFoundation> WorldFoundation::generate(
    std::uint32_t seed,
    const WorldConfig& base_config,
    const ScenarioWorldDefinition& scenario) noexcept {
  try {
    if (blank_id(scenario.id)) {
      return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario id must not be empty"));
    }
    const auto config = resolve_config(base_config, scenario);
    if (config.width == 0U || config.height == 0U || !std::isfinite(config.meters_per_cell) ||
        config.meters_per_cell <= 0.0) {
      return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "invalid world config"));
    }
    auto root = resolved_root(config, scenario);
    if (!root) return std::unexpected(root.error());

    auto generated = WorldFoundation::generate(seed, config);
    if (!generated) return std::unexpected(generated.error());
    auto snapshot = generated->snapshot();

    for (const auto& override_value : scenario.elevation_overrides) {
      if (override_value.x < 0 || override_value.y < 0 ||
          override_value.x >= static_cast<std::int64_t>(config.width) ||
          override_value.y >= static_cast<std::int64_t>(config.height)) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario elevation override out of bounds"));
      }
      if (!std::isfinite(override_value.elevation_meters)) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario elevation must be finite"));
      }
      const auto index = static_cast<std::size_t>(override_value.y) * config.width +
                         static_cast<std::size_t>(override_value.x);
      snapshot.terrain.samples[index].elevation_meters = override_value.elevation_meters;
    }

    for (const auto& region : scenario.soil_regions) {
      auto applied = for_cells_in_polygon(snapshot.terrain, region.polygon, [&](TerrainPhysicalSample& sample) {
        sample.soil_class = region.soil_class;
        sample.bearing_capacity_kpa = soil_properties(region.soil_class).bearing_capacity_kpa;
      });
      if (!applied) return std::unexpected(applied.error());
    }
    for (const auto& region : scenario.groundwater_regions) {
      if (!std::isfinite(region.depth_meters) || region.depth_meters < 0.0) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario groundwater depth invalid"));
      }
      auto applied = for_cells_in_polygon(snapshot.terrain, region.polygon, [&](TerrainPhysicalSample& sample) {
        sample.groundwater_depth_meters = region.depth_meters;
      });
      if (!applied) return std::unexpected(applied.error());
    }
    for (const auto& region : scenario.contamination_regions) {
      if (!std::isfinite(region.index) || region.index < 0.0 || region.index > 1.0) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario contamination index invalid"));
      }
      auto applied = for_cells_in_polygon(snapshot.terrain, region.polygon, [&](TerrainPhysicalSample& sample) {
        sample.contamination_index = region.index;
      });
      if (!applied) return std::unexpected(applied.error());
    }
    for (const auto& region : scenario.permanent_water_regions) {
      if (region.surface_water == SurfaceWaterClass::none) {
        return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, "scenario permanent water class must not be none"));
      }
      auto applied = for_cells_in_polygon(snapshot.terrain, region.polygon, [&](TerrainPhysicalSample& sample) {
        sample.surface_water = region.surface_water;
        sample.vegetation_class = region.surface_water == SurfaceWaterClass::coast
                                      ? VegetationClass::none
                                      : VegetationClass::wetland;
        sample.buildable = false;
      });
      if (!applied) return std::unexpected(applied.error());
    }

    auto terrain_result = recompute_derived_terrain(snapshot.terrain);
    if (!terrain_result) return std::unexpected(terrain_result.error());
    auto hydrology = rebuild_hydrology(snapshot.terrain);
    if (!hydrology) return std::unexpected(hydrology.error());
    snapshot.hydrology = std::move(*hydrology);

    if (scenario.administrative_boundaries.has_value()) {
      auto valid = validate_administrative_boundaries(*scenario.administrative_boundaries);
      if (!valid) return std::unexpected(valid.error());
      snapshot.geography = *scenario.administrative_boundaries;
    } else if (scenario.root_boundary.has_value()) {
      snapshot.geography = generate_geography_from_root(seed, config, *root);
    }
    snapshot.scenario_id = scenario.id;
    return WorldFoundation::restore(std::move(snapshot));
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::invalid_argument, exception.what()));
  } catch (...) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error, "scenario world generation failed"));
  }
}
}  // namespace civic::world
