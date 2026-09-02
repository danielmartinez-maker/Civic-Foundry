#include <civic/transport/RoadTrafficRuntime.hpp>

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>
#include <vector>

namespace civic::transport {
namespace {
constexpr double kEpsilon = 1e-9;

[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }

void require_positive_finite(double value, const char* label) {
    if (!std::isfinite(value) || value <= 0.0) fail(std::string{label} + " must be positive and finite");
}

const Carriageway& carriageway_for(const NetworkSnapshot& network, const CarriagewayId& id) {
    const auto iterator = std::find_if(network.carriageways.begin(), network.carriageways.end(), [&](const auto& value) {
        return value.id == id;
    });
    if (iterator == network.carriageways.end()) fail("road trip references missing carriageway");
    return *iterator;
}

const RoadSegment& segment_for(const NetworkSnapshot& network, const SegmentId& id) {
    const auto iterator = std::find_if(network.segments.begin(), network.segments.end(), [&](const auto& value) {
        return value.id == id;
    });
    if (iterator == network.segments.end()) fail("carriageway references missing road segment");
    return *iterator;
}

const Lane& lane_for(const NetworkSnapshot& network, const LaneId& id) {
    const auto iterator = std::find_if(network.lanes.begin(), network.lanes.end(), [&](const auto& value) {
        return value.id == id;
    });
    if (iterator == network.lanes.end()) fail("carriageway references missing lane");
    return *iterator;
}

bool usable_private_car_lane(const Lane& lane) {
    return lane.open
        && lane.type != LaneType::parking
        && lane.type != LaneType::shoulder
        && (lane.permissions & permission(VehiclePermission::private_car)) != 0U;
}

double base_travel_ticks(const NetworkSnapshot& network, const CarriagewayId& id) {
    const auto& carriageway = carriageway_for(network, id);
    const auto& segment = segment_for(network, carriageway.segment_id);
    double speed_kph = std::numeric_limits<double>::infinity();
    for (const auto& lane_id : carriageway.lane_ids) {
        const auto& lane = lane_for(network, lane_id);
        if (usable_private_car_lane(lane)) speed_kph = std::min(speed_kph, lane.free_flow_speed_kph);
    }
    if (!std::isfinite(speed_kph) || speed_kph <= kEpsilon) fail("road trip carriageway has no usable private-car lane");
    if (!std::isfinite(segment.length_meters) || segment.length_meters <= 0.0) fail("road segment length must be positive and finite");
    const double meters_per_second = speed_kph / 3.6;
    return std::max(1.0, segment.length_meters / meters_per_second);
}

const TurnMovement* movement_between(
    const NetworkSnapshot& network,
    const CarriagewayId& from,
    const CarriagewayId& to) {
    const auto iterator = std::find_if(network.movements.begin(), network.movements.end(), [&](const auto& value) {
        return value.from_carriageway_id == from && value.to_carriageway_id == to;
    });
    return iterator == network.movements.end() ? nullptr : &*iterator;
}

bool movement_is_open(
    const NetworkSnapshot& network,
    const IntersectionControlStore& controls,
    const TurnMovement& movement,
    std::uint64_t tick) {
    if (!movement.allowed || (movement.permissions & permission(VehiclePermission::private_car)) == 0U) return false;
    return controls.capacity_factor(network, movement.junction_id, movement.id, tick) > kEpsilon;
}

std::uint64_t next_vehicle_counter(const RoadTrafficSnapshot& snapshot) {
    std::uint64_t next = std::max<std::uint64_t>(1, snapshot.next_vehicle_id);
    std::set<std::string> ids;
    for (const auto& vehicle : snapshot.vehicles) ids.insert(vehicle.id);
    while (ids.contains("vehicle:" + std::to_string(next))) ++next;
    return next;
}

} // namespace

std::optional<std::string> submit_road_trip(
    RoadTrafficState& traffic,
    const NetworkSnapshot& network,
    const RoadTripSubmission& submission) {
    if (submission.trip_id.value.empty()) fail("road trip id must not be empty");
    require_positive_finite(submission.traveler_weight, "road trip traveler weight");
    if (submission.origin_id.empty() || submission.destination_id.empty()) fail("road trip endpoints must not be empty");

    auto state = traffic.snapshot();
    if (submission.route.carriageway_ids.empty()) {
        if (submission.route.junction_ids.size() != 1U || !submission.route.movement_ids.empty()) {
            fail("zero-edge road trip must be a same-node route");
        }
        ++state.completed_trips;
        ++state.congestion_epoch;
        traffic.restore(network, state);
        return std::nullopt;
    }

    if (submission.route.junction_ids.size() != submission.route.carriageway_ids.size() + 1U) {
        fail("road trip route junction/carriageway shape mismatch");
    }
    if (submission.route.movement_ids.size() + 1U != submission.route.carriageway_ids.size()) {
        fail("road trip route movement/carriageway shape mismatch");
    }
    for (const auto& carriageway_id : submission.route.carriageway_ids) {
        (void)base_travel_ticks(network, carriageway_id);
    }
    for (std::size_t index = 0; index < submission.route.movement_ids.size(); ++index) {
        const auto* movement = movement_between(
            network,
            submission.route.carriageway_ids[index],
            submission.route.carriageway_ids[index + 1U]);
        if (!movement || movement->id != submission.route.movement_ids[index]) fail("road trip route movement mismatch");
    }

    const auto counter = next_vehicle_counter(state);
    const std::string vehicle_id = "vehicle:" + std::to_string(counter);
    double free_flow_ticks = 0.0;
    for (const auto& carriageway_id : submission.route.carriageway_ids) free_flow_ticks += base_travel_ticks(network, carriageway_id);
    state.next_vehicle_id = counter + 1U;
    state.vehicles.push_back(ActiveRoadVehicle{
        vehicle_id,
        submission.trip_id,
        submission.cause,
        submission.traveler_weight,
        submission.origin_id,
        submission.destination_id,
        submission.route.carriageway_ids,
        0,
        0.0,
        submission.departure_tick,
        0.0,
        free_flow_ticks,
        RoadVehicleStatus::moving,
        std::nullopt,
    });
    std::ranges::sort(state.vehicles, {}, &ActiveRoadVehicle::id);
    ++state.congestion_epoch;
    traffic.restore(network, state);
    return vehicle_id;
}

RoadTrafficStepResult step_road_traffic(
    RoadTrafficState& traffic,
    const NetworkSnapshot& network,
    const IntersectionControlStore& controls,
    const IncidentSystem& incidents,
    std::uint64_t tick) {
    auto state = traffic.snapshot();
    TrafficFlowState loads;
    loads.restore(traffic.flow_snapshot());
    std::vector<std::string> completed_ids;
    double completed_weight = 0.0;

    for (auto& vehicle : state.vehicles) {
        if (vehicle.current_carriageway_index >= vehicle.carriageway_ids.size()) fail("active road vehicle route index invalid");
        const auto current_id = vehicle.carriageway_ids[vehicle.current_carriageway_index];
        const auto capacity_factor = incidents.capacity_factor(current_id);
        const auto speed_factor = incidents.speed_factor(current_id);
        if (!std::isfinite(capacity_factor) || !std::isfinite(speed_factor)) fail("incident factor must be finite");

        if (capacity_factor <= kEpsilon || speed_factor <= kEpsilon) {
            vehicle.status = RoadVehicleStatus::queued;
            vehicle.accumulated_delay_ticks += 1.0;
            const auto& carriageway = carriageway_for(network, current_id);
            vehicle.queued_junction_id = carriageway.to_junction_id;
            continue;
        }

        const auto metric = loads.metric(network, current_id, capacity_factor);
        const double effective_speed_kph = metric.speed_kph * speed_factor;
        if (!std::isfinite(effective_speed_kph) || effective_speed_kph <= kEpsilon) {
            vehicle.status = RoadVehicleStatus::queued;
            vehicle.accumulated_delay_ticks += 1.0;
            vehicle.queued_junction_id = carriageway_for(network, current_id).to_junction_id;
            continue;
        }
        const auto& segment = segment_for(network, carriageway_for(network, current_id).segment_id);
        const double required_ticks = std::max(1.0, segment.length_meters / (effective_speed_kph / 3.6));
        vehicle.carriageway_progress_ticks += 1.0;
        vehicle.status = RoadVehicleStatus::moving;
        vehicle.queued_junction_id.reset();
        if (vehicle.carriageway_progress_ticks + kEpsilon < required_ticks) continue;

        if (vehicle.current_carriageway_index + 1U >= vehicle.carriageway_ids.size()) {
            completed_weight += vehicle.traveler_weight;
            completed_ids.push_back(vehicle.id);
            continue;
        }

        const auto next_id = vehicle.carriageway_ids[vehicle.current_carriageway_index + 1U];
        const auto* movement = movement_between(network, current_id, next_id);
        if (!movement || !movement_is_open(network, controls, *movement, tick)) {
            vehicle.carriageway_progress_ticks = required_ticks;
            vehicle.status = RoadVehicleStatus::queued;
            vehicle.accumulated_delay_ticks += 1.0;
            vehicle.queued_junction_id = carriageway_for(network, current_id).to_junction_id;
            continue;
        }
        vehicle.carriageway_progress_ticks = std::max(0.0, vehicle.carriageway_progress_ticks - required_ticks);
        ++vehicle.current_carriageway_index;
    }

    if (!completed_ids.empty()) {
        const std::set<std::string> completed(completed_ids.begin(), completed_ids.end());
        std::erase_if(state.vehicles, [&](const auto& vehicle) { return completed.contains(vehicle.id); });
        state.completed_trips += static_cast<std::uint64_t>(completed_ids.size());
    }
    if (!state.vehicles.empty() || !completed_ids.empty()) ++state.congestion_epoch;
    traffic.restore(network, state);
    return RoadTrafficStepResult{completed_weight, 0.0, state.vehicles.size()};
}

} // namespace civic::transport
