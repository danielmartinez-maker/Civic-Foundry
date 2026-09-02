#include <gtest/gtest.h>

#include "civic/world/WorldFoundation.hpp"

namespace {
using civic::world::ScenarioContaminationRegion;
using civic::world::ScenarioElevationOverride;
using civic::world::ScenarioGenerationOverrides;
using civic::world::ScenarioGroundwaterRegion;
using civic::world::ScenarioPermanentWaterRegion;
using civic::world::ScenarioPoint;
using civic::world::ScenarioPolygon;
using civic::world::ScenarioSoilRegion;
using civic::world::ScenarioWorldDefinition;
using civic::world::SoilClass;
using civic::world::SurfaceWaterClass;
using civic::world::VegetationClass;
using civic::world::WorldConfig;
using civic::world::WorldFoundation;
using civic::world::WorldPreset;

ScenarioPolygon rectangle(double min_x, double min_y, double max_x, double max_y) {
  return ScenarioPolygon{{
      ScenarioPoint{min_x, min_y},
      ScenarioPoint{max_x, min_y},
      ScenarioPoint{max_x, max_y},
      ScenarioPoint{min_x, max_y},
  }};
}

TEST(WorldScenarioParityRed, ScenarioPhysicalOverridesTakePrecedenceAndRebuildDerivedState) {
  ScenarioWorldDefinition scenario{};
  scenario.id = "scenario:physical-overrides";
  scenario.elevation_overrides.push_back(ScenarioElevationOverride{1, 1, 250.0});
  scenario.soil_regions.push_back(ScenarioSoilRegion{SoilClass::clay, rectangle(0.0, 0.0, 2.0, 2.0)});
  scenario.groundwater_regions.push_back(ScenarioGroundwaterRegion{0.5, rectangle(0.0, 0.0, 2.0, 2.0)});
  scenario.contamination_regions.push_back(ScenarioContaminationRegion{0.7, rectangle(0.0, 0.0, 2.0, 2.0)});
  scenario.permanent_water_regions.push_back(
      ScenarioPermanentWaterRegion{SurfaceWaterClass::coast, rectangle(3.0, 0.0, 4.0, 1.0)});

  auto world = WorldFoundation::generate(
      41002,
      WorldConfig{4, 4, 30.0, WorldPreset::plain},
      scenario);
  ASSERT_TRUE(world.has_value()) << world.error().message;
  ASSERT_TRUE(world->snapshot().scenario_id.has_value());
  EXPECT_EQ(*world->snapshot().scenario_id, scenario.id);

  const auto* overridden = world->terrain().at(1, 1).value();
  EXPECT_DOUBLE_EQ(overridden->elevation_meters, 250.0);
  EXPECT_EQ(overridden->soil_class, SoilClass::clay);
  EXPECT_DOUBLE_EQ(
      overridden->bearing_capacity_kpa,
      civic::world::soil_properties(SoilClass::clay).bearing_capacity_kpa);
  EXPECT_DOUBLE_EQ(overridden->groundwater_depth_meters, 0.5);
  EXPECT_DOUBLE_EQ(overridden->contamination_index, 0.7);
  EXPECT_TRUE(std::isfinite(overridden->slope));
  EXPECT_TRUE(std::isfinite(overridden->aspect_radians));
  EXPECT_GT(overridden->land_preparation_multiplier, 0.0);

  const auto* coast = world->terrain().at(3, 0).value();
  EXPECT_EQ(coast->surface_water, SurfaceWaterClass::coast);
  EXPECT_EQ(coast->vegetation_class, VegetationClass::none);
  EXPECT_FALSE(coast->buildable);
  EXPECT_EQ(world->hydrology().receiver.size(), 16u);
}

TEST(WorldScenarioParityRed, ScenarioGenerationOverridesAreResolvedBeforeWorldGeneration) {
  ScenarioWorldDefinition scenario{};
  scenario.id = "scenario:generation";
  scenario.generation = ScenarioGenerationOverrides{};
  scenario.generation->width = 5;
  scenario.generation->height = 3;
  scenario.generation->meters_per_cell = 20.0;
  scenario.generation->preset = WorldPreset::basin;

  auto world = WorldFoundation::generate(
      99,
      WorldConfig{4, 4, 30.0, WorldPreset::plain},
      scenario);
  ASSERT_TRUE(world.has_value()) << world.error().message;
  EXPECT_EQ(world->snapshot().config.width, 5u);
  EXPECT_EQ(world->snapshot().config.height, 3u);
  EXPECT_DOUBLE_EQ(world->snapshot().config.meters_per_cell, 20.0);
  EXPECT_EQ(world->snapshot().config.preset, WorldPreset::basin);
  EXPECT_EQ(world->terrain().samples.size(), 15u);
}

TEST(WorldScenarioParityRed, ScenarioRootBoundaryMustContainEveryCellCenter) {
  ScenarioWorldDefinition scenario{};
  scenario.id = "scenario:bad-root";
  scenario.root_boundary = ScenarioPolygon{{
      ScenarioPoint{0.0, 0.0},
      ScenarioPoint{4.0, 0.0},
      ScenarioPoint{0.0, 4.0},
  }};

  auto world = WorldFoundation::generate(
      7,
      WorldConfig{4, 4, 30.0, WorldPreset::plain},
      scenario);
  ASSERT_FALSE(world.has_value());
  EXPECT_EQ(world.error().code, civic::core::ErrorCode::invalid_argument);
}

TEST(WorldScenarioParityRed, MalformedScenarioOverridesAreRejectedBeforeAuthorityEscapes) {
  ScenarioWorldDefinition scenario{};
  scenario.id = "scenario:invalid";
  scenario.elevation_overrides.push_back(ScenarioElevationOverride{8, 1, 100.0});

  auto out_of_bounds = WorldFoundation::generate(
      7,
      WorldConfig{4, 4, 30.0, WorldPreset::plain},
      scenario);
  ASSERT_FALSE(out_of_bounds.has_value());
  EXPECT_EQ(out_of_bounds.error().code, civic::core::ErrorCode::invalid_argument);

  scenario.elevation_overrides.clear();
  scenario.contamination_regions.push_back(
      ScenarioContaminationRegion{1.5, rectangle(0.0, 0.0, 1.0, 1.0)});
  auto invalid_contamination = WorldFoundation::generate(
      7,
      WorldConfig{4, 4, 30.0, WorldPreset::plain},
      scenario);
  ASSERT_FALSE(invalid_contamination.has_value());
  EXPECT_EQ(invalid_contamination.error().code, civic::core::ErrorCode::invalid_argument);
}
}  // namespace
