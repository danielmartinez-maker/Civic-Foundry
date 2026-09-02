#include <gtest/gtest.h>

#include <civic/presentation/SceneGeometry.hpp>

#include <algorithm>

using namespace civic::presentation;

namespace {
RenderPacket fixturePacket() {
    RenderPacket packet{};
    packet.revision = 12;
    packet.terrain.push_back({{EntityKind::Terrain,"t"},1,2,2,TerrainBiome::Rock,0.0F,0.0F,false,false});
    packet.roads.push_back({{EntityKind::Road,"r"},2,RoadClass::Arterial,{1,3},{7,3},4,false,0.9F,0.8F,0.5F,700.0F});
    packet.buildings.push_back({{EntityKind::Building,"b"},3,"p",{{3,4},{6,4},{5.5,6},{3,5.5}},7,25.0F,{{BuildingUse::Residential,0.6F},{BuildingUse::Commercial,0.4F}},0.8F,1.0F});
    packet.vehicles.push_back({{EntityKind::Vehicle,"metro"},4,VehicleKind::Metro,{5,7},0.0F,220.0F,false});
    packet.transit_stops.push_back({{EntityKind::TransitStop,"station"},5,TransitStopKind::MetroStation,{5,7},1200.0F,0.75F,0.93F});
    packet.overlays.push_back({{EntityKind::Road,"r"},6,OverlayMetric::TrafficCongestion,{4,3},0.8F,0.5F});
    return packet;
}
}

TEST(SceneGeometry, BuildsTerrainRoadCanonicalBuildingAndMetroGeometry) {
    SceneGeometryBuilder builder{};
    IsometricCamera camera{};
    const auto scene = builder.build(fixturePacket(), camera, WorldSize{20,20}, PixelViewport{1280,720});
    EXPECT_GE(scene.stats.terrain_triangles, 2U);
    EXPECT_GE(scene.stats.road_triangles, 2U);
    EXPECT_GT(scene.stats.building_triangles, 2U);
    EXPECT_GT(scene.stats.vehicle_triangles, 0U);
    EXPECT_GT(scene.stats.transit_triangles, 0U);
    EXPECT_FALSE(scene.opaque.empty());
}

TEST(SceneGeometry, BuildingExtrusionUsesCanonicalHeightRatherThanLegacyCellIntensity) {
    SceneGeometryBuilder builder{};
    IsometricCamera camera{};
    const auto scene = builder.build(fixturePacket(), camera, WorldSize{20,20}, PixelViewport{1280,720});
    EXPECT_EQ(scene.stats.canonical_buildings, 1U);
    EXPECT_FLOAT_EQ(scene.stats.max_building_height_m, 25.0F);
    EXPECT_GE(scene.stats.building_triangles, 10U);
}

TEST(SceneGeometry, OverlayIsSpatialGeometryNotFullScreenTint) {
    SceneGeometryBuilder builder{};
    IsometricCamera camera{};
    const auto scene = builder.build(fixturePacket(), camera, WorldSize{20,20}, PixelViewport{1280,720});
    ASSERT_FALSE(scene.overlay.empty());
    float min_x = scene.overlay.front().x, max_x = min_x, min_y = scene.overlay.front().y, max_y = min_y;
    for (const auto& vertex : scene.overlay) { min_x = std::min(min_x,vertex.x); max_x = std::max(max_x,vertex.x); min_y = std::min(min_y,vertex.y); max_y = std::max(max_y,vertex.y); }
    EXPECT_LT(max_x - min_x, 0.5F);
    EXPECT_LT(max_y - min_y, 0.5F);
    EXPECT_EQ(scene.stats.overlay_samples, 1U);
}

TEST(SceneGeometry, FloodAndWaterStateChangesTerrainPresentation) {
    SceneGeometryBuilder builder{};
    IsometricCamera camera{};
    RenderPacket dry{};
    dry.terrain.push_back({{EntityKind::Terrain,"cell"},1,2,2,TerrainBiome::Plains,0.0F,0.0F,true,false});
    RenderPacket flooded = dry;
    flooded.terrain.front().flood_depth_m = 0.8F;
    flooded.terrain.front().water = true;

    const auto dry_scene = builder.build(dry, camera, WorldSize{8,8}, PixelViewport{800,600});
    const auto wet_scene = builder.build(flooded, camera, WorldSize{8,8}, PixelViewport{800,600});
    ASSERT_FALSE(dry_scene.opaque.empty());
    ASSERT_FALSE(wet_scene.opaque.empty());
    EXPECT_NE(dry_scene.opaque.front().r, wet_scene.opaque.front().r);
    EXPECT_NE(dry_scene.opaque.front().g, wet_scene.opaque.front().g);
    EXPECT_NE(dry_scene.opaque.front().b, wet_scene.opaque.front().b);
}

TEST(SceneGeometry, LaneAndDirectionDetailAppearsOnlyAtUsefulZoom) {
    SceneGeometryBuilder builder{};
    RenderPacket packet{};
    packet.roads.push_back({{EntityKind::Road,"one-way"},2,RoadClass::Arterial,{1,3},{7,3},4,true,0.9F,0.2F,0.8F,500.0F});

    IsometricCamera low_zoom{};
    low_zoom.zoomBy(0.5, 0.0, 0.0);
    const auto low = builder.build(packet, low_zoom, WorldSize{20,20}, PixelViewport{1280,720});

    IsometricCamera high_zoom{};
    high_zoom.zoomBy(2.0, 0.0, 0.0);
    const auto high = builder.build(packet, high_zoom, WorldSize{20,20}, PixelViewport{1280,720});
    EXPECT_GT(high.stats.road_triangles, low.stats.road_triangles);
}

TEST(SceneGeometry, ActiveTypedSelectionProducesAVisibleRedundantCue) {
    SceneGeometryBuilder builder{};
    IsometricCamera camera{};
    auto packet = fixturePacket();
    packet.selection = SelectionState{true, {EntityKind::Building, "b"}};
    const auto scene = builder.build(packet, camera, WorldSize{20,20}, PixelViewport{1280,720});
    EXPECT_GT(scene.stats.selection_triangles, 0U);
    EXPECT_FALSE(scene.overlay.empty());
}
