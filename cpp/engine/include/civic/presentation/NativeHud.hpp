#pragma once

#include <civic/presentation/Presentation.hpp>

#include <cstdint>
#include <expected>
#include <optional>
#include <string>
#include <string_view>

namespace civic::presentation {

enum class SaveStatus : std::uint8_t {
    Unknown,
    Clean,
    Saving,
    Saved,
    Error,
};

using HudNoticeSeverity = AlertSeverity;

struct HudNotice {
    std::string message;
    HudNoticeSeverity severity{HudNoticeSeverity::Info};
    double expires_at_seconds{};
};

class NotificationCenter {
public:
    [[nodiscard]] std::expected<void, std::string> show(
        std::string message,
        HudNoticeSeverity severity,
        double now_seconds,
        double ttl_seconds);
    [[nodiscard]] std::optional<HudNotice> current(double now_seconds) const noexcept;
    void clear() noexcept { active_.reset(); }
private:
    std::optional<HudNotice> active_;
};

enum class HudShortcutAction : std::uint8_t {
    None,
    InspectTool,
    RoadTool,
    ZoneTool,
    FacilityTool,
    TransitTool,
    CancelTool,
    SpeedPause,
    SpeedNormal,
    SpeedFast,
    SpeedVeryFast,
};

struct ShortcutContext {
    bool ui_keyboard_capture{false};
    bool editable_control_active{false};
};

[[nodiscard]] HudShortcutAction resolveHudShortcut(int virtual_key, ShortcutContext context) noexcept;
[[nodiscard]] HudShortcutAction resolveHudShortcut(
    int virtual_key,
    ShortcutContext context,
    const KeyBindings& bindings) noexcept;
[[nodiscard]] bool hudNoticeMeetsMinimum(
    HudNoticeSeverity severity,
    AlertSeverity minimum) noexcept;

struct CityHudState {
    std::string city_name{"Civic Foundry"};
    std::uint64_t simulation_tick{};
    int simulation_speed{1};
    std::optional<std::int64_t> treasury;
    std::optional<double> population;
    std::optional<double> unemployment_rate;
    std::optional<double> occupied_housing;
    std::optional<double> housing_capacity;
    std::string current_tool{"inspect"};
    std::string current_overlay{"none"};
    SaveStatus save_status{SaveStatus::Unknown};
};

[[nodiscard]] std::string formatHudCurrency(std::optional<std::int64_t> value);
[[nodiscard]] std::string formatHudCount(std::optional<double> value);
[[nodiscard]] std::string_view saveStatusLabel(SaveStatus status) noexcept;
[[nodiscard]] std::string_view hudNoticeSeverityLabel(HudNoticeSeverity severity) noexcept;

} // namespace civic::presentation
