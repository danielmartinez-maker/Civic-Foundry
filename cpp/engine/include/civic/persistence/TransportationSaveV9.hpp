#pragma once

#include <compare>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/transport/transport_engine.hpp>

namespace civic {

enum class RoadTrafficVehicleStatusV9 { moving, queued };

struct RoadTrafficVehicleV9 final {
    std::string id;
    std::string tripId;
    std::string purpose;
    double travelerWeight{};
    std::string originBuildingId;
    std::string destinationBuildingId;
    std::vector<transport::CarriagewayId> carriagewayIds;
    std::size_t currentCarriagewayIndex{};
    double carriagewayProgressTicks{};
    std::uint64_t departureTick{};
    double accumulatedDelayTicks{};
    double freeFlowTicks{};
    RoadTrafficVehicleStatusV9 status{RoadTrafficVehicleStatusV9::moving};
    std::optional<transport::JunctionId> queuedJunctionId;
    auto operator<=>(const RoadTrafficVehicleV9&) const = default;
};

struct RoadTrafficStateV9 final {
    std::vector<RoadTrafficVehicleV9> vehicles;
    std::uint64_t nextVehicleId{1};
    std::uint64_t completedTrips{};
    std::uint64_t failedTrips{};
    std::uint64_t congestionEpoch{};
    auto operator<=>(const RoadTrafficStateV9&) const = default;
};

struct TransitVehicleContinuationV9 final {
    std::string id;
    std::string lineId;
    std::string mode;
    std::string directionKey;
    std::string state;
    std::vector<std::string> roadEdgeIds;
    std::size_t currentRoadEdgeIndex{};
    double edgeProgressTicks{};
    std::uint64_t dedicatedRemainingTicks{};
    double delayTicks{};
    std::uint64_t inServiceTicks{};
    std::uint64_t runStartedTick{};
    bool hasDepartedOrigin{};
    auto operator<=>(const TransitVehicleContinuationV9&) const = default;
};

struct TransportationContinuationV9 final {
    std::vector<TransitVehicleContinuationV9> vehicles;
    std::string trafficCanonical{"null"};
    std::string intersectionsCanonical{"null"};
    std::string canonical;
    auto operator<=>(const TransportationContinuationV9&) const = default;
};

[[nodiscard]] Result<transport::TransportationSnapshot> parseTransportationV9(std::string_view canonicalSaveJson);
[[nodiscard]] Result<TransportationContinuationV9> parseTransportationContinuationV9(std::string_view canonicalSaveJson);
[[nodiscard]] Result<transport::CarriagewayId> resolveLegacyEdgeV9(
    const transport::NetworkSnapshot& network,
    std::string_view legacyEdgeId);
[[nodiscard]] Result<RoadTrafficStateV9> parseLegacyRoadTrafficV9(
    std::string_view canonicalSaveJson,
    const transport::NetworkSnapshot& network);
[[nodiscard]] Result<transport::TrafficFlowSnapshot> deriveTrafficFlowV9(
    const RoadTrafficStateV9& roadTraffic);
[[nodiscard]] Result<transport::TrafficFlowSnapshot> parseLegacyTrafficFlowV9(
    std::string_view canonicalSaveJson,
    const transport::NetworkSnapshot& network);

} // namespace civic
