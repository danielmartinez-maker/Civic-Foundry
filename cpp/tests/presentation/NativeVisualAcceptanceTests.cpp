#include <gtest/gtest.h>

#include <civic/presentation/MiniaturePresentation.hpp>
#include <civic/presentation/RenderPipeline.hpp>
#include <civic/presentation/SceneGeometry.hpp>
#include <civic/presentation/VisualAcceptance.hpp>

#include <set>
#include <string>

using namespace civic::presentation;

TEST(NativeVisualAcceptance, DefinesEveryStack4ReferenceScenarioExactlyOnce) {
    const auto scenarios = nativeVisualAcceptanceScenarios();
    ASSERT_EQ(scenarios.size(), 10U);
    const std::set<std::string> expected{
        "empty-terrain",
        "developed-neighborhood",
        "dense-mixed-use-core",
        "industrial-freight",
        "congestion",
        "transit",
        "flood",
        "cadastre-zoning",
        "selection",
        "miniature-camera",
    };
    std::set<std::string> actual;
    for (const auto& scenario : scenarios) actual.insert(scenario.id);
    EXPECT_EQ(actual, expected);
}

TEST(NativeVisualAcceptance, EveryReferenceScenarioProducesLegibleNativeGeometry) {
    RenderPacketBuilder packet_builder{};
    SceneGeometryBuilder geometry_builder{};
    IsometricCamera camera{};

    for (const auto& scenario : nativeVisualAcceptanceScenarios()) {
        SCOPED_TRACE(scenario.id);
        const auto packet = packet_builder.build(
            scenario.snapshot,
            {0.0, 0.0, static_cast<double>(scenario.snapshot.world.width), static_cast<double>(scenario.snapshot.world.height)});
        const auto geometry = geometry_builder.build(packet, camera, scenario.snapshot.world, {1280U, 720U});
        EXPECT_FALSE(geometry.opaque.empty() && geometry.overlay.empty());
        EXPECT_GT(geometry.stats.terrain_triangles, 0U);
    }
}

TEST(NativeVisualAcceptance, ScenarioSpecificSignalsArePresent) {
    for (const auto& scenario : nativeVisualAcceptanceScenarios()) {
        if (scenario.id == "dense-mixed-use-core") EXPECT_GE(scenario.snapshot.buildings.size(), 3U);
        if (scenario.id == "industrial-freight") EXPECT_GT(scenario.snapshot.vehicles.size(), 0U);
        if (scenario.id == "congestion") EXPECT_GT(scenario.snapshot.overlays.size(), 0U);
        if (scenario.id == "transit") EXPECT_GT(scenario.snapshot.transit_stops.size(), 0U);
        if (scenario.id == "flood") {
            bool has_flood = false;
            for (const auto& cell : scenario.snapshot.terrain) has_flood = has_flood || cell.flood_depth_m > 0.0F;
            EXPECT_TRUE(has_flood);
        }
        if (scenario.id == "cadastre-zoning") EXPECT_GT(scenario.snapshot.overlays.size(), 0U);
        if (scenario.id == "selection") EXPECT_TRUE(scenario.snapshot.selection.active);
        if (scenario.id == "miniature-camera") {
            const auto treatment = deriveMiniatureTreatment(scenario.settings, {1280U, 720U});
            EXPECT_TRUE(treatment.enabled);
            EXPECT_GT(treatment.blur_radius_px, 0.0F);
        }
    }
}
