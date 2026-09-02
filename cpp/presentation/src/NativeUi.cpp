#include <civic/presentation/NativeUi.hpp>

#include <cmath>
#include <utility>

namespace civic::presentation {
namespace {
bool validPoint(Point2 point) noexcept { return std::isfinite(point.x) && std::isfinite(point.y); }
bool validSimulationSpeed(int speed) noexcept { return speed == 0 || speed == 1 || speed == 2 || speed == 4; }
bool validTaxRate(double rate) noexcept { return std::isfinite(rate) && rate >= 0.0 && rate <= 0.25; }
bool validServiceFunding(double percent) noexcept { return std::isfinite(percent) && percent >= 50.0 && percent <= 150.0; }
bool validTransitMode(VehicleKind mode) noexcept {
    return mode == VehicleKind::Bus || mode == VehicleKind::Brt || mode == VehicleKind::Tram ||
        mode == VehicleKind::Metro || mode == VehicleKind::Rail;
}
bool validTransitConfig(std::uint32_t headway_ticks, double fare, std::uint32_t fleet_limit) noexcept {
    return headway_ticks >= 20U && headway_ticks <= 600U &&
        std::isfinite(fare) && fare >= 0.0 && fare <= 20.0 &&
        fleet_limit <= 50U;
}
bool validIdentifier(std::string_view value) noexcept { return !value.empty(); }
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
std::expected<void, std::string> NativeUiController::placeUtility(Point2 position, std::string utility_type) {
    if (!validPoint(position) || utility_type.empty()) return std::unexpected("utility placement is invalid");
    return sink_.submit(PlaceUtilityCommand{position, std::move(utility_type)});
}
std::expected<void, std::string> NativeUiController::placeServiceFacility(Point2 position, std::string service_type) {
    if (!validPoint(position) || service_type.empty()) return std::unexpected("service facility placement is invalid");
    return sink_.submit(PlaceServiceFacilityCommand{position, std::move(service_type)});
}
std::expected<void, std::string> NativeUiController::placeTransitStop(Point2 position, TransitStopKind kind) {
    if (!validPoint(position)) return std::unexpected("transit stop placement is invalid");
    return sink_.submit(PlaceTransitStopCommand{position, kind});
}
std::expected<void, std::string> NativeUiController::bulldoze(Point2 position) {
    if (!validPoint(position)) return std::unexpected("bulldoze position is invalid");
    return sink_.submit(BulldozeCommand{position});
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
std::expected<void, std::string> NativeUiController::setTaxRate(std::string tax_category, double rate) {
    if (!validIdentifier(tax_category)) return std::unexpected("tax category is required");
    if (!validTaxRate(rate)) return std::unexpected("tax rate must be finite and between 0 and 25 percent");
    return sink_.submit(SetTaxRateCommand{std::move(tax_category), rate});
}
std::expected<void, std::string> NativeUiController::setServiceFunding(std::string department, double percent) {
    if (!validIdentifier(department)) return std::unexpected("service department is required");
    if (!validServiceFunding(percent)) return std::unexpected("service funding must be finite and between 50 and 150 percent");
    return sink_.submit(SetServiceFundingCommand{std::move(department), percent});
}
std::expected<void, std::string> NativeUiController::createTransitService(VehicleKind mode, std::string name) {
    if (!validTransitMode(mode)) return std::unexpected("transit service mode is invalid");
    if (!validIdentifier(name)) return std::unexpected("transit service name is required");
    return sink_.submit(CreateTransitServiceCommand{mode, std::move(name)});
}
std::expected<void, std::string> NativeUiController::setTransitLineStops(std::string line_id, std::vector<std::string> stop_ids) {
    if (!validIdentifier(line_id)) return std::unexpected("transit line id is required");
    if (stop_ids.size() < 2U) return std::unexpected("transit route requires at least two stops");
    for (const auto& stop_id : stop_ids) if (!validIdentifier(stop_id)) return std::unexpected("transit route contains an empty stop id");
    return sink_.submit(SetTransitLineStopsCommand{std::move(line_id), std::move(stop_ids)});
}
std::expected<void, std::string> NativeUiController::appendTransitLineStop(std::string line_id, std::string stop_id) {
    if (!validIdentifier(line_id) || !validIdentifier(stop_id)) return std::unexpected("transit line and stop ids are required");
    return sink_.submit(AppendTransitLineStopCommand{std::move(line_id), std::move(stop_id)});
}
std::expected<void, std::string> NativeUiController::removeTransitLineStop(std::string line_id, std::string stop_id) {
    if (!validIdentifier(line_id) || !validIdentifier(stop_id)) return std::unexpected("transit line and stop ids are required");
    return sink_.submit(RemoveTransitLineStopCommand{std::move(line_id), std::move(stop_id)});
}
std::expected<void, std::string> NativeUiController::configureTransitLine(
    std::string line_id,
    std::uint32_t headway_ticks,
    double fare,
    std::uint32_t fleet_limit,
    bool enabled) {
    if (!validIdentifier(line_id)) return std::unexpected("transit line id is required");
    if (!validTransitConfig(headway_ticks, fare, fleet_limit)) {
        return std::unexpected("transit configuration is outside the current Alpha control range");
    }
    return sink_.submit(ConfigureTransitLineCommand{
        .line_id = std::move(line_id),
        .headway_ticks = headway_ticks,
        .fare = fare,
        .fleet_limit = fleet_limit,
        .enabled = enabled,
    });
}
UiSummary buildUiSummary(const FrameSnapshot& snapshot) noexcept {
    std::size_t active = 0;
    for (const auto& vehicle : snapshot.vehicles) if (!vehicle.out_of_service) ++active;
    return {snapshot.revision, snapshot.buildings.size(), snapshot.roads.size(), active, snapshot.transit_stops.size(), snapshot.selection.active};
}

} // namespace civic::presentation
