#include <gtest/gtest.h>

#include <cmath>

#include <civic/socioeconomic/SocioeconomicRuntime.hpp>

namespace socio = civic::socioeconomic;

TEST(Stack3HousingEconomics, PortsAcceptedAffordabilityAndQualityWeights) {
    EXPECT_DOUBLE_EQ(socio::housing_burden(525.0, socio::HousingIncomeBand::lower), 0.35);
    EXPECT_DOUBLE_EQ(socio::housing_affordability_score(525.0, socio::HousingIncomeBand::lower), 1.0);
    EXPECT_DOUBLE_EQ(socio::housing_affordability_score(1050.0, socio::HousingIncomeBand::lower), 0.0);

    const socio::HousingQualityInputs quality{
        .person_accessibility = 0.8,
        .service_quality = 0.6,
        .neighborhood_quality = 0.9,
        .utility_ratio = 0.5,
    };
    EXPECT_NEAR(socio::housing_quality_score(quality), 0.72, 1e-12);
    EXPECT_DOUBLE_EQ(
        socio::housing_tenure_preference_score(
            socio::HousingIncomeBand::upper,
            socio::HousingTenure::owner,
            socio::HousingTenure::owner),
        1.0);
    EXPECT_DOUBLE_EQ(
        socio::housing_tenure_preference_score(
            socio::HousingIncomeBand::lower,
            socio::HousingTenure::owner,
            socio::HousingTenure::renter),
        0.8);
}

TEST(Stack3HousingTenure, PortsAcceptedOwnerEconomicsAndIntensityShares) {
    socio::HousingTenureSystem system;
    const socio::HousingTenureBuildingInput input{
        .building = civic::BuildingId{10},
        .intensity = socio::HousingIntensity::low,
        .capacity = 100.0,
        .asking_rent = 1000.0,
        .person_accessibility = 0.8,
        .service_quality = 0.7,
        .neighborhood_quality = 0.6,
        .utility_ratio = 0.9,
    };
    auto snapshot = system.evaluate(0.06, std::span<const socio::HousingTenureBuildingInput>{&input, 1});
    ASSERT_TRUE(snapshot);
    ASSERT_EQ(snapshot->buildings.size(), 1U);
    EXPECT_DOUBLE_EQ(snapshot->buildings[0].ownership_capacity, 60.0);
    EXPECT_DOUBLE_EQ(snapshot->buildings[0].rental_capacity, 40.0);
    EXPECT_NEAR(snapshot->buildings[0].implied_purchase_price, 173913.04347826086, 1e-6);
    EXPECT_NEAR(snapshot->buildings[0].monthly_owner_cost, 1051.5485567342705, 1e-6);
    ASSERT_EQ(snapshot->options.size(), 2U);
    EXPECT_EQ(snapshot->options[0].tenure, socio::HousingTenure::renter);
    EXPECT_EQ(snapshot->options[1].tenure, socio::HousingTenure::owner);
}

TEST(Stack3HousingRelocation, RedevelopmentDisplacementIsExplicitAndConserved) {
    socio::HousingMarket housing;
    ASSERT_TRUE(housing.add_unit({socio::HousingUnitId{1}, civic::BuildingId{10}, 4.0}));
    ASSERT_TRUE(housing.add_unit({socio::HousingUnitId{2}, civic::BuildingId{20}, 4.0}));
    ASSERT_TRUE(housing.relocate(civic::HouseholdId{7}, 2.0, socio::HousingUnitId{1}));
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{1}), 2.0);

    auto displaced = housing.displace(civic::HouseholdId{7});
    ASSERT_TRUE(displaced);
    ASSERT_TRUE(*displaced);
    EXPECT_EQ(**displaced, socio::HousingUnitId{1});
    EXPECT_FALSE(housing.primary_home(civic::HouseholdId{7}));
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{1}), 0.0);

    ASSERT_TRUE(housing.relocate(civic::HouseholdId{7}, 2.0, socio::HousingUnitId{2}));
    EXPECT_EQ(housing.primary_home(civic::HouseholdId{7}), socio::HousingUnitId{2});
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{2}), 2.0);
}

TEST(Stack3HousingRelocation, CapacityFailureDoesNotLoseExistingHome) {
    socio::HousingMarket housing;
    ASSERT_TRUE(housing.add_unit({socio::HousingUnitId{1}, civic::BuildingId{10}, 4.0}));
    ASSERT_TRUE(housing.add_unit({socio::HousingUnitId{2}, civic::BuildingId{20}, 1.0}));
    ASSERT_TRUE(housing.relocate(civic::HouseholdId{7}, 2.0, socio::HousingUnitId{1}));

    auto failed = housing.relocate(civic::HouseholdId{7}, 2.0, socio::HousingUnitId{2});
    ASSERT_FALSE(failed);
    EXPECT_EQ(housing.primary_home(civic::HouseholdId{7}), socio::HousingUnitId{1});
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{1}), 2.0);
    EXPECT_DOUBLE_EQ(housing.occupancy(socio::HousingUnitId{2}), 0.0);
}
