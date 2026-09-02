#include <gtest/gtest.h>

#include <civic/presentation/Presentation.hpp>

#include <json-c/json.h>

#include <cmath>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace civic::presentation;

namespace {

struct JsonObjectDeleter {
    void operator()(json_object* value) const noexcept {
        if (value) (void)json_object_put(value);
    }
};
using JsonObjectPtr = std::unique_ptr<json_object, JsonObjectDeleter>;

json_object* requiredField(json_object* object, const char* key) {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(object, key, &value) || !value) {
        throw std::runtime_error(std::string("shared camera fixture is missing field: ") + key);
    }
    return value;
}

double requiredNumber(json_object* object, const char* key) {
    auto* value = requiredField(object, key);
    if (!json_object_is_type(value, json_type_double) && !json_object_is_type(value, json_type_int)) {
        throw std::runtime_error(std::string("shared camera fixture field is not numeric: ") + key);
    }
    return json_object_get_double(value);
}

std::uint32_t requiredUInt(json_object* object, const char* key) {
    auto* value = requiredField(object, key);
    if (!json_object_is_type(value, json_type_int)) {
        throw std::runtime_error(std::string("shared camera fixture field is not integral: ") + key);
    }
    const auto number = json_object_get_int64(value);
    if (number < 0) throw std::runtime_error(std::string("shared camera fixture field is negative: ") + key);
    return static_cast<std::uint32_t>(number);
}

Point2 requiredPoint(json_object* object, const char* key) {
    auto* point = requiredField(object, key);
    if (!json_object_is_type(point, json_type_object)) {
        throw std::runtime_error(std::string("shared camera fixture field is not a point: ") + key);
    }
    return {requiredNumber(point, "x"), requiredNumber(point, "y")};
}

struct SharedCameraFixture {
    IsoMetrics metrics{};
    WorldSize world{};
    Point2 fractional_point{};
    std::vector<std::pair<std::uint32_t, std::uint32_t>> cells;
    Point2 focus_world{};
    Point2 zoom_cell{};
    double zoom_factor{};
    double zoom_max_probe{};
    double zoom_min_probe{};
    double zoom_max{};
    double zoom_min{};
    Point2 outside_canvas{};
};

SharedCameraFixture loadSharedCameraFixture() {
    const auto path = std::filesystem::path(CIVIC_REPOSITORY_ROOT) / "tests" / "fixtures" / "isometric-camera-parity.json";
    JsonObjectPtr root{json_object_from_file(path.string().c_str())};
    if (!root || !json_object_is_type(root.get(), json_type_object)) {
        throw std::runtime_error("failed to load shared TypeScript/native camera fixture: " + path.string());
    }

    SharedCameraFixture fixture{};
    auto* metrics = requiredField(root.get(), "metrics");
    fixture.metrics = {requiredNumber(metrics, "tileWidth"), requiredNumber(metrics, "tileHeight")};
    auto* world = requiredField(root.get(), "world");
    fixture.world = {requiredUInt(world, "width"), requiredUInt(world, "height")};
    fixture.fractional_point = requiredPoint(root.get(), "fractionalPoint");
    fixture.focus_world = requiredPoint(root.get(), "focusWorld");
    fixture.zoom_cell = requiredPoint(root.get(), "zoomCell");
    fixture.zoom_factor = requiredNumber(root.get(), "zoomFactor");
    fixture.zoom_max_probe = requiredNumber(root.get(), "zoomMaxProbe");
    fixture.zoom_min_probe = requiredNumber(root.get(), "zoomMinProbe");
    fixture.zoom_max = requiredNumber(root.get(), "zoomMax");
    fixture.zoom_min = requiredNumber(root.get(), "zoomMin");
    fixture.outside_canvas = requiredPoint(root.get(), "outsideCanvas");

    auto* cells = requiredField(root.get(), "cells");
    if (!json_object_is_type(cells, json_type_array)) throw std::runtime_error("shared camera fixture cells must be an array");
    const auto cell_count = json_object_array_length(cells);
    fixture.cells.reserve(cell_count);
    for (std::size_t index = 0; index < cell_count; ++index) {
        auto* cell = json_object_array_get_idx(cells, index);
        if (!cell || !json_object_is_type(cell, json_type_object)) throw std::runtime_error("shared camera fixture contains an invalid cell");
        fixture.cells.emplace_back(requiredUInt(cell, "x"), requiredUInt(cell, "y"));
    }
    return fixture;
}

FrameSnapshot makeSnapshot() {
    FrameSnapshot snapshot{};
    snapshot.revision = 7;
    snapshot.world = WorldSize{16, 12};
    snapshot.terrain.push_back(TerrainCellSnapshot{
        .id = "terrain:2:3",
        .revision = 1,
        .x = 2,
        .y = 3,
        .biome = TerrainBiome::Rock,
        .buildable = false,
        .water = false,
        .elevation_m = 18.0F,
        .flood_depth_m = 0.0F,
    });
    snapshot.parcels.push_back(ParcelSnapshot{
        .id = "parcel:irregular",
        .revision = 6,
        .polygon = {{1.5, 1.5}, {5.5, 1.5}, {5.5, 4.5}, {1.5, 4.5}},
    });
    snapshot.roads.push_back(RoadSnapshot{
        .id = "road:main",
        .revision = 4,
        .road_class = RoadClass::Arterial,
        .from = {1.0, 2.0},
        .to = {6.0, 2.0},
        .lanes = 4,
        .one_way = false,
        .condition = 0.85F,
        .congestion = 0.62F,
        .speed_ratio = 0.55F,
        .volume = 410.0F,
    });
    snapshot.buildings.push_back(BuildingSnapshot{
        .id = "building:mixed",
        .revision = 9,
        .parcel_id = "parcel:irregular",
        .footprint = {{2.0, 2.0}, {5.0, 2.0}, {4.5, 4.0}, {2.0, 3.5}},
        .floors = 6,
        .height_m = 21.0F,
        .uses = {{BuildingUse::Residential, 0.6F}, {BuildingUse::Commercial, 0.4F}},
        .condition = 0.72F,
        .construction_progress = 1.0F,
    });
    snapshot.vehicles.push_back(VehicleSnapshot{
        .id = "vehicle:1",
        .revision = 12,
        .kind = VehicleKind::PrivateCar,
        .position = {3.25, 2.0},
        .heading_radians = 0.0F,
        .occupancy = 1.0F,
        .out_of_service = false,
    });
    snapshot.transit_stops.push_back(TransitStopSnapshot{
        .id = "stop:metro:central",
        .revision = 3,
        .kind = TransitStopKind::MetroStation,
        .position = {4.0, 4.0},
        .ridership = 800.0F,
        .crowding = 0.7F,
        .reliability = 0.91F,
    });
    snapshot.overlays.push_back(OverlaySample{
        .revision = 8,
        .metric = OverlayMetric::TrafficCongestion,
        .entity = EntityRef{EntityKind::Road, "road:main"},
        .position = {3.0, 2.0},
        .value = 0.62F,
        .secondary = 0.55F,
    });
    return snapshot;
}
} // namespace

TEST(PresentationBoundary, SnapshotOwnsOnlyPresentationDtos) {
    const auto snapshot = makeSnapshot();
    EXPECT_EQ(snapshot.revision, 7U);
    EXPECT_EQ(snapshot.terrain.at(0).biome, TerrainBiome::Rock);
    EXPECT_EQ(snapshot.parcels.at(0).id, "parcel:irregular");
    EXPECT_EQ(snapshot.buildings.at(0).parcel_id, "parcel:irregular");
    EXPECT_EQ(snapshot.transit_stops.at(0).kind, TransitStopKind::MetroStation);
}

TEST(IsometricCameraParity, MatchesLegacyProjectionAndAnchoredZoom) {
    IsometricCamera camera{};
    const WorldSize world{10, 8};
    const auto p = camera.worldToCanvas(0.0, 0.0, world);
    EXPECT_DOUBLE_EQ(p.x, 292.0);
    EXPECT_DOUBLE_EQ(p.y, 52.0);

    const auto anchor_before = camera.worldToCanvas(3.0, 2.0, world);
    camera.zoomBy(1.5, anchor_before.x, anchor_before.y);
    const auto anchor_after = camera.worldToCanvas(3.0, 2.0, world);
    EXPECT_NEAR(anchor_before.x, anchor_after.x, 1e-9);
    EXPECT_NEAR(anchor_before.y, anchor_after.y, 1e-9);
    EXPECT_DOUBLE_EQ(camera.zoom(), 1.5);
}

TEST(IsometricCameraParity, RotationAroundCanvasAnchorPreservesWorldPoint) {
    IsometricCamera camera{};
    const WorldSize world{11, 7};
    const auto anchor = camera.worldToCanvas(5.0, 3.0, world);
    camera.rotateAroundCanvasPoint(1, world, anchor);
    const auto after = camera.worldToCanvas(5.0, 3.0, world);
    EXPECT_NEAR(anchor.x, after.x, 1e-9);
    EXPECT_NEAR(anchor.y, after.y, 1e-9);
    EXPECT_EQ(camera.quarterTurns(), 1);
}

TEST(IsometricCameraParity, CanvasToWorldRoundTripsContinuousPickingCoordinates) {
    IsometricCamera camera{};
    const WorldSize world{17, 13};
    camera.rotate(1);
    const auto canvas = camera.worldToCanvas(4.25, 7.5, world);
    const auto world_point = camera.canvasToWorld(canvas.x, canvas.y, world);
    ASSERT_TRUE(world_point.has_value());
    EXPECT_NEAR(world_point->x, 4.25, 1e-9);
    EXPECT_NEAR(world_point->y, 7.5, 1e-9);
}

TEST(IsometricCameraParity, SharedTypeScriptFixturePreservesPickingRotationAndZoom) {
    const auto fixture = loadSharedCameraFixture();
    EXPECT_DOUBLE_EQ(fixture.metrics.tile_width, 64.0);
    EXPECT_DOUBLE_EQ(fixture.metrics.tile_height, 32.0);

    IsometricCamera camera{fixture.metrics};
    for (int turn = 0; turn < 4; ++turn) {
        for (const auto& [x, y] : fixture.cells) {
            const auto center = camera.worldToCanvas(static_cast<double>(x), static_cast<double>(y), fixture.world);
            const auto picked = camera.canvasToCell(center.x, center.y, fixture.world);
            ASSERT_TRUE(picked.has_value());
            EXPECT_EQ(picked->first, x);
            EXPECT_EQ(picked->second, y);
        }
        camera.rotate(1);
    }

    const auto fractional_canvas = camera.worldToCanvas(fixture.fractional_point.x, fixture.fractional_point.y, fixture.world);
    const auto fractional_world = camera.canvasToWorld(fractional_canvas.x, fractional_canvas.y, fixture.world);
    ASSERT_TRUE(fractional_world.has_value());
    EXPECT_NEAR(fractional_world->x, fixture.fractional_point.x, 1e-9);
    EXPECT_NEAR(fractional_world->y, fixture.fractional_point.y, 1e-9);

    const auto focus_canvas = camera.worldToCanvas(fixture.focus_world.x, fixture.focus_world.y, fixture.world);
    camera.rotateAroundCanvasPoint(1, fixture.world, focus_canvas);
    const auto focus_after = camera.worldToCanvas(fixture.focus_world.x, fixture.focus_world.y, fixture.world);
    EXPECT_NEAR(focus_after.x, focus_canvas.x, 1e-9);
    EXPECT_NEAR(focus_after.y, focus_canvas.y, 1e-9);

    const auto zoom_anchor = camera.worldToCanvas(fixture.zoom_cell.x, fixture.zoom_cell.y, fixture.world);
    camera.zoomBy(fixture.zoom_factor, zoom_anchor.x, zoom_anchor.y);
    const auto zoom_after = camera.worldToCanvas(fixture.zoom_cell.x, fixture.zoom_cell.y, fixture.world);
    EXPECT_NEAR(zoom_after.x, zoom_anchor.x, 1e-9);
    EXPECT_NEAR(zoom_after.y, zoom_anchor.y, 1e-9);
    camera.zoomBy(fixture.zoom_max_probe, zoom_anchor.x, zoom_anchor.y);
    EXPECT_DOUBLE_EQ(camera.zoom(), fixture.zoom_max);
    camera.zoomBy(fixture.zoom_min_probe, zoom_anchor.x, zoom_anchor.y);
    EXPECT_DOUBLE_EQ(camera.zoom(), fixture.zoom_min);

    EXPECT_FALSE(camera.canvasToCell(fixture.outside_canvas.x, fixture.outside_canvas.y, fixture.world).has_value());
}

TEST(RetainedScene, RebuildsOnlyRecordsWhoseRevisionChanged) {
    RetainedScene scene{};
    auto first = makeSnapshot();
    const auto first_stats = scene.apply(first);
    EXPECT_EQ(first_stats.terrain_rebuilt, 1U);
    EXPECT_EQ(first_stats.parcels_rebuilt, 1U);
    EXPECT_EQ(first_stats.roads_rebuilt, 1U);
    EXPECT_EQ(first_stats.buildings_rebuilt, 1U);
    EXPECT_EQ(first_stats.vehicles_updated, 1U);
    EXPECT_EQ(first_stats.overlays_rebuilt, 1U);

    const auto second_stats = scene.apply(first);
    EXPECT_EQ(second_stats.totalRebuilt(), 0U);

    first.roads.at(0).revision += 1;
    first.roads.at(0).congestion = 0.9F;
    const auto third_stats = scene.apply(first);
    EXPECT_EQ(third_stats.roads_rebuilt, 1U);
    EXPECT_EQ(third_stats.totalRebuilt(), 1U);
}

TEST(Picking, ReturnsTypedAuthoritativeEntityWithoutMutation) {
    PickingIndex picking{};
    const auto snapshot = makeSnapshot();
    picking.rebuild(snapshot);
    const auto result = picking.pickWorld({3.0, 2.0}, 0.45);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->kind, EntityKind::Road);
    EXPECT_EQ(result->id, "road:main");
    EXPECT_EQ(snapshot.revision, 7U);
}

TEST(Picking, SelectsParcelByTypedIdWhenNoMoreSpecificEntityWins) {
    PickingIndex picking{};
    const auto snapshot = makeSnapshot();
    picking.rebuild(snapshot);
    const auto result = picking.pickWorld({1.75, 4.25}, 0.2);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->kind, EntityKind::Parcel);
    EXPECT_EQ(result->id, "parcel:irregular");
}

TEST(Overlays, DistinctMetricsHaveAccessibleLegendMetadata) {
    const auto congestion = overlayLegend(OverlayMetric::TrafficCongestion);
    const auto reliability = overlayLegend(OverlayMetric::TransitReliability);
    EXPECT_NE(congestion.label, reliability.label);
    EXPECT_NE(congestion.pattern, reliability.pattern);
    EXPECT_FALSE(congestion.low_cue.empty());
    EXPECT_FALSE(congestion.high_cue.empty());
}

TEST(AssetRegistry, StableIdsRejectMissingReferencesAndBrokenDuplicateDefinitions) {
    AssetRegistry registry{};
    EXPECT_TRUE(registry.registerAsset(AssetDefinition{.id = "building.house.small", .runtime_path = "assets/runtime/house.glb", .lod_paths = {}}).has_value());
    EXPECT_FALSE(registry.registerAsset(AssetDefinition{.id = "building.house.small", .runtime_path = "other.glb", .lod_paths = {}}).has_value());
    EXPECT_TRUE(registry.resolve("building.house.small").has_value());
    EXPECT_FALSE(registry.resolve("missing.asset").has_value());
    EXPECT_FALSE(registry.validateReferences({"building.house.small", "missing.asset"}).has_value());
}

TEST(PresentationSettings, AccessibilityNormalizationClampsUnsafeValues) {
    PresentationSettings settings{};
    settings.ui_scale = 4.0F;
    settings.camera_sensitivity = -2.0F;
    settings.tilt_shift_strength = 3.0F;
    settings.reduced_motion = true;
    const auto normalized = normalizeSettings(settings);
    EXPECT_FLOAT_EQ(normalized.ui_scale, 2.0F);
    EXPECT_FLOAT_EQ(normalized.camera_sensitivity, 0.1F);
    EXPECT_FLOAT_EQ(normalized.tilt_shift_strength, 0.0F);
    EXPECT_TRUE(normalized.reduced_motion);
}

TEST(InputState, LostFocusCancelsDragAndPointerCapture) {
    InputState input{};
    input.pointerDown(42, {100.0, 200.0});
    ASSERT_TRUE(input.dragging());
    EXPECT_EQ(input.activePointerId(), 42);
    input.lostFocus();
    EXPECT_FALSE(input.dragging());
    EXPECT_EQ(input.activePointerId(), -1);
}

TEST(PresentationInterpolation, BlendsMatchingMobilityRecordsWithoutChangingAuthorityIdentity) {
    auto previous = makeSnapshot();
    auto current = previous;
    previous.revision = 20U;
    current.revision = 21U;
    previous.vehicles.at(0).position = {2.0, 4.0};
    previous.vehicles.at(0).heading_radians = 0.0F;
    current.vehicles.at(0).position = {6.0, 8.0};
    current.vehicles.at(0).heading_radians = 1.0F;
    current.vehicles.at(0).occupancy = 3.0F;

    const auto blended = interpolatePresentationSnapshots(previous, current, 0.25);
    ASSERT_EQ(blended.vehicles.size(), 1U);
    EXPECT_EQ(blended.revision, current.revision);
    EXPECT_EQ(blended.vehicles.at(0).id, current.vehicles.at(0).id);
    EXPECT_EQ(blended.vehicles.at(0).revision, current.vehicles.at(0).revision);
    EXPECT_DOUBLE_EQ(blended.vehicles.at(0).position.x, 3.0);
    EXPECT_DOUBLE_EQ(blended.vehicles.at(0).position.y, 5.0);
    EXPECT_FLOAT_EQ(blended.vehicles.at(0).heading_radians, 0.25F);
    EXPECT_FLOAT_EQ(blended.vehicles.at(0).occupancy, current.vehicles.at(0).occupancy);
    EXPECT_DOUBLE_EQ(current.vehicles.at(0).position.x, 6.0);
}

TEST(PresentationInterpolation, NewOrRemovedVehiclesFollowCurrentAuthoritativeMembership) {
    auto previous = makeSnapshot();
    auto current = previous;
    previous.vehicles.at(0).id = "vehicle:removed";
    current.vehicles.at(0).id = "vehicle:new";
    current.vehicles.at(0).position = {9.0, 9.0};

    const auto blended = interpolatePresentationSnapshots(previous, current, 0.5);
    ASSERT_EQ(blended.vehicles.size(), 1U);
    EXPECT_EQ(blended.vehicles.at(0).id, "vehicle:new");
    EXPECT_DOUBLE_EQ(blended.vehicles.at(0).position.x, 9.0);
    EXPECT_DOUBLE_EQ(blended.vehicles.at(0).position.y, 9.0);
}
