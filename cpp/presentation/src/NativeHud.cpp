#include <civic/presentation/NativeHud.hpp>

#include <cmath>
#include <string>
#include <utility>

namespace civic::presentation {

std::expected<void, std::string> NotificationCenter::show(
    std::string message,
    HudNoticeSeverity severity,
    double now_seconds,
    double ttl_seconds) {
    if (message.empty()) return std::unexpected("notification message is required");
    if (!std::isfinite(now_seconds)) return std::unexpected("notification timestamp must be finite");
    if (!std::isfinite(ttl_seconds) || ttl_seconds <= 0.0) return std::unexpected("notification ttl must be positive and finite");
    active_ = HudNotice{
        .message = std::move(message),
        .severity = severity,
        .expires_at_seconds = now_seconds + ttl_seconds,
    };
    return {};
}

std::optional<HudNotice> NotificationCenter::current(double now_seconds) const noexcept {
    if (!active_ || !std::isfinite(now_seconds) || now_seconds >= active_->expires_at_seconds) return std::nullopt;
    return active_;
}

HudShortcutAction resolveHudShortcut(int virtual_key, ShortcutContext context) noexcept {
    if (context.ui_keyboard_capture || context.editable_control_active) return HudShortcutAction::None;

    int key = virtual_key;
    if (key >= 'a' && key <= 'z') key -= ('a' - 'A');
    switch (key) {
        case 'I': return HudShortcutAction::InspectTool;
        case 'R': return HudShortcutAction::RoadTool;
        case 'Z': return HudShortcutAction::ZoneTool;
        case 'F': return HudShortcutAction::FacilityTool;
        case 'T': return HudShortcutAction::TransitTool;
        case 27: return HudShortcutAction::CancelTool;
        case '0': return HudShortcutAction::SpeedPause;
        case '1': return HudShortcutAction::SpeedNormal;
        case '2': return HudShortcutAction::SpeedFast;
        case '4': return HudShortcutAction::SpeedVeryFast;
        default: return HudShortcutAction::None;
    }
}

std::string formatHudCurrency(std::optional<std::int64_t> value) {
    if (!value) return "—";
    return "$" + std::to_string(*value);
}

std::string formatHudCount(std::optional<double> value) {
    if (!value || !std::isfinite(*value)) return "—";
    return std::to_string(static_cast<long long>(std::llround(*value)));
}

std::string_view saveStatusLabel(SaveStatus status) noexcept {
    switch (status) {
        case SaveStatus::Clean: return "Clean";
        case SaveStatus::Saving: return "Saving";
        case SaveStatus::Saved: return "Saved";
        case SaveStatus::Error: return "Error";
        case SaveStatus::Unknown:
        default: return "Unknown";
    }
}

std::string_view hudNoticeSeverityLabel(HudNoticeSeverity severity) noexcept {
    switch (severity) {
        case HudNoticeSeverity::Success: return "Success";
        case HudNoticeSeverity::Warning: return "Warning";
        case HudNoticeSeverity::Error: return "Error";
        case HudNoticeSeverity::Info:
        default: return "Info";
    }
}

} // namespace civic::presentation
