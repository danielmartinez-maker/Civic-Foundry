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

bool hasActiveRenovation(const NativeUrbanAuthority& authority) {
    for (const auto& [_, building] : authority.buildings().buildings()) {
        if (building.status == urban::BuildingStatus::renovation && building.project &&
            building.project->phase == urban::BuildingProjectPhase::fit_out) {
            return true;
        }
    }
    return false;
}
}  // namespace

Result<void> NativeEngine::ensureUrbanScheduler() {
    if (urban_scheduler_configured_) return {};

    auto building_state = scheduler_.registerSystem(SystemDefinition{
        .id = "urban.building-state",
        .cadence = {1, 0},
        .after = {},
        .before = {},
        .reads = {},
        .writes = {"urban.buildings"},
        .order = 100,
        .execute = [this](std::uint64_t tick) -> Result<void> {
            if (!urban_) return {};

            const bool renovation_due = hasActiveRenovation(*urban_);
            const bool lifecycle_due =
                tick % urban::BuildingLifecycleDriver::lifecycle_cadence_ticks == 0;
            if (!renovation_due && !lifecycle_due) return {};

            auto staged = urban_->cloneForTransaction();
            if (!staged) return std::unexpected(staged.error());

            if (renovation_due) {
                auto renovation = (*staged)->tickBuildingRenovations(tick);
                if (!renovation) return renovation;
            }
            if (lifecycle_due) {
                auto lifecycle = (*staged)->tickBuildingLifecycle(tick);
                if (!lifecycle) return lifecycle;
            }

            urban_ = std::move(*staged);
            return {};
        },
    });
    if (!building_state) return building_state;

    auto compiled = scheduler_.compile();
    if (!compiled) return compiled;
    urban_scheduler_configured_ = true;
    return {};
}

Result<void> NativeEngine::loadV9Authoritative(std::string_view json_text) {
    auto parsed = parseSaveV9(json_text);
    if (!parsed) return std::unexpected(parsed.error());

    auto authority = NativeUrbanAuthority::restoreAuthoritativeV9(*parsed);
    if (!authority) return std::unexpected(authority.error());

    auto kernel = loadV9(json_text);
    if (!kernel) return kernel;

    urban_ = std::move(*authority);
    return ensureUrbanScheduler();
}

Result<void> NativeEngine::stageSaveV9Envelope(std::string_view json_text) {
    auto parsed = parseSaveV9(json_text);
    if (!parsed) return std::unexpected(parsed.error());
    loaded_save_ = std::move(*parsed);
    return {};
}

Result<std::string> NativeEngine::saveV9Authoritative() const {
    auto base = saveV9();
    if (!base) return std::unexpected(base.error());
    try {
        auto current = json::parse(*base);
        current["seed"] = seed_;
        current["clock"]["tick"] = clock_.tick();
        current["clock"]["speed"] = static_cast<std::uint32_t>(clock_.speed());
        const auto current_json = current.dump();
        if (!urban_) return current_json;
        return urban_->patchSaveV9(current_json);
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
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
    auto scheduled = ensureUrbanScheduler();
    if (!scheduled) return std::unexpected(scheduled.error());
    return SnapshotBlob{std::move(*snapshot)};
}

Result<SnapshotBlob> NativeEngine::restoreUrbanState(std::string_view snapshot_json) {
    auto dto = urbanDtoFromSnapshot(snapshot_json);
    if (!dto) return std::unexpected(dto.error());
    auto authority = NativeUrbanAuthority::restoreAuthoritativeV9(*dto);
    if (!authority) return std::unexpected(authority.error());
    if (urban_) (*authority)->inheritRuntimeContext(*urban_);
    auto snapshot = (*authority)->snapshotJson();
    if (!snapshot) return std::unexpected(snapshot.error());
    urban_ = std::move(*authority);
    auto scheduled = ensureUrbanScheduler();
    if (!scheduled) return std::unexpected(scheduled.error());
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
    auto staged = urban_->cloneForTransaction();
    if (!staged) return std::unexpected(staged.error());

    Result<std::string> mutation = std::unexpected(make_error(
        ErrorCode::serialization_failure,
        "urban command requires string type"));
    try {
        const auto command = json::parse(request_json.begin(), request_json.end());
        if (!command.is_object() || !command.contains("type") || !command.at("type").is_string()) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "urban command requires string type"));
        }
        const auto type = command.at("type").get<std::string>();
        mutation = type == "buildings.reconcile"
            ? (*staged)->reconcileBuildings(request_json)
            : (*staged)->applyCommand(request_json);
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }

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
        auto scheduled = ensureUrbanScheduler();
        if (!scheduled) return std::unexpected(scheduled.error());
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
