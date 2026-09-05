#pragma once
#include "civic/core/Result.hpp"
#include "civic/core/StrongId.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <span>
#include <vector>

namespace civic::geometry {
using Coordinate = civic::core::LegalCoordinateCm;
struct Point final { Coordinate x{}; Coordinate y{}; auto operator<=>(const Point&) const = default; };
struct Segment final { Point a{}; Point b{}; };
struct Bounds final { Coordinate min_x{}; Coordinate min_y{}; Coordinate max_x{}; Coordinate max_y{}; };
struct Polygon final { std::vector<Point> vertices{}; };
[[nodiscard]] std::int64_t signed_double_area(const Polygon& polygon) noexcept;
[[nodiscard]] double area_square_meters(const Polygon& polygon) noexcept;
[[nodiscard]] civic::core::Result<Point> centroid(const Polygon& polygon) noexcept;
[[nodiscard]] civic::core::Result<Bounds> bounds(const Polygon& polygon) noexcept;
[[nodiscard]] bool point_on_segment(Point p, Segment segment) noexcept;
[[nodiscard]] bool point_in_polygon(Point point, const Polygon& polygon) noexcept;
[[nodiscard]] bool segments_intersect(Segment lhs, Segment rhs) noexcept;
[[nodiscard]] civic::core::Result<Polygon> canonicalize(const Polygon& polygon) noexcept;
[[nodiscard]] std::uint64_t deterministic_hash(const Polygon& polygon) noexcept;
[[nodiscard]] Polygon rectangle(Coordinate min_x, Coordinate min_y, Coordinate max_x, Coordinate max_y);
}
