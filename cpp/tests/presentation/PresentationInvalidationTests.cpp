#include <gtest/gtest.h>

#include <civic/presentation/PresentationInvalidation.hpp>

using namespace civic::presentation;

namespace {
FrameSnapshot invalidationFixture() {
    FrameSnapshot snapshot{};
    snapshot.revision = 7U;
    snapshot.simulation_tick = 7U;
    snapshot.world = {16U, 12U};
    snapshot.terrain.push_back({"terrain:2:3", 1U, 2U, 3U, TerrainBiome::Rock, false, false, 18.0F, 0.0F});
    snapshot.parcels.push_back({"parcel:1", 2U, {{1.0,1.0},{5.0,1.0},{5.0,5.0},{1.0,5.0}}});
    snapshot.roads.push_back({"road:1", 3U, RoadClass::Arterial, {1.0,2.0}, {6.0,2.0}, 4U, false, 0.9F, 0.3F, 0.8F, 320.0F});
    snapshot.buildings.push_back({"building:1", 4U, "parcel:1", {{2.0,2.0},{4.0,2.0},{4.0,4.0},{2.0,4.0}}, 4U, 14.0F, {{BuildingUse::Residential,1.0F}}, 0.9F, 1.0F});
    snapshot.vehicles.push_back({"vehicle:1", 5U, VehicleKind::PrivateCar, {3.0,2.0}, 0.0F, 1.0F, false});
    snapshot.transit_stops.push_back({"stop:1", 6U, TransitStopKind::BusStop, {4.0,4.0}, 100.0F, 0.2F, 0.95F});
    snapshot.overlays.push_back({7U, OverlayMetric::TrafficCongestion, {EntityKind::Road,"road:1"}, {3.0,2.0}, 0.3F, 0.8F});
    return snapshot;
}
}

TEST(PresentationInvalidation, TickOnlyChangesDoNotDirtyRetainedRecordsButRecordRevisionChangesDo) {
    PresentationInvalidationTracker tracker{};
    auto snapshot = invalidationFixture();

    const auto initial = tracker.syncRecords(snapshot);
    EXPECT_GT(initial.totalRebuilt(), 0U);
    EXPECT_TRUE(geometryNeedsRebuild(initial, false, false, false));
    EXPECT_TRUE(pickingNeedsRebuild(initial, false));

    snapshot.revision += 1U;
    snapshot.simulation_tick += 1U;
    const auto tick_only = tracker.syncRecords(snapshot);
    EXPECT_EQ(tick_only.totalRebuilt(), 0U);
    EXPECT_FALSE(geometryNeedsRebuild(tick_only, false, false, false));
    EXPECT_FALSE(pickingNeedsRebuild(tick_only, false));

    snapshot.roads.front().revision += 1U;
    snapshot.roads.front().congestion = 0.85F;
    const auto road_delta = tracker.syncRecords(snapshot);
    EXPECT_EQ(road_delta.roads_rebuilt, 1U);
    EXPECT_EQ(road_delta.totalRebuilt(), 1U);
    EXPECT_TRUE(geometryNeedsRebuild(road_delta, false, false, false));
    EXPECT_TRUE(pickingNeedsRebuild(road_delta, false));
}

TEST(PresentationInvalidation, PresentationOnlyStateInvalidatesGeometryWithoutPretendingRecordsChanged) {
    PresentationInvalidationTracker tracker{};
    const auto snapshot = invalidationFixture();

    EXPECT_TRUE(tracker.syncWorld(snapshot.world));
    EXPECT_FALSE(tracker.syncWorld(snapshot.world));

    EXPECT_TRUE(tracker.syncSelection(snapshot.selection));
    EXPECT_FALSE(tracker.syncSelection(snapshot.selection));

    EXPECT_TRUE(tracker.syncToolPreview(snapshot.tool_preview));
    EXPECT_FALSE(tracker.syncToolPreview(snapshot.tool_preview));

    auto selection = snapshot.selection;
    selection.active = true;
    selection.entity = {EntityKind::Building, "building:1"};
    EXPECT_TRUE(tracker.syncSelection(selection));
    EXPECT_TRUE(geometryNeedsRebuild({}, false, true, false));
    EXPECT_FALSE(pickingNeedsRebuild({}, false));

    auto preview = snapshot.tool_preview;
    preview.tool_id = "road";
    preview.valid = true;
    preview.geometry = {{1.0, 7.0}, {6.0, 7.0}};
    EXPECT_TRUE(tracker.syncToolPreview(preview));
    EXPECT_TRUE(geometryNeedsRebuild({}, false, false, true));
    EXPECT_FALSE(pickingNeedsRebuild({}, false));

    auto world = snapshot.world;
    world.width += 1U;
    EXPECT_TRUE(tracker.syncWorld(world));
    EXPECT_TRUE(geometryNeedsRebuild({}, true, false, false));
    EXPECT_TRUE(pickingNeedsRebuild({}, true));
}