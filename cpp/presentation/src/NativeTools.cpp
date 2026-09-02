#include <civic/presentation/NativeTools.hpp>

#include <cmath>
#include <utility>

namespace civic::presentation {
namespace {

bool validPoint(Point2 point) noexcept {
    return std::isfinite(point.x) && std::isfinite(point.y);
}

std::expected<void, std::string> invalidPreview(ToolPreviewState& preview, std::string reason) {
    preview.valid = false;
    preview.geometry.clear();
    preview.invalid_reason = reason;
    return std::unexpected(std::move(reason));
}

std::expected<void, std::string> previewPoint(
    NativeTool tool,
    Point2 position,
    ToolPreviewState& preview,
    NativeTool& active_tool,
    NativeToolDraft& draft,
    NativeToolDraft next_draft,
    std::string_view invalid_reason) {
    active_tool = tool;
    draft = std::monostate{};
    preview = ToolPreviewState{.tool_id = std::string(nativeToolId(tool)), .geometry = {}};
    if (!validPoint(position)) return invalidPreview(preview, std::string(invalid_reason));
    preview.valid = true;
    preview.geometry = {position};
    preview.invalid_reason.clear();
    draft = std::move(next_draft);
    return {};
}

} // namespace

std::string_view nativeToolId(NativeTool tool) noexcept {
    switch (tool) {
        case NativeTool::Road: return "road";
        case NativeTool::Zone: return "zone";
        case NativeTool::Facility: return "facility";
        case NativeTool::Utility: return "utility";
        case NativeTool::Service: return "service";
        case NativeTool::TransitStop: return "transit_stop";
        case NativeTool::Transit: return "transit";
        case NativeTool::Bulldoze: return "bulldoze";
        case NativeTool::Inspect:
        default: return "inspect";
    }
}

std::string_view nativeToolLabel(NativeTool tool) noexcept {
    switch (tool) {
        case NativeTool::Road: return "Road";
        case NativeTool::Zone: return "Zone";
        case NativeTool::Facility: return "Facility";
        case NativeTool::Utility: return "Utility";
        case NativeTool::Service: return "Service";
        case NativeTool::TransitStop: return "Transit Stop";
        case NativeTool::Transit: return "Transit";
        case NativeTool::Bulldoze: return "Bulldoze";
        case NativeTool::Inspect:
        default: return "Inspect";
    }
}

void NativeToolWorkflow::activate(NativeTool tool) noexcept {
    active_tool_ = tool;
    draft_ = std::monostate{};
    preview_ = ToolPreviewState{.tool_id = std::string(nativeToolId(tool)), .geometry = {}};
}

std::expected<void, std::string> NativeToolWorkflow::previewRoad(std::vector<Point2> path, RoadClass road_class) {
    activate(NativeTool::Road);
    if (path.size() < 2U) return invalidPreview(preview_, "road preview requires at least two points");
    for (const auto point : path) {
        if (!validPoint(point)) return invalidPreview(preview_, "road preview contains a non-finite point");
    }
    preview_.valid = true;
    preview_.geometry = path;
    preview_.invalid_reason.clear();
    draft_ = RoadToolDraft{.path = std::move(path), .road_class = road_class};
    return {};
}

std::expected<void, std::string> NativeToolWorkflow::previewZone(std::string parcel_id, std::string zoning_code) {
    activate(NativeTool::Zone);
    if (parcel_id.empty() || zoning_code.empty()) return invalidPreview(preview_, "zone preview requires parcel and zoning identifiers");
    preview_.valid = true;
    preview_.invalid_reason.clear();
    draft_ = ZoneToolDraft{.parcel_id = std::move(parcel_id), .zoning_code = std::move(zoning_code)};
    return {};
}

std::expected<void, std::string> NativeToolWorkflow::previewFacility(Point2 position, std::string facility_type) {
    activate(NativeTool::Facility);
    if (!validPoint(position) || facility_type.empty()) return invalidPreview(preview_, "facility preview is invalid");
    preview_.valid = true;
    preview_.geometry = {position};
    preview_.invalid_reason.clear();
    draft_ = FacilityToolDraft{.position = position, .facility_type = std::move(facility_type)};
    return {};
}

std::expected<void, std::string> NativeToolWorkflow::previewUtility(Point2 position, std::string utility_type) {
    if (utility_type.empty()) {
        activate(NativeTool::Utility);
        return invalidPreview(preview_, "utility preview requires a utility type");
    }
    return previewPoint(
        NativeTool::Utility,
        position,
        preview_,
        active_tool_,
        draft_,
        UtilityToolDraft{.position = position, .utility_type = std::move(utility_type)},
        "utility preview contains a non-finite point");
}

std::expected<void, std::string> NativeToolWorkflow::previewService(Point2 position, std::string service_type) {
    if (service_type.empty()) {
        activate(NativeTool::Service);
        return invalidPreview(preview_, "service preview requires a service type");
    }
    return previewPoint(
        NativeTool::Service,
        position,
        preview_,
        active_tool_,
        draft_,
        ServiceToolDraft{.position = position, .service_type = std::move(service_type)},
        "service preview contains a non-finite point");
}

std::expected<void, std::string> NativeToolWorkflow::previewTransitStop(Point2 position, TransitStopKind kind) {
    return previewPoint(
        NativeTool::TransitStop,
        position,
        preview_,
        active_tool_,
        draft_,
        TransitStopToolDraft{.position = position, .kind = kind},
        "transit-stop preview contains a non-finite point");
}

std::expected<void, std::string> NativeToolWorkflow::previewTransit(std::vector<std::string> stop_ids, VehicleKind mode) {
    activate(NativeTool::Transit);
    if (stop_ids.size() < 2U) return invalidPreview(preview_, "transit preview requires at least two stops");
    for (const auto& id : stop_ids) {
        if (id.empty()) return invalidPreview(preview_, "transit preview contains an empty stop id");
    }
    preview_.valid = true;
    preview_.invalid_reason.clear();
    draft_ = TransitToolDraft{.stop_ids = std::move(stop_ids), .mode = mode};
    return {};
}

std::expected<void, std::string> NativeToolWorkflow::previewBulldoze(Point2 position) {
    return previewPoint(
        NativeTool::Bulldoze,
        position,
        preview_,
        active_tool_,
        draft_,
        BulldozeToolDraft{.position = position},
        "bulldoze preview contains a non-finite point");
}

std::expected<void, std::string> NativeToolWorkflow::commit(NativeUiController& controller) {
    if (!preview_.valid) return std::unexpected("tool preview must be valid before commit");

    std::expected<void, std::string> result = std::unexpected("active tool has no committable draft");
    switch (active_tool_) {
        case NativeTool::Road:
            if (const auto* draft = std::get_if<RoadToolDraft>(&draft_)) result = controller.buildRoad(draft->path, draft->road_class);
            break;
        case NativeTool::Zone:
            if (const auto* draft = std::get_if<ZoneToolDraft>(&draft_)) result = controller.zoneParcel(draft->parcel_id, draft->zoning_code);
            break;
        case NativeTool::Facility:
            if (const auto* draft = std::get_if<FacilityToolDraft>(&draft_)) result = controller.placeFacility(draft->position, draft->facility_type);
            break;
        case NativeTool::Utility:
            if (const auto* draft = std::get_if<UtilityToolDraft>(&draft_)) result = controller.placeUtility(draft->position, draft->utility_type);
            break;
        case NativeTool::Service:
            if (const auto* draft = std::get_if<ServiceToolDraft>(&draft_)) result = controller.placeServiceFacility(draft->position, draft->service_type);
            break;
        case NativeTool::TransitStop:
            if (const auto* draft = std::get_if<TransitStopToolDraft>(&draft_)) result = controller.placeTransitStop(draft->position, draft->kind);
            break;
        case NativeTool::Transit:
            if (const auto* draft = std::get_if<TransitToolDraft>(&draft_)) result = controller.createTransitLine(draft->stop_ids, draft->mode);
            break;
        case NativeTool::Bulldoze:
            if (const auto* draft = std::get_if<BulldozeToolDraft>(&draft_)) result = controller.bulldoze(draft->position);
            break;
        case NativeTool::Inspect:
        default:
            break;
    }

    if (result) cancel();
    return result;
}

void NativeToolWorkflow::cancel() noexcept {
    draft_ = std::monostate{};
    preview_ = ToolPreviewState{.tool_id = std::string(nativeToolId(active_tool_)), .geometry = {}};
}

} // namespace civic::presentation
