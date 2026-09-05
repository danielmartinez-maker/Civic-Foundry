#include "civic/cadastre/Cadastre.hpp"

namespace civic::cadastre {

civic::core::Result<void> CadastralGraph::register_historical_identity(
    std::string external_id) noexcept {
  try {
    if (external_id.empty()) {
      return std::unexpected(civic::core::error(
          civic::core::ErrorCode::invalid_argument,
          "historical parcel identity must not be empty"));
    }
    const auto id = parcel_id_from_external(external_id);
    if (const auto* existing = find(id); existing != nullptr) {
      if (existing->external_id != external_id) {
        return std::unexpected(civic::core::error(
            civic::core::ErrorCode::conflict,
            "historical parcel identity hash collision"));
      }
      return {};
    }
    if (find_external(external_id) != nullptr) return {};

    Parcel tombstone{};
    tombstone.id = id;
    tombstone.external_id = std::move(external_id);
    tombstone.live = false;
    parcels_.emplace(id, std::move(tombstone));
    ++revision_;
    return {};
  } catch (const std::exception& error) {
    return std::unexpected(civic::core::error(
        civic::core::ErrorCode::internal_error,
        error.what()));
  }
}

}  // namespace civic::cadastre
