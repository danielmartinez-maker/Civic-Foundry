#include <civic/presentation/NativeHud.hpp>

#include <cmath>
#include <string>

namespace civic::presentation {

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

} // namespace civic::presentation
