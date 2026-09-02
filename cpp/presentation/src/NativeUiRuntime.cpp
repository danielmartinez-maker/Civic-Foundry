#include <civic/presentation/NativeUiRuntime.hpp>

#include <cctype>
#include <cmath>
#include <utility>

namespace civic::presentation {
namespace {

bool validPanelId(std::string_view id) noexcept {
    if (id.empty()) return false;
    for (const char raw : id) {
        const auto ch = static_cast<unsigned char>(raw);
        if (!(std::isalnum(ch) || ch == '.' || ch == '_' || ch == '-')) return false;
    }
    return true;
}

bool validDpiScale(float dpi_scale) noexcept {
    return std::isfinite(dpi_scale) && dpi_scale > 0.0F;
}

} // namespace

std::expected<void, std::string> NativeUiRuntimeModel::initialize(float dpi_scale) {
    if (initialized_) return std::unexpected("native UI runtime is already initialized");
    if (!validDpiScale(dpi_scale)) return std::unexpected("native UI DPI scale must be finite and positive");
    dpi_scale_ = dpi_scale;
    initialized_ = true;
    frame_active_ = false;
    return {};
}

std::expected<void, std::string> NativeUiRuntimeModel::updateDpiScale(float dpi_scale) {
    if (!initialized_) return std::unexpected("native UI runtime is not initialized");
    if (frame_active_) return std::unexpected("native UI DPI scale cannot change during an active frame");
    if (!validDpiScale(dpi_scale)) return std::unexpected("native UI DPI scale must be finite and positive");
    dpi_scale_ = dpi_scale;
    return {};
}

void NativeUiRuntimeModel::shutdown() noexcept {
    frame_active_ = false;
    initialized_ = false;
    dpi_scale_ = 1.0F;
    panels_.clear();
}

std::expected<UiFrameState, std::string> NativeUiRuntimeModel::beginFrame(
    const FrameSnapshot& snapshot,
    PresentationSettings settings) {
    if (!initialized_) return std::unexpected("native UI runtime is not initialized");
    if (frame_active_) return std::unexpected("native UI frame is already active");
    settings = normalizeSettings(settings);
    frame_active_ = true;
    return UiFrameState{
        snapshot.revision,
        dpi_scale_,
        settings.ui_scale,
        dpi_scale_ * settings.ui_scale,
    };
}

std::expected<void, std::string> NativeUiRuntimeModel::endFrame() {
    if (!initialized_) return std::unexpected("native UI runtime is not initialized");
    if (!frame_active_) return std::unexpected("native UI frame is not active");
    frame_active_ = false;
    return {};
}

std::expected<void, std::string> NativeUiRuntimeModel::registerPanel(UiPanelState panel) {
    if (!initialized_) return std::unexpected("native UI runtime is not initialized");
    if (!validPanelId(panel.id)) return std::unexpected("native UI panel id is invalid");
    if (panel.title.empty()) return std::unexpected("native UI panel title is empty");
    if (panels_.contains(panel.id)) return std::unexpected("duplicate native UI panel id: " + panel.id);
    panels_.emplace(panel.id, std::move(panel));
    return {};
}

std::expected<void, std::string> NativeUiRuntimeModel::setPanelOpen(std::string_view id, bool open) {
    if (!initialized_) return std::unexpected("native UI runtime is not initialized");
    const auto it = panels_.find(id);
    if (it == panels_.end()) return std::unexpected("unknown native UI panel id: " + std::string(id));
    it->second.open = open;
    return {};
}

std::optional<UiPanelState> NativeUiRuntimeModel::panel(std::string_view id) const {
    const auto it = panels_.find(id);
    if (it == panels_.end()) return std::nullopt;
    return it->second;
}

} // namespace civic::presentation
