#include <civic/persistence/TransportationSaveV9.hpp>

#include <json-c/json.h>

#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

[[noreturn]] void invalid(std::string message) {
    throw std::runtime_error(std::move(message));
}

json_object* field(json_object* object, const char* name) {
    if (!object || json_object_get_type(object) != json_type_object) invalid("transport Save V9 object expected");
    json_object* value = nullptr;
    return json_object_object_get_ex(object, name, &value) ? value : nullptr;
}

json_object* required(json_object* object, const char* name, json_type type) {
    auto* value = field(object, name);
    if (!value || json_object_get_type(value) != type) invalid(std::string{"transport Save V9 field has invalid type: "} + name);
    return value;
}

std::string stringField(json_object* object, const char* name) {
    return json_object_get_string(required(object, name, json_type_string));
}

std::int64_t intField(json_object* object, const char* name) {
    return json_object_get_int64(required(object, name, json_type_int));
}

std::uint64_t uintField(json_object* object, const char* name) {
    const auto value = intField(object, name);
    if (value < 0) invalid(std::string{"transport Save V9 field must be non-negative: "} + name);
    return static_cast<std::uint64_t>(value);
}

std::size_t sizeField(json_object* object, const char* name) {
    const auto value = uintField(object, name);
    if (value > std::numeric_limits<std::size_t>::max()) invalid(std::string{"transport Save V9 field exceeds size_t: "} + name);
    return static_cast<std::size_t>(value);
}

int int32Field(json_object* object, const char* name) {
    const auto value = intField(object, name);
    if (value < std::numeric_limits<int>::min() || value > std::numeric_limits<int>::max()) invalid(std::string{"transport Save V9 field exceeds int: "} + name);
    return static_cast<int>(value);
}

double numberField(json_object* object, const char* name) {
    auto* value = field(object, name);
    if (!value || (json_object_get_type(value) != json_type_double && json_object_get_type(value) != json_type_int)) {
        invalid(std::string{"transport Save V9 numeric field has invalid type: "} + name);
    }
    return json_object_get_double(value);
}

bool boolField(json_object* object, const char* name) {
    return json_object_get_boolean(required(object, name, json_type_boolean)) != 0;
}

transport::RoadClass roadClass(std::string_view value) {
    if (value == "local") return transport::RoadClass::local;
    if (value == "collector") return transport::RoadClass::collector;
    if (value == "arterial") return transport::RoadClass::arterial;
    invalid("unsupported Save V9 road type: " + std::string{value});
}

transport::TransitMode transitMode(std::string_view value) {
    if (value == "bus") return transport::TransitMode::bus;
    if (value == "brt") return static_cast<transport::TransitMode>(5);
    if (value == "tram") return transport::TransitMode::tram;
    if (value == "metro") return transport::TransitMode::metro;
    invalid("unsupported Save V9 transit mode: " + std::string{value});
}

transport::TransitMode stopCompatibilityMode(std::string_view value) {
    if (value == "surface_stop") return transport::TransitMode::bus;
    if (value == "metro_station") return transport::TransitMode::metro;
    invalid("unsupported Save V9 transit stop type: " + std::string{value});
}

transport::PassengerCohort passengerCohort(json_object* object) {
    transport::PassengerCohort cohort;
    cohort.id = transport::PassengerCohortId{stringField(object, "id")};
    cohort.trip_id = transport::TripId{stringField(object, "personTripId")};
    cohort.traveler_weight = numberField(object, "travelerWeight");
    cohort.line_id = transport::TransitLineId{stringField(object, "lineId")};
    cohort.direction_key = stringField(object, "directionKey");
    cohort.boarding_stop_id = transport::TransitStopId{stringField(object, "boardingStopId")};
    cohort.alighting_stop_id = transport::TransitStopId{stringField(object, "alightingStopId")};
    cohort.enqueued_tick = uintField(object, "enqueuedTick");
    auto* legs = required(object, "transferLegs", json_type_array);
    const auto count = json_object_array_length(legs);
    cohort.transfer_legs.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        auto* raw = json_object_array_get_idx(legs, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid transit transfer leg");
        cohort.transfer_legs.push_back(transport::TransferLeg{
            transport::TransitLineId{stringField(raw, "lineId")},
            stringField(raw, "directionKey"),
            transport::TransitStopId{stringField(raw, "boardingStopId")},
            transport::TransitStopId{stringField(raw, "alightingStopId")},
        });
    }
    return cohort;
}

transport::NetworkSnapshot roadSnapshot(json_object* root) {
    auto* roads = field(root, "roads");
    if (!roads) return {};
    if (json_object_get_type(roads) != json_type_object) invalid("Save V9 roads must be an object");
    const auto revision = uintField(roads, "revision");
    auto* cells = required(roads, "cells", json_type_array);
    std::vector<transport::LegacyRoadCell> legacy;
    const auto count = json_object_array_length(cells);
    legacy.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        auto* raw = json_object_array_get_idx(cells, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid Save V9 road cell");
        legacy.push_back(transport::LegacyRoadCell{
            int32Field(raw, "x"),
            int32Field(raw, "y"),
            roadClass(stringField(raw, "type")),
            false,
            transport::Direction::forward,
        });
    }
    return transport::LegacyRoadAdapter{}.project(legacy, revision);
}

transport::TransitNetworkSnapshot transitNetworkSnapshot(json_object* transit) {
    transport::TransitNetworkSnapshot snapshot;
    auto* network = required(transit, "network", json_type_object);
    snapshot.revision = uintField(network, "revision");

    auto* stops = required(network, "stops", json_type_array);
    const auto stopCount = json_object_array_length(stops);
    snapshot.stops.reserve(stopCount);
    for (std::size_t index = 0; index < stopCount; ++index) {
        auto* raw = json_object_array_get_idx(stops, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid Save V9 transit stop");
        snapshot.stops.push_back(transport::TransitStop{
            transport::TransitStopId{stringField(raw, "id")},
            numberField(raw, "x"),
            numberField(raw, "y"),
            stopCompatibilityMode(stringField(raw, "type")),
        });
    }

    auto* lines = required(network, "lines", json_type_array);
    const auto lineCount = json_object_array_length(lines);
    snapshot.lines.reserve(lineCount);
    for (std::size_t index = 0; index < lineCount; ++index) {
        auto* raw = json_object_array_get_idx(lines, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid Save V9 transit line");
        transport::TransitLine line;
        line.id = transport::TransitLineId{stringField(raw, "id")};
        line.mode = transitMode(stringField(raw, "mode"));
        auto* stopIds = required(raw, "stopIds", json_type_array);
        const auto idCount = json_object_array_length(stopIds);
        line.stop_ids.reserve(idCount);
        for (std::size_t stopIndex = 0; stopIndex < idCount; ++stopIndex) {
            auto* stopId = json_object_array_get_idx(stopIds, stopIndex);
            if (!stopId || json_object_get_type(stopId) != json_type_string) invalid("invalid Save V9 transit line stop id");
            line.stop_ids.emplace_back(json_object_get_string(stopId));
        }
        line.fare = numberField(raw, "fare");
        line.headway_ticks = uintField(raw, "headwayTicks");
        line.enabled = boolField(raw, "enabled");
        snapshot.lines.push_back(std::move(line));
    }
    return snapshot;
}

transport::PassengerQueueSnapshot passengerQueueSnapshot(json_object* mobility) {
    transport::PassengerQueueSnapshot snapshot;
    auto* passengers = required(mobility, "passengers", json_type_object);
    snapshot.next_split_id = uintField(passengers, "nextSplitId");
    auto* queues = required(passengers, "queues", json_type_array);
    const auto queueCount = json_object_array_length(queues);
    snapshot.queues.reserve(queueCount);
    for (std::size_t index = 0; index < queueCount; ++index) {
        auto* raw = json_object_array_get_idx(queues, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid Save V9 passenger queue");
        transport::PassengerQueueEntry queue;
        queue.stop_id = transport::TransitStopId{stringField(raw, "stopId")};
        queue.line_id = transport::TransitLineId{stringField(raw, "lineId")};
        queue.direction_key = stringField(raw, "directionKey");
        auto* cohorts = required(raw, "cohorts", json_type_array);
        const auto cohortCount = json_object_array_length(cohorts);
        queue.cohorts.reserve(cohortCount);
        for (std::size_t cohortIndex = 0; cohortIndex < cohortCount; ++cohortIndex) {
            auto* cohort = json_object_array_get_idx(cohorts, cohortIndex);
            if (!cohort || json_object_get_type(cohort) != json_type_object) invalid("invalid Save V9 passenger cohort");
            queue.cohorts.push_back(passengerCohort(cohort));
        }
        snapshot.queues.push_back(std::move(queue));
    }
    return snapshot;
}

transport::TransitOperationsSnapshot transitOperationsSnapshot(json_object* mobility) {
    transport::TransitOperationsSnapshot snapshot;
    auto* vehicles = required(mobility, "vehicles", json_type_object);
    snapshot.next_run_id = uintField(vehicles, "nextVehicleId");
    auto* rows = required(vehicles, "vehicles", json_type_array);
    const auto vehicleCount = json_object_array_length(rows);
    snapshot.vehicles.reserve(vehicleCount);
    for (std::size_t index = 0; index < vehicleCount; ++index) {
        auto* raw = json_object_array_get_idx(rows, index);
        if (!raw || json_object_get_type(raw) != json_type_object) invalid("invalid Save V9 transit vehicle");
        const auto state = stringField(raw, "state");
        transport::TransitVehicleRecord record;
        record.vehicle.run_id = transport::TransitRunId{stringField(raw, "id")};
        record.vehicle.line_id = transport::TransitLineId{stringField(raw, "lineId")};
        record.vehicle.capacity = numberField(raw, "capacity");
        record.vehicle.state = state == "out_of_service" ? transport::TransitVehicleState::out_of_service : transport::TransitVehicleState::in_service;
        record.vehicle.stop_index = sizeField(raw, "stopIndex");
        record.vehicle.dwell_remaining = uintField(raw, "dwellRemainingTicks");
        record.vehicle.stop_serviced = boolField(raw, "stopServiced");
        record.vehicle.reliability = 1.0;
        auto* onboard = required(raw, "onboard", json_type_array);
        const auto cohortCount = json_object_array_length(onboard);
        record.onboard.reserve(cohortCount);
        for (std::size_t cohortIndex = 0; cohortIndex < cohortCount; ++cohortIndex) {
            auto* cohort = json_object_array_get_idx(onboard, cohortIndex);
            if (!cohort || json_object_get_type(cohort) != json_type_object) invalid("invalid Save V9 onboard passenger cohort");
            record.onboard.push_back(passengerCohort(cohort));
        }
        snapshot.vehicles.push_back(std::move(record));
    }
    return snapshot;
}

transport::TransportationSnapshot transportationSnapshot(json_object* root) {
    transport::TransportationSnapshot snapshot;
    snapshot.network = roadSnapshot(root);
    auto* transit = field(root, "transit");
    if (!transit) return snapshot;
    if (json_object_get_type(transit) != json_type_object) invalid("Save V9 transit must be an object");
    snapshot.transit = transitNetworkSnapshot(transit);
    auto* mobility = required(transit, "mobility", json_type_object);
    snapshot.queues = passengerQueueSnapshot(mobility);
    snapshot.operations = transitOperationsSnapshot(mobility);
    return snapshot;
}
} // namespace

Result<transport::TransportationSnapshot> parseTransportationV9(std::string_view canonicalSaveJson) {
    if (canonicalSaveJson.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "transport Save V9 JSON exceeds parser size limit"));
    }
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate transport Save V9 parser"));
    json_object* raw = json_tokener_parse_ex(tokener, canonicalSaveJson.data(), static_cast<int>(canonicalSaveJson.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transport Save V9 JSON"));
    }
    try {
        auto snapshot = transportationSnapshot(root.get());
        transport::TransportationAuthority authority;
        authority.restore(snapshot);
        return authority.snapshot();
    } catch (const std::exception& exception) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, exception.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "unknown transport Save V9 hydration failure"));
    }
}

} // namespace civic
