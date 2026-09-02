#include "civic/urban/NativeUrbanAuthority.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace civic {
namespace {
using json = nlohmann::json;

urban::BuildingTypology parse_runtime_typology(const json& value) {
    urban::BuildingTypology typology{};
    typology.id = value.at("id").get<std::string>();
    typology.name = value.value("name", typology.id);
    typology.maintenance_cost_per_m2 = value.at("maintenanceCostPerM2").get<double>();
    typology.complexity_factor = value.at("complexityFactor").get<double>();
    if (typology.id.empty() || !std::isfinite(typology.maintenance_cost_per_m2) ||
        typology.maintenance_cost_per_m2 < 0.0 || !std::isfinite(typology.complexity_factor) ||
        typology.complexity_factor <= 0.0) {
        throw std::invalid_argument("invalid native lifecycle typology runtime input");
    }
    return typology;
}

urban::BuildingLifecycleInput parse_lifecycle_input(const json& value) {
    urban::BuildingLifecycleInput input{};
    input.maintenance_spend = value.at("maintenanceSpend").get<double>();
    input.occupancy_ratio = value.at("occupancyRatio").get<double>();
    input.utilization_ratio = value.at("utilizationRatio").get<double>();
    input.environmental_stress = value.at("environmentalStress").get<double>();
    input.service_stress = value.at("serviceStress").get<double>();
    input.cadence_ticks = urban::BuildingLifecycleDriver::lifecycle_cadence_ticks;
    return input;
}

json committed_building_result() {
    return json{
        {"committed", true},
        {"resultingParcelIds", json::array()},
        {"retiredParcelIds", json::array()},
        {"rejectionReasons", json::array()},
        {"parcelReferenceRewrites", json::object()},
    };
}

}  // namespace

Result<std::string> NativeUrbanAuthority::reconcileBuildings(std::string_view request_json) {
    try {
        auto request = json::parse(request_json.begin(), request_json.end());
        if (!request.is_object() || request.value("type", std::string{}) != "buildings.reconcile") {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "building reconciliation requires buildings.reconcile command"));
        }
        if (!request.contains("buildingsV2") || !request.at("buildingsV2").is_array() ||
            !request.contains("typologies") || !request.at("typologies").is_array() ||
            !request.contains("lifecycleInputs") || !request.at("lifecycleInputs").is_array()) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                "building reconciliation requires buildingsV2, typologies and lifecycleInputs arrays"));
        }

        auto current_text = buildingsJson();
        if (!current_text) return std::unexpected(current_text.error());
        const auto current = json::parse(*current_text);
        std::map<std::string, json> current_by_id;
        for (const auto& building : current) {
            current_by_id.emplace(building.at("id").get<std::string>(), building);
        }

        json merged = json::array();
        std::map<std::string, bool> proposed_ids;
        for (auto proposal : request.at("buildingsV2")) {
            const auto id = proposal.at("id").get<std::string>();
            if (id.empty() || proposed_ids.contains(id)) {
                return std::unexpected(make_error(
                    ErrorCode::invalid_argument,
                    "building reconciliation contains duplicate or empty building id"));
            }
            proposed_ids.emplace(id, true);
            if (const auto existing = current_by_id.find(id); existing != current_by_id.end()) {
                proposal["lifecycle"] = existing->second.at("lifecycle");
                const auto status = existing->second.at("status").get<std::string>();
                if (status == "renovation") {
                    proposal["status"] = existing->second.at("status");
                    if (existing->second.contains("project")) {
                        proposal["project"] = existing->second.at("project");
                    }
                }
            }
            merged.push_back(std::move(proposal));
        }

        auto restored = restoreBuildings(merged.dump());
        if (!restored) return std::unexpected(restored.error());
        auto valid = buildings_.validate();
        if (!valid) return std::unexpected(make_error(valid.error().code, valid.error().message));

        std::map<std::string, urban::BuildingTypology> typologies;
        for (const auto& raw : request.at("typologies")) {
            auto typology = parse_runtime_typology(raw);
            if (!typologies.emplace(typology.id, std::move(typology)).second) {
                return std::unexpected(make_error(
                    ErrorCode::invalid_argument,
                    "duplicate native lifecycle typology runtime input"));
            }
        }

        std::map<std::string, urban::BuildingLifecycleInput> inputs;
        for (const auto& raw : request.at("lifecycleInputs")) {
            const auto building_id = raw.at("buildingId").get<std::string>();
            if (building_id.empty() || !inputs.emplace(building_id, parse_lifecycle_input(raw)).second) {
                return std::unexpected(make_error(
                    ErrorCode::invalid_argument,
                    "duplicate or empty native lifecycle building input"));
            }
        }

        for (const auto& [_, building] : buildings_.buildings()) {
            if ((building.status == urban::BuildingStatus::occupied ||
                 building.status == urban::BuildingStatus::vacant ||
                 building.status == urban::BuildingStatus::abandoned) &&
                (!typologies.contains(building.typology_id) || !inputs.contains(building.external_id))) {
                return std::unexpected(make_error(
                    ErrorCode::invalid_argument,
                    "native lifecycle runtime input missing for active building: " + building.external_id));
            }
        }

        lifecycle_typologies_ = std::move(typologies);
        lifecycle_inputs_ = std::move(inputs);
        return committed_building_result().dump();
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<void> NativeUrbanAuthority::tickBuildingRenovations(std::uint64_t tick) {
    bool active = false;
    for (const auto& [_, building] : buildings_.buildings()) {
        if (building.status == urban::BuildingStatus::renovation && building.project &&
            building.project->phase == urban::BuildingProjectPhase::fit_out) {
            active = true;
            break;
        }
    }
    if (!active) return {};

    urban::RenovationSystem renovation;
    std::vector<urban::BuildingV2> staged;
    staged.reserve(buildings_.buildings().size());
    for (const auto& [_, building] : buildings_.buildings()) {
        auto next = renovation.tick(building, tick);
        if (!next) return std::unexpected(make_error(next.error().code, next.error().message));
        staged.push_back(std::move(*next));
    }
    auto restored = buildings_.restore_buildings(staged);
    if (!restored) return std::unexpected(make_error(restored.error().code, restored.error().message));
    return {};
}

Result<void> NativeUrbanAuthority::tickBuildingLifecycle(std::uint64_t) {
    if (lifecycle_typologies_.empty() && lifecycle_inputs_.empty()) return {};

    urban::BuildingLifecycleSystem lifecycle;
    std::vector<urban::BuildingV2> staged;
    staged.reserve(buildings_.buildings().size());
    for (const auto& [_, building] : buildings_.buildings()) {
        urban::BuildingV2 next = building;
        if (building.status == urban::BuildingStatus::occupied ||
            building.status == urban::BuildingStatus::vacant ||
            building.status == urban::BuildingStatus::abandoned) {
            const auto typology = lifecycle_typologies_.find(building.typology_id);
            const auto input = lifecycle_inputs_.find(building.external_id);
            if (typology == lifecycle_typologies_.end() || input == lifecycle_inputs_.end()) {
                return std::unexpected(make_error(
                    ErrorCode::invalid_state,
                    "native lifecycle runtime context disappeared for building: " + building.external_id));
            }
            auto state = lifecycle.tick(building, typology->second, input->second);
            if (!state) return std::unexpected(make_error(state.error().code, state.error().message));
            next.lifecycle = *state;
        }
        staged.push_back(std::move(next));
    }
    auto restored = buildings_.restore_buildings(staged);
    if (!restored) return std::unexpected(make_error(restored.error().code, restored.error().message));
    return {};
}

}  // namespace civic
