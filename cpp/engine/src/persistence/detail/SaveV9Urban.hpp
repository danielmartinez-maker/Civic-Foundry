#pragma once

#include "SaveV9Json.hpp"

namespace civic::save_v9_detail {
inline Result<void> validateParcelKeyArray(json_object* array, const char* key, std::string_view label) {
    std::set<std::string, std::less<>> ids;
    for (std::size_t index = 0; index < json_object_array_length(array); ++index) {
        auto* row = json_object_array_get_idx(array, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{label} + " row must be an object"));
        auto id = requireStringField(row, key, std::string{label} + " " + key); if (!id) return std::unexpected(id.error());
        if (!ids.insert(*id).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate " + std::string{label} + ": " + *id));
    }
    return {};
}

inline Result<void> validateV9Shapes(json_object* root) {
    auto urban = requireField(root, "urbanFabric", json_type_object); if (!urban) return std::unexpected(urban.error());
    auto parcels = requireField(*urban, "parcels", json_type_array); if (!parcels) return std::unexpected(parcels.error());
    auto zoning = requireField(root, "zoningV2", json_type_object); if (!zoning) return std::unexpected(zoning.error());
    auto assignments = requireField(*zoning, "parcelAssignments", json_type_array); if (!assignments) return std::unexpected(assignments.error());
    auto buildings = requireField(root, "buildingsV2", json_type_array); if (!buildings) return std::unexpected(buildings.error());
    auto property = requireField(root, "propertyMarket", json_type_object); if (!property) return std::unexpected(property.error());
    auto holdings = requireField(*property, "holdings", json_type_array); if (!holdings) return std::unexpected(holdings.error());
    auto transactions = requireField(*property, "transactions", json_type_array); if (!transactions) return std::unexpected(transactions.error());

    std::set<std::string, std::less<>> live_parcels;
    for (std::size_t index = 0; index < json_object_array_length(*parcels); ++index) {
        auto* parcel = json_object_array_get_idx(*parcels, index);
        if (!isObject(parcel)) return std::unexpected(make_error(ErrorCode::serialization_failure, "urbanFabric parcel must be an object"));
        auto id = requireStringField(parcel, "id", "urbanFabric parcel id"); if (!id) return std::unexpected(id.error());
        live_parcels.insert(*id);
    }

    std::set<std::string, std::less<>> historical_parcels;
    json_object* lineage = nullptr;
    if (json_object_object_get_ex(*urban, "lineage", &lineage)) {
        if (!isArray(lineage)) return std::unexpected(make_error(ErrorCode::serialization_failure, "urbanFabric.lineage must be an array"));
        for (std::size_t index = 0; index < json_object_array_length(lineage); ++index) {
            auto* event = json_object_array_get_idx(lineage, index);
            if (!isObject(event)) return std::unexpected(make_error(ErrorCode::serialization_failure, "cadastral lineage event must be an object"));
            json_object* sources = nullptr;
            if (!json_object_object_get_ex(event, "sourceParcelIds", &sources) || !isArray(sources)) continue;
            for (std::size_t source_index = 0; source_index < json_object_array_length(sources); ++source_index) {
                auto* source = json_object_array_get_idx(sources, source_index);
                if (!source || json_object_get_type(source) != json_type_string || !nonBlank(json_object_get_string(source))) return std::unexpected(make_error(ErrorCode::serialization_failure, "cadastral lineage contains invalid source parcel id"));
                historical_parcels.insert(json_object_get_string(source));
            }
        }
    }

    auto result = validateParcelKeyArray(*assignments, "parcelId", "parcel zoning assignment"); if (!result) return result;
    result = validateParcelKeyArray(*holdings, "parcelId", "property holding"); if (!result) return result;
    auto requireLive = [&](std::string_view parcel_id, std::string_view source) -> Result<void> {
        if (!live_parcels.contains(std::string{parcel_id})) return std::unexpected(make_error(ErrorCode::serialization_failure, std::string{source} + " references missing parcel: " + std::string{parcel_id}));
        return {};
    };

    for (std::size_t index = 0; index < json_object_array_length(*assignments); ++index) {
        auto* row = json_object_array_get_idx(*assignments, index);
        auto id = requireStringField(row, "parcelId", "zoning assignment parcelId"); if (!id) return std::unexpected(id.error());
        result = requireLive(*id, "zoning assignment"); if (!result) return result;
    }
    for (std::size_t index = 0; index < json_object_array_length(*holdings); ++index) {
        auto* row = json_object_array_get_idx(*holdings, index);
        auto id = requireStringField(row, "parcelId", "property holding parcelId"); if (!id) return std::unexpected(id.error());
        result = requireLive(*id, "property holding"); if (!result) return result;
    }
    for (std::size_t index = 0; index < json_object_array_length(*buildings); ++index) {
        auto* building = json_object_array_get_idx(*buildings, index);
        if (!isObject(building)) return std::unexpected(make_error(ErrorCode::serialization_failure, "canonical building must be an object"));
        json_object* parcel_ids = nullptr;
        if (!json_object_object_get_ex(building, "parcelIds", &parcel_ids) || !isArray(parcel_ids) || json_object_array_length(parcel_ids) == 0) return std::unexpected(make_error(ErrorCode::serialization_failure, "canonical building must reference at least one parcel"));
        std::set<std::string, std::less<>> seen;
        for (std::size_t ref_index = 0; ref_index < json_object_array_length(parcel_ids); ++ref_index) {
            auto* raw = json_object_array_get_idx(parcel_ids, ref_index);
            if (!raw || json_object_get_type(raw) != json_type_string || !nonBlank(json_object_get_string(raw))) return std::unexpected(make_error(ErrorCode::serialization_failure, "canonical building has invalid parcel id"));
            const std::string id = json_object_get_string(raw);
            if (!seen.insert(id).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "canonical building contains duplicate parcel id"));
            result = requireLive(id, "canonical building"); if (!result) return result;
        }
    }
    for (std::size_t index = 0; index < json_object_array_length(*transactions); ++index) {
        auto* transaction = json_object_array_get_idx(*transactions, index);
        if (!isObject(transaction)) return std::unexpected(make_error(ErrorCode::serialization_failure, "property transaction must be an object"));
        json_object* parcel_ids = nullptr;
        if (!json_object_object_get_ex(transaction, "parcelIds", &parcel_ids) || !isArray(parcel_ids)) continue;
        for (std::size_t ref_index = 0; ref_index < json_object_array_length(parcel_ids); ++ref_index) {
            auto* raw = json_object_array_get_idx(parcel_ids, ref_index);
            if (!raw || json_object_get_type(raw) != json_type_string || !nonBlank(json_object_get_string(raw))) return std::unexpected(make_error(ErrorCode::serialization_failure, "property transaction has invalid parcel id"));
            const std::string id = json_object_get_string(raw);
            if (!live_parcels.contains(id) && !historical_parcels.contains(id)) return std::unexpected(make_error(ErrorCode::serialization_failure, "property transaction references unknown parcel history: " + id));
        }
    }
    return {};
}

inline Result<std::string> inheritedV8Canonical(json_object* root) {
    JsonPtr copy{json_tokener_parse(json_object_to_json_string_ext(root, JSON_C_TO_STRING_PLAIN)), json_object_put};
    if (!copy) return std::unexpected(make_error(ErrorCode::serialization_failure, "failed to copy save"));
    json_object_object_del(copy.get(), "urbanFabric");
    json_object_object_del(copy.get(), "zoningV2");
    json_object_object_del(copy.get(), "buildingsV2");
    json_object_object_del(copy.get(), "propertyMarket");
    json_object_object_add(copy.get(), "saveVersion", json_object_new_int(8));
    json_object_object_add(copy.get(), "gameVersion", json_object_new_string("0.8.0-world-foundation"));
    return canonical(copy.get());
}
} // namespace civic::save_v9_detail
