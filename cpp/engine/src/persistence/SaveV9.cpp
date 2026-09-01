#include <civic/persistence/SaveV9.hpp>

#include "detail/SaveV9Economy.hpp"
#include "detail/SaveV9Transit.hpp"
#include "detail/SaveV9Urban.hpp"

#include <json-c/json.h>

#include <limits>

namespace civic {
Result<SaveV9Dto> parseSaveV9(std::string_view json) {
    using namespace save_v9_detail;
    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected(make_error(ErrorCode::internal_error, "failed to allocate JSON parser"));
    json_object* raw = json_tokener_parse_ex(tokener, json.data(), static_cast<int>(json.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    JsonPtr root{raw, json_object_put};
    if (error != json_tokener_success || !root || !isObject(root.get())) return std::unexpected(make_error(ErrorCode::serialization_failure, "save must be valid JSON object"));

    json_object* save_version = nullptr;
    if (!json_object_object_get_ex(root.get(), "saveVersion", &save_version) || !save_version || json_object_get_type(save_version) != json_type_int || json_object_get_int64(save_version) != 9) {
        return std::unexpected(make_error(ErrorCode::unsupported_save_version, "native bridge accepts Save V9 only"));
    }
    json_object* game_version = nullptr;
    if (!json_object_object_get_ex(root.get(), "gameVersion", &game_version) || !game_version || json_object_get_type(game_version) != json_type_string || std::string_view{json_object_get_string(game_version)} != "0.9.0-urban-fabric") {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "invalid V9 game version"));
    }

    auto recursive = validateRecursive(root.get(), "save"); if (!recursive) return std::unexpected(recursive.error());
    auto transit = validateTransitState(root.get()); if (!transit) return std::unexpected(transit.error());
    auto economy = validateEconomyState(root.get()); if (!economy) return std::unexpected(economy.error());
    auto shapes = validateV9Shapes(root.get()); if (!shapes) return std::unexpected(shapes.error());

    auto seed_field = requireField(root.get(), "seed", json_type_int); if (!seed_field) return std::unexpected(seed_field.error());
    const auto seed = json_object_get_int64(*seed_field);
    if (seed < 0 || seed > std::numeric_limits<std::uint32_t>::max()) return std::unexpected(make_error(ErrorCode::serialization_failure, "seed must be uint32"));
    auto clock = requireField(root.get(), "clock", json_type_object); if (!clock) return std::unexpected(clock.error());
    auto tick_field = requireField(*clock, "tick", json_type_int); if (!tick_field) return std::unexpected(tick_field.error());
    const auto tick = json_object_get_int64(*tick_field);
    if (tick < 0) return std::unexpected(make_error(ErrorCode::serialization_failure, "clock.tick must be non-negative"));
    auto speed_field = requireField(*clock, "speed", json_type_int); if (!speed_field) return std::unexpected(speed_field.error());
    const auto speed = json_object_get_int64(*speed_field);
    if (speed < 0 || !validSpeed(static_cast<std::uint32_t>(speed))) return std::unexpected(make_error(ErrorCode::serialization_failure, "clock.speed must be one of 0, 1, 2, 4"));

    json_object* urban = nullptr; json_object_object_get_ex(root.get(), "urbanFabric", &urban);
    json_object* zoning = nullptr; json_object_object_get_ex(root.get(), "zoningV2", &zoning);
    json_object* buildings = nullptr; json_object_object_get_ex(root.get(), "buildingsV2", &buildings);
    json_object* property = nullptr; json_object_object_get_ex(root.get(), "propertyMarket", &property);
    auto full = canonical(root.get()); if (!full) return std::unexpected(full.error());
    auto inherited = inheritedV8Canonical(root.get()); if (!inherited) return std::unexpected(inherited.error());
    auto urban_text = canonical(urban); if (!urban_text) return std::unexpected(urban_text.error());
    auto zoning_text = canonical(zoning); if (!zoning_text) return std::unexpected(zoning_text.error());
    auto buildings_text = canonical(buildings); if (!buildings_text) return std::unexpected(buildings_text.error());
    auto property_text = canonical(property); if (!property_text) return std::unexpected(property_text.error());

    return SaveV9Dto{
        9,
        "0.9.0-urban-fabric",
        static_cast<std::uint32_t>(seed),
        static_cast<std::uint64_t>(tick),
        static_cast<SpeedMode>(static_cast<std::uint32_t>(speed)),
        std::move(*inherited),
        std::move(*urban_text),
        std::move(*zoning_text),
        std::move(*buildings_text),
        std::move(*property_text),
        std::move(*full),
    };
}
} // namespace civic
