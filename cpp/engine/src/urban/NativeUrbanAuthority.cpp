#include "civic/urban/NativeUrbanAuthority.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>
#include <vector>

namespace civic {
namespace {
using json = nlohmann::json;
using civic::core::ParcelId;

Error from_core(const core::Error& error) {
    switch (error.code) {
        case core::ErrorCode::none: return make_error(ErrorCode::none, error.message);
        case core::ErrorCode::invalid_argument: return make_error(ErrorCode::invalid_argument, error.message);
        case core::ErrorCode::invalid_state: return make_error(ErrorCode::invalid_state, error.message);
        case core::ErrorCode::serialization_failure: return make_error(ErrorCode::serialization_failure, error.message);
        case core::ErrorCode::invariant_failure: return make_error(ErrorCode::invariant_failure, error.message);
        case core::ErrorCode::unsupported_save_version: return make_error(ErrorCode::unsupported_save_version, error.message);
        case core::ErrorCode::not_found:
        case core::ErrorCode::conflict: return make_error(ErrorCode::invalid_state, error.message);
        case core::ErrorCode::internal_error: return make_error(ErrorCode::internal_error, error.message);
    }
    return make_error(ErrorCode::internal_error, error.message);
}

Result<json> parse_json(std::string_view text, std::string_view label) {
    try {
        return json::parse(text.begin(), text.end());
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string(label) + " is invalid JSON: " + error.what()));
    }
}

geometry::Point point_cm(const json& value) {
    const double x = value.at("x").get<double>();
    const double y = value.at("y").get<double>();
    if (!std::isfinite(x) || !std::isfinite(y)) throw std::invalid_argument("geometry point must be finite");
    return {
        static_cast<geometry::Coordinate>(std::llround(x * 100.0)),
        static_cast<geometry::Coordinate>(std::llround(y * 100.0)),
    };
}

geometry::Polygon polygon_cm(const json& value) {
    if (!value.is_array() || value.size() < 3U) throw std::invalid_argument("polygon must contain at least three points");
    geometry::Polygon polygon{};
    polygon.vertices.reserve(value.size());
    for (const auto& point : value) polygon.vertices.push_back(point_cm(point));
    auto canonical = geometry::canonicalize(polygon);
    if (!canonical) throw std::invalid_argument(canonical.error().message);
    return *canonical;
}

json point_json(geometry::Point point) {
    return {{"x", static_cast<double>(point.x) / 100.0}, {"y", static_cast<double>(point.y) / 100.0}};
}

json polygon_json(const geometry::Polygon& polygon) {
    json output = json::array();
    for (const auto point : polygon.vertices) output.push_back(point_json(point));
    return output;
}

std::string node_id(geometry::Point point) {
    return "node:" + std::to_string(point.x) + "," + std::to_string(point.y);
}

std::string edge_id(geometry::Point left, geometry::Point right) {
    auto a = node_id(left);
    auto b = node_id(right);
    if (b < a) std::swap(a, b);
    return "edge:" + a + "|" + b;
}

std::string native_boundary_id(geometry::Point left, geometry::Point right) {
    if (right < left) std::swap(left, right);
    return "boundary:" + std::to_string(left.x) + "," + std::to_string(left.y) + "|" +
           std::to_string(right.x) + "," + std::to_string(right.y);
}

urban::UseType use_type(std::string_view value) {
    if (value == "residential") return urban::UseType::residential;
    if (value == "retail") return urban::UseType::retail;
    if (value == "office") return urban::UseType::office;
    if (value == "hospitality") return urban::UseType::hospitality;
    if (value == "light-industrial") return urban::UseType::light_industrial;
    if (value == "heavy-industrial") return urban::UseType::heavy_industrial;
    if (value == "logistics") return urban::UseType::logistics;
    if (value == "civic") return urban::UseType::civic;
    throw std::invalid_argument("invalid use type: " + std::string(value));
}

urban::BuildingStatus building_status(std::string_view value) {
    if (value == "proposed") return urban::BuildingStatus::proposed;
    if (value == "entitlement") return urban::BuildingStatus::entitlement;
    if (value == "demolition") return urban::BuildingStatus::demolition;
    if (value == "construction") return urban::BuildingStatus::construction;
    if (value == "occupied") return urban::BuildingStatus::occupied;
    if (value == "renovation") return urban::BuildingStatus::renovation;
    if (value == "vacant") return urban::BuildingStatus::vacant;
    if (value == "abandoned") return urban::BuildingStatus::abandoned;
    throw std::invalid_argument("invalid building status: " + std::string(value));
}

std::string_view building_status_name(urban::BuildingStatus value) {
    switch (value) {
        case urban::BuildingStatus::proposed: return "proposed";
        case urban::BuildingStatus::entitlement: return "entitlement";
        case urban::BuildingStatus::demolition: return "demolition";
        case urban::BuildingStatus::construction: return "construction";
        case urban::BuildingStatus::occupied: return "occupied";
        case urban::BuildingStatus::renovation: return "renovation";
        case urban::BuildingStatus::vacant: return "vacant";
        case urban::BuildingStatus::abandoned: return "abandoned";
    }
    return "proposed";
}

urban::BuildingProjectPhase project_phase(std::string_view value) {
    if (value == "none") return urban::BuildingProjectPhase::none;
    if (value == "entitlement") return urban::BuildingProjectPhase::entitlement;
    if (value == "relocation") return urban::BuildingProjectPhase::relocation;
    if (value == "demolition") return urban::BuildingProjectPhase::demolition;
    if (value == "foundation") return urban::BuildingProjectPhase::foundation;
    if (value == "structure") return urban::BuildingProjectPhase::structure;
    if (value == "enclosure") return urban::BuildingProjectPhase::enclosure;
    if (value == "fit-out") return urban::BuildingProjectPhase::fit_out;
    if (value == "lease-up") return urban::BuildingProjectPhase::lease_up;
    throw std::invalid_argument("invalid project phase: " + std::string(value));
}

std::string_view project_phase_name(urban::BuildingProjectPhase value) {
    switch (value) {
        case urban::BuildingProjectPhase::none: return "none";
        case urban::BuildingProjectPhase::entitlement: return "entitlement";
        case urban::BuildingProjectPhase::relocation: return "relocation";
        case urban::BuildingProjectPhase::demolition: return "demolition";
        case urban::BuildingProjectPhase::foundation: return "foundation";
        case urban::BuildingProjectPhase::structure: return "structure";
        case urban::BuildingProjectPhase::enclosure: return "enclosure";
        case urban::BuildingProjectPhase::fit_out: return "fit-out";
        case urban::BuildingProjectPhase::lease_up: return "lease-up";
    }
    return "none";
}

urban::BuildingProjectKind project_kind(std::string_view value) {
    if (value == "new-build") return urban::BuildingProjectKind::new_build;
    if (value == "renovation") return urban::BuildingProjectKind::renovation;
    if (value == "adaptive-reuse") return urban::BuildingProjectKind::adaptive_reuse;
    if (value == "demolition") return urban::BuildingProjectKind::demolition;
    throw std::invalid_argument("invalid project kind: " + std::string(value));
}

std::string_view project_kind_name(urban::BuildingProjectKind value) {
    switch (value) {
        case urban::BuildingProjectKind::new_build: return "new-build";
        case urban::BuildingProjectKind::renovation: return "renovation";
        case urban::BuildingProjectKind::adaptive_reuse: return "adaptive-reuse";
        case urban::BuildingProjectKind::demolition: return "demolition";
    }
    return "new-build";
}

urban::BuildingRenovationScope renovation_scope(std::string_view value) {
    if (value == "light") return urban::BuildingRenovationScope::light;
    if (value == "major") return urban::BuildingRenovationScope::major;
    if (value == "gut") return urban::BuildingRenovationScope::gut;
    throw std::invalid_argument("invalid renovation scope: " + std::string(value));
}

std::string_view renovation_scope_name(urban::BuildingRenovationScope value) {
    switch (value) {
        case urban::BuildingRenovationScope::light: return "light";
        case urban::BuildingRenovationScope::major: return "major";
        case urban::BuildingRenovationScope::gut: return "gut";
    }
    return "light";
}

urban::PropertyTransactionPurpose property_purpose(std::string_view value) {
    if (value == "sale") return urban::PropertyTransactionPurpose::sale;
    if (value == "redevelopment") return urban::PropertyTransactionPurpose::redevelopment;
    if (value == "assembly") return urban::PropertyTransactionPurpose::assembly;
    if (value == "renovation") return urban::PropertyTransactionPurpose::renovation;
    throw std::invalid_argument("invalid property transaction purpose: " + std::string(value));
}

std::string_view property_purpose_name(urban::PropertyTransactionPurpose value) {
    switch (value) {
        case urban::PropertyTransactionPurpose::sale: return "sale";
        case urban::PropertyTransactionPurpose::redevelopment: return "redevelopment";
        case urban::PropertyTransactionPurpose::assembly: return "assembly";
        case urban::PropertyTransactionPurpose::renovation: return "renovation";
    }
    return "sale";
}

struct InputEdge final {
    std::string from;
    std::string to;
    std::string kind;
    std::optional<std::string> road_ref;
};

std::optional<std::vector<geometry::Point>> walk_boundary(
    const std::vector<std::string>& edge_ids,
    const std::map<std::string, InputEdge>& edges,
    const std::map<std::string, geometry::Point>& nodes,
    bool reverse_first) {
    if (edge_ids.empty()) return std::nullopt;
    const auto first_it = edges.find(edge_ids.front());
    if (first_it == edges.end()) return std::nullopt;
    const auto& first = first_it->second;
    const std::string start = reverse_first ? first.to : first.from;
    std::string current = reverse_first ? first.from : first.to;
    const auto start_point = nodes.find(start);
    if (start_point == nodes.end()) return std::nullopt;
    std::vector<geometry::Point> points{start_point->second};
    for (std::size_t index = 1; index < edge_ids.size(); ++index) {
        const auto current_point = nodes.find(current);
        if (current_point == nodes.end()) return std::nullopt;
        points.push_back(current_point->second);
        const auto edge_it = edges.find(edge_ids[index]);
        if (edge_it == edges.end()) return std::nullopt;
        const auto& edge = edge_it->second;
        if (edge.from == current) current = edge.to;
        else if (edge.to == current) current = edge.from;
        else return std::nullopt;
    }
    if (current != start) return std::nullopt;
    return points;
}

geometry::Polygon trace_boundary(
    const json& parcel,
    const std::map<std::string, InputEdge>& edges,
    const std::map<std::string, geometry::Point>& nodes) {
    const auto edge_ids = parcel.at("boundaryEdgeIds").get<std::vector<std::string>>();
    auto points = walk_boundary(edge_ids, edges, nodes, false);
    if (!points) points = walk_boundary(edge_ids, edges, nodes, true);
    if (!points || points->size() < 3U) throw std::invalid_argument("parcel boundary does not form a closed chain");
    geometry::Polygon polygon{*points};
    auto canonical = geometry::canonicalize(polygon);
    if (!canonical) throw std::invalid_argument(canonical.error().message);
    return *canonical;
}

urban::BuildingV2 parse_building(const json& value) {
    urban::BuildingV2 building{};
    building.external_id = value.at("id").get<std::string>();
    building.id = urban::building_id_from_external(building.external_id);
    const auto parcel_names = value.at("parcelIds").get<std::vector<std::string>>();
    if (parcel_names.empty()) throw std::invalid_argument("building parcelIds must not be empty");
    for (const auto& name : parcel_names) building.parcel_ids.push_back(cadastre::parcel_id_from_external(name));
    building.parcel_id = building.parcel_ids.front();
    building.typology_id = value.at("typologyId").get<std::string>();
    building.footprint = polygon_cm(value.at("footprint"));
    building.gross_floor_area_m2 = value.at("grossFloorAreaM2").get<double>();
    building.usable_floor_area_m2 = value.at("usableFloorAreaM2").get<double>();
    building.height_meters = value.at("heightMeters").get<double>();
    building.stories = value.at("stories").get<std::uint32_t>();
    building.realized_far = value.at("realizedFAR").get<double>();
    building.coverage_ratio = value.at("coverageRatio").get<double>();
    for (const auto& raw_floor : value.at("floors")) {
        urban::BuildingFloor floor{};
        floor.level = raw_floor.at("level").get<std::uint32_t>();
        floor.elevation_meters = raw_floor.at("elevationMeters").get<double>();
        floor.gross_area_m2 = raw_floor.at("grossAreaM2").get<double>();
        floor.usable_area_m2 = raw_floor.value("usableAreaM2", floor.gross_area_m2);
        for (const auto& raw_use : raw_floor.at("uses")) {
            floor.uses.push_back({
                use_type(raw_use.at("use").get<std::string>()),
                raw_use.at("floorAreaM2").get<double>(),
                raw_use.value("residentialUnits", 0U),
                raw_use.value("jobs", 0U),
                raw_use.value("hotelRooms", 0U),
                raw_use.value("storageCapacity", 0.0),
            });
        }
        building.floors.push_back(std::move(floor));
    }
    building.status = building_status(value.at("status").get<std::string>());
    building.year_built = value.at("yearBuilt").get<std::int32_t>();
    if (value.contains("developerId")) building.developer_id = value.at("developerId").get<std::string>();
    if (value.contains("ownerId")) building.owner_id = value.at("ownerId").get<std::string>();
    building.project_cost = value.at("projectCost").get<double>();

    const auto& entitlement = value.at("entitlement");
    building.entitlement.approval_tick = entitlement.at("approvalTick").get<std::uint64_t>();
    building.entitlement.zoning_district_id = entitlement.at("zoningDistrictId").get<std::string>();
    building.entitlement.approved_far = entitlement.at("approvedFAR").get<double>();
    building.entitlement.approved_height_meters = entitlement.at("approvedHeightMeters").get<double>();
    for (const auto& use : entitlement.at("approvedUses")) {
        building.entitlement.approved_uses.push_back(use_type(use.get<std::string>()));
    }
    building.entitlement.legal_nonconforming = entitlement.value("legalNonconforming", false);

    const auto& lifecycle = value.at("lifecycle");
    building.lifecycle.age_ticks = lifecycle.at("ageTicks").get<std::uint64_t>();
    building.lifecycle.condition = lifecycle.at("condition").get<double>();
    building.lifecycle.structural_condition = lifecycle.at("structuralCondition").get<double>();
    building.lifecycle.systems_condition = lifecycle.at("systemsCondition").get<double>();
    building.lifecycle.exterior_condition = lifecycle.at("exteriorCondition").get<double>();
    building.lifecycle.maintenance_backlog = lifecycle.at("maintenanceBacklog").get<double>();
    building.lifecycle.deferred_maintenance_ticks = lifecycle.at("deferredMaintenanceTicks").get<std::uint64_t>();
    if (lifecycle.contains("lastMajorRenovationTick")) {
        building.lifecycle.last_major_renovation_tick = lifecycle.at("lastMajorRenovationTick").get<std::uint64_t>();
    }
    building.lifecycle.effective_age = lifecycle.at("effectiveAge").get<double>();
    building.lifecycle.vacancy_duration_ticks = lifecycle.at("vacancyDurationTicks").get<double>();
    building.lifecycle.distress_score = lifecycle.at("distressScore").get<double>();

    if (value.contains("project")) {
        const auto& raw = value.at("project");
        urban::BuildingProjectState project{};
        project.phase = project_phase(raw.at("phase").get<std::string>());
        if (raw.contains("startedTick")) project.started_tick = raw.at("startedTick").get<std::uint64_t>();
        if (raw.contains("completionTick")) project.completion_tick = raw.at("completionTick").get<std::uint64_t>();
        project.progress = raw.at("progress").get<double>();
        if (raw.contains("kind")) project.kind = project_kind(raw.at("kind").get<std::string>());
        if (raw.contains("renovationScope")) project.renovation_scope = renovation_scope(raw.at("renovationScope").get<std::string>());
        if (raw.contains("targetCondition")) project.target_condition = raw.at("targetCondition").get<double>();
        if (raw.contains("targetStructuralCondition")) project.target_structural_condition = raw.at("targetStructuralCondition").get<double>();
        if (raw.contains("targetSystemsCondition")) project.target_systems_condition = raw.at("targetSystemsCondition").get<double>();
        if (raw.contains("targetExteriorCondition")) project.target_exterior_condition = raw.at("targetExteriorCondition").get<double>();
        if (raw.contains("targetEffectiveAge")) project.target_effective_age = raw.at("targetEffectiveAge").get<double>();
        if (raw.contains("destinationUse")) project.destination_use = use_type(raw.at("destinationUse").get<std::string>());
        building.project = project;
    }
    return building;
}

json building_json(const urban::BuildingV2& building, const cadastre::CadastralGraph& graph) {
    auto parcel_name = [&](ParcelId id) -> std::string {
        const auto* parcel = graph.find(id);
        if (!parcel) throw std::invalid_argument("building references unknown native parcel");
        return parcel->external_id;
    };
    json parcel_ids = json::array();
    for (const auto id : building.parcel_ids) parcel_ids.push_back(parcel_name(id));
    json floors = json::array();
    for (const auto& floor : building.floors) {
        json uses = json::array();
        for (const auto& allocation : floor.uses) {
            json use{{"use", urban::use_type_name(allocation.use)}, {"floorAreaM2", allocation.floor_area_m2}};
            if (allocation.residential_units != 0U) use["residentialUnits"] = allocation.residential_units;
            if (allocation.jobs != 0U) use["jobs"] = allocation.jobs;
            if (allocation.hotel_rooms != 0U) use["hotelRooms"] = allocation.hotel_rooms;
            if (allocation.storage_capacity != 0.0) use["storageCapacity"] = allocation.storage_capacity;
            uses.push_back(std::move(use));
        }
        json row{{"level", floor.level}, {"elevationMeters", floor.elevation_meters}, {"grossAreaM2", floor.gross_area_m2}, {"uses", std::move(uses)}};
        if (std::abs(floor.usable_area_m2 - floor.gross_area_m2) > 1e-12) row["usableAreaM2"] = floor.usable_area_m2;
        floors.push_back(std::move(row));
    }
    json approved_uses = json::array();
    for (const auto use : building.entitlement.approved_uses) approved_uses.push_back(urban::use_type_name(use));
    json entitlement{
        {"approvalTick", building.entitlement.approval_tick},
        {"zoningDistrictId", building.entitlement.zoning_district_id},
        {"approvedFAR", building.entitlement.approved_far},
        {"approvedHeightMeters", building.entitlement.approved_height_meters},
        {"approvedUses", std::move(approved_uses)},
    };
    if (building.entitlement.legal_nonconforming) entitlement["legalNonconforming"] = true;

    json lifecycle{
        {"ageTicks", building.lifecycle.age_ticks},
        {"condition", building.lifecycle.condition},
        {"structuralCondition", building.lifecycle.structural_condition},
        {"systemsCondition", building.lifecycle.systems_condition},
        {"exteriorCondition", building.lifecycle.exterior_condition},
        {"maintenanceBacklog", building.lifecycle.maintenance_backlog},
        {"deferredMaintenanceTicks", building.lifecycle.deferred_maintenance_ticks},
        {"effectiveAge", building.lifecycle.effective_age},
        {"vacancyDurationTicks", building.lifecycle.vacancy_duration_ticks},
        {"distressScore", building.lifecycle.distress_score},
    };
    if (building.lifecycle.last_major_renovation_tick) lifecycle["lastMajorRenovationTick"] = *building.lifecycle.last_major_renovation_tick;

    json result{
        {"id", building.external_id},
        {"parcelIds", std::move(parcel_ids)},
        {"typologyId", building.typology_id},
        {"footprint", polygon_json(building.footprint)},
        {"grossFloorAreaM2", building.gross_floor_area_m2},
        {"usableFloorAreaM2", building.usable_floor_area_m2},
        {"heightMeters", building.height_meters},
        {"stories", building.stories},
        {"realizedFAR", building.realized_far},
        {"coverageRatio", building.coverage_ratio},
        {"floors", std::move(floors)},
        {"status", building_status_name(building.status)},
        {"yearBuilt", building.year_built},
        {"projectCost", building.project_cost},
        {"entitlement", std::move(entitlement)},
        {"lifecycle", std::move(lifecycle)},
    };
    if (building.developer_id) result["developerId"] = *building.developer_id;
    if (building.owner_id) result["ownerId"] = *building.owner_id;
    if (building.project) {
        const auto& project = *building.project;
        json row{{"phase", project_phase_name(project.phase)}, {"progress", project.progress}};
        if (project.started_tick) row["startedTick"] = *project.started_tick;
        if (project.completion_tick) row["completionTick"] = *project.completion_tick;
        if (project.kind) row["kind"] = project_kind_name(*project.kind);
        if (project.renovation_scope) row["renovationScope"] = renovation_scope_name(*project.renovation_scope);
        if (project.target_condition) row["targetCondition"] = *project.target_condition;
        if (project.target_structural_condition) row["targetStructuralCondition"] = *project.target_structural_condition;
        if (project.target_systems_condition) row["targetSystemsCondition"] = *project.target_systems_condition;
        if (project.target_exterior_condition) row["targetExteriorCondition"] = *project.target_exterior_condition;
        if (project.target_effective_age) row["targetEffectiveAge"] = *project.target_effective_age;
        if (project.destination_use) row["destinationUse"] = urban::use_type_name(*project.destination_use);
        result["project"] = std::move(row);
    }
    return result;
}

std::uint64_t fnv1a64(std::string_view text) noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char byte : text) {
        hash ^= byte;
        hash *= 1099511628211ULL;
    }
    return hash;
}

}  // namespace

NativeUrbanAuthority::NativeUrbanAuthority()
    : buildings_(&cadastre_), property_(cadastre_) {}

Result<std::unique_ptr<NativeUrbanAuthority>> NativeUrbanAuthority::restoreV9(const SaveV9Dto& save) {
    auto authority = std::unique_ptr<NativeUrbanAuthority>(new NativeUrbanAuthority());
    if (auto result = authority->restoreCadastre(save.urbanFabric); !result) return std::unexpected(result.error());
    if (auto result = authority->restoreZoning(save.zoningV2); !result) return std::unexpected(result.error());
    if (auto result = authority->restoreBuildings(save.buildingsV2); !result) return std::unexpected(result.error());
    if (auto result = authority->restoreProperty(save.propertyMarket); !result) return std::unexpected(result.error());
    return authority;
}

Result<std::unique_ptr<NativeUrbanAuthority>> NativeUrbanAuthority::rebuildLegacy(std::string_view request_json) {
    auto parsed = parse_json(request_json, "native urban rebuild request");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        std::vector<cadastre::LegacyTerrainCell> terrain;
        std::vector<cadastre::LegacyRoadCell> roads;
        std::vector<cadastre::LegacyZoningCell> zoning;
        for (const auto& cell : parsed->at("terrain")) {
            terrain.push_back({cell.at("x").get<std::int32_t>(), cell.at("y").get<std::int32_t>(), cell.value("buildable", true)});
        }
        for (const auto& cell : parsed->at("roads")) {
            roads.push_back({cell.at("x").get<std::int32_t>(), cell.at("y").get<std::int32_t>(), cell.value("roadRef", std::string{})});
        }
        for (const auto& cell : parsed->at("zoning")) {
            zoning.push_back({cell.at("x").get<std::int32_t>(), cell.at("y").get<std::int32_t>(), cell.at("zoningDistrictId").get<std::string>()});
        }
        auto generated = cadastre::ParcelGenerationSystem{}.rebuild(terrain, roads, zoning);
        if (!generated) return std::unexpected(from_core(generated.error()));

        auto authority = std::unique_ptr<NativeUrbanAuthority>(new NativeUrbanAuthority());
        authority->cadastre_ = std::move(generated->graph);
        authority->blocks_ = std::move(generated->blocks);
        authority->buildings_.bind_cadastre(authority->cadastre_);
        authority->property_.bind_cadastre(authority->cadastre_);
        return authority;
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string("invalid native urban rebuild request: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<void> NativeUrbanAuthority::restoreCadastre(std::string_view text) {
    auto parsed = parse_json(text, "urbanFabric");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        std::map<std::string, geometry::Point> nodes;
        for (const auto& raw : parsed->at("nodes")) {
            const auto id = raw.at("id").get<std::string>();
            if (!nodes.emplace(id, point_cm(raw.at("point"))).second) throw std::invalid_argument("duplicate cadastral node id");
        }
        std::map<std::string, InputEdge> edges;
        for (const auto& raw : parsed->at("edges")) {
            InputEdge edge{raw.at("fromNodeId").get<std::string>(), raw.at("toNodeId").get<std::string>(), raw.at("kind").get<std::string>(), std::nullopt};
            if (raw.contains("roadRef")) edge.road_ref = raw.at("roadRef").get<std::string>();
            const auto id = raw.at("id").get<std::string>();
            if (!edges.emplace(id, std::move(edge)).second) throw std::invalid_argument("duplicate cadastral edge id");
        }

        const auto& parcels = parsed->at("parcels");
        for (const auto& raw : parcels) {
            cadastre::Parcel parcel{};
            parcel.external_id = raw.at("id").get<std::string>();
            parcel.id = cadastre::parcel_id_from_external(parcel.external_id);
            parcel.block_id = raw.at("blockId").get<std::string>();
            parcel.boundary = trace_boundary(raw, edges, nodes);
            parcel.zoning_district_id = raw.at("zoningDistrictId").get<std::string>();
            if (raw.contains("ownerId")) parcel.owner_id = raw.at("ownerId").get<std::string>();
            auto inserted = cadastre_.insert(std::move(parcel));
            if (!inserted) return std::unexpected(from_core(inserted.error()));
        }

        for (const auto& raw : parcels) {
            const auto* parcel = cadastre_.find_external(raw.at("id").get<std::string>());
            if (!parcel) throw std::invalid_argument("restored cadastral parcel missing");
            const std::set<std::string> frontage(raw.at("frontageEdgeIds").begin(), raw.at("frontageEdgeIds").end());
            const std::set<std::string> access(raw.at("accessEdgeIds").begin(), raw.at("accessEdgeIds").end());
            const auto boundary_edge_ids = raw.at("boundaryEdgeIds").get<std::vector<std::string>>();
            for (std::size_t index = 0; index < parcel->boundary.vertices.size() && index < boundary_edge_ids.size(); ++index) {
                const auto left = parcel->boundary.vertices[index];
                const auto right = parcel->boundary.vertices[(index + 1U) % parcel->boundary.vertices.size()];
                const auto input = edges.find(boundary_edge_ids[index]);
                if (input == edges.end()) continue;
                const auto id = native_boundary_id(left, right);
                const bool is_frontage = frontage.contains(boundary_edge_ids[index]);
                const bool is_access = access.contains(boundary_edge_ids[index]);
                if (input->second.kind != "property-boundary" || input->second.road_ref || is_frontage || is_access) {
                    auto semantic = cadastre_.set_boundary_semantics(id, input->second.kind, input->second.road_ref, is_frontage, is_access);
                    if (!semantic) return std::unexpected(from_core(semantic.error()));
                }
            }
        }

        for (const auto& raw : parsed->at("blocks")) {
            cadastre::GeneratedUrbanBlock block{};
            block.external_id = raw.at("id").get<std::string>();
            block.boundary = polygon_cm(raw.at("boundary"));
            for (const auto& name : raw.at("parcelIds")) block.parcel_ids.push_back(cadastre::parcel_id_from_external(name.get<std::string>()));
            blocks_.push_back(std::move(block));
        }
        std::sort(blocks_.begin(), blocks_.end(), [](const auto& left, const auto& right) { return left.external_id < right.external_id; });

        for (const auto& raw : parsed->at("easements")) {
            cadastre::Easement easement{};
            easement.id = raw.at("id").get<std::string>();
            easement.kind = raw.at("kind").get<std::string>();
            for (const auto& name : raw.at("parcelIds")) easement.parcel_ids.push_back(cadastre::parcel_id_from_external(name.get<std::string>()));
            for (const auto& point : raw.at("geometry")) easement.geometry.push_back(point_cm(point));
            auto added = cadastre_.add_easement(std::move(easement));
            if (!added) return std::unexpected(from_core(added.error()));
        }

        for (const auto& raw : parsed->at("lineage")) {
            cadastre::LineageEvent event{};
            event.id = raw.at("id").get<std::string>();
            event.tick = raw.at("tick").get<std::uint64_t>();
            event.kind = raw.at("kind").get<std::string>();
            bool all_present = true;
            for (const auto& name : raw.at("sourceParcelIds")) {
                const auto id = cadastre::parcel_id_from_external(name.get<std::string>());
                event.source_parcel_ids.push_back(id);
                all_present = all_present && cadastre_.find(id) != nullptr;
            }
            for (const auto& name : raw.at("resultingParcelIds")) {
                const auto id = cadastre::parcel_id_from_external(name.get<std::string>());
                event.resulting_parcel_ids.push_back(id);
                all_present = all_present && cadastre_.find(id) != nullptr;
            }
            if (all_present) {
                auto added = cadastre_.append_lineage(std::move(event));
                if (!added) return std::unexpected(from_core(added.error()));
            }
        }
        if (auto valid = cadastre_.validate(); !valid) return std::unexpected(from_core(valid.error()));
        return {};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string("invalid urbanFabric: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<void> NativeUrbanAuthority::restoreZoning(std::string_view text) {
    auto parsed = parse_json(text, "zoningV2");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        std::vector<urban::ParcelZoningAssignment> assignments;
        for (const auto& raw : parsed->at("parcelAssignments")) {
            const auto name = raw.at("parcelId").get<std::string>();
            if (!cadastre_.find_external(name)) throw std::invalid_argument("zoning assignment references missing parcel: " + name);
            assignments.push_back({cadastre::parcel_id_from_external(name), raw.at("districtId").get<std::string>(), raw.at("overlayIds").get<std::vector<std::string>>()});
        }
        auto restored = zoning_.restore_assignments(assignments);
        if (!restored) return std::unexpected(from_core(restored.error()));
        return {};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string("invalid zoningV2: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<void> NativeUrbanAuthority::restoreBuildings(std::string_view text) {
    auto parsed = parse_json(text, "buildingsV2");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        if (!parsed->is_array()) throw std::invalid_argument("buildingsV2 must be an array");
        std::vector<urban::BuildingV2> buildings;
        for (const auto& raw : *parsed) buildings.push_back(parse_building(raw));
        auto restored = buildings_.restore_buildings(buildings);
        if (!restored) return std::unexpected(from_core(restored.error()));
        return {};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string("invalid buildingsV2: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<void> NativeUrbanAuthority::restoreProperty(std::string_view text) {
    auto parsed = parse_json(text, "propertyMarket");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        urban::PropertyMarketSnapshot snapshot{};
        for (const auto& raw : parsed->at("holdings")) {
            snapshot.holdings.push_back({raw.at("parcelId").get<std::string>(), raw.at("ownerId").get<std::string>(), raw.at("reservationValue").get<double>()});
        }
        for (const auto& raw : parsed->at("transactions")) {
            snapshot.transactions.push_back({
                raw.at("id").get<std::string>(),
                raw.at("tick").get<std::uint64_t>(),
                raw.at("parcelIds").get<std::vector<std::string>>(),
                raw.at("buyerId").get<std::string>(),
                raw.at("sellerId").get<std::string>(),
                property_purpose(raw.at("purpose").get<std::string>()),
                raw.at("price").get<double>(),
                raw.at("landValue").get<double>(),
                raw.at("improvementValue").get<double>(),
            });
        }
        snapshot.next_transaction_id = parsed->at("nextTransactionId").get<std::uint64_t>();
        auto restored = property_.restore(snapshot);
        if (!restored) return std::unexpected(from_core(restored.error()));
        return {};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, std::string("invalid propertyMarket: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<std::string> NativeUrbanAuthority::cadastreJson() const {
    try {
        struct EdgeOut final {
            std::string from;
            std::string to;
            std::optional<std::string> left;
            std::optional<std::string> right;
            std::string kind{"property-boundary"};
            std::optional<std::string> road_ref;
        };
        std::map<std::string, geometry::Point> nodes;
        std::map<std::string, EdgeOut> edges;
        json parcels = json::array();
        std::map<std::string, std::vector<std::string>> frontage_by_parcel;

        auto live = cadastre_.live_parcels();
        std::sort(live.begin(), live.end(), [](const auto* left, const auto* right) { return left->external_id < right->external_id; });
        for (const auto* parcel : live) {
            json boundary_ids = json::array();
            json frontage_ids = json::array();
            json access_ids = json::array();
            for (std::size_t index = 0; index < parcel->boundary.vertices.size(); ++index) {
                const auto left_point = parcel->boundary.vertices[index];
                const auto right_point = parcel->boundary.vertices[(index + 1U) % parcel->boundary.vertices.size()];
                const auto left_node = node_id(left_point);
                const auto right_node = node_id(right_point);
                nodes.emplace(left_node, left_point);
                nodes.emplace(right_node, right_point);
                const auto id = edge_id(left_point, right_point);
                boundary_ids.push_back(id);
                const auto native_id = native_boundary_id(left_point, right_point);
                const auto* native = cadastre_.find_boundary(native_id);
                auto [it, inserted] = edges.try_emplace(id, EdgeOut{left_node, right_node, parcel->external_id, std::nullopt});
                if (!inserted && (!it->second.left || *it->second.left != parcel->external_id)) it->second.right = parcel->external_id;
                if (native) {
                    it->second.kind = native->kind;
                    it->second.road_ref = native->road_ref;
                }
                if (std::find(parcel->frontage_boundary_ids.begin(), parcel->frontage_boundary_ids.end(), native_id) != parcel->frontage_boundary_ids.end()) {
                    frontage_ids.push_back(id);
                    frontage_by_parcel[parcel->external_id].push_back(id);
                }
                if (std::find(parcel->access_boundary_ids.begin(), parcel->access_boundary_ids.end(), native_id) != parcel->access_boundary_ids.end()) access_ids.push_back(id);
            }
            json historical = json::array();
            for (const auto parent : parcel->historical_parent_ids) {
                const auto* parent_parcel = cadastre_.find(parent);
                if (parent_parcel) historical.push_back(parent_parcel->external_id);
            }
            json row{
                {"id", parcel->external_id},
                {"blockId", parcel->block_id},
                {"boundaryEdgeIds", std::move(boundary_ids)},
                {"areaM2", parcel->area_m2},
                {"centroid", point_json(parcel->centroid)},
                {"frontageEdgeIds", std::move(frontage_ids)},
                {"accessEdgeIds", std::move(access_ids)},
                {"zoningDistrictId", parcel->zoning_district_id},
                {"historicalParentIds", std::move(historical)},
            };
            if (parcel->owner_id) row["ownerId"] = *parcel->owner_id;
            parcels.push_back(std::move(row));
        }

        json node_rows = json::array();
        for (const auto& [id, point] : nodes) node_rows.push_back({{"id", id}, {"point", point_json(point)}});
        json edge_rows = json::array();
        for (const auto& [id, edge] : edges) {
            json row{{"id", id}, {"fromNodeId", edge.from}, {"toNodeId", edge.to}, {"kind", edge.kind}};
            if (edge.left) row["leftParcelId"] = *edge.left;
            if (edge.right) row["rightParcelId"] = *edge.right;
            if (edge.road_ref) row["roadRef"] = *edge.road_ref;
            edge_rows.push_back(std::move(row));
        }

        json block_rows = json::array();
        auto blocks = blocks_;
        std::sort(blocks.begin(), blocks.end(), [](const auto& left, const auto& right) { return left.external_id < right.external_id; });
        for (const auto& block : blocks) {
            json parcel_ids = json::array();
            std::vector<std::string> road_ids;
            for (const auto id : block.parcel_ids) {
                const auto* parcel = cadastre_.find(id);
                if (!parcel || !parcel->live) continue;
                parcel_ids.push_back(parcel->external_id);
                if (const auto it = frontage_by_parcel.find(parcel->external_id); it != frontage_by_parcel.end()) {
                    road_ids.insert(road_ids.end(), it->second.begin(), it->second.end());
                }
            }
            std::sort(road_ids.begin(), road_ids.end());
            road_ids.erase(std::unique(road_ids.begin(), road_ids.end()), road_ids.end());
            block_rows.push_back({
                {"id", block.external_id},
                {"boundary", polygon_json(block.boundary)},
                {"parcelIds", std::move(parcel_ids)},
                {"roadEdgeIds", road_ids},
            });
        }

        json easements = json::array();
        for (const auto& [_, easement] : cadastre_.easements()) {
            json parcel_ids = json::array();
            for (const auto id : easement.parcel_ids) {
                const auto* parcel = cadastre_.find(id);
                if (parcel) parcel_ids.push_back(parcel->external_id);
            }
            json geometry = json::array();
            for (const auto point : easement.geometry) geometry.push_back(point_json(point));
            easements.push_back({{"id", easement.id}, {"parcelIds", std::move(parcel_ids)}, {"kind", easement.kind}, {"geometry", std::move(geometry)}});
        }

        json lineage = json::array();
        for (const auto& event : cadastre_.lineage()) {
            json source = json::array();
            json resulting = json::array();
            for (const auto id : event.source_parcel_ids) if (const auto* parcel = cadastre_.find(id)) source.push_back(parcel->external_id);
            for (const auto id : event.resulting_parcel_ids) if (const auto* parcel = cadastre_.find(id)) resulting.push_back(parcel->external_id);
            lineage.push_back({{"id", event.id}, {"tick", event.tick}, {"kind", event.kind}, {"sourceParcelIds", std::move(source)}, {"resultingParcelIds", std::move(resulting)}});
        }

        return json{
            {"nodes", std::move(node_rows)},
            {"edges", std::move(edge_rows)},
            {"blocks", std::move(block_rows)},
            {"parcels", std::move(parcels)},
            {"easements", std::move(easements)},
            {"lineage", std::move(lineage)},
        }.dump();
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<std::string> NativeUrbanAuthority::zoningJson() const {
    try {
        json assignments = json::array();
        for (const auto& [parcel_id, assignment] : zoning_.assignments()) {
            const auto* parcel = cadastre_.find(parcel_id);
            if (!parcel || !parcel->live) return std::unexpected(make_error(ErrorCode::invalid_state, "zoning assignment references non-live parcel"));
            assignments.push_back({{"parcelId", parcel->external_id}, {"districtId", assignment.district_id}, {"overlayIds", assignment.overlay_ids}});
        }
        return json{{"parcelAssignments", std::move(assignments)}}.dump();
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<std::string> NativeUrbanAuthority::buildingsJson() const {
    try {
        json output = json::array();
        for (const auto& [_, building] : buildings_.buildings()) output.push_back(building_json(building, cadastre_));
        return output.dump();
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<std::string> NativeUrbanAuthority::propertyJson() const {
    try {
        const auto snapshot = property_.snapshot();
        json holdings = json::array();
        for (const auto& holding : snapshot.holdings) holdings.push_back({{"parcelId", holding.parcel_id}, {"ownerId", holding.owner_id}, {"reservationValue", holding.reservation_value}});
        json transactions = json::array();
        for (const auto& transaction : snapshot.transactions) {
            transactions.push_back({
                {"id", transaction.id},
                {"tick", transaction.tick},
                {"parcelIds", transaction.parcel_ids},
                {"buyerId", transaction.buyer_id},
                {"sellerId", transaction.seller_id},
                {"purpose", property_purpose_name(transaction.purpose)},
                {"price", transaction.price},
                {"landValue", transaction.land_value},
                {"improvementValue", transaction.improvement_value},
            });
        }
        return json{{"holdings", std::move(holdings)}, {"transactions", std::move(transactions)}, {"nextTransactionId", snapshot.next_transaction_id}}.dump();
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<std::string> NativeUrbanAuthority::snapshotJson() const {
    auto cadastre = cadastreJson(); if (!cadastre) return std::unexpected(cadastre.error());
    auto zoning = zoningJson(); if (!zoning) return std::unexpected(zoning.error());
    auto buildings = buildingsJson(); if (!buildings) return std::unexpected(buildings.error());
    auto property = propertyJson(); if (!property) return std::unexpected(property.error());
    try {
        return json{
            {"urbanFabric", json::parse(*cadastre)},
            {"zoningV2", json::parse(*zoning)},
            {"buildingsV2", json::parse(*buildings)},
            {"propertyMarket", json::parse(*property)},
            {"legacyLots", [&] {
                json lots = json::array();
                for (const auto& lot : cadastre_.legacy_lot_projection().lots) {
                    lots.push_back({{"parcelId", lot.parcel_external_id}, {"x", lot.x}, {"y", lot.y}, {"faithful", lot.faithful}});
                }
                return lots;
            }()},
            {"compatibilityDiagnostics", cadastre_.legacy_lot_projection().diagnostics},
        }.dump();
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

Result<std::string> NativeUrbanAuthority::patchSaveV9(std::string_view canonical_save_json) const {
    auto root = parse_json(canonical_save_json, "Save V9");
    if (!root) return std::unexpected(root.error());
    auto cadastre = cadastreJson(); if (!cadastre) return std::unexpected(cadastre.error());
    auto zoning = zoningJson(); if (!zoning) return std::unexpected(zoning.error());
    auto buildings = buildingsJson(); if (!buildings) return std::unexpected(buildings.error());
    auto property = propertyJson(); if (!property) return std::unexpected(property.error());
    try {
        (*root)["urbanFabric"] = json::parse(*cadastre);
        (*root)["zoningV2"] = json::parse(*zoning);
        (*root)["buildingsV2"] = json::parse(*buildings);
        (*root)["propertyMarket"] = json::parse(*property);
        auto reparsed = parseSaveV9(root->dump());
        if (!reparsed) return std::unexpected(reparsed.error());
        return reparsed->canonicalJson;
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::serialization_failure, error.what()));
    }
}

std::uint64_t NativeUrbanAuthority::cadastreHash() const noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const auto& [id, parcel] : cadastre_.parcels()) {
        hash ^= id.value(); hash *= 1099511628211ULL;
        hash ^= geometry::deterministic_hash(parcel.boundary); hash *= 1099511628211ULL;
        hash ^= parcel.live ? 1ULL : 0ULL; hash *= 1099511628211ULL;
    }
    hash ^= cadastre_.revision(); hash *= 1099511628211ULL;
    return hash;
}

std::uint64_t NativeUrbanAuthority::urbanHash() const noexcept {
    std::uint64_t hash = cadastreHash();
    for (const auto& [id, assignment] : zoning_.assignments()) {
        hash ^= id.value(); hash *= 1099511628211ULL;
        hash ^= fnv1a64(assignment.district_id); hash *= 1099511628211ULL;
    }
    for (const auto& [id, building] : buildings_.buildings()) {
        hash ^= id.value(); hash *= 1099511628211ULL;
        hash ^= geometry::deterministic_hash(building.footprint); hash *= 1099511628211ULL;
        hash ^= static_cast<std::uint64_t>(std::llround(building.lifecycle.condition * 1000.0)); hash *= 1099511628211ULL;
    }
    const auto property = property_.snapshot();
    for (const auto& holding : property.holdings) {
        hash ^= fnv1a64(holding.parcel_id); hash *= 1099511628211ULL;
        hash ^= fnv1a64(holding.owner_id); hash *= 1099511628211ULL;
    }
    return hash;
}

}  // namespace civic
