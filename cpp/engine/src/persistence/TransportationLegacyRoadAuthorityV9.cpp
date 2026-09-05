#include <civic/persistence/TransportationSaveV9.hpp>

#include <json-c/json.h>

#include <limits>
#include <memory>
#include <string>
#include <string_view>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;

transport::RoadClass parseRoadClass(std::string_view value) {
    if (value == "local") return transport::RoadClass::local;
    if (value == "collector") return transport::RoadClass::collector;
    if (value == "arterial") return transport::RoadClass::arterial;
    throw std::runtime_error("unsupported Save V9 road type: " + std::string{value});
}
}

Result<LegacyRoadAuthorityV9> parseLegacyRoadAuthorityV9(std::string_view json) {
    if (json.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "legacy road Save V9 JSON exceeds parser size limit"));
    }
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate legacy road parser"));
    json_object* raw = json_tokener_parse_ex(tokener, json.data(), static_cast<int>(json.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid legacy road Save V9 JSON"));
    }
    try {
        json_object* roads = nullptr;
        if (!json_object_object_get_ex(root.get(), "roads", &roads)) return LegacyRoadAuthorityV9{};
        if (!roads || json_object_get_type(roads) != json_type_object) throw std::runtime_error("Save V9 roads must be an object");
        json_object* revision = nullptr;
        json_object* cells = nullptr;
        if (!json_object_object_get_ex(roads, "revision", &revision) || !revision || json_object_get_type(revision) != json_type_int || json_object_get_int64(revision) < 0) throw std::runtime_error("Save V9 roads.revision must be non-negative integer");
        if (!json_object_object_get_ex(roads, "cells", &cells) || !cells || json_object_get_type(cells) != json_type_array) throw std::runtime_error("Save V9 roads.cells must be an array");
        LegacyRoadAuthorityV9 result;
        result.revision = static_cast<std::uint64_t>(json_object_get_int64(revision));
        result.cells.reserve(json_object_array_length(cells));
        for (std::size_t index = 0; index < json_object_array_length(cells); ++index) {
            auto* cell = json_object_array_get_idx(cells, index);
            if (!cell || json_object_get_type(cell) != json_type_object) throw std::runtime_error("Save V9 road cell must be an object");
            json_object *x = nullptr, *y = nullptr, *type = nullptr;
            if (!json_object_object_get_ex(cell, "x", &x) || !x || json_object_get_type(x) != json_type_int) throw std::runtime_error("Save V9 road cell x must be integer");
            if (!json_object_object_get_ex(cell, "y", &y) || !y || json_object_get_type(y) != json_type_int) throw std::runtime_error("Save V9 road cell y must be integer");
            if (!json_object_object_get_ex(cell, "type", &type) || !type || json_object_get_type(type) != json_type_string) throw std::runtime_error("Save V9 road cell type must be string");
            const auto xv = json_object_get_int64(x);
            const auto yv = json_object_get_int64(y);
            if (xv < std::numeric_limits<int>::min() || xv > std::numeric_limits<int>::max() || yv < std::numeric_limits<int>::min() || yv > std::numeric_limits<int>::max()) throw std::runtime_error("Save V9 road cell coordinate exceeds int range");
            result.cells.push_back({static_cast<int>(xv), static_cast<int>(yv), parseRoadClass(json_object_get_string(type)), false, transport::Direction::forward});
        }
        return result;
    } catch (const std::exception& exception) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, exception.what()));
    }
}

} // namespace civic
