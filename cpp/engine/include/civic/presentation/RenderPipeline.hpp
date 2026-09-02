#pragma once

#include <civic/presentation/Presentation.hpp>

#include <cstddef>
#include <vector>

namespace civic::presentation {

struct ViewportWorldBounds {
    double min_x{};
    double min_y{};
    double max_x{};
    double max_y{};
};

struct TerrainRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    std::uint32_t x{};
    std::uint32_t y{};
    TerrainBiome biome{TerrainBiome::Plains};
    float elevation_m{};
    float flood_depth_m{};
    bool buildable{};
    bool water{};
};

struct ParcelRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    std::vector<Point2> polygon;
};

struct RoadRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    RoadClass road_class{RoadClass::Local};
    Point2 from{};
    Point2 to{};
    std::uint8_t lanes{};
    bool one_way{};
    float condition{};
    float congestion{};
    float speed_ratio{};
    float volume{};
};

struct BuildingRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    std::string parcel_id;
    std::vector<Point2> footprint;
    std::uint16_t floors{};
    float height_m{};
    std::vector<UseComponentSnapshot> uses;
    float condition{};
    float construction_progress{};
};

struct VehicleRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    VehicleKind kind{VehicleKind::PrivateCar};
    Point2 position{};
    float heading_radians{};
    float occupancy{};
    bool out_of_service{};
};

struct TransitStopRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    TransitStopKind kind{TransitStopKind::BusStop};
    Point2 position{};
    float ridership{};
    float crowding{};
    float reliability{};
};

struct OverlayRenderRecord {
    EntityRef entity;
    RenderRevision revision{};
    OverlayMetric metric{OverlayMetric::TrafficCongestion};
    Point2 position{};
    float value{};
    float secondary{};
};

struct CullingStats {
    std::size_t input_records{};
    std::size_t visible_records{};
    std::size_t culled_records{};
};

struct RenderPacket {
    RenderRevision revision{};
    std::vector<TerrainRenderRecord> terrain;
    std::vector<ParcelRenderRecord> parcels;
    std::vector<RoadRenderRecord> roads;
    std::vector<BuildingRenderRecord> buildings;
    std::vector<VehicleRenderRecord> vehicles;
    std::vector<TransitStopRenderRecord> transit_stops;
    std::vector<OverlayRenderRecord> overlays;
    SelectionState selection{};
    ToolPreviewState tool_preview{};
    CullingStats culling;
};

class RenderPacketBuilder {
public:
    [[nodiscard]] RenderPacket build(const FrameSnapshot& snapshot, ViewportWorldBounds viewport) const;
};

} // namespace civic::presentation