#include <civic/transport/TransportationCommands.hpp>

#include <json-c/json.h>

#include <algorithm>
#include <cstring>
#include <limits>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

std::string payloadText(const CommandEnvelope& command) {
    return std::string(reinterpret_cast<const char*>(command.payload.data()), command.payload.size());
}

bool onlyWhitespace(std::string_view text, std::size_t offset) {
    if (offset > text.size()) return false;
    for (std::size_t index = offset; index < text.size(); ++index) {
        const char ch = text[index];
        if (ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n') return false;
    }
    return true;
}

Result<JsonPtr> parseObject(const CommandEnvelope& command) {
    const auto text = payloadText(command);
    if (text.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "transport command payload exceeds parser size limit"));
    }
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate transport command parser"));
    json_object* raw = json_tokener_parse_ex(tokener, text.data(), static_cast<int>(text.size()));
    const auto error = json_tokener_get_error(tokener);
    const auto parseEnd = json_tokener_get_parse_end(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object || !onlyWhitespace(text, parseEnd)) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "transport command payload must be one complete JSON object"));
    }
    return root;
}

json_object* field(json_object* root, const char* name) {
    json_object* value = nullptr;
    return json_object_object_get_ex(root, name, &value) ? value : nullptr;
}

Result<std::string> stringField(json_object* root, const char* name) {
    auto* value = field(root, name);
    if (!value || json_object_get_type(value) != json_type_string || std::string_view{json_object_get_string(value)}.empty()) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, std::string{"transport command field must be non-empty string: "} + name));
    }
    return std::string{json_object_get_string(value)};
}

Result<std::uint64_t> uintField(json_object* root, const char* name) {
    auto* value = field(root, name);
    if (!value || json_object_get_type(value) != json_type_int || json_object_get_int64(value) < 0) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, std::string{"transport command field must be non-negative integer: "} + name));
    }
    return static_cast<std::uint64_t>(json_object_get_int64(value));
}

Result<bool> boolField(json_object* root, const char* name) {
    auto* value = field(root, name);
    if (!value || json_object_get_type(value) != json_type_boolean) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, std::string{"transport command field must be boolean: "} + name));
    }
    return json_object_get_boolean(value) != 0;
}

Result<transport::RoadClass> roadClass(std::string_view value) {
    if (value == "local") return transport::RoadClass::local;
    if (value == "collector") return transport::RoadClass::collector;
    if (value == "arterial") return transport::RoadClass::arterial;
    return std::unexpected(make_error(ErrorCode::invalid_argument, "legacy road command supports local, collector, or arterial"));
}

Result<void> replaceLegacyRoads(transport::TransportationAuthority& authority, LegacyRoadAuthorityV9& legacyRoads, json_object* root) {
    auto revision = uintField(root, "revision");
    if (!revision) return std::unexpected(revision.error());
    auto* cells = field(root, "cells");
    if (!cells || json_object_get_type(cells) != json_type_array) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "transport road replacement requires cells array"));
    }
    std::vector<transport::LegacyRoadCell> nextCells;
    nextCells.reserve(json_object_array_length(cells));
    std::set<std::pair<int, int>> coordinates;
    for (std::size_t index = 0; index < json_object_array_length(cells); ++index) {
        auto* row = json_object_array_get_idx(cells, index);
        if (!row || json_object_get_type(row) != json_type_object) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "transport road cell must be an object"));
        }
        auto* x = field(row, "x");
        auto* y = field(row, "y");
        auto roadClassName = stringField(row, "roadClass");
        if (!x || !y || json_object_get_type(x) != json_type_int || json_object_get_type(y) != json_type_int || !roadClassName) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "transport road cell requires integer x/y and roadClass"));
        }
        const auto x64 = json_object_get_int64(x);
        const auto y64 = json_object_get_int64(y);
        if (x64 < std::numeric_limits<int>::min() || x64 > std::numeric_limits<int>::max() || y64 < std::numeric_limits<int>::min() || y64 > std::numeric_limits<int>::max()) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "transport road coordinate exceeds int range"));
        }
        auto parsedClass = roadClass(*roadClassName);
        if (!parsedClass) return std::unexpected(parsedClass.error());
        const auto coordinate = std::pair{static_cast<int>(x64), static_cast<int>(y64)};
        if (!coordinates.insert(coordinate).second) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "transport road replacement contains duplicate coordinate"));
        }
        nextCells.push_back({coordinate.first, coordinate.second, *parsedClass, false, transport::Direction::forward});
    }
    std::ranges::sort(nextCells, [](const auto& left, const auto& right) {
        return left.y < right.y || (left.y == right.y && left.x < right.x);
    });
    transport::TransportationAuthority candidate = authority;
    try {
        candidate.load_network(transport::LegacyRoadAdapter{}.project(nextCells, *revision));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_state, error.what()));
    }
    authority = std::move(candidate);
    legacyRoads.revision = *revision;
    legacyRoads.cells = std::move(nextCells);
    return {};
}

} // namespace

Result<bool> applyTransportationCommand(transport::TransportationAuthority& authority, LegacyRoadAuthorityV9& legacyRoads, const CommandEnvelope& command) {
    if (!command.type.starts_with("transport.")) return false;
    auto payload = parseObject(command);
    if (!payload) return std::unexpected(payload.error());

    if (command.type == "transport.legacy_roads.replace") {
        auto result = replaceLegacyRoads(authority, legacyRoads, payload->get());
        if (!result) return std::unexpected(result.error());
        return true;
    }
    if (command.type == "transport.lane.set_open") {
        auto laneId = stringField(payload->get(), "laneId");
        auto open = boolField(payload->get(), "open");
        if (!laneId) return std::unexpected(laneId.error());
        if (!open) return std::unexpected(open.error());
        try {
            const auto changed = authority.network().set_lane_open(transport::LaneId{*laneId}, *open);
            if (!changed.changed && !changed.reason.empty()) return std::unexpected(make_error(ErrorCode::invalid_argument, changed.reason));
        } catch (const std::exception& error) {
            return std::unexpected(make_error(ErrorCode::invalid_state, error.what()));
        }
        return true;
    }
    if (command.type == "transport.movement.set_allowed") {
        auto movementId = stringField(payload->get(), "movementId");
        auto allowed = boolField(payload->get(), "allowed");
        if (!movementId) return std::unexpected(movementId.error());
        if (!allowed) return std::unexpected(allowed.error());
        try {
            const auto changed = authority.network().set_movement_allowed(transport::MovementId{*movementId}, *allowed);
            if (!changed.changed && !changed.reason.empty()) return std::unexpected(make_error(ErrorCode::invalid_argument, changed.reason));
        } catch (const std::exception& error) {
            return std::unexpected(make_error(ErrorCode::invalid_state, error.what()));
        }
        return true;
    }
    return std::unexpected(make_error(ErrorCode::invalid_argument, "unknown transportation command: " + command.type));
}

} // namespace civic
