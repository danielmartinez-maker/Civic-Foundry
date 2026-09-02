#pragma once

#include <cstdint>
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

} // namespace civic::presentation
