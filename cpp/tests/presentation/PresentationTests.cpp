#include <gtest/gtest.h>

#include <civic/presentation/Presentation.hpp>

#include <cmath>
#include <string>

using namespace civic::presentation;

namespace {
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

TEST(RetainedScene, RebuildsOnlyRecordsWhoseRevisionChanged) {
    RetainedScene scene{};
    auto first = makeSnapshot();
    const auto first_stats = scene.apply(first);
    EXPECT_EQ(first_stats.terrain_rebuilt, 1U);
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
