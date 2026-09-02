#include <civic/persistence/TransportationSaveV9.hpp>

#include <json-c/json.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <utility>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

Result<json_object*> requiredObjectField(json_object* object, const char* name, json_type type) {
    if (!object || json_object_get_type(object) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic object expected"));
    }
    json_object* value = nullptr;
    if (!json_object_object_get_ex(object, name, &value) || !value || json_object_get_type(value) != type) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic field has invalid type: "} + name));
    }
    return value;
}

Result<std::string> stringField(json_object* object, const char* name) {
    auto value = requiredObjectField(object, name, json_type_string);
    if (!value) return std::unexpected(value.error());
    std::string text{json_object_get_string(*value)};
    if (text.empty()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic field must not be empty: "} + name));
    }
    return text;
}

Result<std::uint64_t> nonNegativeUint(json_object* object, const char* name) {
    auto value = requiredObjectField(object, name, json_type_int);
    if (!value) return std::unexpected(value.error());
    const auto integer = json_object_get_int64(*value);
    if (integer < 0) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic integer is invalid: "} + name));
    }
    return static_cast<std::uint64_t>(integer);
}

Result<std::size_t> nonNegativeIndex(json_object* object, const char* name) {
    auto value = nonNegativeUint(object, name);
    if (!value) return std::unexpected(value.error());
    if (*value > std::numeric_limits<std::size_t>::max()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic index is invalid: "} + name));
    }
    return static_cast<std::size_t>(*value);
}

Result<double> finiteNonNegativeNumber(json_object* object, const char* name) {
    if (!object || json_object_get_type(object) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle must be an object"));
    }
    json_object* value = nullptr;
    if (!json_object_object_get_ex(object, name, &value) || !value ||
        (json_object_get_type(value) != json_type_double && json_object_get_type(value) != json_type_int)) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic numeric field has invalid type: "} + name));
    }
    const double number = json_object_get_double(value);
    if (!std::isfinite(number) || number < 0.0) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic numeric field must be finite and non-negative: "} + name));
    }
    return number;
}

Result<RoadTrafficVehicleStatusV9> vehicleStatus(json_object* vehicle) {
    auto raw = stringField(vehicle, "status");
    if (!raw) return std::unexpected(raw.error());
    if (*raw == "moving") return RoadTrafficVehicleStatusV9::moving;
    if (*raw == "queued") return RoadTrafficVehicleStatusV9::queued;
    return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle status is invalid"));
}

Result<std::optional<transport::JunctionId>> queuedJunction(
    json_object* vehicle,
    const transport::NetworkSnapshot& network) {
    json_object* raw = nullptr;
    if (!json_object_object_get_ex(vehicle, "queuedNodeId", &raw)) return std::optional<transport::JunctionId>{};
    if (!raw || json_object_get_type(raw) != json_type_string) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic queuedNodeId has invalid type"));
    }
    const std::string node{json_object_get_string(raw)};
    if (!node.starts_with("n:") || node.size() <= 2) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic queuedNodeId is invalid"));
    }
    transport::JunctionId id{"j:legacy:" + node.substr(2)};
    const auto found = std::find_if(network.junctions.begin(), network.junctions.end(), [&](const auto& junction) {
        return junction.id == id;
    });
    if (found == network.junctions.end()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic queuedNodeId has no native junction: " + node));
    }
    return std::optional<transport::JunctionId>{std::move(id)};
}

bool isStaleRoadEdit(const Error& error) {
    return error.message.find("has no native carriageway") != std::string::npos;
}

} // namespace

Result<RoadTrafficStateV9> parseLegacyRoadTrafficV9(
    std::string_view canonicalSaveJson,
    const transport::NetworkSnapshot& network) {
    if (canonicalSaveJson.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic Save V9 JSON exceeds parser size limit"));
    }

    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate legacy traffic parser"));
    json_object* raw = json_tokener_parse_ex(tokener, canonicalSaveJson.data(), static_cast<int>(canonicalSaveJson.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid legacy traffic Save V9 JSON"));
    }

    json_object* traffic = nullptr;
    if (!json_object_object_get_ex(root.get(), "traffic", &traffic)) return RoadTrafficStateV9{};
    if (!traffic || json_object_get_type(traffic) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic must be an object"));
    }

    RoadTrafficStateV9 state;
    auto nextVehicleId = nonNegativeUint(traffic, "nextVehicleId");
    if (!nextVehicleId) return std::unexpected(nextVehicleId.error());
    auto completedTrips = nonNegativeUint(traffic, "completedTrips");
    if (!completedTrips) return std::unexpected(completedTrips.error());
    auto failedTrips = nonNegativeUint(traffic, "failedTrips");
    if (!failedTrips) return std::unexpected(failedTrips.error());
    auto congestionEpoch = nonNegativeUint(traffic, "congestionEpoch");
    if (!congestionEpoch) return std::unexpected(congestionEpoch.error());
    state.nextVehicleId = *nextVehicleId;
    state.completedTrips = *completedTrips;
    state.failedTrips = *failedTrips;
    state.congestionEpoch = *congestionEpoch;

    auto vehiclesResult = requiredObjectField(traffic, "vehicles", json_type_array);
    if (!vehiclesResult) return std::unexpected(vehiclesResult.error());
    auto* vehicles = *vehiclesResult;
    std::set<std::string> vehicleIds;

    const auto count = json_object_array_length(vehicles);
    state.vehicles.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        auto* vehicle = json_object_array_get_idx(vehicles, index);
        if (!vehicle || json_object_get_type(vehicle) != json_type_object) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle must be an object"));
        }

        auto id = stringField(vehicle, "id");
        if (!id) return std::unexpected(id.error());
        if (!vehicleIds.insert(*id).second) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate legacy traffic vehicle id: " + *id));
        }
        auto tripId = stringField(vehicle, "tripId");
        if (!tripId) return std::unexpected(tripId.error());
        auto purpose = stringField(vehicle, "purpose");
        if (!purpose) return std::unexpected(purpose.error());
        if (*purpose != "commute" && *purpose != "shopping") {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle purpose is invalid"));
        }
        auto origin = stringField(vehicle, "originBuildingId");
        if (!origin) return std::unexpected(origin.error());
        auto destination = stringField(vehicle, "destinationBuildingId");
        if (!destination) return std::unexpected(destination.error());
        auto weight = finiteNonNegativeNumber(vehicle, "travelerWeight");
        if (!weight) return std::unexpected(weight.error());
        auto routeIndex = nonNegativeIndex(vehicle, "currentEdgeIndex");
        if (!routeIndex) return std::unexpected(routeIndex.error());
        auto progress = finiteNonNegativeNumber(vehicle, "edgeProgressTicks");
        if (!progress) return std::unexpected(progress.error());
        auto departureTick = nonNegativeUint(vehicle, "departureTick");
        if (!departureTick) return std::unexpected(departureTick.error());
        auto delay = finiteNonNegativeNumber(vehicle, "accumulatedDelayTicks");
        if (!delay) return std::unexpected(delay.error());
        auto freeFlow = finiteNonNegativeNumber(vehicle, "freeFlowTicks");
        if (!freeFlow) return std::unexpected(freeFlow.error());
        auto status = vehicleStatus(vehicle);
        if (!status) return std::unexpected(status.error());

        auto edgeIdsResult = requiredObjectField(vehicle, "edgeIds", json_type_array);
        if (!edgeIdsResult) return std::unexpected(edgeIdsResult.error());
        auto* edgeIds = *edgeIdsResult;
        const auto edgeCount = json_object_array_length(edgeIds);
        if (edgeCount == 0 || *routeIndex >= edgeCount) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic route index is out of range"));
        }

        std::vector<transport::CarriagewayId> mappedRoute;
        mappedRoute.reserve(edgeCount);
        bool stale = false;
        for (std::size_t edgeIndex = 0; edgeIndex < edgeCount; ++edgeIndex) {
            auto* edge = json_object_array_get_idx(edgeIds, edgeIndex);
            if (!edge || json_object_get_type(edge) != json_type_string || std::string_view{json_object_get_string(edge)}.empty()) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic route contains invalid edge id"));
            }
            const std::string_view edgeId{json_object_get_string(edge)};
            auto mapped = resolveLegacyEdgeV9(network, edgeId);
            if (!mapped) {
                if (isStaleRoadEdit(mapped.error())) {
                    stale = true;
                    continue;
                }
                return std::unexpected(mapped.error());
            }
            mappedRoute.push_back(*mapped);
        }
        if (stale) continue;
        if (mappedRoute.size() != edgeCount) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic route mapping is incomplete"));
        }

        auto queued = queuedJunction(vehicle, network);
        if (!queued) return std::unexpected(queued.error());

        state.vehicles.push_back(RoadTrafficVehicleV9{
            std::move(*id),
            std::move(*tripId),
            std::move(*purpose),
            *weight,
            std::move(*origin),
            std::move(*destination),
            std::move(mappedRoute),
            *routeIndex,
            *progress,
            *departureTick,
            *delay,
            *freeFlow,
            *status,
            std::move(*queued),
        });
    }

    std::sort(state.vehicles.begin(), state.vehicles.end(), [](const auto& left, const auto& right) {
        return left.id < right.id;
    });
    return state;
}

Result<transport::TrafficFlowSnapshot> deriveTrafficFlowV9(const RoadTrafficStateV9& roadTraffic) {
    std::map<transport::CarriagewayId, double> weights;
    for (const auto& vehicle : roadTraffic.vehicles) {
        if (!std::isfinite(vehicle.travelerWeight) || vehicle.travelerWeight < 0.0) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "native road traffic travelerWeight must be finite and non-negative"));
        }
        if (vehicle.carriagewayIds.empty() || vehicle.currentCarriagewayIndex >= vehicle.carriagewayIds.size()) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "native road traffic route index is out of range"));
        }
        weights[vehicle.carriagewayIds[vehicle.currentCarriagewayIndex]] += vehicle.travelerWeight;
    }

    transport::TrafficFlowSnapshot snapshot;
    snapshot.loads.reserve(weights.size());
    for (const auto& [carriageway, weight] : weights) {
        snapshot.loads.push_back(transport::TrafficLoadRecord{carriageway, weight});
    }
    return snapshot;
}

Result<transport::TrafficFlowSnapshot> parseLegacyTrafficFlowV9(
    std::string_view canonicalSaveJson,
    const transport::NetworkSnapshot& network) {
    auto roadTraffic = parseLegacyRoadTrafficV9(canonicalSaveJson, network);
    if (!roadTraffic) return std::unexpected(roadTraffic.error());
    return deriveTrafficFlowV9(*roadTraffic);
}

} // namespace civic
