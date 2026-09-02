#pragma once

#include <compare>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/Error.hpp>
#include <civic/transport/transport_engine.hpp>

namespace civic {

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

struct LegacyRoadAuthorityV9 final {
    std::uint64_t revision{};
    std::vector<transport::LegacyRoadCell> cells;
};

[[nodiscard]] Result<transport::TransportationSnapshot> parseTransportationV9(std::string_view canonicalSaveJson);
[[nodiscard]] Result<LegacyRoadAuthorityV9> parseLegacyRoadAuthorityV9(std::string_view canonicalSaveJson);
[[nodiscard]] Result<std::string> writeTransportationV9(
    std::string_view canonicalSaveJson,
    const LegacyRoadAuthorityV9& roads,
    const transport::TransportationSnapshot& transportation);
[[nodiscard]] Result<std::string> transportationSnapshotJson(const transport::TransportationSnapshot& transportation);
[[nodiscard]] Result<TransportationContinuationV9> parseTransportationContinuationV9(std::string_view canonicalSaveJson);
[[nodiscard]] Result<transport::CarriagewayId> resolveLegacyEdgeV9(
    const transport::NetworkSnapshot& network,
    std::string_view legacyEdgeId);
[[nodiscard]] Result<transport::RoadTrafficSnapshot> parseLegacyRoadTrafficV9(
    std::string_view canonicalSaveJson,
    const transport::NetworkSnapshot& network);
[[nodiscard]] Result<transport::TrafficFlowSnapshot> deriveTrafficFlowV9(
    const transport::NetworkSnapshot& network,
    const transport::RoadTrafficSnapshot& roadTraffic);
[[nodiscard]] Result<transport::TrafficFlowSnapshot> parseLegacyTrafficFlowV9(
    std::string_view canonicalSaveJson,
    const transport::NetworkSnapshot& network);

} // namespace civic
