#include "civic/urban/NativeUrbanAuthority.hpp"

#include "civic/cadastre/CadastreMutation.hpp"
#include "civic/geometry/BooleanOps.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace civic {
namespace {
using json = nlohmann::json;
using civic::core::ParcelId;

constexpr double kGeometryAreaToleranceM2 = 0.01;

Result<geometry::Point> command_point(const json& value) {
    try {
        const double x = value.at("x").get<double>();
        const double y = value.at("y").get<double>();
        if (!std::isfinite(x) || !std::isfinite(y)) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "urban command point must be finite"));
        }
        return geometry::Point{
            static_cast<geometry::Coordinate>(std::llround(x * 100.0)),
            static_cast<geometry::Coordinate>(std::llround(y * 100.0)),
        };
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<geometry::Polygon> command_polygon(const json& value) {
    if (!value.is_array() || value.size() < 3U) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "urban command polygon requires at least three points"));
    }
    geometry::Polygon polygon{};
    polygon.vertices.reserve(value.size());
    for (const auto& raw : value) {
        auto point = command_point(raw);
        if (!point) return std::unexpected(point.error());
        polygon.vertices.push_back(*point);
    }
    auto canonical = geometry::canonicalize(polygon);
    if (!canonical) return std::unexpected(make_error(ErrorCode::invalid_argument, canonical.error().message));
    return *canonical;
}

Result<std::vector<geometry::Point>> command_polyline(const json& value) {
    if (!value.is_array() || value.size() < 2U) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, "urban command polyline requires at least two points"));
    }
    std::vector<geometry::Point> points;
    points.reserve(value.size());
    for (const auto& raw : value) {
        auto point = command_point(raw);
        if (!point) return std::unexpected(point.error());
        points.push_back(*point);
    }
    return points;
}

Result<ParcelId> live_parcel_id(const cadastre::CadastralGraph& graph, std::string_view external_id) {
    const auto* parcel = graph.find_external(external_id);
    if (!parcel || !parcel->live) {
        return std::unexpected(make_error(ErrorCode::not_found, "parcel-not-found"));
    }
    return parcel->id;
}

std::string external_id(const cadastre::CadastralGraph& graph, ParcelId id) {
    const auto* parcel = graph.find(id);
    return parcel ? parcel->external_id : std::string{};
}

std::vector<std::string> external_ids(
    const cadastre::CadastralGraph& graph,
    const std::vector<ParcelId>& ids) {
    std::vector<std::string> output;
    output.reserve(ids.size());
    for (const auto id : ids) output.push_back(external_id(graph, id));
    return output;
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

bool same_assignment(
    const urban::ParcelZoningAssignment& left,
    const urban::ParcelZoningAssignment& right) {
    return left.district_id == right.district_id && left.overlay_ids == right.overlay_ids;
}

std::optional<urban::ParcelZoningAssignment> find_assignment(
    const std::vector<urban::ParcelZoningAssignment>& assignments,
    ParcelId parcel_id) {
    const auto it = std::find_if(assignments.begin(), assignments.end(), [&](const auto& assignment) {
        return assignment.parcel_id == parcel_id;
    });
    return it == assignments.end() ? std::nullopt : std::optional<urban::ParcelZoningAssignment>{*it};
}

std::optional<urban::PropertyHolding> find_holding(
    const urban::PropertyMarketSnapshot& snapshot,
    std::string_view parcel_id) {
    const auto it = std::find_if(snapshot.holdings.begin(), snapshot.holdings.end(), [&](const auto& holding) {
        return holding.parcel_id == parcel_id;
    });
    return it == snapshot.holdings.end() ? std::nullopt : std::optional<urban::PropertyHolding>{*it};
}

std::vector<ParcelId> canonical_parcel_ids(std::vector<ParcelId> ids) {
    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
    return ids;
}

Result<bool> footprint_supported(
    const urban::BuildingV2& building,
    const std::vector<ParcelId>& parcel_ids,
    const cadastre::CadastralGraph& graph) {
    std::vector<geometry::Polygon> support;
    support.reserve(parcel_ids.size());
    for (const auto parcel_id : parcel_ids) {
        const auto* parcel = graph.find(parcel_id);
        if (!parcel || !parcel->live) {
            return std::unexpected(make_error(ErrorCode::invariant_failure, "building references non-live parcel"));
        }
        support.push_back(parcel->boundary);
    }
    auto united = geometry::polygon_union(support);
    if (!united) return std::unexpected(make_error(ErrorCode::invariant_failure, united.error().message));
    double overlap_area = 0.0;
    for (const auto& polygon : *united) {
        auto intersection = geometry::polygon_intersection(building.footprint, polygon);
        if (!intersection) {
            return std::unexpected(make_error(ErrorCode::invariant_failure, intersection.error().message));
        }
        overlap_area += geometry::total_area_square_meters(*intersection);
    }
    const double footprint_area = geometry::area_square_meters(building.footprint);
    return std::abs(footprint_area - overlap_area) <= kGeometryAreaToleranceM2;
}

Result<void> validate_assignments(
    const urban::ZoningStore& zoning,
    const cadastre::CadastralGraph& graph) {
    for (const auto& [parcel_id, _] : zoning.assignments()) {
        const auto* parcel = graph.find(parcel_id);
        if (!parcel || !parcel->live) {
            return std::unexpected(make_error(ErrorCode::invariant_failure, "zoning assignment references non-live parcel"));
        }
    }
    return {};
}

void rewrite_blocks(
    std::vector<cadastre::GeneratedUrbanBlock>& blocks,
    const cadastre::CadastralGraph& graph,
    const std::vector<ParcelId>& retired,
    const std::vector<ParcelId>& resulting) {
    const std::set<ParcelId> retired_set{retired.begin(), retired.end()};
    for (auto& block : blocks) {
        const bool touches = std::any_of(block.parcel_ids.begin(), block.parcel_ids.end(), [&](ParcelId id) {
            return retired_set.contains(id);
        });
        if (!touches) continue;
        block.parcel_ids.erase(
            std::remove_if(block.parcel_ids.begin(), block.parcel_ids.end(), [&](ParcelId id) {
                return retired_set.contains(id);
            }),
            block.parcel_ids.end());
        for (const auto id : resulting) {
            const auto* parcel = graph.find(id);
            if (parcel && parcel->live && parcel->block_id == block.external_id) block.parcel_ids.push_back(id);
        }
        block.parcel_ids = canonical_parcel_ids(std::move(block.parcel_ids));
    }
}

json committed_result(
    std::vector<std::string> resulting,
    std::vector<std::string> retired,
    json rewrites = json::object()) {
    return json{
        {"committed", true},
        {"resultingParcelIds", std::move(resulting)},
        {"retiredParcelIds", std::move(retired)},
        {"rejectionReasons", json::array()},
        {"parcelReferenceRewrites", std::move(rewrites)},
    };
}

Result<void> finalize_native_state(
    cadastre::CadastralGraph& cadastre,
    urban::ZoningStore& zoning,
    urban::UrbanFabricStore& buildings,
    urban::PropertyMarketSystem& property) {
    auto cadastre_valid = cadastre.validate();
    if (!cadastre_valid) return std::unexpected(make_error(ErrorCode::invariant_failure, cadastre_valid.error().message));
    auto zoning_valid = validate_assignments(zoning, cadastre);
    if (!zoning_valid) return zoning_valid;
    buildings.bind_cadastre(cadastre);
    auto buildings_valid = buildings.validate();
    if (!buildings_valid) return std::unexpected(make_error(ErrorCode::invariant_failure, buildings_valid.error().message));
    property.bind_cadastre(cadastre);
    auto property_valid = property.restore_with_cadastre_history(property.snapshot());
    if (!property_valid) return std::unexpected(make_error(ErrorCode::invariant_failure, property_valid.error().message));
    return {};
}

}  // namespace

Result<std::string> NativeUrbanAuthority::applyCommand(std::string_view request_json) {
    json command;
    try {
        command = json::parse(request_json.begin(), request_json.end());
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
    if (!command.is_object() || !command.contains("type") || !command.at("type").is_string()) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, "urban command requires string type"));
    }

    try {
        const auto type = command.at("type").get<std::string>();
        cadastre::CadastralMutationService mutations{cadastre_};
        const auto original_zoning = zoning_snapshot(zoning_);
        const auto original_buildings = building_snapshot(buildings_);
        const auto original_property = property_.snapshot();

        if (type == "cadastre.split") {
            const auto source_external = command.at("parcelId").get<std::string>();
            auto source_id = live_parcel_id(cadastre_, source_external);
            if (!source_id) return std::unexpected(source_id.error());
            const auto* source = cadastre_.find(*source_id);
            const double source_area = source ? source->area_m2 : 0.0;
            auto cut = command_polyline(command.at("cutLine"));
            if (!cut) return std::unexpected(cut.error());
            if (cut->size() != 2U) {
                return std::unexpected(make_error(ErrorCode::invalid_argument, "split cutLine must contain exactly two endpoints"));
            }

            auto result = mutations.split({*source_id, {cut->front(), cut->back()}});
            if (!result) return std::unexpected(make_error(result.error().code, result.error().message));
            const auto resulting_external = external_ids(cadastre_, result->resulting_parcel_ids);
            const auto retired_external = external_ids(cadastre_, result->retired_parcel_ids);
            rewrite_blocks(blocks_, cadastre_, result->retired_parcel_ids, result->resulting_parcel_ids);

            std::vector<urban::ParcelZoningAssignment> staged_zoning;
            const auto source_assignment = find_assignment(original_zoning, *source_id);
            for (const auto& assignment : original_zoning) {
                if (assignment.parcel_id != *source_id) staged_zoning.push_back(assignment);
            }
            if (source_assignment) {
                for (const auto child_id : result->resulting_parcel_ids) {
                    auto assignment = *source_assignment;
                    assignment.parcel_id = child_id;
                    staged_zoning.push_back(std::move(assignment));
                }
            }
            auto zoning_restored = zoning_.restore_assignments(staged_zoning);
            if (!zoning_restored) return std::unexpected(make_error(ErrorCode::invariant_failure, zoning_restored.error().message));

            auto staged_buildings = original_buildings;
            for (auto& building : staged_buildings) {
                if (std::find(building.parcel_ids.begin(), building.parcel_ids.end(), *source_id) == building.parcel_ids.end()) continue;
                std::vector<ParcelId> containing;
                const double footprint_area = geometry::area_square_meters(building.footprint);
                std::size_t material_overlaps = 0;
                for (const auto child_id : result->resulting_parcel_ids) {
                    const auto* child = cadastre_.find(child_id);
                    if (!child) continue;
                    auto intersection = geometry::polygon_intersection(building.footprint, child->boundary);
                    if (!intersection) return std::unexpected(make_error(ErrorCode::invariant_failure, intersection.error().message));
                    const double overlap = geometry::total_area_square_meters(*intersection);
                    if (overlap > kGeometryAreaToleranceM2) ++material_overlaps;
                    if (std::abs(footprint_area - overlap) <= kGeometryAreaToleranceM2) containing.push_back(child_id);
                }
                if (containing.size() != 1U) {
                    return std::unexpected(make_error(
                        ErrorCode::conflict,
                        material_overlaps > 1U ? "building-crosses-split" : "building-outside-resulting-parcel"));
                }
                for (auto& parcel_id : building.parcel_ids) {
                    if (parcel_id == *source_id) parcel_id = containing.front();
                }
                building.parcel_ids = canonical_parcel_ids(std::move(building.parcel_ids));
                building.parcel_id = building.parcel_ids.front();
            }
            auto buildings_restored = buildings_.restore_buildings(staged_buildings);
            if (!buildings_restored) return std::unexpected(make_error(ErrorCode::conflict, buildings_restored.error().message));

            auto staged_property = original_property;
            const auto source_holding = find_holding(original_property, source_external);
            if (source_holding) {
                staged_property.holdings.erase(
                    std::remove_if(staged_property.holdings.begin(), staged_property.holdings.end(), [&](const auto& holding) {
                        return holding.parcel_id == source_external;
                    }),
                    staged_property.holdings.end());
                const auto total_cents = static_cast<std::int64_t>(std::llround(source_holding->reservation_value * 100.0));
                std::int64_t remaining_cents = total_cents;
                for (std::size_t index = 0; index < result->resulting_parcel_ids.size(); ++index) {
                    const auto child_id = result->resulting_parcel_ids[index];
                    const auto* child = cadastre_.find(child_id);
                    if (!child) return std::unexpected(make_error(ErrorCode::invariant_failure, "split child parcel missing"));
                    const bool last = index + 1U == result->resulting_parcel_ids.size();
                    const auto cents = last
                        ? remaining_cents
                        : static_cast<std::int64_t>(std::llround(
                              static_cast<long double>(total_cents) * child->area_m2 / source_area));
                    remaining_cents -= cents;
                    staged_property.holdings.push_back({
                        child->external_id,
                        source_holding->owner_id,
                        static_cast<double>(cents) / 100.0,
                    });
                }
                std::sort(staged_property.holdings.begin(), staged_property.holdings.end(), [](const auto& left, const auto& right) {
                    return left.parcel_id < right.parcel_id;
                });
            }
            auto property_restored = property_.restore_with_cadastre_history(staged_property);
            if (!property_restored) return std::unexpected(make_error(ErrorCode::conflict, property_restored.error().message));

            auto finalized = finalize_native_state(cadastre_, zoning_, buildings_, property_);
            if (!finalized) return std::unexpected(finalized.error());
            return committed_result(resulting_external, retired_external).dump();
        }

        if (type == "cadastre.assemble") {
            const auto parcel_names = command.at("parcelIds").get<std::vector<std::string>>();
            std::vector<ParcelId> source_ids;
            source_ids.reserve(parcel_names.size());
            for (const auto& name : parcel_names) {
                auto id = live_parcel_id(cadastre_, name);
                if (!id) return std::unexpected(id.error());
                source_ids.push_back(*id);
            }
            source_ids = canonical_parcel_ids(std::move(source_ids));
            if (source_ids.size() < 2U) {
                return std::unexpected(make_error(ErrorCode::invalid_argument, "assembly requires at least two parcels"));
            }

            std::vector<urban::ParcelZoningAssignment> source_assignments;
            for (const auto id : source_ids) {
                if (auto assignment = find_assignment(original_zoning, id)) source_assignments.push_back(*assignment);
            }
            if (!source_assignments.empty()) {
                if (source_assignments.size() != source_ids.size() ||
                    std::any_of(source_assignments.begin() + 1, source_assignments.end(), [&](const auto& assignment) {
                        return !same_assignment(source_assignments.front(), assignment);
                    })) {
                    return std::unexpected(make_error(ErrorCode::conflict, "conflicting-zoning-assignments"));
                }
            }

            std::vector<urban::PropertyHolding> source_holdings;
            for (const auto& name : parcel_names) {
                if (auto holding = find_holding(original_property, name)) source_holdings.push_back(*holding);
            }
            if (!source_holdings.empty()) {
                if (source_holdings.size() != source_ids.size() ||
                    std::any_of(source_holdings.begin() + 1, source_holdings.end(), [&](const auto& holding) {
                        return holding.owner_id != source_holdings.front().owner_id;
                    })) {
                    return std::unexpected(make_error(ErrorCode::conflict, "conflicting-property-owners"));
                }
            }

            auto result = mutations.assemble({source_ids});
            if (!result) return std::unexpected(make_error(result.error().code, result.error().message));
            const auto result_id = result->resulting_parcel_ids.front();
            const auto result_external = external_id(cadastre_, result_id);
            const auto retired_external = external_ids(cadastre_, result->retired_parcel_ids);
            rewrite_blocks(blocks_, cadastre_, result->retired_parcel_ids, result->resulting_parcel_ids);
            const std::set<ParcelId> source_set{source_ids.begin(), source_ids.end()};

            std::vector<urban::ParcelZoningAssignment> staged_zoning;
            for (const auto& assignment : original_zoning) {
                if (!source_set.contains(assignment.parcel_id)) staged_zoning.push_back(assignment);
            }
            if (!source_assignments.empty()) {
                auto assignment = source_assignments.front();
                assignment.parcel_id = result_id;
                staged_zoning.push_back(std::move(assignment));
            }
            auto zoning_restored = zoning_.restore_assignments(staged_zoning);
            if (!zoning_restored) return std::unexpected(make_error(ErrorCode::invariant_failure, zoning_restored.error().message));

            auto staged_buildings = original_buildings;
            for (auto& building : staged_buildings) {
                bool changed = false;
                for (auto& parcel_id : building.parcel_ids) {
                    if (source_set.contains(parcel_id)) {
                        parcel_id = result_id;
                        changed = true;
                    }
                }
                if (changed) {
                    building.parcel_ids = canonical_parcel_ids(std::move(building.parcel_ids));
                    building.parcel_id = building.parcel_ids.front();
                }
            }
            auto buildings_restored = buildings_.restore_buildings(staged_buildings);
            if (!buildings_restored) return std::unexpected(make_error(ErrorCode::conflict, buildings_restored.error().message));

            auto staged_property = original_property;
            const std::set<std::string> source_external_set{parcel_names.begin(), parcel_names.end()};
            staged_property.holdings.erase(
                std::remove_if(staged_property.holdings.begin(), staged_property.holdings.end(), [&](const auto& holding) {
                    return source_external_set.contains(holding.parcel_id);
                }),
                staged_property.holdings.end());
            if (!source_holdings.empty()) {
                std::int64_t total_cents = 0;
                for (const auto& holding : source_holdings) {
                    total_cents += static_cast<std::int64_t>(std::llround(holding.reservation_value * 100.0));
                }
                staged_property.holdings.push_back({
                    result_external,
                    source_holdings.front().owner_id,
                    static_cast<double>(total_cents) / 100.0,
                });
            }
            std::sort(staged_property.holdings.begin(), staged_property.holdings.end(), [](const auto& left, const auto& right) {
                return left.parcel_id < right.parcel_id;
            });
            auto property_restored = property_.restore_with_cadastre_history(staged_property);
            if (!property_restored) return std::unexpected(make_error(ErrorCode::conflict, property_restored.error().message));

            auto finalized = finalize_native_state(cadastre_, zoning_, buildings_, property_);
            if (!finalized) return std::unexpected(finalized.error());
            json rewrites = json::object();
            for (const auto& retired : retired_external) rewrites[retired] = result_external;
            return committed_result({result_external}, retired_external, std::move(rewrites)).dump();
        }

        if (type == "cadastre.dedicate-right-of-way") {
            const auto source_external = command.at("parcelId").get<std::string>();
            auto source_id = live_parcel_id(cadastre_, source_external);
            if (!source_id) return std::unexpected(source_id.error());
            const auto* source = cadastre_.find(*source_id);
            const double source_area = source ? source->area_m2 : 0.0;
            auto dedication = command_polygon(command.at("dedication"));
            if (!dedication) return std::unexpected(dedication.error());

            auto result = mutations.dedicate_right_of_way({*source_id, *dedication});
            if (!result) return std::unexpected(make_error(result.error().code, result.error().message));
            const auto result_id = result->resulting_parcel_ids.front();
            const auto result_external = external_id(cadastre_, result_id);
            const auto retired_external = external_ids(cadastre_, result->retired_parcel_ids);
            rewrite_blocks(blocks_, cadastre_, result->retired_parcel_ids, result->resulting_parcel_ids);

            std::vector<urban::ParcelZoningAssignment> staged_zoning;
            const auto source_assignment = find_assignment(original_zoning, *source_id);
            for (const auto& assignment : original_zoning) {
                if (assignment.parcel_id != *source_id) staged_zoning.push_back(assignment);
            }
            if (source_assignment) {
                auto replacement = *source_assignment;
                replacement.parcel_id = result_id;
                staged_zoning.push_back(std::move(replacement));
            }
            auto zoning_restored = zoning_.restore_assignments(staged_zoning);
            if (!zoning_restored) return std::unexpected(make_error(ErrorCode::invariant_failure, zoning_restored.error().message));

            auto staged_buildings = original_buildings;
            for (auto& building : staged_buildings) {
                bool changed = false;
                for (auto& parcel_id : building.parcel_ids) {
                    if (parcel_id == *source_id) {
                        parcel_id = result_id;
                        changed = true;
                    }
                }
                if (!changed) continue;
                building.parcel_ids = canonical_parcel_ids(std::move(building.parcel_ids));
                building.parcel_id = building.parcel_ids.front();
                auto supported = footprint_supported(building, building.parcel_ids, cadastre_);
                if (!supported) return std::unexpected(supported.error());
                if (!*supported) {
                    return std::unexpected(make_error(ErrorCode::conflict, "building-outside-resulting-parcel"));
                }
            }
            auto buildings_restored = buildings_.restore_buildings(staged_buildings);
            if (!buildings_restored) return std::unexpected(make_error(ErrorCode::conflict, buildings_restored.error().message));

            auto staged_property = original_property;
            const auto source_holding = find_holding(original_property, source_external);
            if (source_holding) {
                staged_property.holdings.erase(
                    std::remove_if(staged_property.holdings.begin(), staged_property.holdings.end(), [&](const auto& holding) {
                        return holding.parcel_id == source_external;
                    }),
                    staged_property.holdings.end());
                const auto* residual = cadastre_.find(result_id);
                if (!residual) return std::unexpected(make_error(ErrorCode::invariant_failure, "ROW residual parcel missing"));
                const auto cents = static_cast<std::int64_t>(std::llround(
                    source_holding->reservation_value * (residual->area_m2 / source_area) * 100.0));
                staged_property.holdings.push_back({
                    result_external,
                    source_holding->owner_id,
                    static_cast<double>(cents) / 100.0,
                });
                std::sort(staged_property.holdings.begin(), staged_property.holdings.end(), [](const auto& left, const auto& right) {
                    return left.parcel_id < right.parcel_id;
                });
            }
            auto property_restored = property_.restore_with_cadastre_history(staged_property);
            if (!property_restored) return std::unexpected(make_error(ErrorCode::conflict, property_restored.error().message));

            auto finalized = finalize_native_state(cadastre_, zoning_, buildings_, property_);
            if (!finalized) return std::unexpected(finalized.error());
            json rewrites = json::object();
            rewrites[source_external] = result_external;
            return committed_result({result_external}, retired_external, std::move(rewrites)).dump();
        }

        if (type == "cadastre.create-easement") {
            const auto parcel_names = command.at("parcelIds").get<std::vector<std::string>>();
            std::vector<ParcelId> parcel_ids;
            parcel_ids.reserve(parcel_names.size());
            for (const auto& name : parcel_names) {
                auto id = live_parcel_id(cadastre_, name);
                if (!id) return std::unexpected(id.error());
                parcel_ids.push_back(*id);
            }
            auto geometry = command_polyline(command.at("geometry"));
            if (!geometry) return std::unexpected(geometry.error());
            const auto id = command.value("id", std::string{});
            const auto kind = command.at("kind").get<std::string>();
            auto created = mutations.create_easement({id, parcel_ids, kind, *geometry});
            if (!created) return std::unexpected(make_error(created.error().code, created.error().message));
            auto finalized = finalize_native_state(cadastre_, zoning_, buildings_, property_);
            if (!finalized) return std::unexpected(finalized.error());
            return committed_result({}, {}).dump();
        }

        if (type == "cadastre.remove-easement") {
            const auto id = command.at("easementId").get<std::string>();
            auto removed = mutations.remove_easement(id);
            if (!removed) return std::unexpected(make_error(removed.error().code, removed.error().message));
            auto finalized = finalize_native_state(cadastre_, zoning_, buildings_, property_);
            if (!finalized) return std::unexpected(finalized.error());
            return committed_result({}, {}).dump();
        }

        return std::unexpected(make_error(ErrorCode::invalid_argument, "unsupported native urban command: " + type));
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::internal_error, error.what()));
    }
}

}  // namespace civic
