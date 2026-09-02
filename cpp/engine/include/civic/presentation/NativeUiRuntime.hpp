#pragma once

#include <civic/presentation/Presentation.hpp>

#include <cstddef>
#include <expected>
#include <map>
#include <optional>
#include <string>
#include <string_view>

namespace civic::presentation {

struct UiPanelState {
    std::string id;
    std::string title;
    bool open{true};
    bool dockable{true};
};

struct UiFrameState {
    RenderRevision snapshot_revision{};
    float dpi_scale{1.0F};
    float ui_scale{1.0F};
    float effective_scale{1.0F};
};

class NativeUiRuntimeModel final {
public:
    [[nodiscard]] std::expected<void, std::string> initialize(float dpi_scale);
    [[nodiscard]] std::expected<void, std::string> updateDpiScale(float dpi_scale);
    void shutdown() noexcept;

    [[nodiscard]] std::expected<UiFrameState, std::string> beginFrame(
        const FrameSnapshot& snapshot,
        PresentationSettings settings);
    [[nodiscard]] std::expected<void, std::string> endFrame();

    [[nodiscard]] std::expected<void, std::string> registerPanel(UiPanelState panel);
    [[nodiscard]] std::expected<void, std::string> setPanelOpen(std::string_view id, bool open);
    [[nodiscard]] std::optional<UiPanelState> panel(std::string_view id) const;

    [[nodiscard]] bool initialized() const noexcept { return initialized_; }
    [[nodiscard]] bool frameActive() const noexcept { return frame_active_; }
    [[nodiscard]] float dpiScale() const noexcept { return dpi_scale_; }
    [[nodiscard]] std::size_t panelCount() const noexcept { return panels_.size(); }

private:
    bool initialized_{};
    bool frame_active_{};
    float dpi_scale_{1.0F};
    std::map<std::string, UiPanelState, std::less<>> panels_;
};

} // namespace civic::presentation
