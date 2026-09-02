#include <civic/persistence/TransportationSaveV9.hpp>

#include <json-c/json.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

[[noreturn]] void invalid(std::string message) {
    throw std::runtime_error(std::move(message));
}

json_object* field(json_object* object, const char* name) {
    if (!object || json_object_get_type(object) != json_type_object) invalid("transport continuation object expected");
    json_object* value = nullptr;
    return json_object_object_get_ex(object, name, &value) ? value : nullptr;
}

json_object* required(json_object* object, const char* name, json_type type) {
    auto* value = field(object, name);
    if (!value || json_object_get_type(value) != type) invalid(std::string{"transport continuation field has invalid type: "} + name);
    return value;
}

std::string stringField(json_object* object, const char* name) {
    return json_object_get_string(required(object, name, json_type_string));
}

std::uint64_t uintField(json_object* object, const char* name) {
    auto* value = required(object, name, json_type_int);
    const auto number = json_object_get_int64(value);
    if (number < 0) invalid(std::string{"transport continuation field must be non-negative: "} + name);
    return static_cast<std::uint64_t>(number);
}

std::size_t sizeField(json_object* object, const char* name) {
    const auto value = uintField(object, name);
    if (value > std::numeric_limits<std::size_t>::max()) invalid(std::string{"transport continuation field exceeds size_t: "} + name);
    return static_cast<std::size_t>(value);
}

double finiteNonNegativeField(json_object* object, const char* name) {
    auto* value = field(object, name);
    if (!value || (json_object_get_type(value) != json_type_double && json_object_get_type(value) != json_type_int)) {
        invalid(std::string{"transport continuation numeric field has invalid type: "} + name);
    }
    const double number = json_object_get_double(value);
    if (!std::isfinite(number) || number < 0.0) invalid(std::string{"transport continuation field must be finite and non-negative: "} + name);
    return number;
}

bool boolField(json_object* object, const char* name) {
    return json_object_get_boolean(required(object, name, json_type_boolean)) != 0;
}

void validateMode(std::string_view mode) {
    if (mode != "bus" && mode != "brt" && mode != "tram" && mode != "metro") invalid("invalid transport continuation vehicle mode");
}

void validateDirection(std::string_view direction) {
    if (direction != "forward" && direction != "reverse") invalid("invalid transport continuation direction");
}

void validateState(std::string_view state) {
    if (state != "dwell" && state != "moving" && state != "out_of_service") invalid("invalid transport continuation vehicle state");
}

TransitVehicleContinuationV9 parseVehicle(json_object* raw) {
    TransitVehicleContinuationV9 vehicle;
    vehicle.id = stringField(raw, "id");
    vehicle.lineId = stringField(raw, "lineId");
    vehicle.mode = stringField(raw, "mode");
    vehicle.directionKey = stringField(raw, "directionKey");
    vehicle.state = stringField(raw, "state");
    if (vehicle.id.empty() || vehicle.lineId.empty()) invalid("transport continuation vehicle identity must not be empty");
    validateMode(vehicle.mode);
    validateDirection(vehicle.directionKey);
    validateState(vehicle.state);

    auto* roadEdges = required(raw, "roadEdgeIds", json_type_array);
    const auto edgeCount = json_object_array_length(roadEdges);
    vehicle.roadEdgeIds.reserve(edgeCount);
    for (std::size_t index = 0; index < edgeCount; ++index) {
        auto* edge = json_object_array_get_idx(roadEdges, index);
        if (!edge || json_object_get_type(edge) != json_type_string) invalid("invalid transport continuation road edge id");
        std::string id = json_object_get_string(edge);
        if (id.empty()) invalid("transport continuation road edge id must not be empty");
        vehicle.roadEdgeIds.push_back(std::move(id));
    }

    vehicle.currentRoadEdgeIndex = sizeField(raw, "currentRoadEdgeIndex");
    vehicle.edgeProgressTicks = finiteNonNegativeField(raw, "edgeProgressTicks");
    vehicle.dedicatedRemainingTicks = uintField(raw, "dedicatedRemainingTicks");
    vehicle.delayTicks = finiteNonNegativeField(raw, "delayTicks");
    vehicle.inServiceTicks = uintField(raw, "inServiceTicks");
    vehicle.runStartedTick = uintField(raw, "runStartedTick");
    vehicle.hasDepartedOrigin = boolField(raw, "hasDepartedOrigin");

    if (vehicle.roadEdgeIds.empty()) {
        if (vehicle.currentRoadEdgeIndex != 0) invalid("transport continuation empty route must have zero edge index");
    } else if (vehicle.currentRoadEdgeIndex >= vehicle.roadEdgeIds.size()) {
        invalid("transport continuation road edge index out of range");
    }
    if (vehicle.mode == "metro" && !vehicle.roadEdgeIds.empty()) invalid("metro continuation must not contain surface road edges");
    return vehicle;
}

std::string canonicalContinuation(const std::vector<TransitVehicleContinuationV9>& vehicles) {
    std::ostringstream output;
    output << std::setprecision(std::numeric_limits<double>::max_digits10) << "TV9:" << vehicles.size();
    const auto appendString = [&](std::string_view value) { output << ':' << value.size() << '#' << value; };
    for (const auto& vehicle : vehicles) {
        output << "|V";
        appendString(vehicle.id);
        appendString(vehicle.lineId);
        appendString(vehicle.mode);
        appendString(vehicle.directionKey);
        appendString(vehicle.state);
        output << ':' << vehicle.roadEdgeIds.size();
        for (const auto& edge : vehicle.roadEdgeIds) appendString(edge);
        output << ':' << vehicle.currentRoadEdgeIndex
               << ':' << vehicle.edgeProgressTicks
               << ':' << vehicle.dedicatedRemainingTicks
               << ':' << vehicle.delayTicks
               << ':' << vehicle.inServiceTicks
               << ':' << vehicle.runStartedTick
               << ':' << (vehicle.hasDepartedOrigin ? 1 : 0);
    }
    return output.str();
}
} // namespace

Result<TransportationContinuationV9> parseTransportationContinuationV9(std::string_view canonicalSaveJson) {
    if (canonicalSaveJson.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "transport continuation Save V9 JSON exceeds parser size limit"));
    }
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate transport continuation parser"));
    json_object* raw = json_tokener_parse_ex(tokener, canonicalSaveJson.data(), static_cast<int>(canonicalSaveJson.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid transport continuation Save V9 JSON"));
    }

    try {
        TransportationContinuationV9 continuation;
        auto* transit = field(root.get(), "transit");
        if (!transit) {
            continuation.canonical = canonicalContinuation(continuation.vehicles);
            return continuation;
        }
        auto* mobility = required(transit, "mobility", json_type_object);
        auto* vehicles = required(required(mobility, "vehicles", json_type_object), "vehicles", json_type_array);
        const auto count = json_object_array_length(vehicles);
        continuation.vehicles.reserve(count);
        std::set<std::string> ids;
        for (std::size_t index = 0; index < count; ++index) {
            auto* vehicle = json_object_array_get_idx(vehicles, index);
            if (!vehicle || json_object_get_type(vehicle) != json_type_object) invalid("invalid transport continuation vehicle");
            auto parsed = parseVehicle(vehicle);
            if (!ids.insert(parsed.id).second) invalid("duplicate transport continuation vehicle id: " + parsed.id);
            continuation.vehicles.push_back(std::move(parsed));
        }
        std::sort(continuation.vehicles.begin(), continuation.vehicles.end(), [](const auto& left, const auto& right) { return left.id < right.id; });
        continuation.canonical = canonicalContinuation(continuation.vehicles);
        return continuation;
    } catch (const std::exception& exception) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, exception.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "unknown transport continuation hydration failure"));
    }
}

} // namespace civic
