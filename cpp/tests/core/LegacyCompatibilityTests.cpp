#include <gtest/gtest.h>

#include <civic/core/NativeEngine.hpp>

TEST(LegacyCompatibility, LegacyCoreConfigSelectsLegacyRoundedDemandMode) {
    const auto config = civic::EngineConfig::legacyCompatibilityConfig(123U, 17U);

    EXPECT_EQ(config.seed, 123U);
    EXPECT_EQ(config.startTick, 17U);
    EXPECT_EQ(config.speed, civic::SpeedMode::normal);
    EXPECT_EQ(config.demand_weight_mode, civic::DemandWeightMode::legacy_rounded);
}

TEST(LegacyCompatibility, DefaultNativeConfigDoesNotSilentlySelectLegacyMode) {
    const civic::EngineConfig config{};

    EXPECT_EQ(config.demand_weight_mode, civic::DemandWeightMode::conservation);
}

TEST(LegacyCompatibility, CompatibilityModeIsStableAcrossKernelStep) {
    auto created = civic::NativeEngine::create(civic::EngineConfig::legacyCompatibilityConfig(77U, 5U));
    ASSERT_TRUE(created);

    EXPECT_EQ((*created)->demandWeightMode(), civic::DemandWeightMode::legacy_rounded);
    ASSERT_TRUE((*created)->step(3U));
    EXPECT_EQ((*created)->tick(), 8U);
    EXPECT_EQ((*created)->demandWeightMode(), civic::DemandWeightMode::legacy_rounded);
}
