#include <gtest/gtest.h>

#include <civic/presentation/NativeUiRuntime.hpp>

using namespace civic::presentation;

TEST(NativeUiRuntimeModel, RequiresExplicitLifecycleAndRejectsNestedFrames) {
    NativeUiRuntimeModel runtime{};
    FrameSnapshot snapshot{};
    snapshot.revision = 41;

    EXPECT_FALSE(runtime.beginFrame(snapshot, PresentationSettings{}).has_value());
    ASSERT_TRUE(runtime.initialize(1.5F).has_value());
    EXPECT_TRUE(runtime.initialized());

    const auto frame = runtime.beginFrame(snapshot, PresentationSettings{});
    ASSERT_TRUE(frame.has_value());
    EXPECT_EQ(frame->snapshot_revision, 41U);
    EXPECT_TRUE(runtime.frameActive());
    EXPECT_FALSE(runtime.beginFrame(snapshot, PresentationSettings{}).has_value());
    ASSERT_TRUE(runtime.endFrame().has_value());
    EXPECT_FALSE(runtime.frameActive());

    runtime.shutdown();
    EXPECT_FALSE(runtime.initialized());
    EXPECT_FALSE(runtime.endFrame().has_value());
}

TEST(NativeUiRuntimeModel, CombinesDpiAndUserScaleWithoutChangingSnapshot) {
    NativeUiRuntimeModel runtime{};
    ASSERT_TRUE(runtime.initialize(1.5F).has_value());
    FrameSnapshot snapshot{};
    snapshot.revision = 9;
    PresentationSettings settings{};
    settings.ui_scale = 1.25F;

    const auto frame = runtime.beginFrame(snapshot, settings);
    ASSERT_TRUE(frame.has_value());
    EXPECT_FLOAT_EQ(frame->dpi_scale, 1.5F);
    EXPECT_FLOAT_EQ(frame->ui_scale, 1.25F);
    EXPECT_FLOAT_EQ(frame->effective_scale, 1.875F);
    EXPECT_EQ(snapshot.revision, 9U);
}

TEST(NativeUiRuntimeModel, AppliesPerMonitorDpiChangesBetweenFrames) {
    NativeUiRuntimeModel runtime{};
    ASSERT_TRUE(runtime.initialize(1.0F).has_value());
    FrameSnapshot snapshot{};
    PresentationSettings settings{};
    settings.ui_scale = 1.2F;

    auto first = runtime.beginFrame(snapshot, settings);
    ASSERT_TRUE(first.has_value());
    EXPECT_FLOAT_EQ(first->effective_scale, 1.2F);
    ASSERT_TRUE(runtime.endFrame().has_value());

    ASSERT_TRUE(runtime.updateDpiScale(1.5F).has_value());
    auto second = runtime.beginFrame(snapshot, settings);
    ASSERT_TRUE(second.has_value());
    EXPECT_FLOAT_EQ(second->dpi_scale, 1.5F);
    EXPECT_FLOAT_EQ(second->effective_scale, 1.8F);
    ASSERT_TRUE(runtime.endFrame().has_value());

    EXPECT_FALSE(runtime.updateDpiScale(0.0F).has_value());
    EXPECT_FLOAT_EQ(runtime.dpiScale(), 1.5F);
}

TEST(NativeUiRuntimeModel, OwnsPanelLifecycleByStablePresentationId) {
    NativeUiRuntimeModel runtime{};
    ASSERT_TRUE(runtime.initialize(1.0F).has_value());
    ASSERT_TRUE(runtime.registerPanel({"hud", "City HUD", true, false}).has_value());
    ASSERT_TRUE(runtime.registerPanel({"inspector", "Inspector", true, true}).has_value());
    EXPECT_FALSE(runtime.registerPanel({"hud", "Duplicate", true, false}).has_value());
    EXPECT_EQ(runtime.panelCount(), 2U);

    ASSERT_TRUE(runtime.setPanelOpen("inspector", false).has_value());
    const auto inspector = runtime.panel("inspector");
    ASSERT_TRUE(inspector.has_value());
    EXPECT_FALSE(inspector->open);
    EXPECT_TRUE(inspector->dockable);
    EXPECT_FALSE(runtime.panel("missing").has_value());
}

TEST(NativeUiRuntimeModel, RejectsInvalidDpiAndPanelIdentifiers) {
    NativeUiRuntimeModel runtime{};
    EXPECT_FALSE(runtime.initialize(0.0F).has_value());
    ASSERT_TRUE(runtime.initialize(1.0F).has_value());
    EXPECT_FALSE(runtime.registerPanel({"", "No Id", true, true}).has_value());
    EXPECT_FALSE(runtime.registerPanel({"bad id", "Whitespace Id", true, true}).has_value());
}
