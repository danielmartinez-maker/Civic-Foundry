#include "civic/urban/NativeUrbanAuthority.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace civic {
namespace {
using civic::core::ParcelId;

bool same_geometry(const geometry::Polygon& left, const geometry::Polygon& right) {
    auto a = geometry::canonicalize(left);
    auto b = geometry::canonicalize(right);
    return a && b && a->vertices == b->vertices;
}

std::vector<urban::ParcelZoningAssignment> zoning_snapshot(const urban::ZoningStore& zoning) {
    std::vector<urban::ParcelZoningAssignment> output;
    output.reserve(zoning.assignments().size());
    for (const auto& [_, assignment] : zoning.assignments()) output.push_back(assignment);
    return output;
}

std::vector<urban::BuildingV2> building_snapshot(const urban::UrbanFabricStore& buildings) {
    std::vector<urban::BuildingV2> output;
    output.reserve(buildings.buildings().size());
    for (const auto& [_, building] : buildings.buildings()) output.push_back(building);
    return output;
}

std::uint64_t next_lineage_tick(const cadastre::CadastralGraph& graph) {
    std::uint64_t tick = 0;
    for (const auto& event : graph.lineage()) tick = std::max(tick, event.tick);
    return tick + 1U;
}

std::string next_lineage_id(const cadastre::CadastralGraph& graph) {
    std::set<std::string> existing;
    for (const auto& event : graph.lineage()) existing.insert(event.id);
    for (std::uint64_t sequence = graph.lineage().size() + 1U;; ++sequence) {
        auto id = "legacy-boundary-adjustment:" + std::to_string(sequence);
        if (!existing.contains(id)) return id;
    }
}

}  // namespace

Result<std::string> NativeUrbanAuthority::rebuildLegacyPreservingAuthority(
    std::string_view request_json) {
    auto generated = NativeUrbanAuthority::rebuildLegacy(request_json);
    if (!generated) return std::unexpected(generated.error());

    const auto original_zoning = zoning_snapshot(zoning_);
    const auto original_buildings = building_snapshot(buildings_);
    const auto original_property = property_.snapshot();

    std::set<ParcelId> protected_ids;
    for (const auto& assignment : original_zoning) protected_ids.insert(assignment.parcel_id);
    for (const auto& building : original_buildings) {
        protected_ids.insert(building.parcel_ids.begin(), building.parcel_ids.end());
    }
    for (const auto& holding : original_property.holdings) {
        if (const auto* parcel = cadastre_.find_external(holding.parcel_id)) {
            protected_ids.insert(parcel->id);
        }
    }
    for (const auto& [_, easement] : cadastre_.easements()) {
        protected_ids.insert(easement.parcel_ids.begin(), easement.parcel_ids.end());
    }

    const auto old_live = cadastre_.live_parcels();
    const auto candidate_live = (*generated)->cadastre_.live_parcels();
    std::map<ParcelId, ParcelId> candidate_to_old;
    std::set<ParcelId> matched_old;

    for (const auto* candidate : candidate_live) {
        const auto match = std::find_if(old_live.begin(), old_live.end(), [&](const auto* old) {
            return !matched_old.contains(old->id) && same_geometry(old->boundary, candidate->boundary);
        });
        if (match == old_live.end()) continue;
        candidate_to_old.emplace(candidate->id, (*match)->id);
        matched_old.insert((*match)->id);
    }

    for (const auto protected_id : protected_ids) {
        if (!matched_old.contains(protected_id)) {
            return std::unexpected(make_error(
                ErrorCode::conflict,
                "protected-parcel-topology-change"));
        }
    }

    cadastre::CadastralGraph reconciled;
    std::map<ParcelId, ParcelId> candidate_to_reconciled;
    std::set<std::string> used_external_ids;
    for (const auto& [_, old] : cadastre_.parcels()) {
        used_external_ids.insert(old.external_id);
    }

    std::uint64_t generated_sequence = cadastre_.lineage().size() + 1U;
    for (const auto* candidate : candidate_live) {
        auto parcel = *candidate;
        if (const auto match = candidate_to_old.find(candidate->id); match != candidate_to_old.end()) {
            const auto* old = cadastre_.find(match->second);
            if (!old) {
                return std::unexpected(make_error(
                    ErrorCode::invariant_failure,
                    "matched legacy parcel disappeared"));
            }
            parcel.id = old->id;
            parcel.external_id = old->external_id;
            parcel.owner_id = old->owner_id;
            parcel.historical_parent_ids = old->historical_parent_ids;
        } else if (cadastre_.find_external(parcel.external_id) != nullptr) {
            std::string external;
            do {
                external = "legacy-parcel:" + std::to_string(generated_sequence++) + ":" + parcel.external_id;
            } while (used_external_ids.contains(external));
            parcel.external_id = std::move(external);
            parcel.id = cadastre::parcel_id_from_external(parcel.external_id);
        }
        used_external_ids.insert(parcel.external_id);
        candidate_to_reconciled.emplace(candidate->id, parcel.id);
        auto inserted = reconciled.insert(std::move(parcel));
        if (!inserted) return std::unexpected(make_error(inserted.error().code, inserted.error().message));
    }

    for (const auto& [_, old] : cadastre_.parcels()) {
        if (old.live && matched_old.contains(old.id)) continue;
        auto registered = reconciled.register_historical_identity(old.external_id);
        if (!registered) {
            return std::unexpected(make_error(registered.error().code, registered.error().message));
        }
    }

    for (const auto& event : cadastre_.lineage()) {
        auto appended = reconciled.append_lineage(event);
        if (!appended) return std::unexpected(make_error(appended.error().code, appended.error().message));
    }

    std::vector<ParcelId> retired;
    for (const auto* old : old_live) {
        if (!matched_old.contains(old->id)) retired.push_back(old->id);
    }
    std::vector<ParcelId> resulting;
    for (const auto* candidate : candidate_live) {
        if (!candidate_to_old.contains(candidate->id)) {
            resulting.push_back(candidate_to_reconciled.at(candidate->id));
        }
    }
    retired = cadastre::canonical_ids(std::move(retired));
    resulting = cadastre::canonical_ids(std::move(resulting));
    if (!retired.empty() || !resulting.empty()) {
        auto appended = reconciled.append_lineage({
            next_lineage_id(cadastre_),
            next_lineage_tick(cadastre_),
            "boundary-adjustment",
            retired,
            resulting,
        });
        if (!appended) return std::unexpected(make_error(appended.error().code, appended.error().message));
    }

    for (const auto& [_, easement] : cadastre_.easements()) {
        auto added = reconciled.add_easement(easement);
        if (!added) return std::unexpected(make_error(added.error().code, added.error().message));
    }

    std::vector<cadastre::GeneratedUrbanBlock> reconciled_blocks = (*generated)->blocks_;
    for (auto& block : reconciled_blocks) {
        for (auto& parcel_id : block.parcel_ids) {
            const auto mapped = candidate_to_reconciled.find(parcel_id);
            if (mapped == candidate_to_reconciled.end()) {
                return std::unexpected(make_error(
                    ErrorCode::invariant_failure,
                    "generated block references unknown parcel"));
            }
            parcel_id = mapped->second;
        }
        block.parcel_ids = cadastre::canonical_ids(std::move(block.parcel_ids));
    }

    urban::ZoningStore staged_zoning;
    auto zoning_restored = staged_zoning.restore_assignments(original_zoning);
    if (!zoning_restored) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, zoning_restored.error().message));
    }

    urban::UrbanFabricStore staged_buildings{&reconciled};
    auto buildings_restored = staged_buildings.restore_buildings(original_buildings);
    if (!buildings_restored) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, buildings_restored.error().message));
    }
    auto buildings_valid = staged_buildings.validate();
    if (!buildings_valid) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, buildings_valid.error().message));
    }

    urban::PropertyMarketSystem staged_property{reconciled};
    auto property_restored = staged_property.restore_with_cadastre_history(original_property);
    if (!property_restored) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, property_restored.error().message));
    }

    auto cadastre_valid = reconciled.validate();
    if (!cadastre_valid) {
        return std::unexpected(make_error(ErrorCode::invariant_failure, cadastre_valid.error().message));
    }

    cadastre_ = std::move(reconciled);
    blocks_ = std::move(reconciled_blocks);
    zoning_ = std::move(staged_zoning);
    buildings_ = urban::UrbanFabricStore{&cadastre_};
    auto committed_buildings = buildings_.restore_buildings(original_buildings);
    if (!committed_buildings) {
        return std::unexpected(make_error(ErrorCode::internal_error, committed_buildings.error().message));
    }
    property_.bind_cadastre(cadastre_);
    auto committed_property = property_.restore_with_cadastre_history(original_property);
    if (!committed_property) {
        return std::unexpected(make_error(ErrorCode::internal_error, committed_property.error().message));
    }

    return snapshotJson();
}

}  // namespace civic
