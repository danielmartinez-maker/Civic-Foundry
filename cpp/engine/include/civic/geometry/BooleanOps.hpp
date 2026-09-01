#pragma once
#include "Geometry.hpp"
#include <span>
#include <vector>

namespace civic::geometry {
using MultiPolygon = std::vector<Polygon>;
[[nodiscard]] civic::core::Result<MultiPolygon> polygon_union(std::span<const Polygon> polygons) noexcept;
[[nodiscard]] civic::core::Result<MultiPolygon> polygon_intersection(const Polygon& subject, const Polygon& clip) noexcept;
[[nodiscard]] civic::core::Result<MultiPolygon> polygon_difference(const Polygon& subject, const Polygon& clip) noexcept;
[[nodiscard]] civic::core::Result<MultiPolygon> polygon_difference(std::span<const Polygon> subjects, const Polygon& clip) noexcept;
[[nodiscard]] double total_area_square_meters(std::span<const Polygon> polygons) noexcept;
}
