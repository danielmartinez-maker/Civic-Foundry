#pragma once

#include <civic/presentation/NativeUi.hpp>

#include <cstdint>
#include <expected>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace civic::presentation {

enum class NativeTool : std::uint8_t {
    Inspect,
    Road,
    Zone,
    Facility,
    Utility,
    Service,
    TransitStop,
    Transit,
    Bulldoze,
};

struct RoadToolDraft {
    std::vector<Point2> path;
    RoadClass road_class{RoadClass::Local};
};

struct ZoneToolDraft {
    std::string parcel_id;
    std::string zoning_code;
};

struct FacilityToolDraft {
    Point2 position{};
    std::string facility_type;
};

struct UtilityToolDraft {
    Point2 position{};
    std::string utility_type;
};

struct ServiceToolDraft {
    Point2 position{};
    std::string service_type;
};

struct TransitStopToolDraft {
    Point2 position{};
    TransitStopKind kind{TransitStopKind::BusStop};
};

struct TransitToolDraft {
    std::vector<std::string> stop_ids;
    VehicleKind mode{VehicleKind::Bus};
};

struct BulldozeToolDraft {
    Point2 position{};
};

using NativeToolDraft = std::variant<
    std::monostate,
    RoadToolDraft,
    ZoneToolDraft,
    FacilityToolDraft,
    UtilityToolDraft,
    ServiceToolDraft,
    TransitStopToolDraft,
    TransitToolDraft,
    BulldozeToolDraft>;

class NativeToolWorkflow {
public:
    void activate(NativeTool tool) noexcept;
    [[nodiscard]] NativeTool activeTool() const noexcept { return active_tool_; }
    [[nodiscard]] const ToolPreviewState& preview() const noexcept { return preview_; }

    [[nodiscard]] std::expected<void, std::string> previewRoad(std::vector<Point2> path, RoadClass road_class);
    [[nodiscard]] std::expected<void, std::string> previewZone(std::string parcel_id, std::string zoning_code);
    [[nodiscard]] std::expected<void, std::string> previewFacility(Point2 position, std::string facility_type);
    [[nodiscard]] std::expected<void, std::string> previewUtility(Point2 position, std::string utility_type);
    [[nodiscard]] std::expected<void, std::string> previewService(Point2 position, std::string service_type);
    [[nodiscard]] std::expected<void, std::string> previewTransitStop(Point2 position, TransitStopKind kind);
    [[nodiscard]] std::expected<void, std::string> previewTransit(std::vector<std::string> stop_ids, VehicleKind mode);
    [[nodiscard]] std::expected<void, std::string> previewBulldoze(Point2 position);
    [[nodiscard]] std::expected<void, std::string> commit(NativeUiController& controller);
    void cancel() noexcept;

private:
    NativeTool active_tool_{NativeTool::Inspect};
    ToolPreviewState preview_{.tool_id = "inspect", .valid = false, .geometry = {}, .invalid_reason = {}};
    NativeToolDraft draft_{};
};

[[nodiscard]] std::string_view nativeToolId(NativeTool tool) noexcept;
[[nodiscard]] std::string_view nativeToolLabel(NativeTool tool) noexcept;

} // namespace civic::presentation
