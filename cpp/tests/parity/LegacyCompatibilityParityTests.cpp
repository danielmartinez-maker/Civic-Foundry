#include <gtest/gtest.h>

#include <cstddef>

#include <civic/bridge/civic_engine.h>
#include <civic/core/NativeEngine.hpp>

TEST(LegacyCompatibilityParity, ConfigurationIntentMatchesLegacyRoundedContract) {
    const auto config = civic::EngineConfig::legacyCompatibilityConfig(41U);
    EXPECT_EQ(config.demand_weight_mode, civic::DemandWeightMode::legacy_rounded);
}

TEST(LegacyCompatibilityParity, TransportationAuthorityRemainsDeferred) {
    auto created = civic::NativeEngine::create(civic::EngineConfig::legacyCompatibilityConfig(41U));
    ASSERT_TRUE(created);

    const auto transportation = (*created)->domainHash("transportation");
    ASSERT_TRUE(transportation);
    EXPECT_EQ(transportation->ownership, civic::DomainOwnership::unowned);
    EXPECT_EQ(transportation->value, 0U);
}

TEST(LegacyCompatibilityParity, CAbiEngineConfigLayoutRemainsStable) {
    EXPECT_EQ(offsetof(cf_engine_config, seed), 0U);
    EXPECT_EQ(offsetof(cf_engine_config, start_tick), 8U);
    EXPECT_EQ(offsetof(cf_engine_config, speed), 16U);
    EXPECT_EQ(sizeof(cf_engine_config), 24U);
}
