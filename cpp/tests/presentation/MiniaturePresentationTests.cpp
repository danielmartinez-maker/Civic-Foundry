#include <gtest/gtest.h>

#include <civic/presentation/MiniaturePresentation.hpp>

using namespace civic::presentation;

TEST(MiniaturePresentation, BuildsNarrowFocalBandAndPhysicalScaleCuesFromSettings) {
    PresentationSettings settings{};
    settings.tilt_shift_strength = 0.8F;
    settings.camera_smoothing = 0.5F;
    settings.visual_effects = true;

    const auto treatment = deriveMiniatureTreatment(settings, PixelViewport{1920, 1080});
    EXPECT_TRUE(treatment.enabled);
    EXPECT_GT(treatment.blur_radius_px, 0.0F);
    EXPECT_GT(treatment.focus_width, 0.0F);
    EXPECT_LT(treatment.focus_width, 0.6F);
    EXPECT_GT(treatment.scale_cue_strength, 0.0F);
    EXPECT_GT(treatment.material_softness, 0.0F);
    EXPECT_TRUE(treatment.overlay_after_postprocess);
    EXPECT_TRUE(treatment.selection_after_postprocess);

    EXPECT_FLOAT_EQ(treatment.blurWeight(treatment.focus_center), 0.0F);
    EXPECT_GT(treatment.blurWeight(0.0F), 0.0F);
    EXPECT_GT(treatment.blurWeight(1.0F), 0.0F);
}

TEST(MiniaturePresentation, VisualEffectsToggleDisablesBlurWithoutChangingSimulationState) {
    PresentationSettings settings{};
    settings.tilt_shift_strength = 1.0F;
    settings.visual_effects = false;
    const auto treatment = deriveMiniatureTreatment(settings, PixelViewport{1600, 900});
    EXPECT_FALSE(treatment.enabled);
    EXPECT_FLOAT_EQ(treatment.blur_radius_px, 0.0F);
    EXPECT_FLOAT_EQ(treatment.scale_cue_strength, 0.0F);
    EXPECT_TRUE(treatment.overlay_after_postprocess);
    EXPECT_TRUE(treatment.selection_after_postprocess);
}

TEST(MiniaturePresentation, ReducedMotionSuppressesCameraSmoothingAndMiniatureBlur) {
    PresentationSettings settings{};
    settings.camera_smoothing = 0.9F;
    settings.tilt_shift_strength = 0.9F;
    settings.visual_effects = true;
    settings.reduced_motion = true;

    const auto normalized = normalizeSettings(settings);
    EXPECT_FLOAT_EQ(normalized.camera_smoothing, 0.0F);
    EXPECT_FLOAT_EQ(normalized.tilt_shift_strength, 0.0F);
    EXPECT_TRUE(normalized.visual_effects);

    CameraSmoother smoother{};
    const CameraState initial{1.0, 0, 36.0, 36.0};
    smoother.reset(initial);
    const CameraState target{2.0, 1, 300.0, 200.0};
    const auto rendered = smoother.update(target, 1.0 / 60.0, normalized);
    EXPECT_DOUBLE_EQ(rendered.zoom, target.zoom);
    EXPECT_EQ(rendered.quarter_turns, target.quarter_turns);
    EXPECT_DOUBLE_EQ(rendered.pan_x, target.pan_x);
    EXPECT_DOUBLE_EQ(rendered.pan_y, target.pan_y);
}

TEST(MiniaturePresentation, CameraSmoothingInterpolatesPresentationOnlyTowardAuthoritativeTarget) {
    PresentationSettings settings{};
    settings.camera_smoothing = 0.65F;
    settings.reduced_motion = false;

    CameraSmoother smoother{};
    const CameraState initial{1.0, 0, 0.0, 0.0};
    smoother.reset(initial);
    const CameraState target{2.0, 1, 200.0, 100.0};
    const auto rendered = smoother.update(target, 1.0 / 60.0, settings);

    EXPECT_GT(rendered.zoom, initial.zoom);
    EXPECT_LT(rendered.zoom, target.zoom);
    EXPECT_GT(rendered.pan_x, initial.pan_x);
    EXPECT_LT(rendered.pan_x, target.pan_x);
    EXPECT_GT(rendered.pan_y, initial.pan_y);
    EXPECT_LT(rendered.pan_y, target.pan_y);
    EXPECT_EQ(rendered.quarter_turns, target.quarter_turns);

    EXPECT_DOUBLE_EQ(target.zoom, 2.0);
    EXPECT_DOUBLE_EQ(target.pan_x, 200.0);
    EXPECT_DOUBLE_EQ(target.pan_y, 100.0);
}

TEST(MiniaturePresentation, ZeroSizedViewportSafelyDisablesPostProcess) {
    PresentationSettings settings{};
    settings.tilt_shift_strength = 1.0F;
    const auto treatment = deriveMiniatureTreatment(settings, PixelViewport{});
    EXPECT_FALSE(treatment.enabled);
    EXPECT_FLOAT_EQ(treatment.blur_radius_px, 0.0F);
}
