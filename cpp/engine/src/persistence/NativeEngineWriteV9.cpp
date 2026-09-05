#include <civic/persistence/TransportationSaveV9.hpp>

#include <civic/persistence/SaveV9.hpp>

#include <json-c/json.h>

#include <limits>
#include <memory>
#include <string>
#include <string_view>

namespace civic {
namespace {
using JsonPtr = std::unique_ptr<json_object, decltype(&json_object_put)>;
}

Result<std::string> writeNativeEngineV9(
    std::string_view canonicalSaveJson,
    const LegacyRoadAuthorityV9& roads,
    const transport::TransportationSnapshot& transportation,
    std::uint64_t tick,
    std::uint32_t speed) {
    auto transportSave = writeTransportationV9(canonicalSaveJson, roads, transportation);
    if (!transportSave) return std::unexpected(transportSave.error());
    if (tick > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "native clock tick exceeds JSON int64 range"));
    }
    if (speed != 0U && speed != 1U && speed != 2U && speed != 4U) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "native clock speed is invalid"));
    }
    if (transportSave->size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "Save V9 JSON exceeds parser size limit"));
    }
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate Save V9 clock writer parser"));
    json_object* raw = json_tokener_parse_ex(tokener, transportSave->data(), static_cast<int>(transportSave->size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || json_object_get_type(root.get()) != json_type_object) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid Save V9 JSON while writing native clock"));
    }
    json_object* clock = nullptr;
    if (!json_object_object_get_ex(root.get(), "clock", &clock) || !clock || json_object_get_type(clock) != json_type_object) {
        clock = json_object_new_object();
        json_object_object_add(root.get(), "clock", clock);
    }
    json_object_object_add(clock, "tick", json_object_new_int64(static_cast<std::int64_t>(tick)));
    json_object_object_add(clock, "speed", json_object_new_int64(static_cast<std::int64_t>(speed)));
    const std::string rewritten = json_object_to_json_string_ext(root.get(), JSON_C_TO_STRING_PLAIN);
    auto parsed = parseSaveV9(rewritten);
    if (!parsed) return std::unexpected(parsed.error());
    return parsed->canonicalJson;
}

} // namespace civic
