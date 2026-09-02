#include "civic/urban/NativeUrbanAuthority.hpp"

#include <nlohmann/json.hpp>

#include <set>
#include <utility>

namespace civic {
namespace {
using json = nlohmann::json;

Error history_error(const core::Error& error) {
  switch (error.code) {
    case core::ErrorCode::none: return make_error(ErrorCode::none, error.message);
    case core::ErrorCode::invalid_argument:
      return make_error(ErrorCode::invalid_argument, error.message);
    case core::ErrorCode::invalid_state:
      return make_error(ErrorCode::invalid_state, error.message);
    case core::ErrorCode::serialization_failure:
      return make_error(ErrorCode::serialization_failure, error.message);
    case core::ErrorCode::invariant_failure:
      return make_error(ErrorCode::invariant_failure, error.message);
    case core::ErrorCode::unsupported_save_version:
      return make_error(ErrorCode::unsupported_save_version, error.message);
    case core::ErrorCode::not_found:
    case core::ErrorCode::conflict:
      return make_error(ErrorCode::invalid_state, error.message);
    case core::ErrorCode::internal_error:
      return make_error(ErrorCode::internal_error, error.message);
  }
  return make_error(ErrorCode::internal_error, error.message);
}

urban::PropertyTransactionPurpose history_purpose(std::string_view value) {
  if (value == "sale") return urban::PropertyTransactionPurpose::sale;
  if (value == "redevelopment") return urban::PropertyTransactionPurpose::redevelopment;
  if (value == "assembly") return urban::PropertyTransactionPurpose::assembly;
  if (value == "renovation") return urban::PropertyTransactionPurpose::renovation;
  throw std::invalid_argument("invalid property transaction purpose: " + std::string(value));
}

Result<urban::PropertyMarketSnapshot> parse_property_history(std::string_view text) {
  try {
    const auto parsed = json::parse(text.begin(), text.end());
    if (!parsed.is_object()) {
      return std::unexpected(make_error(
          ErrorCode::serialization_failure,
          "propertyMarket must be an object"));
    }
    urban::PropertyMarketSnapshot snapshot{};
    for (const auto& raw : parsed.at("holdings")) {
      snapshot.holdings.push_back({
          raw.at("parcelId").get<std::string>(),
          raw.at("ownerId").get<std::string>(),
          raw.at("reservationValue").get<double>(),
      });
    }
    for (const auto& raw : parsed.at("transactions")) {
      snapshot.transactions.push_back({
          raw.at("id").get<std::string>(),
          raw.at("tick").get<std::uint64_t>(),
          raw.at("parcelIds").get<std::vector<std::string>>(),
          raw.at("buyerId").get<std::string>(),
          raw.at("sellerId").get<std::string>(),
          history_purpose(raw.at("purpose").get<std::string>()),
          raw.at("price").get<double>(),
          raw.at("landValue").get<double>(),
          raw.at("improvementValue").get<double>(),
      });
    }
    snapshot.next_transaction_id = parsed.at("nextTransactionId").get<std::uint64_t>();
    return snapshot;
  } catch (const json::exception& error) {
    return std::unexpected(make_error(
        ErrorCode::serialization_failure,
        std::string("invalid propertyMarket: ") + error.what()));
  } catch (const std::exception& error) {
    return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
  }
}
}  // namespace

Result<std::unique_ptr<NativeUrbanAuthority>> NativeUrbanAuthority::restoreAuthoritativeV9(
    const SaveV9Dto& save) {
  auto authority = std::unique_ptr<NativeUrbanAuthority>(new NativeUrbanAuthority());
  if (auto result = authority->restoreCadastre(save.urbanFabric); !result) {
    return std::unexpected(result.error());
  }

  try {
    const auto urban_fabric = json::parse(save.urbanFabric.begin(), save.urbanFabric.end());
    std::set<std::string> existing_lineage_ids;
    for (const auto& event : authority->cadastre_.lineage()) {
      existing_lineage_ids.insert(event.id);
    }

    for (const auto& raw : urban_fabric.at("lineage")) {
      const auto event_id = raw.at("id").get<std::string>();
      if (existing_lineage_ids.contains(event_id)) continue;

      cadastre::LineageEvent event{};
      event.id = event_id;
      event.tick = raw.at("tick").get<std::uint64_t>();
      event.kind = raw.at("kind").get<std::string>();
      for (const auto& raw_id : raw.at("sourceParcelIds")) {
        const auto external_id = raw_id.get<std::string>();
        if (authority->cadastre_.find_external(external_id) == nullptr) {
          auto registered = authority->cadastre_.register_historical_identity(external_id);
          if (!registered) return std::unexpected(history_error(registered.error()));
        }
        event.source_parcel_ids.push_back(cadastre::parcel_id_from_external(external_id));
      }
      for (const auto& raw_id : raw.at("resultingParcelIds")) {
        const auto external_id = raw_id.get<std::string>();
        if (authority->cadastre_.find_external(external_id) == nullptr) {
          auto registered = authority->cadastre_.register_historical_identity(external_id);
          if (!registered) return std::unexpected(history_error(registered.error()));
        }
        event.resulting_parcel_ids.push_back(cadastre::parcel_id_from_external(external_id));
      }
      auto added = authority->cadastre_.append_lineage(std::move(event));
      if (!added) return std::unexpected(history_error(added.error()));
      existing_lineage_ids.insert(event_id);
    }
  } catch (const json::exception& error) {
    return std::unexpected(make_error(
        ErrorCode::serialization_failure,
        std::string("invalid urbanFabric lineage: ") + error.what()));
  } catch (const std::exception& error) {
    return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
  }

  if (auto result = authority->restoreZoning(save.zoningV2); !result) {
    return std::unexpected(result.error());
  }
  if (auto result = authority->restoreBuildings(save.buildingsV2); !result) {
    return std::unexpected(result.error());
  }

  auto property = parse_property_history(save.propertyMarket);
  if (!property) return std::unexpected(property.error());
  auto restored_property = authority->property_.restore_with_cadastre_history(*property);
  if (!restored_property) return std::unexpected(history_error(restored_property.error()));
  return authority;
}

}  // namespace civic
