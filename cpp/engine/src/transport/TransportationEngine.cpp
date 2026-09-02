#include <civic/transport/Transportation.hpp>

#include <cstring>
#include <sstream>

namespace civic::transport {
namespace {
[[nodiscard]] std::uint64_t fnv1a(std::uint64_t hash, std::string_view value) noexcept {
    for (const unsigned char ch : value) { hash ^= ch; hash *= 1099511628211ULL; }
    return hash;
}
[[nodiscard]] std::uint64_t fnvNumber(std::uint64_t hash, std::uint64_t value) noexcept {
    for (std::size_t shift = 0; shift < 64U; shift += 8U) { hash ^= static_cast<std::uint8_t>((value >> shift) & 0xffU); hash *= 1099511628211ULL; }
    return hash;
}
[[nodiscard]] std::uint64_t doubleBits(double value) noexcept {
    if (value == 0.0) value = 0.0;
    std::uint64_t bits{}; std::memcpy(&bits, &value, sizeof(bits)); return bits;
}
}

void TransportationEngine::bumpCostRevision() {
    (void)network_.advanceCostRevision();
    router_.clear();
    ++revision_;
}

Result<void> TransportationEngine::migrateLegacyRoads(const LegacyRoadState& roads) {
    LegacyRoadMigrationAdapter adapter;
    auto migrated = adapter.project(roads); if (!migrated) return std::unexpected(migrated.error());
    auto mutation = network_.replaceAuthority(std::move(migrated->authority));
    if (!mutation.ok) return std::unexpected(make_error(ErrorCode::invariant_failure, mutation.reason));
    router_.clear();
    auto rebuilt = traffic_.rebuild(network_.snapshot(), incidents_); if (!rebuilt) return rebuilt;
    if (mutation.changed) ++revision_;
    return validate();
}

Result<void> TransportationEngine::restoreNetwork(const TransportNetworkSnapshot& snapshot_value) {
    auto restored = network_.restore(snapshot_value); if (!restored) return restored;
    router_.clear();
    auto rebuilt = traffic_.rebuild(network_.snapshot(), incidents_); if (!rebuilt) return rebuilt;
    ++revision_;
    return validate();
}

Result<void> TransportationEngine::restoreTransit(const TransitNetworkSnapshot& transit, const PassengerQueueSnapshot& queues, const TransitOperationsSnapshot& operations) {
    const auto road = network_.snapshot();
    auto network_restored = transit_network_.restore(transit, road); if (!network_restored) return network_restored;
    auto queues_restored = passenger_queues_.restore(queues, transit_network_); if (!queues_restored) return queues_restored;
    auto operations_restored = transit_operations_.restore(operations, transit_network_); if (!operations_restored) return operations_restored;
    ++revision_;
    return validate();
}

Result<void> TransportationEngine::restoreSnapshot(const TransportationSnapshot& snapshot_value, std::uint64_t tick) {
    auto network_restored=network_.restore(snapshot_value.network);if(!network_restored)return network_restored;
    auto controls_restored=controls_.restore(snapshot_value.controls,snapshot_value.signalPlans,network_.snapshot());if(!controls_restored)return controls_restored;
    auto parking_restored=parking_.restore(snapshot_value.parking,network_.snapshot());if(!parking_restored)return parking_restored;
    auto incidents_restored=incidents_.restore(snapshot_value.incidents,network_.snapshot(),tick);if(!incidents_restored)return incidents_restored;
    auto traffic_restored=traffic_.restore(snapshot_value.traffic,network_.snapshot(),incidents_);if(!traffic_restored)return traffic_restored;
    auto transit_restored=transit_network_.restore(snapshot_value.transitNetwork,network_.snapshot());if(!transit_restored)return transit_restored;
    auto queues_restored=passenger_queues_.restore(snapshot_value.passengerQueues,transit_network_);if(!queues_restored)return queues_restored;
    auto operations_restored=transit_operations_.restore(snapshot_value.transitOperations,transit_network_);if(!operations_restored)return operations_restored;
    revision_=snapshot_value.revision;router_.clear();return validate();
}

Result<void> TransportationEngine::step(std::uint64_t tick) {
    const auto incident_revision = incidents_.revision();
    (void)incidents_.step(tick);
    if (incidents_.revision() != incident_revision) bumpCostRevision();
    auto traffic_rebuilt = traffic_.rebuild(network_.snapshot(), incidents_); if (!traffic_rebuilt) return traffic_rebuilt;
    auto transit_step = transit_operations_.step(tick, transit_network_, passenger_queues_); if (!transit_step) return transit_step;
    ++revision_;
    return validate();
}

Result<RouteResult> TransportationEngine::route(const RouteRequest& request) {
    return router_.route(network_.snapshot(), controls_, parking_, incidents_, request);
}

Result<TransportationSnapshot> TransportationEngine::snapshot() const {
    TransportationSnapshot result;
    result.network = network_.snapshot();
    auto groups = buildLaneGroups(result.network); if (!groups) return std::unexpected(groups.error());
    result.laneGroups = std::move(*groups);
    result.controls.reserve(controls_.controls().size()); for (const auto& [id, item] : controls_.controls()) { (void)id; result.controls.push_back(item); }
    result.signalPlans.reserve(controls_.signalPlans().size()); for (const auto& [id, item] : controls_.signalPlans()) { (void)id; result.signalPlans.push_back(item); }
    result.parking = parking_.snapshot();
    result.incidents = incidents_.snapshot();
    result.traffic = traffic_.snapshot();
    result.transitNetwork = transit_network_.snapshot();
    result.passengerQueues = passenger_queues_.snapshot();
    result.transitOperations = transit_operations_.snapshot();
    result.revision = revision_;
    return result;
}

Result<void> TransportationEngine::validate() const {
    auto network_valid = network_.validate(); if (!network_valid) return network_valid;
    for (const auto& state : traffic_.snapshot()) {
        if (!std::isfinite(state.vehicleStock) || state.vehicleStock < 0.0 || !std::isfinite(state.enteringFlowPerMinute) || state.enteringFlowPerMinute < 0.0 || !std::isfinite(state.capacityPerMinute) || state.capacityPerMinute < 0.0 || !std::isfinite(state.speedKph) || state.speedKph < 0.0) return std::unexpected(make_error(ErrorCode::invariant_failure, "traffic state contains non-finite/negative metric"));
    }
    const auto queue = passenger_queues_.snapshot();
    const auto operations = transit_operations_.snapshot();
    std::set<PassengerCohortId> active_ids;
    double waiting = 0.0;
    for (const auto& entry : queue.queues) for (const auto& cohort : entry.cohorts) {
        if (!active_ids.insert(cohort.id).second) return std::unexpected(make_error(ErrorCode::invariant_failure, "duplicate passenger cohort across queues"));
        waiting += cohort.travelerWeight;
    }
    double onboard = 0.0;
    for (const auto& vehicle : operations.vehicles) for (const auto& cohort : vehicle.onboard) {
        if (!active_ids.insert(cohort.id).second) return std::unexpected(make_error(ErrorCode::invariant_failure, "duplicate passenger cohort across waiting/onboard state"));
        onboard += cohort.travelerWeight;
    }
    const double conserved = waiting + onboard + queue.completedWeight + queue.cancelledWeight;
    if (!std::isfinite(queue.generatedWeight) || std::abs(queue.generatedWeight - conserved) > 1e-8) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, "passenger conservation violated: generated != waiting + onboard + completed + cancelled"));
    }
    if (std::abs(queue.completedWeight - operations.completedPassengerWeight) > 1e-8) return std::unexpected(make_error(ErrorCode::invariant_failure, "transit completed passenger ledgers diverge"));
    return {};
}

std::uint64_t canonicalHash(const TransportationSnapshot& snapshot_value) noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    hash = fnvNumber(hash, snapshot_value.network.topologyRevision);
    hash = fnvNumber(hash, snapshot_value.network.costRevision);
    for (const auto& junction_value : snapshot_value.network.junctions) {
        hash = fnv1a(hash, junction_value.id.value()); hash = fnvNumber(hash, doubleBits(junction_value.x)); hash = fnvNumber(hash, doubleBits(junction_value.y));
    }
    for (const auto& segment : snapshot_value.network.segments) {
        hash = fnv1a(hash, segment.id.value()); hash = fnvNumber(hash, static_cast<std::uint64_t>(segment.roadClass)); hash = fnv1a(hash, segment.startJunctionId.value()); hash = fnv1a(hash, segment.endJunctionId.value()); hash = fnvNumber(hash, doubleBits(segment.lengthMeters)); hash = fnvNumber(hash, doubleBits(segment.speedLimitKph));
    }
    for (const auto& lane : snapshot_value.network.lanes) {
        hash = fnv1a(hash, lane.id.value()); hash = fnv1a(hash, lane.carriagewayId.value()); hash = fnvNumber(hash, lane.ordinal); hash = fnvNumber(hash, lane.permissions); hash = fnvNumber(hash, static_cast<std::uint64_t>(lane.operatingState)); hash = fnvNumber(hash, doubleBits(lane.baseCapacityPerMinute));
    }
    for (const auto& movement : snapshot_value.network.movements) {
        hash = fnv1a(hash, movement.id.value()); hash = fnvNumber(hash, movement.allowed ? 1U : 0U); hash = fnvNumber(hash, movement.permissions); hash = fnvNumber(hash, static_cast<std::uint64_t>(movement.type));
    }
    for (const auto& parking : snapshot_value.parking) { hash = fnv1a(hash, parking.id.value()); hash = fnvNumber(hash, doubleBits(parking.capacity)); hash = fnvNumber(hash, doubleBits(parking.occupied)); hash = fnvNumber(hash, doubleBits(parking.price)); }
    for (const auto& incident : snapshot_value.incidents) { hash = fnv1a(hash, incident.id.value()); hash = fnvNumber(hash, static_cast<std::uint64_t>(incident.state)); hash = fnvNumber(hash, doubleBits(incident.capacityFactor)); }
    for (const auto& state : snapshot_value.traffic) { hash = fnv1a(hash, state.laneGroupId.value()); hash = fnvNumber(hash, doubleBits(state.vehicleStock)); hash = fnvNumber(hash, doubleBits(state.enteringFlowPerMinute)); }
    for (const auto& stop : snapshot_value.transitNetwork.stops) { hash = fnv1a(hash, stop.id.value()); hash = fnv1a(hash, stop.roadJunctionId.value()); }
    for (const auto& line : snapshot_value.transitNetwork.lines) { hash = fnv1a(hash, line.id.value()); for (const auto& stop_id : line.stopIds) hash = fnv1a(hash, stop_id.value()); hash = fnvNumber(hash, line.headwayTicks); hash = fnvNumber(hash, doubleBits(line.fare)); }
    hash = fnvNumber(hash, doubleBits(snapshot_value.passengerQueues.generatedWeight)); hash = fnvNumber(hash, doubleBits(snapshot_value.passengerQueues.completedWeight)); hash = fnvNumber(hash, doubleBits(snapshot_value.passengerQueues.cancelledWeight));
    for (const auto& queue : snapshot_value.passengerQueues.queues) for (const auto& cohort : queue.cohorts) { hash = fnv1a(hash, cohort.id.value()); hash = fnvNumber(hash, doubleBits(cohort.travelerWeight)); }
    for (const auto& vehicle : snapshot_value.transitOperations.vehicles) { hash = fnv1a(hash, vehicle.id.value()); hash = fnvNumber(hash, static_cast<std::uint64_t>(vehicle.state)); for (const auto& cohort : vehicle.onboard) { hash = fnv1a(hash, cohort.id.value()); hash = fnvNumber(hash, doubleBits(cohort.travelerWeight)); } }
    return hash;
}

} // namespace civic::transport
