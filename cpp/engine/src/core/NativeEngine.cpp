#include <civic/core/NativeEngine.hpp>

#include <civic/geometry/Geometry.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <utility>
#include <vector>

namespace civic {
namespace {
using json = nlohmann::json;

std::string escapeJson(std::string_view value) {
    std::string output{"\""};
    for (const unsigned char ch : value) {
        switch (ch) {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (ch < 0x20U) {
                    constexpr char hex[] = "0123456789abcdef";
                    output += "\\u00";
                    output.push_back(hex[(ch >> 4U) & 0xfU]);
                    output.push_back(hex[ch & 0xfU]);
                } else {
                    output.push_back(static_cast<char>(ch));
                }
        }
    }
    output.push_back('"');
    return output;
}

std::string bytesToString(const std::vector<std::byte>& bytes) {
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

Error fromCoreError(const core::Error& error) {
    switch (error.code) {
        case core::ErrorCode::none:
            return make_error(ErrorCode::none, error.message);
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

Result<json> parseJson(std::string_view text, std::string_view label) {
    if (text.empty()) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string(label) + " JSON must not be empty"));
    }
    try {
        return json::parse(text.begin(), text.end());
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string(label) + " JSON is invalid: " + error.what()));
    }
}

world::WorldPreset worldPresetFromString(std::string_view value) {
    if (value == "plain") return world::WorldPreset::plain;
    if (value == "river_valley") return world::WorldPreset::river_valley;
    if (value == "basin") return world::WorldPreset::basin;
    if (value == "rolling_uplands") return world::WorldPreset::rolling_uplands;
    if (value == "ridge_edge") return world::WorldPreset::ridge_edge;
    if (value == "coastal_lowland") return world::WorldPreset::coastal_lowland;
    throw std::invalid_argument("invalid world preset: " + std::string(value));
}

std::string_view worldPresetName(world::WorldPreset preset) noexcept {
    switch (preset) {
        case world::WorldPreset::plain: return "plain";
        case world::WorldPreset::river_valley: return "river_valley";
        case world::WorldPreset::basin: return "basin";
        case world::WorldPreset::rolling_uplands: return "rolling_uplands";
        case world::WorldPreset::ridge_edge: return "ridge_edge";
        case world::WorldPreset::coastal_lowland: return "coastal_lowland";
    }
    return "rolling_uplands";
}

world::SoilClass soilClassFromString(std::string_view value) {
    if (value == "rock") return world::SoilClass::rock;
    if (value == "gravel") return world::SoilClass::gravel;
    if (value == "sand") return world::SoilClass::sand;
    if (value == "loam") return world::SoilClass::loam;
    if (value == "clay") return world::SoilClass::clay;
    if (value == "alluvium") return world::SoilClass::alluvium;
    if (value == "peat") return world::SoilClass::peat;
    if (value == "fill_disturbed") return world::SoilClass::fill_disturbed;
    throw std::invalid_argument("invalid soil class: " + std::string(value));
}

std::string_view soilClassName(world::SoilClass value) noexcept {
    switch (value) {
        case world::SoilClass::rock: return "rock";
        case world::SoilClass::gravel: return "gravel";
        case world::SoilClass::sand: return "sand";
        case world::SoilClass::loam: return "loam";
        case world::SoilClass::clay: return "clay";
        case world::SoilClass::alluvium: return "alluvium";
        case world::SoilClass::peat: return "peat";
        case world::SoilClass::fill_disturbed: return "fill_disturbed";
    }
    return "loam";
}

world::VegetationClass vegetationClassFromString(std::string_view value) {
    if (value == "none") return world::VegetationClass::none;
    if (value == "grass") return world::VegetationClass::grass;
    if (value == "forest") return world::VegetationClass::forest;
    if (value == "scrub") return world::VegetationClass::scrub;
    if (value == "wetland") return world::VegetationClass::wetland;
    throw std::invalid_argument("invalid vegetation class: " + std::string(value));
}

std::string_view vegetationClassName(world::VegetationClass value) noexcept {
    switch (value) {
        case world::VegetationClass::none: return "none";
        case world::VegetationClass::grass: return "grass";
        case world::VegetationClass::forest: return "forest";
        case world::VegetationClass::scrub: return "scrub";
        case world::VegetationClass::wetland: return "wetland";
    }
    return "none";
}

world::SurfaceWaterClass surfaceWaterFromString(std::string_view value) {
    if (value == "none") return world::SurfaceWaterClass::none;
    if (value == "lake") return world::SurfaceWaterClass::lake;
    if (value == "river") return world::SurfaceWaterClass::river;
    if (value == "coast") return world::SurfaceWaterClass::coast;
    throw std::invalid_argument("invalid surface water class: " + std::string(value));
}

std::string_view surfaceWaterName(world::SurfaceWaterClass value) noexcept {
    switch (value) {
        case world::SurfaceWaterClass::none: return "none";
        case world::SurfaceWaterClass::lake: return "lake";
        case world::SurfaceWaterClass::river: return "river";
        case world::SurfaceWaterClass::coast: return "coast";
    }
    return "none";
}

world::GeographyKind geographyKindFromString(std::string_view value) {
    if (value == "region") return world::GeographyKind::region;
    if (value == "municipality") return world::GeographyKind::municipality;
    if (value == "district") return world::GeographyKind::district;
    if (value == "neighborhood") return world::GeographyKind::neighborhood;
    if (value == "block") return world::GeographyKind::block;
    throw std::invalid_argument("invalid geography kind: " + std::string(value));
}

std::string_view geographyKindName(world::GeographyKind value) noexcept {
    switch (value) {
        case world::GeographyKind::region: return "region";
        case world::GeographyKind::municipality: return "municipality";
        case world::GeographyKind::district: return "district";
        case world::GeographyKind::neighborhood: return "neighborhood";
        case world::GeographyKind::block: return "block";
    }
    return "region";
}

world::ScenarioPolygon parseScenarioPolygon(const json& value) {
    const auto& points = value.at("points");
    if (!points.is_array()) throw std::invalid_argument("scenario polygon points must be an array");
    world::ScenarioPolygon polygon{};
    polygon.points.reserve(points.size());
    for (const auto& point : points) {
        polygon.points.push_back({
            point.at("x").get<double>(),
            point.at("y").get<double>(),
        });
    }
    return polygon;
}

geometry::Polygon parseLegalPolygon(const json& value) {
    const auto& points = value.at("points");
    if (!points.is_array()) throw std::invalid_argument("geography polygon points must be an array");
    geometry::Polygon polygon{};
    polygon.vertices.reserve(points.size());
    for (const auto& point : points) {
        const auto x = point.at("x").get<double>();
        const auto y = point.at("y").get<double>();
        if (!std::isfinite(x) || !std::isfinite(y)) {
            throw std::invalid_argument("geography polygon coordinates must be finite");
        }
        polygon.vertices.push_back({
            static_cast<geometry::Coordinate>(std::llround(x * 100.0)),
            static_cast<geometry::Coordinate>(std::llround(y * 100.0)),
        });
    }
    const auto canonical = geometry::canonicalize(polygon);
    if (!canonical) throw std::invalid_argument(canonical.error().message);
    return *canonical;
}

world::GeographyHierarchy parseGeography(const json& value) {
    const auto& entities = value.at("entities");
    if (!entities.is_array()) throw std::invalid_argument("geography entities must be an array");
    world::GeographyHierarchy hierarchy{};
    hierarchy.entities.reserve(entities.size());
    for (const auto& entity : entities) {
        std::string parent{};
        if (entity.contains("parentId") && !entity.at("parentId").is_null()) {
            parent = entity.at("parentId").get<std::string>();
        }
        hierarchy.entities.push_back({
            entity.at("id").get<std::string>(),
            geographyKindFromString(entity.at("kind").get<std::string>()),
            std::move(parent),
            parseLegalPolygon(entity.at("boundary")),
            entity.at("sortKey").get<std::string>(),
        });
    }
    return hierarchy;
}

world::WorldConfig parseWorldConfig(const json& value) {
    const auto width = value.at("width").get<std::uint32_t>();
    const auto height = value.at("height").get<std::uint32_t>();
    const auto meters_per_cell = value.at("metersPerCell").get<double>();
    const auto preset = worldPresetFromString(value.at("preset").get<std::string>());
    if (width == 0U || height == 0U || !std::isfinite(meters_per_cell) || meters_per_cell <= 0.0) {
        throw std::invalid_argument("invalid world config");
    }
    return {width, height, meters_per_cell, preset};
}

world::ScenarioWorldDefinition parseScenario(const json& value) {
    world::ScenarioWorldDefinition scenario{};
    scenario.id = value.at("id").get<std::string>();

    if (value.contains("generation")) {
        const auto& generation = value.at("generation");
        world::ScenarioGenerationOverrides overrides{};
        if (generation.contains("width")) overrides.width = generation.at("width").get<std::uint32_t>();
        if (generation.contains("height")) overrides.height = generation.at("height").get<std::uint32_t>();
        if (generation.contains("metersPerCell")) overrides.meters_per_cell = generation.at("metersPerCell").get<double>();
        if (generation.contains("preset")) overrides.preset = worldPresetFromString(generation.at("preset").get<std::string>());
        scenario.generation = overrides;
    }
    if (value.contains("rootBoundary")) {
        scenario.root_boundary = parseScenarioPolygon(value.at("rootBoundary"));
    }
    if (value.contains("elevationOverrides")) {
        for (const auto& item : value.at("elevationOverrides")) {
            scenario.elevation_overrides.push_back({
                item.at("x").get<std::int64_t>(),
                item.at("y").get<std::int64_t>(),
                item.at("elevationMeters").get<double>(),
            });
        }
    }
    if (value.contains("permanentWaterPolygons")) {
        for (const auto& item : value.at("permanentWaterPolygons")) {
            const auto water = surfaceWaterFromString(item.at("class").get<std::string>());
            if (water == world::SurfaceWaterClass::none) {
                throw std::invalid_argument("scenario permanent water class must not be none");
            }
            scenario.permanent_water_regions.push_back({
                water,
                parseScenarioPolygon(item.at("polygon")),
            });
        }
    }
    if (value.contains("soilRegions")) {
        for (const auto& item : value.at("soilRegions")) {
            scenario.soil_regions.push_back({
                soilClassFromString(item.at("soilClass").get<std::string>()),
                parseScenarioPolygon(item.at("polygon")),
            });
        }
    }
    if (value.contains("groundwaterRegions")) {
        for (const auto& item : value.at("groundwaterRegions")) {
            scenario.groundwater_regions.push_back({
                item.at("depthMeters").get<double>(),
                parseScenarioPolygon(item.at("polygon")),
            });
        }
    }
    if (value.contains("contaminationRegions")) {
        for (const auto& item : value.at("contaminationRegions")) {
            scenario.contamination_regions.push_back({
                item.at("index").get<double>(),
                parseScenarioPolygon(item.at("polygon")),
            });
        }
    }
    if (value.contains("administrativeBoundaries")) {
        scenario.administrative_boundaries = parseGeography(value.at("administrativeBoundaries"));
    }
    return scenario;
}

world::TerrainField parseTerrain(const json& value) {
    world::TerrainField terrain{};
    terrain.width = value.at("width").get<std::uint32_t>();
    terrain.height = value.at("height").get<std::uint32_t>();
    terrain.meters_per_cell = value.at("metersPerCell").get<double>();
    const auto& samples = value.at("samples");
    if (!samples.is_array()) throw std::invalid_argument("terrain samples must be an array");
    terrain.samples.reserve(samples.size());
    for (const auto& sample : samples) {
        terrain.samples.push_back({
            sample.at("elevationMeters").get<double>(),
            sample.at("slope").get<double>(),
            sample.at("aspectRadians").get<double>(),
            soilClassFromString(sample.at("soilClass").get<std::string>()),
            sample.at("soilDepthMeters").get<double>(),
            sample.at("bearingCapacityKpa").get<double>(),
            sample.at("bedrockDepthMeters").get<double>(),
            sample.at("groundwaterDepthMeters").get<double>(),
            vegetationClassFromString(sample.at("vegetationClass").get<std::string>()),
            sample.at("contaminationIndex").get<double>(),
            sample.at("landPreparationMultiplier").get<double>(),
            surfaceWaterFromString(sample.at("surfaceWater").get<std::string>()),
            sample.at("buildable").get<bool>(),
        });
    }
    return terrain;
}

world::HydrologyState parseHydrology(const json& value) {
    world::HydrologyState hydrology{};
    hydrology.width = value.at("width").get<std::uint32_t>();
    hydrology.height = value.at("height").get<std::uint32_t>();
    hydrology.conditioned_elevation_meters =
        value.at("conditionedElevationMeters").get<std::vector<double>>();

    for (const auto& receiver : value.at("receiver")) {
        if (receiver.is_null()) hydrology.receiver.push_back(std::nullopt);
        else hydrology.receiver.push_back(receiver.get<std::uint32_t>());
    }
    for (const auto& watershed : value.at("watersheds")) {
        std::optional<std::string> primary{};
        if (!watershed.at("primaryChannelId").is_null()) {
            primary = watershed.at("primaryChannelId").get<std::string>();
        }
        hydrology.watersheds.push_back({
            watershed.at("id").get<std::string>(),
            watershed.at("outletIndex").get<std::uint32_t>(),
            watershed.at("memberCount").get<std::uint32_t>(),
            watershed.at("upstreamAreaCells").get<double>(),
            std::move(primary),
        });
    }
    for (const auto& channel : value.at("channels")) {
        hydrology.channels.push_back({
            channel.at("id").get<std::string>(),
            channel.at("fromIndex").get<std::uint32_t>(),
            channel.at("toIndex").get<std::uint32_t>(),
            channel.at("accumulation").get<double>(),
            channel.at("capacityVolumeM3").get<double>(),
        });
    }
    hydrology.flow_accumulation = value.at("flowAccumulation").get<std::vector<double>>();
    hydrology.watershed_ids = value.at("watershedIds").get<std::vector<std::string>>();
    hydrology.flood_susceptibility = value.at("floodSusceptibility").get<std::vector<double>>();
    return hydrology;
}

world::FloodResult parseFloodResult(const json& value) {
    return {
        value.at("eventId").get<std::string>(),
        value.at("depthMeters").get<std::vector<double>>(),
        value.at("rainfallVolume").get<double>(),
        value.at("infiltrationVolume").get<double>(),
        value.at("retainedChannelSurfaceVolume").get<double>(),
        value.at("overbankFloodVolume").get<double>(),
        value.at("exportedVolume").get<double>(),
        value.at("balanceError").get<double>(),
    };
}

json floodResultJson(const world::FloodResult& result) {
    return {
        {"eventId", result.event_id},
        {"depthMeters", result.depth_meters},
        {"rainfallVolume", result.rainfall_volume},
        {"infiltrationVolume", result.infiltration_volume},
        {"retainedChannelSurfaceVolume", result.retained_channel_surface_volume},
        {"overbankFloodVolume", result.overbank_flood_volume},
        {"exportedVolume", result.exported_volume},
        {"balanceError", result.balance_error},
    };
}

json terrainJson(const world::TerrainField& terrain) {
    json samples = json::array();
    for (const auto& sample : terrain.samples) {
        samples.push_back({
            {"elevationMeters", sample.elevation_meters},
            {"slope", sample.slope},
            {"aspectRadians", sample.aspect_radians},
            {"soilClass", soilClassName(sample.soil_class)},
            {"soilDepthMeters", sample.soil_depth_meters},
            {"bearingCapacityKpa", sample.bearing_capacity_kpa},
            {"bedrockDepthMeters", sample.bedrock_depth_meters},
            {"groundwaterDepthMeters", sample.groundwater_depth_meters},
            {"vegetationClass", vegetationClassName(sample.vegetation_class)},
            {"contaminationIndex", sample.contamination_index},
            {"landPreparationMultiplier", sample.land_preparation_multiplier},
            {"surfaceWater", surfaceWaterName(sample.surface_water)},
            {"buildable", sample.buildable},
        });
    }
    return {
        {"width", terrain.width},
        {"height", terrain.height},
        {"metersPerCell", terrain.meters_per_cell},
        {"samples", std::move(samples)},
    };
}

json hydrologyJson(const world::HydrologyState& hydrology) {
    json receiver = json::array();
    for (const auto& item : hydrology.receiver) {
        if (item.has_value()) receiver.push_back(*item);
        else receiver.push_back(nullptr);
    }

    json watersheds = json::array();
    for (const auto& item : hydrology.watersheds) {
        watersheds.push_back({
            {"id", item.id},
            {"outletIndex", item.outlet_index},
            {"memberCount", item.member_count},
            {"upstreamAreaCells", item.upstream_area_cells},
            {"primaryChannelId", item.primary_channel_id.has_value() ? json(*item.primary_channel_id) : json(nullptr)},
        });
    }

    json channels = json::array();
    for (const auto& item : hydrology.channels) {
        channels.push_back({
            {"id", item.id},
            {"fromIndex", item.from_index},
            {"toIndex", item.to_index},
            {"accumulation", item.accumulation},
            {"capacityVolumeM3", item.capacity_volume_m3},
        });
    }

    return {
        {"width", hydrology.width},
        {"height", hydrology.height},
        {"conditionedElevationMeters", hydrology.conditioned_elevation_meters},
        {"receiver", std::move(receiver)},
        {"watersheds", std::move(watersheds)},
        {"channels", std::move(channels)},
        {"flowAccumulation", hydrology.flow_accumulation},
        {"watershedIds", hydrology.watershed_ids},
        {"floodSusceptibility", hydrology.flood_susceptibility},
    };
}

json geographyJson(const world::GeographyHierarchy& geography) {
    json entities = json::array();
    for (const auto& entity : geography.entities) {
        json points = json::array();
        for (const auto& point : entity.boundary.vertices) {
            points.push_back({
                {"x", static_cast<double>(point.x) / 100.0},
                {"y", static_cast<double>(point.y) / 100.0},
            });
        }
        entities.push_back({
            {"id", entity.id},
            {"kind", geographyKindName(entity.kind)},
            {"parentId", entity.parent_id.empty() ? json(nullptr) : json(entity.parent_id)},
            {"boundary", {{"points", std::move(points)}}},
            {"sortKey", entity.sort_key},
        });
    }
    return {{"entities", std::move(entities)}};
}

world::GeographyHierarchy legacyGeography(std::uint32_t width, std::uint32_t height) {
    const auto boundary = geometry::rectangle(
        0,
        0,
        static_cast<geometry::Coordinate>(width) * 100,
        static_cast<geometry::Coordinate>(height) * 100);
    world::GeographyHierarchy hierarchy{};
    hierarchy.entities = {
        {"region:0", world::GeographyKind::region, "", boundary, "0"},
        {"municipality:region:0:000", world::GeographyKind::municipality, "region:0", boundary, "0.0"},
        {"district:legacy:000", world::GeographyKind::district, "municipality:region:0:000", boundary, "0.0.0"},
        {"neighborhood:legacy:000", world::GeographyKind::neighborhood, "district:legacy:000", boundary, "0.0.0.0"},
        {"block:legacy:000", world::GeographyKind::block, "neighborhood:legacy:000", boundary, "0.0.0.0.0"},
    };
    return hierarchy;
}

Result<world::WorldFoundation> restoreFoundationFromSnapshotJson(const json& root) {
    try {
        world::WorldSnapshot snapshot{};
        snapshot.seed = root.at("seed").get<std::uint32_t>();
        snapshot.config = parseWorldConfig(root.at("config"));
        snapshot.terrain = parseTerrain(root.at("terrain"));
        snapshot.geography = parseGeography(root.at("geography"));
        snapshot.hydrology = parseHydrology(root.at("hydrology"));
        if (root.contains("scenarioId") && !root.at("scenarioId").is_null()) {
            snapshot.scenario_id = root.at("scenarioId").get<std::string>();
        }
        auto restored = world::WorldFoundation::restore(std::move(snapshot));
        if (!restored) return std::unexpected(fromCoreError(restored.error()));
        return std::move(*restored);
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string("world snapshot is invalid: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

} // namespace

NativeEngine::NativeEngine(const EngineConfig& config)
    : seed_(config.seed),
      clock_(config.startTick, config.speed),
      random_(config.seed) {
    (void)invariants_.registerInvariant(InvariantDefinition{
        "kernel-clock-valid", {1, 0}, [](std::uint64_t) -> Result<void> { return {}; }
    });
}

Result<std::unique_ptr<NativeEngine>> NativeEngine::create(const EngineConfig& config) {
    try {
        return std::unique_ptr<NativeEngine>(new NativeEngine(config));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::internal_error, error.what()));
    } catch (...) {
        return std::unexpected(make_error(ErrorCode::internal_error, "unknown native engine creation failure"));
    }
}

Result<void> NativeEngine::submit(std::span<const CommandEnvelope> commands) {
    return commands_.submit(commands, clock_.tick());
}

Result<void> NativeEngine::step(std::uint64_t ticks) {
    if (ticks == 0) return {};
    for (std::uint64_t index = 0; index < ticks; ++index) {
        const auto checkpoint_clock = clock_;
        const auto checkpoint_commands = commands_;
        const auto checkpoint_events = events_;
        const auto checkpoint_random = random_;
        auto rollback = [&] {
            clock_ = checkpoint_clock;
            commands_ = checkpoint_commands;
            events_ = checkpoint_events;
            random_ = checkpoint_random;
        };
        auto advanced = clock_.step(1);
        if (!advanced) {
            rollback();
            return advanced;
        }
        auto ready = commands_.takeReady(clock_.tick());
        for (const auto& command : ready) {
            events_.append(clock_.tick(), command.type, "shadow-command", command.payload);
        }
        auto due = scheduler_.dueSystems(clock_.tick());
        if (!due) {
            rollback();
            return std::unexpected(due.error());
        }
        for (auto* system : *due) {
            if (!system->execute) continue;
            auto executed = system->execute(clock_.tick());
            if (!executed) {
                rollback();
                return executed;
            }
        }
        auto valid = invariants_.runDue(clock_.tick());
        if (!valid) {
            rollback();
            return valid;
        }
    }
    return {};
}

std::string NativeEngine::kernelCanonicalState() const {
    std::ostringstream out;
    out << "{\"hashVersion\":1,\"pendingCommands\":[";
    bool first = true;
    for (const auto& command : commands_.pending()) {
        if (!first) out << ',';
        first = false;
        out << "{\"payload\":" << escapeJson(bytesToString(command.payload))
            << ",\"sequence\":" << command.sequence
            << ",\"tick\":" << command.tick
            << ",\"type\":" << escapeJson(command.type) << '}';
    }
    out << "],\"randomStreams\":{";
    first = true;
    for (const auto& [name, state] : random_.snapshot()) {
        if (!first) out << ',';
        first = false;
        out << escapeJson(name) << ':' << state;
    }
    out << "},\"seed\":" << seed_
        << ",\"speed\":" << static_cast<std::uint32_t>(clock_.speed())
        << ",\"tick\":" << clock_.tick() << '}';
    return out.str();
}

Result<SnapshotBlob> NativeEngine::snapshot() const {
    return SnapshotBlob{kernelCanonicalState()};
}

Result<EventBlob> NativeEngine::drainEvents() {
    auto drained = events_.drain();
    std::ostringstream out;
    out << '[';
    for (std::size_t i = 0; i < drained.size(); ++i) {
        if (i != 0) out << ',';
        const auto& event = drained[i];
        out << "{\"payload\":" << escapeJson(bytesToString(event.payload))
            << ",\"sequence\":" << event.sequence
            << ",\"source\":" << escapeJson(event.source)
            << ",\"tick\":" << event.tick
            << ",\"type\":" << escapeJson(event.type) << '}';
    }
    out << ']';
    return EventBlob{out.str()};
}

std::uint64_t NativeEngine::fnv1a64(std::string_view bytes) noexcept {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ULL;
    }
    return hash;
}

Result<DomainHash> NativeEngine::domainHash(std::string_view domain) const {
    if (domain == "kernel") {
        return DomainHash{DomainOwnership::owned, 1, fnv1a64(kernelCanonicalState())};
    }
    if (domain == "world") {
        if (!world_.has_value()) return DomainHash{DomainOwnership::unowned, 1, 0};
        return DomainHash{DomainOwnership::owned, 1, world_->deterministic_hash()};
    }
    static constexpr std::string_view unowned[] = {
        "cadastre", "buildings", "transportation", "population", "economy", "services"
    };
    if (std::ranges::find(unowned, domain) != std::end(unowned)) {
        return DomainHash{DomainOwnership::unowned, 1, 0};
    }
    return std::unexpected(make_error(
        ErrorCode::invalid_argument,
        "unknown domain hash: " + std::string{domain}));
}

Result<void> NativeEngine::loadV9(std::string_view json_text) {
    auto parsed = parseSaveV9(json_text);
    if (!parsed) return std::unexpected(parsed.error());
    seed_ = parsed->seed;
    clock_.restore(parsed->tick, parsed->speed);
    random_ = RandomStreamRegistry(seed_);
    commands_ = CommandQueue{};
    events_ = DomainEventJournal{};
    loaded_save_ = std::move(*parsed);
    return {};
}

Result<std::string> NativeEngine::saveV9() const {
    if (!loaded_save_) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "no Save V9 is loaded"));
    }
    return loaded_save_->canonicalJson;
}

Result<std::string> NativeEngine::worldSnapshotJson() const {
    if (!world_.has_value()) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "native world is not initialized"));
    }
    const auto& snapshot = world_->snapshot();
    json root{
        {"mode", world_mode_},
        {"seed", snapshot.seed},
        {"config", {
            {"width", snapshot.config.width},
            {"height", snapshot.config.height},
            {"metersPerCell", snapshot.config.meters_per_cell},
            {"preset", worldPresetName(snapshot.config.preset)},
        }},
        {"scenarioId", snapshot.scenario_id.has_value() ? json(*snapshot.scenario_id) : json(nullptr)},
        {"terrain", terrainJson(snapshot.terrain)},
        {"hydrology", hydrologyJson(snapshot.hydrology)},
        {"geography", geographyJson(snapshot.geography)},
        {"legacyCompatibility", nullptr},
        {"lastFloodResult", last_world_flood_.has_value() ? floodResultJson(*last_world_flood_) : json(nullptr)},
    };
    if (legacy_compatibility_json_.has_value()) {
        try {
            root["legacyCompatibility"] = json::parse(*legacy_compatibility_json_);
        } catch (const json::exception& error) {
            return std::unexpected(make_error(
                ErrorCode::serialization_failure,
                std::string("stored legacy terrain JSON is invalid: ") + error.what()));
        }
    }
    return root.dump();
}

Result<SnapshotBlob> NativeEngine::createWorld(std::string_view request_json) {
    auto parsed = parseJson(request_json, "world create request");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        const auto seed = parsed->at("seed").get<std::uint32_t>();
        const auto config = parseWorldConfig(parsed->at("config"));

        core::Result<world::WorldFoundation> generated =
            parsed->contains("scenario") && !parsed->at("scenario").is_null()
                ? world::WorldFoundation::generate(seed, config, parseScenario(parsed->at("scenario")))
                : world::WorldFoundation::generate(seed, config);
        if (!generated) return std::unexpected(fromCoreError(generated.error()));

        world_ = std::move(*generated);
        world_mode_ = "generated-1r";
        last_world_flood_.reset();
        legacy_compatibility_json_.reset();

        auto snapshot = worldSnapshotJson();
        if (!snapshot) return std::unexpected(snapshot.error());
        return SnapshotBlob{std::move(*snapshot)};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string("world create request is invalid: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<SnapshotBlob> NativeEngine::restoreWorld(std::string_view snapshot_json) {
    auto parsed = parseJson(snapshot_json, "world snapshot");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        auto restored = restoreFoundationFromSnapshotJson(*parsed);
        if (!restored) return std::unexpected(restored.error());

        const auto mode = parsed->at("mode").get<std::string>();
        if (mode != "generated-1r" && mode != "legacy-flat" && mode != "legacy-explicit") {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid world mode: " + mode));
        }

        world_ = std::move(*restored);
        world_mode_ = mode;
        last_world_flood_.reset();
        if (parsed->contains("lastFloodResult") && !parsed->at("lastFloodResult").is_null()) {
            last_world_flood_ = parseFloodResult(parsed->at("lastFloodResult"));
        }
        legacy_compatibility_json_.reset();
        if (parsed->contains("legacyCompatibility") && !parsed->at("legacyCompatibility").is_null()) {
            legacy_compatibility_json_ = parsed->at("legacyCompatibility").dump();
        }

        auto snapshot = worldSnapshotJson();
        if (!snapshot) return std::unexpected(snapshot.error());
        return SnapshotBlob{std::move(*snapshot)};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string("world snapshot is invalid: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<SnapshotBlob> NativeEngine::createLegacyWorld(std::string_view request_json) {
    auto parsed = parseJson(request_json, "legacy world request");
    if (!parsed) return std::unexpected(parsed.error());
    try {
        const auto seed = parsed->at("seed").get<std::uint32_t>();
        const auto mode = parsed->at("mode").get<std::string>();
        if (mode != "legacy-flat" && mode != "legacy-explicit") {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid legacy world mode: " + mode));
        }

        const auto& terrain_json = parsed->at("terrain");
        const auto width = terrain_json.at("width").get<std::uint32_t>();
        const auto height = terrain_json.at("height").get<std::uint32_t>();
        const auto& cells = terrain_json.at("cells");
        if (width == 0U || height == 0U || !cells.is_array() ||
            cells.size() != static_cast<std::size_t>(width) * height) {
            return std::unexpected(make_error(ErrorCode::invalid_argument, "invalid legacy terrain dimensions"));
        }

        world::TerrainField terrain{width, height, 30.0, {}};
        terrain.samples.reserve(cells.size());
        std::vector<double> elevations;
        std::vector<std::uint8_t> permanent_water;
        elevations.reserve(cells.size());
        permanent_water.reserve(cells.size());

        for (const auto& cell : cells) {
            const auto elevation = cell.at("elevation").get<double>() * 100.0;
            const auto water = cell.at("water").get<bool>();
            const auto buildable = cell.at("buildable").get<bool>();
            const auto biome = cell.at("biome").get<std::string>();
            if (!std::isfinite(elevation)) {
                return std::unexpected(make_error(ErrorCode::invalid_argument, "legacy terrain elevation must be finite"));
            }
            const auto vegetation =
                biome == "forest" ? world::VegetationClass::forest : world::VegetationClass::grass;
            terrain.samples.push_back({
                elevation,
                0.0,
                0.0,
                world::SoilClass::loam,
                2.0,
                160.0,
                8.0,
                5.0,
                vegetation,
                0.0,
                1.0,
                water ? world::SurfaceWaterClass::lake : world::SurfaceWaterClass::none,
                buildable,
            });
            elevations.push_back(elevation);
            permanent_water.push_back(water ? 1U : 0U);
        }

        auto conditioned = world::resolve_depressions(width, height, elevations, permanent_water);
        if (!conditioned) return std::unexpected(fromCoreError(conditioned.error()));
        auto hydrology = world::build_hydrology(terrain, *conditioned);
        if (!hydrology) return std::unexpected(fromCoreError(hydrology.error()));

        world::WorldSnapshot native_snapshot{};
        native_snapshot.seed = seed;
        native_snapshot.config = {width, height, 30.0, world::WorldPreset::plain};
        native_snapshot.terrain = std::move(terrain);
        native_snapshot.geography = legacyGeography(width, height);
        native_snapshot.hydrology = std::move(*hydrology);

        auto restored = world::WorldFoundation::restore(std::move(native_snapshot));
        if (!restored) return std::unexpected(fromCoreError(restored.error()));

        world_ = std::move(*restored);
        world_mode_ = mode;
        last_world_flood_.reset();
        legacy_compatibility_json_ = terrain_json.dump();

        auto snapshot = worldSnapshotJson();
        if (!snapshot) return std::unexpected(snapshot.error());
        return SnapshotBlob{std::move(*snapshot)};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string("legacy world request is invalid: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

Result<SnapshotBlob> NativeEngine::runDesignStorm(std::string_view request_json) {
    if (!world_.has_value()) {
        return std::unexpected(make_error(ErrorCode::invalid_state, "native world is not initialized"));
    }
    auto parsed = parseJson(request_json, "design storm request");
    if (!parsed) return std::unexpected(parsed.error());

    try {
        const json* event_json = &*parsed;
        const json* impervious_json = nullptr;
        if (parsed->contains("event")) {
            event_json = &parsed->at("event");
            if (parsed->contains("imperviousFraction")) {
                impervious_json = &parsed->at("imperviousFraction");
            }
        }

        world::DesignStormEvent event{
            event_json->at("id").get<std::string>(),
            event_json->at("rainfallMm").get<double>(),
            event_json->at("durationHours").get<double>(),
            event_json->contains("saturationFactor")
                ? event_json->at("saturationFactor").get<double>()
                : 1.0,
        };

        std::vector<double> impervious{};
        const std::vector<double>* impervious_pointer = nullptr;
        if (impervious_json != nullptr) {
            impervious = impervious_json->get<std::vector<double>>();
            const auto expected =
                static_cast<std::size_t>(world_->terrain().width) * world_->terrain().height;
            if (impervious.size() != expected) {
                return std::unexpected(make_error(
                    ErrorCode::invalid_argument,
                    "impervious fraction array does not match world dimensions"));
            }
            for (const auto value : impervious) {
                if (!std::isfinite(value) || value < 0.0 || value > 1.0) {
                    return std::unexpected(make_error(
                        ErrorCode::invalid_argument,
                        "impervious fractions must be finite values in [0,1]"));
                }
            }
            impervious_pointer = &impervious;
        }

        auto result = world::run_design_storm(
            event,
            world_->terrain(),
            world_->hydrology(),
            impervious_pointer);
        if (!result) return std::unexpected(fromCoreError(result.error()));
        last_world_flood_ = std::move(*result);

        auto snapshot = worldSnapshotJson();
        if (!snapshot) return std::unexpected(snapshot.error());

        json response{
            {"result", floodResultJson(*last_world_flood_)},
            {"snapshot", json::parse(*snapshot)},
        };
        return SnapshotBlob{response.dump()};
    } catch (const json::exception& error) {
        return std::unexpected(make_error(
            ErrorCode::serialization_failure,
            std::string("design storm request is invalid: ") + error.what()));
    } catch (const std::exception& error) {
        return std::unexpected(make_error(ErrorCode::invalid_argument, error.what()));
    }
}

} // namespace civic
