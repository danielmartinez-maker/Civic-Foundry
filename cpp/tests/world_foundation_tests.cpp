#include <gtest/gtest.h>
#include "civic/world/WorldFoundation.hpp"
#include <array>
#include <cmath>

namespace {
using civic::world::WorldConfig;
using civic::world::WorldFoundation;
using civic::world::WorldPreset;

TEST(WorldFoundationRed, SameSeedProducesIdenticalNativeDomainHash) {
  WorldConfig config{12, 8, 30.0, WorldPreset::rolling_uplands};
  auto first = WorldFoundation::generate(42, config);
  auto second = WorldFoundation::generate(42, config);
  ASSERT_TRUE(first.has_value());
  ASSERT_TRUE(second.has_value());
  EXPECT_EQ(first->deterministic_hash(), second->deterministic_hash());
  EXPECT_EQ(first->snapshot().terrain.samples, second->snapshot().terrain.samples);
}

TEST(WorldFoundationRed, EveryAcceptedPresetGeneratesDeterministically) {
  constexpr std::array presets{
    WorldPreset::plain, WorldPreset::river_valley, WorldPreset::basin,
    WorldPreset::rolling_uplands, WorldPreset::ridge_edge, WorldPreset::coastal_lowland,
  };
  for (const auto preset : presets) {
    WorldConfig config{10, 6, 30.0, preset};
    auto world = WorldFoundation::generate(1234, config);
    ASSERT_TRUE(world.has_value());
    EXPECT_EQ(world->terrain().samples.size(), 60u);
    EXPECT_FALSE(world->geography().entities.empty());
    EXPECT_EQ(world->hydrology().receiver.size(), 60u);
  }
}

TEST(WorldFoundationRed, SnapshotRestorePreservesFutureAuthorityState) {
  auto generated = WorldFoundation::generate(9876, WorldConfig{9, 7, 20.0, WorldPreset::river_valley});
  ASSERT_TRUE(generated.has_value());
  const auto expected_hash = generated->deterministic_hash();
  auto restored = WorldFoundation::restore(generated->snapshot());
  ASSERT_TRUE(restored.has_value());
  EXPECT_EQ(restored->deterministic_hash(), expected_hash);
}

TEST(WorldFoundationRed, DesignStormConservesWater) {
  auto generated = WorldFoundation::generate(77, WorldConfig{8, 8, 30.0, WorldPreset::basin});
  ASSERT_TRUE(generated.has_value());
  auto result = civic::world::run_design_storm({"design:100y", 110.0, 6.0, 0.85}, generated->terrain(), generated->hydrology());
  ASSERT_TRUE(result.has_value());
  EXPECT_LT(std::abs(result->balance_error), 1e-6);
}
}
