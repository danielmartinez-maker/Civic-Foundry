#include <civic/presentation/MiniaturePresentation.hpp>

#include <algorithm>
#include <cmath>

namespace civic::presentation {

float MiniatureTreatment::blurWeight(float normalized_screen_y) const noexcept {
    if (!enabled || !std::isfinite(normalized_screen_y)) return 0.0F;
    const float y = std::clamp(normalized_screen_y, 0.0F, 1.0F);
    const float half_width = std::clamp(focus_width * 0.5F, 0.0F, 0.5F);
    const float distance = std::abs(y - focus_center);
    if (distance <= half_width) return 0.0F;
    const float available = std::max(0.0001F, std::max(focus_center, 1.0F - focus_center) - half_width);
    const float t = std::clamp((distance - half_width) / available, 0.0F, 1.0F);
    return t * t * (3.0F - 2.0F * t);
}

MiniatureTreatment deriveMiniatureTreatment(PresentationSettings settings, PixelViewport viewport) noexcept {
    settings = normalizeSettings(settings);
    MiniatureTreatment treatment{};
    treatment.overlay_after_postprocess = true;
    treatment.selection_after_postprocess = true;
    if (viewport.width == 0U || viewport.height == 0U || !settings.visual_effects || settings.tilt_shift_strength <= 0.0F) {
        return treatment;
    }

    const float strength = settings.tilt_shift_strength;
    treatment.enabled = true;
    treatment.focus_center = 0.52F;
    treatment.focus_width = std::lerp(0.48F, 0.18F, strength);
    const float short_side = static_cast<float>(std::min(viewport.width, viewport.height));
    treatment.blur_radius_px = std::clamp(short_side * 0.012F * strength, 0.0F, 18.0F);
    treatment.scale_cue_strength = 0.22F * strength;
    treatment.material_softness = 0.28F + 0.42F * strength;
    treatment.saturation = 1.0F + 0.08F * strength;
    treatment.contrast = 1.0F + 0.05F * strength;
    return treatment;
}

void CameraSmoother::reset(CameraState state) noexcept {
    current_ = state;
}

CameraState CameraSmoother::update(CameraState target, double delta_seconds, PresentationSettings settings) noexcept {
    settings = normalizeSettings(settings);
    if (!current_) {
        current_ = target;
        return target;
    }
    if (settings.camera_smoothing <= 0.0F || !(delta_seconds > 0.0) || !std::isfinite(delta_seconds)) {
        current_ = target;
        return target;
    }

    const double smoothing = static_cast<double>(settings.camera_smoothing);
    const double response_hz = std::lerp(40.0, 6.0, smoothing);
    const double alpha = std::clamp(1.0 - std::exp(-response_hz * delta_seconds), 0.0, 1.0);
    CameraState next = *current_;
    next.zoom += (target.zoom - next.zoom) * alpha;
    next.pan_x += (target.pan_x - next.pan_x) * alpha;
    next.pan_y += (target.pan_y - next.pan_y) * alpha;
    next.quarter_turns = target.quarter_turns;
    current_ = next;
    return next;
}

} // namespace civic::presentation
