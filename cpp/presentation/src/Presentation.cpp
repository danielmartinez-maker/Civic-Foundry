#include <civic/presentation/Presentation.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>

namespace civic::presentation {
namespace {
int normalizedTurn(int turn) noexcept { return ((turn % 4) + 4) % 4; }
WorldSize rotatedWorldSize(WorldSize size, int turn) noexcept {
    return normalizedTurn(turn) % 2 == 0 ? size : WorldSize{size.height, size.width};
}
Point2 rotateWorldPoint(double x, double y, WorldSize size, int turn) noexcept {
    switch (normalizedTurn(turn)) {
        case 1: return {static_cast<double>(size.height) - 1.0 - y, x};
        case 2: return {static_cast<double>(size.width) - 1.0 - x, static_cast<double>(size.height) - 1.0 - y};
        case 3: return {y, static_cast<double>(size.width) - 1.0 - x};
        default: return {x, y};
    }
}
Point2 inverseRotateWorldPoint(double x, double y, WorldSize size, int turn) noexcept {
    switch (normalizedTurn(turn)) {
        case 1: return {y, static_cast<double>(size.height) - 1.0 - x};
        case 2: return {static_cast<double>(size.width) - 1.0 - x, static_cast<double>(size.height) - 1.0 - y};
        case 3: return {static_cast<double>(size.width) - 1.0 - y, x};
        default: return {x, y};
    }
}
Point2 project(double x, double y, IsoMetrics metrics) noexcept {
    return {(x - y) * metrics.tile_width / 2.0, (x + y) * metrics.tile_height / 2.0};
}
Point2 inverseProject(double x, double y, IsoMetrics metrics) noexcept {
    const double a = x / (metrics.tile_width / 2.0);
    const double b = y / (metrics.tile_height / 2.0);
    return {(a + b) / 2.0, (b - a) / 2.0};
}
bool diamondContains(double x, double y, IsoMetrics metrics) noexcept {
    return std::abs(x) / (metrics.tile_width / 2.0) + std::abs(y) / (metrics.tile_height / 2.0) <= 1.0 + 1e-9;
}
double sqr(double value) noexcept { return value * value; }
double distanceSquared(Point2 a, Point2 b) noexcept { return sqr(a.x - b.x) + sqr(a.y - b.y); }
double distanceToSegmentSquared(Point2 point, Point2 a, Point2 b) noexcept {
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const double denominator = dx * dx + dy * dy;
    if (denominator <= 1e-15) return distanceSquared(point, a);
    const double t = std::clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator, 0.0, 1.0);
    return distanceSquared(point, {a.x + t * dx, a.y + t * dy});
}
bool pointInPolygon(Point2 point, const std::vector<Point2>& polygon) noexcept {
    if (polygon.size() < 3) return false;
    bool inside = false;
    for (std::size_t i = 0, j = polygon.size() - 1; i < polygon.size(); j = i++) {
        const auto& a = polygon[i];
        const auto& b = polygon[j];
        const bool crosses = (a.y > point.y) != (b.y > point.y);
        if (crosses) {
            const double x = (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
            if (point.x < x) inside = !inside;
        }
    }
    return inside;
}
template <class Range>
std::size_t updateRevisionMap(const Range& range, std::map<std::string, RenderRevision>& revisions) {
    std::size_t changed = 0;
    std::set<std::string> alive;
    for (const auto& record : range) {
        alive.insert(record.id);
        const auto it = revisions.find(record.id);
        if (it == revisions.end() || it->second != record.revision) {
            revisions[record.id] = record.revision;
            ++changed;
        }
    }
    for (auto it = revisions.begin(); it != revisions.end();) {
        if (!alive.contains(it->first)) {
            it = revisions.erase(it);
            ++changed;
        } else {
            ++it;
        }
    }
    return changed;
}
bool validAssetId(std::string_view id) {
    if (id.empty()) return false;
    for (const unsigned char ch : id) {
        if (!(std::isalnum(ch) || ch == '.' || ch == '_' || ch == '-')) return false;
    }
    return true;
}
float lerpFloat(float a, float b, double alpha) noexcept {
    return static_cast<float>(static_cast<double>(a) + (static_cast<double>(b) - static_cast<double>(a)) * alpha);
}
double lerpDouble(double a, double b, double alpha) noexcept { return a + (b - a) * alpha; }
} // namespace

OverlayLegend overlayLegend(OverlayMetric metric) {
    switch (metric) {
        case OverlayMetric::TrafficCongestion: return {"Traffic congestion", "free-flow / sparse", "severe / dense", "diagonal-stripes"};
        case OverlayMetric::TrafficSpeed: return {"Traffic speed", "slow", "fast", "chevrons"};
        case OverlayMetric::TrafficVolume: return {"Traffic volume", "low volume", "high volume", "dots"};
        case OverlayMetric::TransitAccess: return {"Transit access", "poor access", "strong access", "rings"};
        case OverlayMetric::TransitRidership: return {"Transit ridership", "low ridership", "high ridership", "vertical-bars"};
        case OverlayMetric::TransitCrowding: return {"Transit crowding", "seats available", "crowded", "crosshatch"};
        case OverlayMetric::TransitReliability: return {"Transit reliability", "unreliable", "reliable", "horizontal-bars"};
        case OverlayMetric::ServiceAccess: return {"Service access", "underserved", "well served", "grid"};
        case OverlayMetric::EconomyActivity: return {"Economic activity", "low activity", "high activity", "diamonds"};
        case OverlayMetric::FreightFlow: return {"Freight flow", "light flow", "heavy flow", "arrows"};
        case OverlayMetric::Cadastre: return {"Cadastre", "parcel edge", "selected parcel", "solid-outline"};
        case OverlayMetric::Zoning: return {"Zoning", "restricted", "permitted", "zone-hatch"};
        case OverlayMetric::BuildableEnvelope: return {"Buildable envelope", "constrained", "available", "stipple"};
        case OverlayMetric::FloodExposure: return {"Flood exposure", "dry", "deep water", "wave-hatch"};
    }
    return {"Unknown", "low", "high", "solid"};
}

PresentationSettings normalizeSettings(PresentationSettings settings) noexcept {
    settings.master_volume = std::clamp(settings.master_volume, 0.0F, 1.0F);
    settings.music_volume = std::clamp(settings.music_volume, 0.0F, 1.0F);
    settings.ui_scale = std::clamp(settings.ui_scale, 0.75F, 2.0F);
    settings.camera_sensitivity = std::clamp(settings.camera_sensitivity, 0.1F, 3.0F);
    settings.camera_smoothing = std::clamp(settings.camera_smoothing, 0.0F, 1.0F);
    settings.tilt_shift_strength = std::clamp(settings.tilt_shift_strength, 0.0F, 1.0F);
    settings.input_sensitivity = std::clamp(settings.input_sensitivity, 0.1F, 3.0F);
    if (settings.reduced_motion) {
        settings.camera_smoothing = 0.0F;
        settings.tilt_shift_strength = 0.0F;
    }
    return settings;
}

FrameSnapshot interpolatePresentationSnapshots(
    const FrameSnapshot& previous,
    const FrameSnapshot& current,
    double alpha) {
    FrameSnapshot blended = current;
    alpha = std::clamp(std::isfinite(alpha) ? alpha : 1.0, 0.0, 1.0);
    if (alpha >= 1.0 || previous.vehicles.empty() || current.vehicles.empty()) return blended;

    std::map<std::string_view, const VehicleSnapshot*, std::less<>> previous_by_id;
    for (const auto& vehicle : previous.vehicles) previous_by_id.emplace(vehicle.id, &vehicle);
    for (auto& vehicle : blended.vehicles) {
        const auto it = previous_by_id.find(vehicle.id);
        if (it == previous_by_id.end()) continue;
        const auto& before = *it->second;
        vehicle.position.x = lerpDouble(before.position.x, vehicle.position.x, alpha);
        vehicle.position.y = lerpDouble(before.position.y, vehicle.position.y, alpha);
        vehicle.heading_radians = lerpFloat(before.heading_radians, vehicle.heading_radians, alpha);
    }
    return blended;
}

IsometricCamera::IsometricCamera(IsoMetrics metrics) : metrics_(metrics) {
    if (!(metrics.tile_width > 0.0) || !(metrics.tile_height > 0.0)) {
        throw std::invalid_argument("isometric tile metrics must be positive");
    }
}
void IsometricCamera::pan(double dx, double dy) noexcept {
    if (!std::isfinite(dx) || !std::isfinite(dy)) return;
    pan_x_ += dx;
    pan_y_ += dy;
}
void IsometricCamera::zoomBy(double factor, double anchor_x, double anchor_y) noexcept {
    if (!(factor > 0.0) || !std::isfinite(factor) || !std::isfinite(anchor_x) || !std::isfinite(anchor_y)) return;
    const double before = zoom_;
    const double next = std::clamp(before * factor, 0.45, 2.5);
    if (next == before) return;
    const double ratio = next / before;
    zoom_ = next;
    pan_x_ = anchor_x - (anchor_x - pan_x_) * ratio;
    pan_y_ = anchor_y - (anchor_y - pan_y_) * ratio;
}
void IsometricCamera::rotate(int direction) noexcept {
    if (direction == 0) return;
    quarter_turns_ = normalizedTurn(quarter_turns_ + (direction > 0 ? 1 : -1));
}
void IsometricCamera::rotateAroundCanvasPoint(int direction, WorldSize size, Point2 anchor) noexcept {
    if (!std::isfinite(anchor.x) || !std::isfinite(anchor.y)) {
        rotate(direction);
        return;
    }
    const auto world_anchor = canvasToWorldPoint(anchor.x, anchor.y, size);
    rotate(direction);
    const auto after = worldToCanvas(world_anchor.x, world_anchor.y, size);
    pan_x_ += anchor.x - after.x;
    pan_y_ += anchor.y - after.y;
}
Point2 IsometricCamera::worldToCanvas(double x, double y, WorldSize size) const noexcept {
    if (!std::isfinite(x) || !std::isfinite(y)) {
        const auto nan = std::numeric_limits<double>::quiet_NaN();
        return {nan, nan};
    }
    const auto rotated = rotateWorldPoint(x, y, size, quarter_turns_);
    const auto projected = project(rotated.x, rotated.y, metrics_);
    const auto offset = logicalMapOffset(size);
    return {pan_x_ + (offset.x + projected.x) * zoom_, pan_y_ + (offset.y + projected.y) * zoom_};
}
std::optional<std::pair<std::uint32_t, std::uint32_t>> IsometricCamera::canvasToCell(double canvas_x, double canvas_y, WorldSize size) const noexcept {
    if (!std::isfinite(canvas_x) || !std::isfinite(canvas_y)) return std::nullopt;
    const auto offset = logicalMapOffset(size);
    const double logical_x = (canvas_x - pan_x_) / zoom_ - offset.x;
    const double logical_y = (canvas_y - pan_y_) / zoom_ - offset.y;
    const auto continuous = inverseProject(logical_x, logical_y, metrics_);
    const auto rx = static_cast<long long>(std::floor(continuous.x + 0.5));
    const auto ry = static_cast<long long>(std::floor(continuous.y + 0.5));
    const auto rotated_size = rotatedWorldSize(size, quarter_turns_);
    if (rx < 0 || ry < 0 || rx >= static_cast<long long>(rotated_size.width) || ry >= static_cast<long long>(rotated_size.height)) return std::nullopt;
    const auto center = project(static_cast<double>(rx), static_cast<double>(ry), metrics_);
    if (!diamondContains(logical_x - center.x, logical_y - center.y, metrics_)) return std::nullopt;
    const auto world = inverseRotateWorldPoint(static_cast<double>(rx), static_cast<double>(ry), size, quarter_turns_);
    const auto x = static_cast<long long>(std::llround(world.x));
    const auto y = static_cast<long long>(std::llround(world.y));
    if (x < 0 || y < 0 || x >= static_cast<long long>(size.width) || y >= static_cast<long long>(size.height)) return std::nullopt;
    return std::pair{static_cast<std::uint32_t>(x), static_cast<std::uint32_t>(y)};
}
std::vector<Point2> IsometricCamera::tilePolygon(std::uint32_t x, std::uint32_t y, WorldSize size) const {
    const auto center = worldToCanvas(static_cast<double>(x), static_cast<double>(y), size);
    const double half_w = tileWidth() / 2.0;
    const double half_h = tileHeight() / 2.0;
    return {{center.x, center.y - half_h}, {center.x + half_w, center.y}, {center.x, center.y + half_h}, {center.x - half_w, center.y}};
}
Point2 IsometricCamera::canvasToWorldPoint(double canvas_x, double canvas_y, WorldSize size) const noexcept {
    const auto offset = logicalMapOffset(size);
    const double logical_x = (canvas_x - pan_x_) / zoom_ - offset.x;
    const double logical_y = (canvas_y - pan_y_) / zoom_ - offset.y;
    const auto rotated = inverseProject(logical_x, logical_y, metrics_);
    return inverseRotateWorldPoint(rotated.x, rotated.y, size, quarter_turns_);
}
Point2 IsometricCamera::logicalMapOffset(WorldSize size) const noexcept {
    const auto rotated = rotatedWorldSize(size, quarter_turns_);
    return {static_cast<double>(rotated.height) * metrics_.tile_width / 2.0, metrics_.tile_height / 2.0};
}

void InputState::pointerDown(int pointer_id, Point2 position) noexcept {
    if (pointer_id < 0 || !std::isfinite(position.x) || !std::isfinite(position.y)) return;
    active_pointer_id_ = pointer_id;
    pointer_position_ = position;
    dragging_ = true;
}
void InputState::pointerMove(int pointer_id, Point2 position) noexcept {
    if (!dragging_ || pointer_id != active_pointer_id_ || !std::isfinite(position.x) || !std::isfinite(position.y)) return;
    pointer_position_ = position;
}
void InputState::pointerUp(int pointer_id) noexcept { if (pointer_id == active_pointer_id_) lostFocus(); }
void InputState::pointerCancel(int pointer_id) noexcept { if (pointer_id == active_pointer_id_) lostFocus(); }
void InputState::lostFocus() noexcept { active_pointer_id_ = -1; dragging_ = false; }

SceneUpdateStats RetainedScene::apply(const FrameSnapshot& snapshot) {
    SceneUpdateStats stats{};
    stats.terrain_rebuilt = updateRevisionMap(snapshot.terrain, terrain_);
    stats.roads_rebuilt = updateRevisionMap(snapshot.roads, roads_);
    stats.buildings_rebuilt = updateRevisionMap(snapshot.buildings, buildings_);
    stats.vehicles_updated = updateRevisionMap(snapshot.vehicles, vehicles_);
    stats.transit_rebuilt = updateRevisionMap(snapshot.transit_stops, transit_);
    std::map<std::string, RenderRevision> next_overlay;
    for (std::size_t i = 0; i < snapshot.overlays.size(); ++i) {
        const auto& record = snapshot.overlays[i];
        const std::string key = std::to_string(static_cast<int>(record.metric)) + ":" + record.entity.id + ":" + std::to_string(i);
        next_overlay.emplace(key, record.revision);
        const auto it = overlays_.find(key);
        if (it == overlays_.end() || it->second != record.revision) ++stats.overlays_rebuilt;
    }
    for (const auto& [key, revision] : overlays_) {
        (void)revision;
        if (!next_overlay.contains(key)) ++stats.overlays_rebuilt;
    }
    overlays_ = std::move(next_overlay);
    applied_revision_ = snapshot.revision;
    return stats;
}

void PickingIndex::rebuild(const FrameSnapshot& snapshot) {
    roads_ = snapshot.roads;
    buildings_ = snapshot.buildings;
    vehicles_ = snapshot.vehicles;
    transit_ = snapshot.transit_stops;
}
std::optional<EntityRef> PickingIndex::pickWorld(Point2 point, double tolerance) const noexcept {
    if (!std::isfinite(point.x) || !std::isfinite(point.y) || !(tolerance >= 0.0)) return std::nullopt;
    const double limit = tolerance * tolerance;
    for (const auto& stop : transit_) if (distanceSquared(point, stop.position) <= limit) return EntityRef{EntityKind::TransitStop, stop.id};
    for (const auto& road : roads_) if (distanceToSegmentSquared(point, road.from, road.to) <= limit) return EntityRef{EntityKind::Road, road.id};
    for (const auto& vehicle : vehicles_) if (distanceSquared(point, vehicle.position) <= limit) return EntityRef{EntityKind::Vehicle, vehicle.id};
    for (const auto& building : buildings_) if (pointInPolygon(point, building.footprint)) return EntityRef{EntityKind::Building, building.id};
    return std::nullopt;
}

std::expected<void, std::string> AssetRegistry::registerAsset(AssetDefinition definition) {
    if (!validAssetId(definition.id)) return std::unexpected("asset id is empty or contains unsupported characters");
    if (definition.runtime_path.empty()) return std::unexpected("runtime asset path is empty");
    if (assets_.contains(definition.id)) return std::unexpected("duplicate asset id: " + definition.id);
    assets_.emplace(definition.id, std::move(definition));
    return {};
}
std::optional<AssetDefinition> AssetRegistry::resolve(std::string_view id) const {
    const auto it = assets_.find(id);
    if (it == assets_.end()) return std::nullopt;
    return it->second;
}
std::expected<void, std::string> AssetRegistry::validateReferences(const std::vector<std::string>& ids) const {
    for (const auto& id : ids) {
        if (!assets_.contains(id)) return std::unexpected("missing asset reference: " + id);
    }
    return {};
}

} // namespace civic::presentation
