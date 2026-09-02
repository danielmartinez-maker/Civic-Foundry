#include <gtest/gtest.h>

#include <civic/presentation/NativeHud.hpp>
#include <civic/presentation/NativeTools.hpp>
#include <civic/presentation/NativeUi.hpp>

#include <variant>
#include <vector>

using namespace civic::presentation;

namespace {
struct RecordingCommandSink final : ICommandSink {
    std::vector<AuthoritativeCommand> submitted;
    std::expected<void, std::string> submit(const AuthoritativeCommand& command) override {
        submitted.push_back(command);
        return {};
    }
};
}

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

TEST(NativeHudShortcuts, UiCaptureAndEditableControlsSuppressGameplayActions) {
    EXPECT_EQ(resolveHudShortcut('R', {}), HudShortcutAction::RoadTool);
    EXPECT_EQ(resolveHudShortcut('4', {}), HudShortcutAction::SpeedVeryFast);

    EXPECT_EQ(
        resolveHudShortcut('R', ShortcutContext{.ui_keyboard_capture = true}),
        HudShortcutAction::None);
    EXPECT_EQ(
        resolveHudShortcut('R', ShortcutContext{.editable_control_active = true}),
        HudShortcutAction::None);
    EXPECT_EQ(
        resolveHudShortcut('4', ShortcutContext{.ui_keyboard_capture = true, .editable_control_active = true}),
        HudShortcutAction::None);
}

TEST(NativeToolWorkflow, PreviewIsPresentationOnlyUntilExplicitTypedCommit) {
    RecordingCommandSink sink{};
    NativeUiController controller(sink);
    NativeToolWorkflow tools{};

    tools.activate(NativeTool::Road);
    ASSERT_TRUE(tools.previewRoad({{1.0, 2.0}, {6.0, 2.0}}, RoadClass::Collector).has_value());
    ASSERT_TRUE(tools.preview().valid);
    EXPECT_EQ(tools.preview().tool_id, "road");
    ASSERT_EQ(tools.preview().geometry.size(), 2U);
    EXPECT_TRUE(sink.submitted.empty());

    ASSERT_TRUE(tools.commit(controller).has_value());
    ASSERT_EQ(sink.submitted.size(), 1U);
    ASSERT_TRUE(std::holds_alternative<BuildRoadCommand>(sink.submitted.front()));
    const auto& command = std::get<BuildRoadCommand>(sink.submitted.front());
    EXPECT_EQ(command.road_class, RoadClass::Collector);
    EXPECT_EQ(command.path, (std::vector<Point2>{{1.0, 2.0}, {6.0, 2.0}}));
    EXPECT_FALSE(tools.preview().valid);
}

TEST(NativeToolWorkflow, AlphaPlacementAndBulldozeToolsStayTypedAndPreviewOnlyUntilCommit) {
    RecordingCommandSink sink{};
    NativeUiController controller(sink);
    NativeToolWorkflow tools{};

    ASSERT_TRUE(tools.previewUtility({2.0, 3.0}, "power").has_value());
    EXPECT_TRUE(sink.submitted.empty());
    ASSERT_TRUE(tools.commit(controller).has_value());
    ASSERT_TRUE(std::holds_alternative<PlaceUtilityCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<PlaceUtilityCommand>(sink.submitted.back()).utility_type, "power");

    ASSERT_TRUE(tools.previewService({4.0, 5.0}, "fire_station").has_value());
    EXPECT_EQ(sink.submitted.size(), 1U);
    ASSERT_TRUE(tools.commit(controller).has_value());
    ASSERT_TRUE(std::holds_alternative<PlaceServiceFacilityCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<PlaceServiceFacilityCommand>(sink.submitted.back()).service_type, "fire_station");

    ASSERT_TRUE(tools.previewTransitStop({6.0, 7.0}, TransitStopKind::MetroStation).has_value());
    EXPECT_EQ(sink.submitted.size(), 2U);
    ASSERT_TRUE(tools.commit(controller).has_value());
    ASSERT_TRUE(std::holds_alternative<PlaceTransitStopCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<PlaceTransitStopCommand>(sink.submitted.back()).kind, TransitStopKind::MetroStation);

    ASSERT_TRUE(tools.previewBulldoze({8.0, 9.0}).has_value());
    EXPECT_EQ(sink.submitted.size(), 3U);
    ASSERT_TRUE(tools.commit(controller).has_value());
    ASSERT_TRUE(std::holds_alternative<BulldozeCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<BulldozeCommand>(sink.submitted.back()).position, (Point2{8.0, 9.0}));
}

TEST(NativeUiController, AlphaManagementMutationsRemainTypedCommands) {
    RecordingCommandSink sink{};
    NativeUiController controller(sink);

    ASSERT_TRUE(controller.setTaxRate("residential", 0.125).has_value());
    ASSERT_TRUE(std::holds_alternative<SetTaxRateCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<SetTaxRateCommand>(sink.submitted.back()).tax_category, "residential");
    EXPECT_DOUBLE_EQ(std::get<SetTaxRateCommand>(sink.submitted.back()).rate, 0.125);

    ASSERT_TRUE(controller.setServiceFunding("fire", 110.0).has_value());
    ASSERT_TRUE(std::holds_alternative<SetServiceFundingCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<SetServiceFundingCommand>(sink.submitted.back()).department, "fire");
    EXPECT_DOUBLE_EQ(std::get<SetServiceFundingCommand>(sink.submitted.back()).percent, 110.0);

    ASSERT_TRUE(controller.createTransitService(VehicleKind::Tram, "Crosstown").has_value());
    ASSERT_TRUE(std::holds_alternative<CreateTransitServiceCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<CreateTransitServiceCommand>(sink.submitted.back()).name, "Crosstown");

    ASSERT_TRUE(controller.setTransitLineStops("line:1", {"stop:a", "stop:b"}).has_value());
    ASSERT_TRUE(std::holds_alternative<SetTransitLineStopsCommand>(sink.submitted.back()));
    EXPECT_EQ(std::get<SetTransitLineStopsCommand>(sink.submitted.back()).stop_ids.size(), 2U);

    ASSERT_TRUE(controller.appendTransitLineStop("line:1", "stop:c").has_value());
    ASSERT_TRUE(std::holds_alternative<AppendTransitLineStopCommand>(sink.submitted.back()));

    ASSERT_TRUE(controller.removeTransitLineStop("line:1", "stop:b").has_value());
    ASSERT_TRUE(std::holds_alternative<RemoveTransitLineStopCommand>(sink.submitted.back()));

    ASSERT_TRUE(controller.configureTransitLine("line:1", 80U, 2.25, 4U, true).has_value());
    ASSERT_TRUE(std::holds_alternative<ConfigureTransitLineCommand>(sink.submitted.back()));
    const auto& config = std::get<ConfigureTransitLineCommand>(sink.submitted.back());
    EXPECT_EQ(config.headway_ticks, 80U);
    EXPECT_DOUBLE_EQ(config.fare, 2.25);
    EXPECT_EQ(config.fleet_limit, 4U);
    EXPECT_TRUE(config.enabled);
}

TEST(NativeUiController, RejectsOutOfRangeAlphaManagementValuesBeforeCommandSubmission) {
    RecordingCommandSink sink{};
    NativeUiController controller(sink);

    EXPECT_FALSE(controller.setTaxRate("residential", -0.01).has_value());
    EXPECT_FALSE(controller.setTaxRate("residential", 0.26).has_value());
    EXPECT_FALSE(controller.setServiceFunding("fire", 49.0).has_value());
    EXPECT_FALSE(controller.setServiceFunding("fire", 151.0).has_value());
    EXPECT_FALSE(controller.createTransitService(VehicleKind::Tram, "").has_value());
    EXPECT_FALSE(controller.setTransitLineStops("line:1", {"stop:a"}).has_value());
    EXPECT_FALSE(controller.appendTransitLineStop("", "stop:a").has_value());
    EXPECT_FALSE(controller.removeTransitLineStop("line:1", "").has_value());
    EXPECT_FALSE(controller.configureTransitLine("line:1", 19U, 2.0, 2U, true).has_value());
    EXPECT_FALSE(controller.configureTransitLine("line:1", 80U, 21.0, 2U, true).has_value());
    EXPECT_FALSE(controller.configureTransitLine("line:1", 80U, 2.0, 51U, true).has_value());
    EXPECT_TRUE(sink.submitted.empty());
}
