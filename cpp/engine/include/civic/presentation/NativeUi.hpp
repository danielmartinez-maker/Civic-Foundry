#pragma once

#include <civic/presentation/Presentation.hpp>

#include <cstdint>
#include <expected>
#include <string>
#include <variant>
#include <vector>

namespace civic::presentation {

struct BuildRoadCommand { std::vector<Point2> path; RoadClass road_class{RoadClass::Local}; };
struct ZoneParcelCommand { std::string parcel_id; std::string zoning_code; };
struct PlaceFacilityCommand { Point2 position{}; std::string facility_type; };
struct PlaceUtilityCommand { Point2 position{}; std::string utility_type; };
struct PlaceServiceFacilityCommand { Point2 position{}; std::string service_type; };
struct PlaceTransitStopCommand { Point2 position{}; TransitStopKind kind{TransitStopKind::BusStop}; };
struct BulldozeCommand { Point2 position{}; };
struct CreateTransitLineCommand { std::vector<std::string> stop_ids; VehicleKind mode{VehicleKind::Bus}; };
struct SetSimulationSpeedCommand { int speed{1}; };
struct SetTaxRateCommand { std::string tax_category; double rate{}; };
struct SetServiceFundingCommand { std::string department; double percent{100.0}; };
struct CreateTransitServiceCommand { VehicleKind mode{VehicleKind::Bus}; std::string name; };
struct SetTransitLineStopsCommand { std::string line_id; std::vector<std::string> stop_ids; };
struct AppendTransitLineStopCommand { std::string line_id; std::string stop_id; };
struct RemoveTransitLineStopCommand { std::string line_id; std::string stop_id; };
struct ConfigureTransitLineCommand {
    std::string line_id;
    std::uint32_t headway_ticks{80U};
    double fare{2.0};
    std::uint32_t fleet_limit{2U};
    bool enabled{true};
};

using AuthoritativeCommand = std::variant<
    BuildRoadCommand,
    ZoneParcelCommand,
    PlaceFacilityCommand,
    PlaceUtilityCommand,
    PlaceServiceFacilityCommand,
    PlaceTransitStopCommand,
    BulldozeCommand,
    CreateTransitLineCommand,
    SetSimulationSpeedCommand,
    SetTaxRateCommand,
    SetServiceFundingCommand,
    CreateTransitServiceCommand,
    SetTransitLineStopsCommand,
    AppendTransitLineStopCommand,
    RemoveTransitLineStopCommand,
    ConfigureTransitLineCommand>;

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
    [[nodiscard]] std::expected<void, std::string> placeUtility(Point2 position, std::string utility_type);
    [[nodiscard]] std::expected<void, std::string> placeServiceFacility(Point2 position, std::string service_type);
    [[nodiscard]] std::expected<void, std::string> placeTransitStop(Point2 position, TransitStopKind kind);
    [[nodiscard]] std::expected<void, std::string> bulldoze(Point2 position);
    [[nodiscard]] std::expected<void, std::string> createTransitLine(std::vector<std::string> stop_ids, VehicleKind mode);
    [[nodiscard]] std::expected<void, std::string> setSimulationSpeed(int speed);
    [[nodiscard]] std::expected<void, std::string> setTaxRate(std::string tax_category, double rate);
    [[nodiscard]] std::expected<void, std::string> setServiceFunding(std::string department, double percent);
    [[nodiscard]] std::expected<void, std::string> createTransitService(VehicleKind mode, std::string name);
    [[nodiscard]] std::expected<void, std::string> setTransitLineStops(std::string line_id, std::vector<std::string> stop_ids);
    [[nodiscard]] std::expected<void, std::string> appendTransitLineStop(std::string line_id, std::string stop_id);
    [[nodiscard]] std::expected<void, std::string> removeTransitLineStop(std::string line_id, std::string stop_id);
    [[nodiscard]] std::expected<void, std::string> configureTransitLine(
        std::string line_id,
        std::uint32_t headway_ticks,
        double fare,
        std::uint32_t fleet_limit,
        bool enabled);
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
