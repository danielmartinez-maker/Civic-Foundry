#pragma once

#include <civic/presentation/Presentation.hpp>
#include <civic/presentation/SceneGeometry.hpp>

#include <optional>

namespace civic::presentation {

struct MiniatureTreatment final {
    bool enabled{false};
    float focus_center{0.5F};
    float focus_width{1.0F};
    float blur_radius_px{};
    float scale_cue_strength{};
    float material_softness{};
    float saturation{1.0F};
    float contrast{1.0F};
    bool overlay_after_postprocess{true};
    bool selection_after_postprocess{true};

    [[nodiscard]] float blurWeight(float normalized_screen_y) const noexcept;
};

[[nodiscard]] MiniatureTreatment deriveMiniatureTreatment(PresentationSettings settings, PixelViewport viewport) noexcept;

class CameraSmoother final {
public:
    void reset(CameraState state) noexcept;
    [[nodiscard]] CameraState update(CameraState target, double delta_seconds, PresentationSettings settings) noexcept;
    [[nodiscard]] bool initialized() const noexcept { return current_.has_value(); }
    [[nodiscard]] CameraState current() const noexcept { return current_.value_or(CameraState{}); }
private:
    std::optional<CameraState> current_;
};

} // namespace civic::presentation
