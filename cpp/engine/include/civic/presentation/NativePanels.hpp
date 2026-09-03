#pragma once

#include <civic/presentation/Presentation.hpp>

#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace civic::presentation {

struct InspectorField {
    std::string label;
    std::string value;
};

struct InspectorSnapshot {
    EntityRef entity{};
    std::string title;
    std::vector<InspectorField> fields;
};

enum class TrendDirection : std::uint8_t {
    Down,
    Flat,
    Up,
};

struct HistorySample {
    std::uint64_t tick{};
    double value{};
};

struct CausalContributor {
    std::string label;
    double contribution{};
    std::string detail;
};

struct DiagnosticSeries {
    std::string id;
    std::string label;
    double current_value{};
    std::optional<double> previous_value;
    std::string unit;
    std::vector<HistorySample> history;
    std::vector<CausalContributor> contributors;
};

struct ManagementPanelSnapshot {
    std::string id;
    std::string title;
    std::vector<InspectorField> fields;
    std::vector<DiagnosticSeries> diagnostics;
};

struct NativePanelSnapshot {
    RenderRevision revision{};
    std::optional<InspectorSnapshot> inspector;
    std::vector<ManagementPanelSnapshot> management;
};

[[nodiscard]] inline TrendDirection classifyTrend(
    const DiagnosticSeries& series,
    double epsilon = 1.0e-9) noexcept {
    if (!series.previous_value || !std::isfinite(series.current_value) ||
        !std::isfinite(*series.previous_value) || !std::isfinite(epsilon) || epsilon < 0.0) {
        return TrendDirection::Flat;
    }
    const double delta = series.current_value - *series.previous_value;
    if (delta > epsilon) return TrendDirection::Up;
    if (delta < -epsilon) return TrendDirection::Down;
    return TrendDirection::Flat;
}

[[nodiscard]] inline std::string_view trendCue(TrendDirection direction) noexcept {
    switch (direction) {
        case TrendDirection::Up: return "up";
        case TrendDirection::Down: return "down";
        case TrendDirection::Flat:
        default: return "flat";
    }
}

[[nodiscard]] inline const ManagementPanelSnapshot* findManagementPanel(
    const NativePanelSnapshot& snapshot,
    std::string_view id) noexcept {
    for (const auto& panel : snapshot.management) {
        if (panel.id == id) return &panel;
    }
    return nullptr;
}

} // namespace civic::presentation
