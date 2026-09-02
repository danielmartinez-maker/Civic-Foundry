#include <civic/presentation/NativeHud.hpp>

#include <cmath>
#include <string>
#include <utility>

namespace civic::presentation {
namespace {

int normalizedShortcutKey(int key) noexcept {
    if (key >= 'a' && key <= 'z') return key - ('a' - 'A');
    return key;
}

bool shortcutMatches(int key, int configured) noexcept {
    return normalizedShortcutKey(key) == normalizedShortcutKey(configured);
}

int severityRank(AlertSeverity severity) noexcept {
    switch (severity) {
        case AlertSeverity::Info: return 0;
        case AlertSeverity::Success: return 1;
        case AlertSeverity::Warning: return 2;
        case AlertSeverity::Error: return 3;
    }
    return 0;
}

} // namespace

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
    return resolveHudShortcut(virtual_key, context, KeyBindings{});
}

HudShortcutAction resolveHudShortcut(
    int virtual_key,
    ShortcutContext context,
    const KeyBindings& bindings) noexcept {
    if (context.ui_keyboard_capture || context.editable_control_active) return HudShortcutAction::None;

    if (shortcutMatches(virtual_key, bindings.inspect)) return HudShortcutAction::InspectTool;
    if (shortcutMatches(virtual_key, bindings.road)) return HudShortcutAction::RoadTool;
    if (shortcutMatches(virtual_key, bindings.zone)) return HudShortcutAction::ZoneTool;
    if (shortcutMatches(virtual_key, bindings.facility)) return HudShortcutAction::FacilityTool;
    if (shortcutMatches(virtual_key, bindings.transit)) return HudShortcutAction::TransitTool;
    if (shortcutMatches(virtual_key, bindings.cancel)) return HudShortcutAction::CancelTool;
    if (shortcutMatches(virtual_key, bindings.speed_pause)) return HudShortcutAction::SpeedPause;
    if (shortcutMatches(virtual_key, bindings.speed_normal)) return HudShortcutAction::SpeedNormal;
    if (shortcutMatches(virtual_key, bindings.speed_fast)) return HudShortcutAction::SpeedFast;
    if (shortcutMatches(virtual_key, bindings.speed_very_fast)) return HudShortcutAction::SpeedVeryFast;
    return HudShortcutAction::None;
}

bool hudNoticeMeetsMinimum(HudNoticeSeverity severity, AlertSeverity minimum) noexcept {
    return severityRank(severity) >= severityRank(minimum);
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
