#include "civic/geometry/BooleanOps.hpp"
#include <clipper2/clipper.h>
#include <algorithm>
#include <array>

namespace civic::geometry {
namespace {
Clipper2Lib::Path64 to_path(const Polygon& polygon) {
  Clipper2Lib::Path64 path;
  path.reserve(polygon.vertices.size());
  for (const auto point : polygon.vertices) path.emplace_back(point.x, point.y);
  return path;
}
Clipper2Lib::Paths64 to_paths(std::span<const Polygon> polygons) {
  Clipper2Lib::Paths64 paths;
  paths.reserve(polygons.size());
  for (const auto& polygon : polygons) paths.push_back(to_path(polygon));
  return paths;
}
civic::core::Result<MultiPolygon> from_paths(const Clipper2Lib::Paths64& paths) noexcept {
  try {
    MultiPolygon result;
    result.reserve(paths.size());
    for (const auto& path : paths) {
      Polygon polygon;
      polygon.vertices.reserve(path.size());
      for (const auto& point : path) polygon.vertices.push_back({point.x, point.y});
      auto canonical = canonicalize(polygon);
      if (!canonical) return std::unexpected(canonical.error());
      result.push_back(std::move(*canonical));
    }
    std::sort(result.begin(), result.end(), [](const Polygon& left, const Polygon& right) {
      return deterministic_hash(left) < deterministic_hash(right);
    });
    return result;
  } catch (const std::exception& exception) {
    return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error, exception.what()));
  }
}
}

civic::core::Result<MultiPolygon> polygon_union(std::span<const Polygon> polygons) noexcept {
  if (polygons.empty()) return MultiPolygon{};
  try { return from_paths(Clipper2Lib::Union(to_paths(polygons), Clipper2Lib::FillRule::NonZero)); }
  catch (const std::exception& exception) { return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error, exception.what())); }
}

civic::core::Result<MultiPolygon> polygon_intersection(const Polygon& subject, const Polygon& clip) noexcept {
  try { return from_paths(Clipper2Lib::Intersect(Clipper2Lib::Paths64{to_path(subject)}, Clipper2Lib::Paths64{to_path(clip)}, Clipper2Lib::FillRule::NonZero)); }
  catch (const std::exception& exception) { return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error, exception.what())); }
}

civic::core::Result<MultiPolygon> polygon_difference(const Polygon& subject, const Polygon& clip) noexcept {
  const std::array<Polygon,1> subjects{subject};
  return polygon_difference(std::span<const Polygon>{subjects}, clip);
}

civic::core::Result<MultiPolygon> polygon_difference(std::span<const Polygon> subjects, const Polygon& clip) noexcept {
  if (subjects.empty()) return MultiPolygon{};
  try { return from_paths(Clipper2Lib::Difference(to_paths(subjects), Clipper2Lib::Paths64{to_path(clip)}, Clipper2Lib::FillRule::NonZero)); }
  catch (const std::exception& exception) { return std::unexpected(civic::core::error(civic::core::ErrorCode::internal_error, exception.what())); }
}

double total_area_square_meters(std::span<const Polygon> polygons) noexcept {
  double total=0.0;
  for (const auto& polygon : polygons) total += area_square_meters(polygon);
  return total;
}
}
