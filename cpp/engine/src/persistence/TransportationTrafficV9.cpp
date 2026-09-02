#include <civic/persistence/TransportationSaveV9.hpp>

#include <json-c/json.h>

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <string_view>

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

Result<std::size_t> nonNegativeIndex(json_object* object, const char* name) {
    auto value = requiredObjectField(object, name, json_type_int);
    if (!value) return std::unexpected(value.error());
    const auto integer = json_object_get_int64(*value);
    if (integer < 0 || static_cast<std::uint64_t>(integer) > std::numeric_limits<std::size_t>::max()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{"legacy traffic index is invalid: "} + name));
    }
    return static_cast<std::size_t>(integer);
}

Result<double> travelerWeight(json_object* vehicle) {
    if (!vehicle || json_object_get_type(vehicle) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle must be an object"));
    }
    json_object* value = nullptr;
    if (!json_object_object_get_ex(vehicle, "travelerWeight", &value) || !value ||
        (json_object_get_type(value) != json_type_double && json_object_get_type(value) != json_type_int)) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic travelerWeight has invalid type"));
    }
    const double weight = json_object_get_double(value);
    if (!std::isfinite(weight) || weight < 0.0) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic travelerWeight must be finite and non-negative"));
    }
    return weight;
}

Result<void> validateStatus(json_object* vehicle) {
    auto raw = requiredObjectField(vehicle, "status", json_type_string);
    if (!raw) return std::unexpected(raw.error());
    const std::string_view status{json_object_get_string(*raw)};
    if (status != "moving" && status != "queued") {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle status is invalid"));
    }
    return {};
}

} // namespace

Result<transport::TrafficFlowSnapshot> parseLegacyTrafficFlowV9(
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
    if (!json_object_object_get_ex(root.get(), "traffic", &traffic)) return transport::TrafficFlowSnapshot{};
    if (!traffic || json_object_get_type(traffic) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic must be an object"));
    }

    auto vehiclesResult = requiredObjectField(traffic, "vehicles", json_type_array);
    if (!vehiclesResult) return std::unexpected(vehiclesResult.error());
    auto* vehicles = *vehiclesResult;
    std::map<transport::CarriagewayId, double> weights;

    const auto count = json_object_array_length(vehicles);
    for (std::size_t index = 0; index < count; ++index) {
        auto* vehicle = json_object_array_get_idx(vehicles, index);
        if (!vehicle || json_object_get_type(vehicle) != json_type_object) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic vehicle must be an object"));
        }
        auto status = validateStatus(vehicle);
        if (!status) return std::unexpected(status.error());
        auto weight = travelerWeight(vehicle);
        if (!weight) return std::unexpected(weight.error());
        auto routeIndex = nonNegativeIndex(vehicle, "currentEdgeIndex");
        if (!routeIndex) return std::unexpected(routeIndex.error());
        auto edgeIdsResult = requiredObjectField(vehicle, "edgeIds", json_type_array);
        if (!edgeIdsResult) return std::unexpected(edgeIdsResult.error());
        auto* edgeIds = *edgeIdsResult;
        const auto edgeCount = json_object_array_length(edgeIds);
        if (edgeCount == 0 || *routeIndex >= edgeCount) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic route index is out of range"));
        }
        for (std::size_t edgeIndex = 0; edgeIndex < edgeCount; ++edgeIndex) {
            auto* edge = json_object_array_get_idx(edgeIds, edgeIndex);
            if (!edge || json_object_get_type(edge) != json_type_string || std::string_view{json_object_get_string(edge)}.empty()) {
                return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy traffic route contains invalid edge id"));
            }
        }

        const std::string_view currentEdge{json_object_get_string(json_object_array_get_idx(edgeIds, *routeIndex))};
        auto mapped = resolveLegacyEdgeV9(network, currentEdge);
        if (!mapped) continue; // A road edit can intentionally leave a route stale until the next authoritative traffic step.
        weights[*mapped] += *weight;
    }

    transport::TrafficFlowSnapshot snapshot;
    snapshot.loads.reserve(weights.size());
    for (const auto& [carriageway, weight] : weights) {
        snapshot.loads.push_back(transport::TrafficLoadRecord{carriageway, weight});
    }
    return snapshot;
}

} // namespace civic
