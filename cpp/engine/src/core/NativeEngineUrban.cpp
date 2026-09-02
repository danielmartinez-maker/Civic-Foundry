#include <civic/core/NativeEngine.hpp>

#include <nlohmann/json.hpp>

#include <utility>

namespace civic {
namespace {
using json = nlohmann::json;

Result<SaveV9Dto> urbanDtoFromSnapshot(std::string_view snapshot_json) {
    if (snapshot_json.empty()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "urban snapshot must not be empty"));
    }
    try {
        const auto root = json::parse(snapshot_json.begin(), snapshot_json.end());
        if (!root.is_object()) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, "urban snapshot must be an object"));
        }
        for (const auto* key : {"urbanFabric", "zoningV2", "buildingsV2", "propertyMarket"}) {
            if (!root.contains(key)) {
                return std::unexpected(make_error(
                    ErrorCode::serialization_failure,
                    std::string("urban snapshot missing ") + key));
            }
        }
        SaveV9Dto dto{};
        dto.urbanFabric = root.at("urbanFabric").dump();
        dto.zoningV2 = root.at("zoningV2").dump();
        dto.buildingsV2 = root.at("buildingsV2").dump();
        dto.propertyMarket = root.at("propertyMarket").dump();
        return dto;
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string("urban snapshot is invalid JSON: ") + error.what()));
    }
}

json rejectedMutation(std::string reason) {
    return json{
        {"committed", false},
        {"resultingParcelIds", json::array()},
        {"retiredParcelIds", json::array()},
        {"rejectionReasons", json::array({std::move(reason)})},
        {"parcelReferenceRewrites", json::object()},
    };
}
}  // namespace

Result<void> NativeEngine::loadV9Authoritative(std::string_view json_text) {
    auto parsed = parseSaveV9(json_text);
    if (!parsed) return std::unexpected(parsed.error());

    auto authority = NativeUrbanAuthority::restoreAuthoritativeV9(*parsed);
    if (!authority) return std::unexpected(authority.error());

    auto kernel = loadV9(json_text);
    if (!kernel) return kernel;

    urban_ = std::move(*authority);
    return {};
}

Result<std::string> NativeEngine::saveV9Authoritative() const {
    auto base = saveV9();
    if (!base) return std::unexpected(base.error());
    if (!urban_) return base;
    return urban_->patchSaveV9(*base);
}

Result<DomainHash> NativeEngine::authoritativeDomainHash(std::string_view domain) const {
    if (domain == "cadastre") {
        if (!urban_) return DomainHash{DomainOwnership::unowned, 1, 0};
        return DomainHash{DomainOwnership::owned, 1, urban_->cadastreHash()};
    }
    if (domain == "buildings" || domain == "zoning" || domain == "property") {
        if (!urban_) return DomainHash{DomainOwnership::unowned, 1, 0};
        return DomainHash{DomainOwnership::owned, 1, urban_->urbanHash()};
    }
    return domainHash(domain);
}

Result<SnapshotBlob> NativeEngine::rebuildUrbanLegacy(std::string_view request_json) {
    if (urban_) {
        auto snapshot = urban_->rebuildLegacyPreservingAuthority(request_json);
        if (!snapshot) return std::unexpected(snapshot.error());
        return SnapshotBlob{std::move(*snapshot)};
    }

    auto authority = NativeUrbanAuthority::rebuildLegacy(request_json);
    if (!authority) return std::unexpected(authority.error());
    auto snapshot = (*authority)->snapshotJson();
    if (!snapshot) return std::unexpected(snapshot.error());
    urban_ = std::move(*authority);
    return SnapshotBlob{std::move(*snapshot)};
}

Result<SnapshotBlob> NativeEngine::restoreUrbanState(std::string_view snapshot_json) {
    auto dto = urbanDtoFromSnapshot(snapshot_json);
    if (!dto) return std::unexpected(dto.error());
    auto authority = NativeUrbanAuthority::restoreAuthoritativeV9(*dto);
    if (!authority) return std::unexpected(authority.error());
    auto snapshot = (*authority)->snapshotJson();
    if (!snapshot) return std::unexpected(snapshot.error());
    urban_ = std::move(*authority);
    return SnapshotBlob{std::move(*snapshot)};
}

Result<SnapshotBlob> NativeEngine::applyUrbanCommand(std::string_view request_json) {
    if (!urban_) {
        return std::unexpected(make_error(
            ErrorCode::invalid_state,
            "native urban authority is not initialized"));
    }

    auto current_snapshot = urban_->snapshotJson();
    if (!current_snapshot) return std::unexpected(current_snapshot.error());
    auto dto = urbanDtoFromSnapshot(*current_snapshot);
    if (!dto) return std::unexpected(dto.error());
    auto staged = NativeUrbanAuthority::restoreAuthoritativeV9(*dto);
    if (!staged) return std::unexpected(staged.error());

    auto mutation = (*staged)->applyCommand(request_json);
    if (!mutation) {
        try {
            return SnapshotBlob{json{
                {"result", rejectedMutation(mutation.error().message)},
                {"snapshot", json::parse(*current_snapshot)},
            }.dump()};
        } catch (const json::exception& error) {
            return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
        }
    }

    auto staged_snapshot = (*staged)->snapshotJson();
    if (!staged_snapshot) return std::unexpected(staged_snapshot.error());
    try {
        auto response = json{
            {"result", json::parse(*mutation)},
            {"snapshot", json::parse(*staged_snapshot)},
        }.dump();
        urban_ = std::move(*staged);
        return SnapshotBlob{std::move(response)};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<SnapshotBlob> NativeEngine::urbanSnapshot() const {
    if (!urban_) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "native urban authority is not initialized"));
    }
    auto snapshot = urban_->snapshotJson();
    if (!snapshot) return std::unexpected(snapshot.error());
    return SnapshotBlob{std::move(*snapshot)};
}

}  // namespace civic
