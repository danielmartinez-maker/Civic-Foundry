#include <gtest/gtest.h>

#include <civic/presentation/NativeHud.hpp>

using namespace civic::presentation;

TEST(NativeHud, MissingAuthorityRemainsUnavailableInsteadOfBecomingZero) {
    CityHudState hud{};
    hud.city_name = "Civic Foundry";
    hud.simulation_tick = 42U;

    EXPECT_FALSE(hud.treasury.has_value());
    EXPECT_FALSE(hud.population.has_value());
    EXPECT_FALSE(hud.unemployment_rate.has_value());
    EXPECT_FALSE(hud.occupied_housing.has_value());
    EXPECT_FALSE(hud.housing_capacity.has_value());
    EXPECT_EQ(formatHudCurrency(hud.treasury), "—");
    EXPECT_EQ(formatHudCount(hud.population), "—");

    hud.treasury = 0;
    hud.population = 0.0;
    EXPECT_EQ(formatHudCurrency(hud.treasury), "$0");
    EXPECT_EQ(formatHudCount(hud.population), "0");
}

TEST(NativeHudNotifications, ReplacementOwnsItsExpiryInsteadOfInheritingOlderTimeout) {
    NotificationCenter notifications{};

    ASSERT_TRUE(notifications.show("first", HudNoticeSeverity::Info, 10.0, 4.0).has_value());
    ASSERT_TRUE(notifications.current(12.0).has_value());
    EXPECT_EQ(notifications.current(12.0)->message, "first");

    ASSERT_TRUE(notifications.show("second", HudNoticeSeverity::Warning, 13.0, 4.0).has_value());
    ASSERT_TRUE(notifications.current(14.1).has_value());
    EXPECT_EQ(notifications.current(14.1)->message, "second");
    EXPECT_EQ(notifications.current(14.1)->severity, HudNoticeSeverity::Warning);

    EXPECT_TRUE(notifications.current(16.9).has_value());
    EXPECT_FALSE(notifications.current(17.01).has_value());
}
