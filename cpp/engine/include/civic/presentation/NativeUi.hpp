#pragma once

#include <civic/presentation/Presentation.hpp>

#include <expected>
#include <string>
#include <variant>
#include <vector>

namespace civic::presentation {

struct BuildRoadCommand { std::vector<Point2> path; RoadClass road_class{RoadClass::Local}; };
struct ZoneParcelCommand { std::string parcel_id; std::string zoning_code; };
struct PlaceFacilityCommand { Point2 position{}; std::string facility_type; };
struct CreateTransitLineCommand { std::vector<std::string> stop_ids; VehicleKind mode{VehicleKind::Bus}; };
struct SetSimulationSpeedCommand { int speed{1}; };

using AuthoritativeCommand = std::variant<BuildRoadCommand, ZoneParcelCommand, PlaceFacilityCommand, CreateTransitLineCommand, SetSimulationSpeedCommand>;

class ICommandSink {
public:
    virtual ~ICommandSink() = default;
    virtual std::expected<void, std::string> submit(const AuthoritativeCommand& command) = 0;
};

class NativeUiController {
public:
    explicit NativeUiController(ICommandSink& sink) : sink_(sink) {}
    [[nodiscard]] std::expected<void, std::string> buildRoad(std::vector<Point2> path, RoadClass road_class);
    [[nodiscard]] std::expected<void, std::string> zoneParcel(std::string parcel_id, std::string zoning_code);
    [[nodiscard]] std::expected<void, std::string> placeFacility(Point2 position, std::string facility_type);
    [[nodiscard]] std::expected<void, std::string> createTransitLine(std::vector<std::string> stop_ids, VehicleKind mode);
    [[nodiscard]] std::expected<void, std::string> setSimulationSpeed(int speed);
private:
    ICommandSink& sink_;
};

struct UiSummary {
    RenderRevision revision{};
    std::size_t building_count{};
    std::size_t road_count{};
    std::size_t active_vehicle_count{};
    std::size_t transit_stop_count{};
    bool selection_active{};
};

[[nodiscard]] UiSummary buildUiSummary(const FrameSnapshot& snapshot) noexcept;

} // namespace civic::presentation
