#include <civic/presentation/RenderPipeline.hpp>

#include <algorithm>
#include <string>
#include <string_view>

namespace civic::presentation {
namespace {

bool pointVisible(Point2 point, ViewportWorldBounds viewport) noexcept {
    return point.x >= viewport.min_x && point.x <= viewport.max_x && point.y >= viewport.min_y && point.y <= viewport.max_y;
}

bool boundsIntersect(double min_x, double min_y, double max_x, double max_y, ViewportWorldBounds viewport) noexcept {
    return max_x >= viewport.min_x && min_x <= viewport.max_x && max_y >= viewport.min_y && min_y <= viewport.max_y;
}

bool polygonVisible(const std::vector<Point2>& polygon, ViewportWorldBounds viewport) noexcept {
    if (polygon.empty()) return false;
    double min_x = polygon.front().x;
    double max_x = min_x;
    double min_y = polygon.front().y;
    double max_y = min_y;
    for (const auto point : polygon) {
        min_x = std::min(min_x, point.x);
        max_x = std::max(max_x, point.x);
        min_y = std::min(min_y, point.y);
        max_y = std::max(max_y, point.y);
    }
    return boundsIntersect(min_x, min_y, max_x, max_y, viewport);
}

bool roadVisible(const RoadSnapshot& road, ViewportWorldBounds viewport) noexcept {
    return boundsIntersect(
        std::min(road.from.x, road.to.x),
        std::min(road.from.y, road.to.y),
        std::max(road.from.x, road.to.x),
        std::max(road.from.y, road.to.y),
        viewport);
}

Point2 polygonCentroid(const std::vector<Point2>& polygon) noexcept {
    Point2 center{};
    if (polygon.empty()) return center;
    for (const auto point : polygon) { center.x += point.x; center.y += point.y; }
    const double denominator = static_cast<double>(polygon.size());
    return {center.x / denominator, center.y / denominator};
}

void countVisibility(bool visible, CullingStats& stats) noexcept {
    ++stats.input_records;
    if (visible) ++stats.visible_records;
    else ++stats.culled_records;
}

EntityKind previewEntityKind(std::string_view tool_id) noexcept {
    if (tool_id == "road") return EntityKind::Road;
    if (tool_id == "zone") return EntityKind::Parcel;
    if (tool_id == "transit" || tool_id == "transit-stop") return EntityKind::TransitStop;
    if (tool_id == "facility" || tool_id == "utility" || tool_id == "service") return EntityKind::Facility;
    return EntityKind::Terrain;
}

OverlayMetric previewMetric(std::string_view tool_id) noexcept {
    return tool_id == "bulldoze" ? OverlayMetric::TrafficCongestion : OverlayMetric::BuildableEnvelope;
}

void appendPreviewPoint(
    RenderPacket& packet,
    const FrameSnapshot& snapshot,
    ViewportWorldBounds viewport,
    Point2 point,
    std::size_t index) {
    if (!pointVisible(point, viewport)) return;
    packet.overlays.push_back({
        {previewEntityKind(snapshot.tool_preview.tool_id),
         "tool-preview:" + snapshot.tool_preview.tool_id + ":" + std::to_string(index)},
        snapshot.revision,
        previewMetric(snapshot.tool_preview.tool_id),
        point,
        1.0F,
        0.0F});
}

void appendToolPreview(RenderPacket& packet, const FrameSnapshot& snapshot, ViewportWorldBounds viewport) {
    const auto& preview = snapshot.tool_preview;
    if (!preview.valid || preview.geometry.empty()) return;

    if (preview.geometry.size() == 1U) {
        appendPreviewPoint(packet, snapshot, viewport, preview.geometry.front(), 0U);
        return;
    }

    constexpr std::size_t samples_per_segment = 8U;
    std::size_t preview_index = 0U;
    for (std::size_t segment = 1U; segment < preview.geometry.size(); ++segment) {
        const auto from = preview.geometry[segment - 1U];
        const auto to = preview.geometry[segment];
        for (std::size_t sample = 0U; sample <= samples_per_segment; ++sample) {
            if (segment > 1U && sample == 0U) continue;
            const double t = static_cast<double>(sample) / static_cast<double>(samples_per_segment);
            appendPreviewPoint(
                packet,
                snapshot,
                viewport,
                {from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t},
                preview_index++);
        }
    }
}

} // namespace

RenderPacket RenderPacketBuilder::build(const FrameSnapshot& snapshot, ViewportWorldBounds viewport) const {
    RenderPacket packet{};
    packet.revision = snapshot.revision;
    packet.selection = snapshot.selection;
    packet.tool_preview = snapshot.tool_preview;

    for (const auto& record : snapshot.terrain) {
        const bool visible = pointVisible({static_cast<double>(record.x), static_cast<double>(record.y)}, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.terrain.push_back({
            {EntityKind::Terrain, record.id}, record.revision, record.x, record.y, record.biome,
            record.elevation_m, record.flood_depth_m, record.buildable, record.water});
    }
    for (const auto& record : snapshot.parcels) {
        const bool visible = polygonVisible(record.polygon, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.parcels.push_back({{EntityKind::Parcel, record.id}, record.revision, record.polygon});
        if (snapshot.selection.active && snapshot.selection.entity == EntityRef{EntityKind::Parcel, record.id}) {
            packet.overlays.push_back({
                {EntityKind::Parcel, record.id},
                record.revision,
                OverlayMetric::Cadastre,
                polygonCentroid(record.polygon),
                1.0F,
                1.0F});
        }
    }
    for (const auto& record : snapshot.roads) {
        const bool visible = roadVisible(record, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.roads.push_back({
            {EntityKind::Road, record.id}, record.revision, record.road_class, record.from, record.to,
            record.lanes, record.one_way, record.condition, record.congestion, record.speed_ratio, record.volume});
    }
    for (const auto& record : snapshot.buildings) {
        const bool visible = polygonVisible(record.footprint, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.buildings.push_back({
            {EntityKind::Building, record.id}, record.revision, record.parcel_id, record.footprint,
            record.floors, record.height_m, record.uses, record.condition, record.construction_progress});
    }
    for (const auto& record : snapshot.vehicles) {
        const bool visible = pointVisible(record.position, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.vehicles.push_back({
            {EntityKind::Vehicle, record.id}, record.revision, record.kind, record.position,
            record.heading_radians, record.occupancy, record.out_of_service});
    }
    for (const auto& record : snapshot.transit_stops) {
        const bool visible = pointVisible(record.position, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.transit_stops.push_back({
            {EntityKind::TransitStop, record.id}, record.revision, record.kind, record.position,
            record.ridership, record.crowding, record.reliability});
    }
    for (const auto& record : snapshot.overlays) {
        const bool visible = pointVisible(record.position, viewport);
        countVisibility(visible, packet.culling);
        if (!visible) continue;
        packet.overlays.push_back({record.entity, record.revision, record.metric, record.position, record.value, record.secondary});
    }
    appendToolPreview(packet, snapshot, viewport);
    return packet;
}

} // namespace civic::presentation
