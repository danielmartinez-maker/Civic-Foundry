#include <gtest/gtest.h>

#include <civic/presentation/GpuBackend.hpp>
#include <civic/presentation/RenderPipeline.hpp>

using namespace civic::presentation;

namespace {
FrameSnapshot renderFixture() {
    FrameSnapshot snapshot{};
    snapshot.revision = 100;
    snapshot.world = {20, 20};
    snapshot.terrain.push_back({"terrain:rock", 2, 2, 3, TerrainBiome::Rock, false, false, 12.0F, 0.0F});
    snapshot.parcels.push_back({"parcel:p1", 2, {{2.5,2.5},{6.5,2.5},{6.5,5.5},{2.5,5.5}}});
    snapshot.roads.push_back({"road:a", 3, RoadClass::Arterial, {1.0, 2.0}, {8.0, 2.0}, 4, false, 0.8F, 0.75F, 0.5F, 500.0F});
    snapshot.buildings.push_back({"building:canonical", 4, "parcel:p1", {{3.0,3.0},{6.0,3.0},{5.5,5.0},{3.0,4.5}}, 8, 28.0F, {{BuildingUse::Residential,0.55F},{BuildingUse::Commercial,0.45F}}, 0.9F, 1.0F});
    snapshot.vehicles.push_back({"vehicle:metro", 5, VehicleKind::Metro, {5.0, 6.0}, 0.0F, 240.0F, false});
    snapshot.transit_stops.push_back({"stop:metro", 6, TransitStopKind::MetroStation, {5.0, 6.0}, 1500.0F, 0.8F, 0.95F});
    snapshot.overlays.push_back({7, OverlayMetric::TrafficCongestion, {EntityKind::Road,"road:a"}, {4.0,2.0}, 0.75F, 0.5F});
    return snapshot;
}
}

TEST(RenderPipeline, CanonicalBuildingUsesAuthoritativeFootprintAndHeight) {
    RenderPacketBuilder builder{};
    const auto packet = builder.build(renderFixture(), ViewportWorldBounds{0.0, 0.0, 10.0, 10.0});
    ASSERT_EQ(packet.buildings.size(), 1U);
    EXPECT_EQ(packet.buildings[0].entity.id, "building:canonical");
    EXPECT_EQ(packet.buildings[0].footprint.size(), 4U);
    EXPECT_EQ(packet.buildings[0].floors, 8);
    EXPECT_FLOAT_EQ(packet.buildings[0].height_m, 28.0F);
    ASSERT_EQ(packet.buildings[0].uses.size(), 2U);
}

TEST(RenderPipeline, ParcelRecordsStayReadOnlyAndSelectionAddsCadastreCue) {
    RenderPacketBuilder builder{};
    auto snapshot = renderFixture();
    snapshot.selection = {true, {EntityKind::Parcel, "parcel:p1"}};
    const auto packet = builder.build(snapshot, ViewportWorldBounds{0.0, 0.0, 10.0, 10.0});
    ASSERT_EQ(packet.parcels.size(), 1U);
    EXPECT_EQ(packet.parcels[0].entity.id, "parcel:p1");
    ASSERT_EQ(packet.parcels[0].polygon.size(), 4U);
    ASSERT_EQ(packet.overlays.size(), 2U);
    EXPECT_EQ(packet.overlays.front().metric, OverlayMetric::Cadastre);
    EXPECT_EQ(packet.overlays.front().entity.kind, EntityKind::Parcel);
    EXPECT_EQ(snapshot.parcels.front().revision, 2U);
}

TEST(RenderPipeline, RockAndMetroHaveIntentionalPresentationRecords) {
    RenderPacketBuilder builder{};
    const auto packet = builder.build(renderFixture(), ViewportWorldBounds{0.0, 0.0, 10.0, 10.0});
    ASSERT_EQ(packet.terrain.size(), 1U);
    EXPECT_EQ(packet.terrain[0].biome, TerrainBiome::Rock);
    ASSERT_EQ(packet.vehicles.size(), 1U);
    EXPECT_EQ(packet.vehicles[0].kind, VehicleKind::Metro);
    ASSERT_EQ(packet.transit_stops.size(), 1U);
    EXPECT_EQ(packet.transit_stops[0].kind, TransitStopKind::MetroStation);
}

TEST(RenderPipeline, SpatialOverlaysPreserveMetricAndSampleValue) {
    RenderPacketBuilder builder{};
    const auto packet = builder.build(renderFixture(), ViewportWorldBounds{0.0, 0.0, 10.0, 10.0});
    ASSERT_EQ(packet.overlays.size(), 1U);
    EXPECT_EQ(packet.overlays[0].metric, OverlayMetric::TrafficCongestion);
    EXPECT_FLOAT_EQ(packet.overlays[0].value, 0.75F);
    EXPECT_EQ(packet.overlays[0].entity.id, "road:a");
}

TEST(RenderPipeline, PreservesValidToolPreviewAcrossPresentationBoundary) {
    RenderPacketBuilder builder{};
    auto snapshot = renderFixture();
    snapshot.tool_preview = ToolPreviewState{
        .tool_id = "road",
        .valid = true,
        .geometry = {{2.0, 7.0}, {8.0, 7.0}},
        .invalid_reason = {},
    };

    const auto packet = builder.build(snapshot, ViewportWorldBounds{0.0, 0.0, 10.0, 10.0});

    EXPECT_TRUE(packet.tool_preview.valid);
    EXPECT_EQ(packet.tool_preview.tool_id, "road");
    EXPECT_EQ(packet.tool_preview.geometry, snapshot.tool_preview.geometry);
}

TEST(RenderPipeline, CullsRecordsOutsideWorldViewport) {
    RenderPacketBuilder builder{};
    const auto packet = builder.build(renderFixture(), ViewportWorldBounds{12.0, 12.0, 19.0, 19.0});
    EXPECT_TRUE(packet.terrain.empty());
    EXPECT_TRUE(packet.parcels.empty());
    EXPECT_TRUE(packet.roads.empty());
    EXPECT_TRUE(packet.buildings.empty());
    EXPECT_TRUE(packet.vehicles.empty());
    EXPECT_TRUE(packet.transit_stops.empty());
    EXPECT_TRUE(packet.overlays.empty());
    EXPECT_GT(packet.culling.culled_records, 0U);
}

TEST(GpuBackendContract, HandlesAreTypedAndInvalidByDefault) {
    BufferHandle buffer{};
    TextureHandle texture{};
    PipelineHandle pipeline{};
    EXPECT_FALSE(buffer.valid());
    EXPECT_FALSE(texture.valid());
    EXPECT_FALSE(pipeline.valid());
    EXPECT_NE(BufferUsage::Vertex, BufferUsage::Uniform);
    EXPECT_NE(TextureFormat::Bgra8Unorm, TextureFormat::Depth32Float);
}

TEST(GpuBackendContract, ResourceDescriptorsRemainApiNeutral) {
    const BufferDesc vertex{.size_bytes = 4096, .usage = BufferUsage::Vertex, .cpu_visible = false, .debug_name = "terrain vertices"};
    const TextureDesc color{.width = 1280, .height = 720, .format = TextureFormat::Bgra8Unorm, .render_target = true, .debug_name = "backbuffer"};
    EXPECT_EQ(vertex.size_bytes, 4096U);
    EXPECT_TRUE(color.render_target);
    EXPECT_EQ(color.width, 1280U);
}