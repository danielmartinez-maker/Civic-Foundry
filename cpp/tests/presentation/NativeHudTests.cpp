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
