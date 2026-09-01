#include <gtest/gtest.h>
#include "civic/urban/BuildableEnvelope.hpp"
#include <algorithm>
#include <limits>
#include <string>

namespace {
using civic::cadastre::CadastralGraph;
using civic::cadastre::Parcel;
using civic::core::ParcelId;
using civic::geometry::Point;
using civic::geometry::Polygon;
using civic::geometry::Segment;
using civic::urban::BuildableEnvelopeSystem;
using civic::urban::EffectiveZoningControls;
using civic::urban::UseType;
using civic::urban::ZoningConstraintCode;

Parcel make_parcel(std::string external, Polygon boundary) {
  Parcel parcel;
  parcel.external_id = std::move(external);
  parcel.id = civic::cadastre::parcel_id_from_external(parcel.external_id);
  parcel.block_id = "block:envelope";
  parcel.zoning_district_id = "MU4";
  parcel.owner_id = "owner:envelope";
  parcel.boundary = std::move(boundary);
  return parcel;
}

bool same_segment(Segment left, Segment right) {
  return (left.a == right.a && left.b == right.b) ||
         (left.a == right.b && left.b == right.a);
}

void mark_frontage(CadastralGraph& graph, ParcelId parcel_id, Segment segment, std::string road_ref) {
  for (const auto& [id, boundary] : graph.boundaries()) {
    const bool belongs = boundary.left_parcel_id == parcel_id || boundary.right_parcel_id == parcel_id;
    if (belongs && same_segment(boundary.geometry, segment)) {
      ASSERT_TRUE(graph.set_boundary_semantics(id, "street-frontage", std::move(road_ref), true, true).has_value());
      return;
    }
  }
  FAIL() << "frontage boundary not found";
}

EffectiveZoningControls controls(ParcelId parcel_id) {
  return EffectiveZoningControls{
      .parcel_id = parcel_id,
      .district_id = "MU4",
      .overlay_ids = {},
      .max_far = 4.0,
      .max_height_meters = 30.0,
      .max_stories = 8U,
      .max_coverage_ratio = 0.75,
      .front_setback_meters = 0.0,
      .rear_setback_meters = 3.0,
      .side_setback_meters = 0.0,
      .min_parcel_area_m2 = 150.0,
      .min_frontage_meters = 6.0,
      .max_residential_units_per_hectare = std::nullopt,
      .permitted_uses = {UseType::residential, UseType::retail, UseType::office, UseType::hospitality},
  };
}

bool has_constraint(const civic::urban::ParcelDevelopmentEnvelope& envelope, ZoningConstraintCode code) {
  return std::any_of(envelope.limiting_constraints.begin(), envelope.limiting_constraints.end(),
                     [&](const civic::urban::ZoningConstraint& constraint) {
                       return constraint.code == code;
                     });
}

TEST(NativeBuildableEnvelopeRed, SquareSetbackFixtureMatchesTwoRGeometryAndCapacity) {
  CadastralGraph graph;
  auto source = make_parcel("parcel:square", civic::geometry::rectangle(0,0,2000,2000));
  const auto parcel_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  mark_frontage(graph, parcel_id, {{0,0},{2000,0}}, "road:south");

  auto rules = controls(parcel_id);
  rules.max_far = 2.0;
  rules.max_height_meters = 18.0;
  rules.max_coverage_ratio = 0.5;
  rules.front_setback_meters = 2.0;
  rules.rear_setback_meters = 2.0;
  rules.side_setback_meters = 2.0;
  rules.min_parcel_area_m2 = 0.0;
  rules.min_frontage_meters = 0.0;

  auto envelope = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, rules);
  ASSERT_TRUE(envelope.has_value());
  EXPECT_DOUBLE_EQ(envelope->parcel_area_m2, 400.0);
  EXPECT_DOUBLE_EQ(envelope->frontage_meters, 20.0);
  EXPECT_EQ(civic::geometry::deterministic_hash(envelope->buildable_footprint),
            civic::geometry::deterministic_hash(civic::geometry::rectangle(200,200,1800,1800)));
  EXPECT_DOUBLE_EQ(envelope->max_footprint_area_m2, 200.0);
  EXPECT_DOUBLE_EQ(envelope->max_gross_floor_area_m2, 800.0);
  EXPECT_DOUBLE_EQ(envelope->max_height_meters, 18.0);
  EXPECT_EQ(envelope->max_stories, 5U);
  EXPECT_DOUBLE_EQ(envelope->allowed_far, 2.0);
  EXPECT_DOUBLE_EQ(envelope->effective_far, 2.0);
  EXPECT_DOUBLE_EQ(envelope->effective_coverage_ratio, 0.5);
}

TEST(NativeBuildableEnvelopeRed, RearSetbackUsesPerpendicularDistanceFromLongestFrontage) {
  CadastralGraph graph;
  Polygon skewed{{
      {0,0}, {2000,0}, {10000,100}, {2000,2000}, {0,2000},
  }};
  auto source = make_parcel("parcel:skew", std::move(skewed));
  const auto parcel_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  mark_frontage(graph, parcel_id, {{0,0},{2000,0}}, "road:front");

  auto rules = controls(parcel_id);
  rules.max_far = 20.0;
  rules.max_height_meters = 200.0;
  rules.max_stories = 100U;
  rules.max_coverage_ratio = 1.0;
  rules.front_setback_meters = 0.0;
  rules.rear_setback_meters = 5.0;
  rules.side_setback_meters = 0.0;
  rules.min_parcel_area_m2 = 0.0;
  rules.min_frontage_meters = 0.0;

  auto envelope = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, rules);
  ASSERT_TRUE(envelope.has_value());
  ASSERT_GE(envelope->buildable_footprint.vertices.size(), 3U);
  const auto bounds = civic::geometry::bounds(envelope->buildable_footprint);
  ASSERT_TRUE(bounds.has_value());
  EXPECT_LE(bounds->max_y, 1501);
}

TEST(NativeBuildableEnvelopeRed, MinimumAreaAndFrontageCanEliminateCapacityWithoutDeletingParcel) {
  CadastralGraph graph;
  auto source = make_parcel("parcel:constrained", civic::geometry::rectangle(0,0,2000,2000));
  const auto parcel_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  mark_frontage(graph, parcel_id, {{0,0},{2000,0}}, "road:south");

  auto area_rules = controls(parcel_id);
  area_rules.min_parcel_area_m2 = 500.0;
  auto area_result = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, area_rules);
  ASSERT_TRUE(area_result.has_value());
  EXPECT_TRUE(area_result->buildable_footprint.vertices.empty());
  EXPECT_DOUBLE_EQ(area_result->max_footprint_area_m2, 0.0);
  EXPECT_DOUBLE_EQ(area_result->max_gross_floor_area_m2, 0.0);
  EXPECT_TRUE(has_constraint(*area_result, ZoningConstraintCode::minimum_area));
  EXPECT_NE(graph.find(parcel_id), nullptr);

  auto frontage_rules = controls(parcel_id);
  frontage_rules.min_parcel_area_m2 = 0.0;
  frontage_rules.min_frontage_meters = 25.0;
  auto frontage_result = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, frontage_rules);
  ASSERT_TRUE(frontage_result.has_value());
  EXPECT_TRUE(frontage_result->buildable_footprint.vertices.empty());
  EXPECT_TRUE(has_constraint(*frontage_result, ZoningConstraintCode::minimum_frontage));
  EXPECT_NE(graph.find(parcel_id), nullptr);
}

TEST(NativeBuildableEnvelopeRed, NarrowParcelCanCollapseUnderSideSetbacks) {
  CadastralGraph graph;
  auto source = make_parcel("parcel:narrow", civic::geometry::rectangle(0,0,600,2000));
  const auto parcel_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  mark_frontage(graph, parcel_id, {{0,0},{600,0}}, "road:south");

  auto rules = controls(parcel_id);
  rules.max_far = 10.0;
  rules.max_height_meters = 100.0;
  rules.max_stories = 30U;
  rules.max_coverage_ratio = 1.0;
  rules.front_setback_meters = 0.0;
  rules.rear_setback_meters = 0.0;
  rules.side_setback_meters = 3.1;
  rules.min_parcel_area_m2 = 0.0;
  rules.min_frontage_meters = 0.0;

  auto envelope = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, rules);
  ASSERT_TRUE(envelope.has_value());
  EXPECT_TRUE(envelope->buildable_footprint.vertices.empty());
  EXPECT_DOUBLE_EQ(envelope->max_footprint_area_m2, 0.0);
}

TEST(NativeBuildableEnvelopeRed, CornerFrontagesComposeDeterministically) {
  CadastralGraph graph;
  auto source = make_parcel("parcel:corner", civic::geometry::rectangle(0,0,2000,2000));
  const auto parcel_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  mark_frontage(graph, parcel_id, {{0,0},{2000,0}}, "road:south");
  mark_frontage(graph, parcel_id, {{0,0},{0,2000}}, "road:west");

  auto rules = controls(parcel_id);
  rules.front_setback_meters = 2.0;
  rules.rear_setback_meters = 3.0;
  rules.side_setback_meters = 1.0;
  rules.min_parcel_area_m2 = 0.0;
  rules.min_frontage_meters = 0.0;

  auto first = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, rules);
  auto second = BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, rules);
  ASSERT_TRUE(first.has_value());
  ASSERT_TRUE(second.has_value());
  EXPECT_DOUBLE_EQ(first->frontage_meters, 40.0);
  EXPECT_GE(first->buildable_footprint.vertices.size(), 3U);
  EXPECT_LT(civic::geometry::area_square_meters(first->buildable_footprint), 400.0);
  EXPECT_EQ(civic::geometry::deterministic_hash(first->buildable_footprint),
            civic::geometry::deterministic_hash(second->buildable_footprint));
}

TEST(NativeBuildableEnvelopeRed, NonFiniteOrInvalidDimensionsAreRejectedAtInput) {
  CadastralGraph graph;
  auto source = make_parcel("parcel:invalid-controls", civic::geometry::rectangle(0,0,2000,2000));
  const auto parcel_id = source.id;
  ASSERT_TRUE(graph.insert(std::move(source)).has_value());
  mark_frontage(graph, parcel_id, {{0,0},{2000,0}}, "road:south");

  auto nan_far = controls(parcel_id);
  nan_far.max_far = std::numeric_limits<double>::quiet_NaN();
  EXPECT_FALSE(BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, nan_far).has_value());

  auto negative_coverage = controls(parcel_id);
  negative_coverage.max_coverage_ratio = -0.1;
  EXPECT_FALSE(BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, negative_coverage).has_value());

  auto infinite_setback = controls(parcel_id);
  infinite_setback.side_setback_meters = std::numeric_limits<double>::infinity();
  EXPECT_FALSE(BuildableEnvelopeSystem{}.evaluate(parcel_id, graph, infinite_setback).has_value());
}
}  // namespace
