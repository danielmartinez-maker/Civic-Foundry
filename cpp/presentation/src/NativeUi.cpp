#include <civic/presentation/NativeUi.hpp>

#include <cmath>
#include <utility>

namespace civic::presentation {
namespace {
bool validPoint(Point2 point) noexcept { return std::isfinite(point.x) && std::isfinite(point.y); }
bool validSimulationSpeed(int speed) noexcept { return speed == 0 || speed == 1 || speed == 2 || speed == 4; }
}

std::expected<void, std::string> NativeUiController::buildRoad(std::vector<Point2> path, RoadClass road_class) {
    if (path.size() < 2) return std::unexpected("road command requires at least two points");
    for (const auto point : path) if (!validPoint(point)) return std::unexpected("road command contains a non-finite point");
    return sink_.submit(BuildRoadCommand{std::move(path), road_class});
}
std::expected<void, std::string> NativeUiController::zoneParcel(std::string parcel_id, std::string zoning_code) {
    if (parcel_id.empty() || zoning_code.empty()) return std::unexpected("parcel and zoning identifiers are required");
    return sink_.submit(ZoneParcelCommand{std::move(parcel_id), std::move(zoning_code)});
}
std::expected<void, std::string> NativeUiController::placeFacility(Point2 position, std::string facility_type) {
    if (!validPoint(position) || facility_type.empty()) return std::unexpected("facility placement is invalid");
    return sink_.submit(PlaceFacilityCommand{position, std::move(facility_type)});
}
std::expected<void, std::string> NativeUiController::createTransitLine(std::vector<std::string> stop_ids, VehicleKind mode) {
    if (stop_ids.size() < 2) return std::unexpected("transit line requires at least two stops");
    for (const auto& id : stop_ids) if (id.empty()) return std::unexpected("transit stop id is empty");
    return sink_.submit(CreateTransitLineCommand{std::move(stop_ids), mode});
}
std::expected<void, std::string> NativeUiController::setSimulationSpeed(int speed) {
    if (!validSimulationSpeed(speed)) return std::unexpected("simulation speed must be one of 0, 1, 2, or 4");
    return sink_.submit(SetSimulationSpeedCommand{speed});
}
UiSummary buildUiSummary(const FrameSnapshot& snapshot) noexcept {
    std::size_t active = 0;
    for (const auto& vehicle : snapshot.vehicles) if (!vehicle.out_of_service) ++active;
    return {snapshot.revision, snapshot.buildings.size(), snapshot.roads.size(), active, snapshot.transit_stops.size(), snapshot.selection.active};
}

} // namespace civic::presentation
