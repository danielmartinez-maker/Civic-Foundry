#include "civic/geometry/Geometry.hpp"

#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

namespace {
using civic::geometry::Coordinate;
using civic::geometry::Point;
using civic::geometry::Polygon;
using civic::geometry::Segment;
using nlohmann::json;

const json& geometry_fixture() {
  static const json fixture = [] {
    const auto path = std::filesystem::path(CIVIC_REPO_ROOT) /
                      "tests/fixtures/cpp-migration/geometry-v1.json";
    std::ifstream input(path);
    if (!input) {
      throw std::runtime_error("failed to open shared geometry fixture: " +
                               path.string());
    }
    return json::parse(input);
  }();
  return fixture;
}

Point read_point(const json& value) {
  return Point{value.at(0).get<Coordinate>(), value.at(1).get<Coordinate>()};
}

Polygon read_polygon(const json& vertices) {
  Polygon polygon;
  polygon.vertices.reserve(vertices.size());
  for (const auto& vertex : vertices) {
    polygon.vertices.push_back(read_point(vertex));
  }
  return polygon;
}

Segment read_segment(const json& value) {
  return Segment{read_point(value.at(0)), read_point(value.at(1))};
}

TEST(GeometryFixtureParity, SharedPolygonCasesMatchNativeKernel) {
  const auto& fixture = geometry_fixture();
  ASSERT_EQ(fixture.at("version").get<int>(), 1);
  const auto centroid_tolerance = fixture.at("centroidToleranceCm").get<double>();
  const auto& polygon_cases = fixture.at("polygons");
  ASSERT_GE(polygon_cases.size(), 3U);

  for (const auto& polygon_case : polygon_cases) {
    const auto id = polygon_case.at("id").get<std::string>();
    SCOPED_TRACE(id);
    const auto polygon = read_polygon(polygon_case.at("verticesCm"));
    const auto& expected = polygon_case.at("expected");

    EXPECT_EQ(civic::geometry::signed_double_area(polygon),
              expected.at("signedDoubleAreaCm2").get<std::int64_t>());

    const auto canonical = civic::geometry::canonicalize(polygon);
    ASSERT_TRUE(canonical.has_value());
    const auto& expected_vertices = expected.at("canonicalVerticesCm");
    ASSERT_EQ(canonical->vertices.size(), expected_vertices.size());
    for (std::size_t index = 0; index < expected_vertices.size(); ++index) {
      EXPECT_EQ(canonical->vertices[index], read_point(expected_vertices[index]));
    }

    const auto center = civic::geometry::centroid(polygon);
    ASSERT_TRUE(center.has_value());
    const auto& expected_center = expected.at("centroidCm");
    EXPECT_NEAR(static_cast<double>(center->x), expected_center.at(0).get<double>(),
                centroid_tolerance);
    EXPECT_NEAR(static_cast<double>(center->y), expected_center.at(1).get<double>(),
                centroid_tolerance);

    const auto polygon_bounds = civic::geometry::bounds(polygon);
    ASSERT_TRUE(polygon_bounds.has_value());
    const auto& expected_bounds = expected.at("boundsCm");
    EXPECT_EQ(polygon_bounds->min_x, expected_bounds.at(0).get<Coordinate>());
    EXPECT_EQ(polygon_bounds->min_y, expected_bounds.at(1).get<Coordinate>());
    EXPECT_EQ(polygon_bounds->max_x, expected_bounds.at(2).get<Coordinate>());
    EXPECT_EQ(polygon_bounds->max_y, expected_bounds.at(3).get<Coordinate>());

    EXPECT_EQ(civic::geometry::deterministic_hash(polygon),
              std::stoull(expected.at("hash64").get<std::string>()));

    for (const auto& point_case : polygon_case.at("pointCases")) {
      EXPECT_EQ(civic::geometry::point_in_polygon(
                    read_point(point_case.at("pointCm")), polygon),
                point_case.at("insideOrBoundary").get<bool>());
    }
  }
}

TEST(GeometryFixtureParity, SharedSegmentCasesMatchNativeKernel) {
  for (const auto& segment_case : geometry_fixture().at("segmentCases")) {
    SCOPED_TRACE(segment_case.at("id").get<std::string>());
    EXPECT_EQ(civic::geometry::segments_intersect(
                  read_segment(segment_case.at("lhsCm")),
                  read_segment(segment_case.at("rhsCm"))),
              segment_case.at("intersects").get<bool>());
  }
}
}  // namespace
