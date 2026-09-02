#pragma once

#include "SaveV9Json.hpp"

namespace civic::save_v9_detail {
inline Result<void> validateEconomyState(json_object* root) {
    json_object* economy = nullptr;
    if (!json_object_object_get_ex(root, "economyDomain", &economy) || !isObject(economy)) return {};
    auto inventories = requireField(economy, "inventories", json_type_object); if (!inventories) return std::unexpected(inventories.error());
    auto records = requireField(*inventories, "records", json_type_array); if (!records) return std::unexpected(records.error());
    auto cargo = requireField(*inventories, "cargo", json_type_array); if (!cargo) return std::unexpected(cargo.error());
    auto financials = requireField(economy, "financials", json_type_array); if (!financials) return std::unexpected(financials.error());

    std::set<std::string, std::less<>> inventory_keys;
    for (std::size_t index = 0; index < json_object_array_length(*records); ++index) {
        auto* row = json_object_array_get_idx(*records, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, "economy inventory record must be an object"));
        auto firm = requireStringField(row, "firmId", "economy inventory firmId"); if (!firm) return std::unexpected(firm.error());
        auto commodity = requireStringField(row, "commodity", "economy inventory commodity"); if (!commodity) return std::unexpected(commodity.error());
        const std::string key = *firm + "|" + *commodity;
        if (!inventory_keys.insert(key).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate economy inventory record: " + key));
    }

    std::set<std::string, std::less<>> shipment_ids;
    for (std::size_t index = 0; index < json_object_array_length(*cargo); ++index) {
        auto* row = json_object_array_get_idx(*cargo, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, "economy cargo row must be an object"));
        auto token = requireField(row, "token", json_type_object); if (!token) return std::unexpected(token.error());
        auto shipment = requireStringField(*token, "shipmentId", "economy cargo shipmentId"); if (!shipment) return std::unexpected(shipment.error());
        if (!shipment_ids.insert(*shipment).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate economy cargo shipment: " + *shipment));
    }

    std::set<std::string, std::less<>> firm_ids;
    for (std::size_t index = 0; index < json_object_array_length(*financials); ++index) {
        auto* row = json_object_array_get_idx(*financials, index);
        if (!isObject(row)) return std::unexpected(make_error(ErrorCode::serialization_failure, "economy financial row must be an object"));
        auto firm = requireStringField(row, "firmId", "economy financial firmId"); if (!firm) return std::unexpected(firm.error());
        if (!firm_ids.insert(*firm).second) return std::unexpected(make_error(ErrorCode::serialization_failure, "duplicate economy financial firm reference: " + *firm));
    }
    return {};
}
} // namespace civic::save_v9_detail
