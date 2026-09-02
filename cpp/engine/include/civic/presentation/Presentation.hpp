#pragma once

#include <cstdint>
#include <expected>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace civic::presentation {

using RenderRevision = std::uint64_t;

struct Point2 {
    double x{};
    double y{};
    friend bool operator==(const Point2&, const Point2&) = default;
};

struct WorldSize {
    std::uint32_t width{};
    std::uint32_t height{};
};

enum class EntityKind : std::uint8_t { Terrain, Parcel, Building, Road, TransitStop, Vehicle, Facility };
struct EntityRef {
    EntityKind kind{EntityKind::Terrain};
    std::string id;
    friend bool operator==(const EntityRef&, const EntityRef&) = default;
};

enum class TerrainBiome : std::uint8_t { Rock, Gravel, Sand, Loam, Clay, Alluvium, Peat, Fill, Water, Wetland, Forest, Plains, Grassland, Hills };
enum class RoadClass : std::uint8_t { Local, Collector, Arterial, Avenue, Expressway, Highway };
enum class BuildingUse : std::uint8_t { Residential, Commercial, Industrial, Civic, Office, Hospitality, Education, Healthcare, Mixed };
enum class VehicleKind : std::uint8_t { PrivateCar, Service, Freight, Bus, Brt, Tram, Metro, Rail, Emergency };
enum class TransitStopKind : std::uint8_t { BusStop, BrtStation, TramStop, MetroStation, RailStation };
enum class AlertSeverity : std::uint8_t { Info, Success, Warning, Error };

enum class OverlayMetric : std::uint8_t {
    TrafficCongestion,
    TrafficSpeed,
    TrafficVolume,
    TransitAccess,
    TransitRidership,
    TransitCrowding,
    TransitReliability,
    ServiceAccess,
    EconomyActivity,
    FreightFlow,
    Cadastre,
    Zoning,
    BuildableEnvelope,
    FloodExposure,
};

struct UseComponentSnapshot {
    BuildingUse use{BuildingUse::Residential};
    float share{};
};

struct TerrainCellSnapshot {
    std::string id;
    RenderRevision revision{};
    std::uint32_t x{};
    std::uint32_t y{};
    TerrainBiome biome{TerrainBiome::Plains};
    bool buildable{true};
    bool water{false};
    float elevation_m{};
    float flood_depth_m{};
};

struct ParcelSnapshot {
    std::string id;
    RenderRevision revision{};
    std::vector<Point2> polygon;
};

struct RoadSnapshot {
    std::string id;
    RenderRevision revision{};
    RoadClass road_class{RoadClass::Local};
    Point2 from{};
    Point2 to{};
    std::uint8_t lanes{1};
    bool one_way{false};
    float condition{1.0F};
    float congestion{};
    float speed_ratio{1.0F};
    float volume{};
};

struct BuildingSnapshot {
    std::string id;
    RenderRevision revision{};
    std::string parcel_id;
    std::vector<Point2> footprint;
    std::uint16_t floors{1};
    float height_m{3.0F};
    std::vector<UseComponentSnapshot> uses;
    float condition{1.0F};
    float construction_progress{1.0F};
};

struct VehicleSnapshot {
    std::string id;
    RenderRevision revision{};
    VehicleKind kind{VehicleKind::PrivateCar};
    Point2 position{};
    float heading_radians{};
    float occupancy{};
    bool out_of_service{false};
};

struct TransitStopSnapshot {
    std::string id;
    RenderRevision revision{};
    TransitStopKind kind{TransitStopKind::BusStop};
    Point2 position{};
    float ridership{};
    float crowding{};
    float reliability{1.0F};
};

struct OverlaySample {
    RenderRevision revision{};
    OverlayMetric metric{OverlayMetric::TrafficCongestion};
    EntityRef entity{};
    Point2 position{};
    float value{};
    float secondary{};
};

struct CameraState {
    double zoom{1.0};
    std::uint8_t quarter_turns{};
    double pan_x{36.0};
    double pan_y{36.0};
};

struct SelectionState {
    bool active{false};
    EntityRef entity{};
};

struct ToolPreviewState {
    std::string tool_id;
    bool valid{false};
    std::vector<Point2> geometry;
    std::string invalid_reason;
};

struct KeyBindings {
    int inspect{'I'};
    int road{'R'};
    int zone{'Z'};
    int facility{'F'};
    int transit{'T'};
    int cancel{27};
    int speed_pause{'0'};
    int speed_normal{'1'};
    int speed_fast{'2'};
    int speed_very_fast{'4'};
    friend bool operator==(const KeyBindings&, const KeyBindings&) = default;
};

struct PresentationSettings {
    float master_volume{1.0F};
    float music_volume{0.8F};
    float ui_scale{1.0F};
    float camera_sensitivity{1.0F};
    float camera_smoothing{0.35F};
    float tilt_shift_strength{0.55F};
    float input_sensitivity{1.0F};
    bool reduced_motion{false};
    bool color_independent_cues{true};
    bool visual_effects{true};
    bool high_contrast{false};
    AlertSeverity minimum_alert_severity{AlertSeverity::Info};
    KeyBindings keybindings{};
};

struct FrameSnapshot {
    RenderRevision revision{};
    std::uint64_t simulation_tick{};
    WorldSize world{};
    std::vector<TerrainCellSnapshot> terrain;
    std::vector<ParcelSnapshot> parcels;
    std::vector<RoadSnapshot> roads;
    std::vector<BuildingSnapshot> buildings;
    std::vector<VehicleSnapshot> vehicles;
    std::vector<TransitStopSnapshot> transit_stops;
    std::vector<OverlaySample> overlays;
    SelectionState selection{};
    ToolPreviewState tool_preview{};
};

struct OverlayLegend {
    std::string label;
    std::string low_cue;
    std::string high_cue;
    std::string pattern;
};

OverlayLegend overlayLegend(OverlayMetric metric);
PresentationSettings normalizeSettings(PresentationSettings settings) noexcept;
[[nodiscard]] FrameSnapshot interpolatePresentationSnapshots(
    const FrameSnapshot& previous,
    const FrameSnapshot& current,
    double alpha);

struct IsoMetrics { double tile_width{64.0}; double tile_height{32.0}; };
class IsometricCamera {
public:
    explicit IsometricCamera(IsoMetrics metrics = {});
    [[nodiscard]] double zoom() const noexcept { return zoom_; }
    [[nodiscard]] int quarterTurns() const noexcept { return quarter_turns_; }
    [[nodiscard]] double tileWidth() const noexcept { return metrics_.tile_width * zoom_; }
    [[nodiscard]] double tileHeight() const noexcept { return metrics_.tile_height * zoom_; }
    [[nodiscard]] CameraState state() const noexcept { return CameraState{zoom_, static_cast<std::uint8_t>(quarter_turns_), pan_x_, pan_y_}; }
    void pan(double dx, double dy) noexcept;
    void zoomBy(double factor, double anchor_x, double anchor_y) noexcept;
    void rotate(int direction) noexcept;
    void rotateAroundCanvasPoint(int direction, WorldSize size, Point2 anchor) noexcept;
    [[nodiscard]] Point2 worldToCanvas(double x, double y, WorldSize size) const noexcept;
    [[nodiscard]] std::optional<Point2> canvasToWorld(double canvas_x, double canvas_y, WorldSize size) const noexcept;
    [[nodiscard]] std::optional<std::pair<std::uint32_t, std::uint32_t>> canvasToCell(double canvas_x, double canvas_y, WorldSize size) const noexcept;
    [[nodiscard]] std::vector<Point2> tilePolygon(std::uint32_t x, std::uint32_t y, WorldSize size) const;
private:
    [[nodiscard]] Point2 canvasToWorldPoint(double canvas_x, double canvas_y, WorldSize size) const noexcept;
    [[nodiscard]] Point2 logicalMapOffset(WorldSize size) const noexcept;
    IsoMetrics metrics_{};
    double zoom_{1.0};
    int quarter_turns_{0};
    double pan_x_{36.0};
    double pan_y_{36.0};
};

class InputState {
public:
    void pointerDown(int pointer_id, Point2 position) noexcept;
    void pointerMove(int pointer_id, Point2 position) noexcept;
    void pointerUp(int pointer_id) noexcept;
    void pointerCancel(int pointer_id) noexcept;
    void lostFocus() noexcept;
    [[nodiscard]] bool dragging() const noexcept { return dragging_; }
    [[nodiscard]] int activePointerId() const noexcept { return active_pointer_id_; }
    [[nodiscard]] Point2 pointerPosition() const noexcept { return pointer_position_; }
private:
    int active_pointer_id_{-1};
    Point2 pointer_position_{};
    bool dragging_{false};
};

struct SceneUpdateStats {
    std::size_t terrain_rebuilt{};
    std::size_t parcels_rebuilt{};
    std::size_t roads_rebuilt{};
    std::size_t buildings_rebuilt{};
    std::size_t vehicles_updated{};
    std::size_t transit_rebuilt{};
    std::size_t overlays_rebuilt{};
    [[nodiscard]] std::size_t totalRebuilt() const noexcept { return terrain_rebuilt + parcels_rebuilt + roads_rebuilt + buildings_rebuilt + vehicles_updated + transit_rebuilt + overlays_rebuilt; }
};

class RetainedScene {
public:
    SceneUpdateStats apply(const FrameSnapshot& snapshot);
    [[nodiscard]] RenderRevision appliedRevision() const noexcept { return applied_revision_; }
private:
    RenderRevision applied_revision_{};
    std::map<std::string, RenderRevision> terrain_;
    std::map<std::string, RenderRevision> parcels_;
    std::map<std::string, RenderRevision> roads_;
    std::map<std::string, RenderRevision> buildings_;
    std::map<std::string, RenderRevision> vehicles_;
    std::map<std::string, RenderRevision> transit_;
    std::map<std::string, RenderRevision> overlays_;
};

class PickingIndex {
public:
    void rebuild(const FrameSnapshot& snapshot);
    [[nodiscard]] std::optional<EntityRef> pickWorld(Point2 point, double tolerance) const noexcept;
private:
    std::vector<ParcelSnapshot> parcels_;
    std::vector<RoadSnapshot> roads_;
    std::vector<BuildingSnapshot> buildings_;
    std::vector<VehicleSnapshot> vehicles_;
    std::vector<TransitStopSnapshot> transit_;
};

struct AssetDefinition {
    std::string id;
    std::string runtime_path;
    std::vector<std::string> lod_paths;
};

class AssetRegistry {
public:
    [[nodiscard]] std::expected<void, std::string> registerAsset(AssetDefinition definition);
    [[nodiscard]] std::optional<AssetDefinition> resolve(std::string_view id) const;
    [[nodiscard]] std::expected<void, std::string> validateReferences(const std::vector<std::string>& ids) const;
    [[nodiscard]] std::size_t size() const noexcept { return assets_.size(); }
private:
    std::map<std::string, AssetDefinition, std::less<>> assets_;
};

} // namespace civic::presentation
