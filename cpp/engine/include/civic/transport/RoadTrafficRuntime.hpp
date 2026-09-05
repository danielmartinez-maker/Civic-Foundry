#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

#include <civic/transport/transport_engine.hpp>

namespace civic::transport {

struct RoadTripSubmission final {
    TripId trip_id;
    TripCause cause{TripCause::home_to_work};
    double traveler_weight{};
    std::string origin_id;
    std::string destination_id;
    RouteResult route;
    std::uint64_t departure_tick{};
};

struct RoadTrafficStepResult final {
    double completed_weight{};
    double failed_weight{};
    std::size_t active_vehicle_count{};
};

[[nodiscard]] std::optional<std::string> submit_road_trip(
    RoadTrafficState& traffic,
    const NetworkSnapshot& network,
    const RoadTripSubmission& submission);

[[nodiscard]] RoadTrafficStepResult step_road_traffic(
    RoadTrafficState& traffic,
    const NetworkSnapshot& network,
    const IntersectionControlStore& controls,
    const IncidentSystem& incidents,
    std::uint64_t tick);

} // namespace civic::transport
