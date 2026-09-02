#include <civic/presentation/SceneGeometry.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <optional>

namespace civic::presentation {
namespace {

struct Color { float r; float g; float b; float a; };

SceneVertex vertex(Point2 pixel, PixelViewport viewport, Color color) {
    const float width = static_cast<float>(std::max<std::uint32_t>(1, viewport.width));
    const float height = static_cast<float>(std::max<std::uint32_t>(1, viewport.height));
    return {
        static_cast<float>(pixel.x) * 2.0F / width - 1.0F,
        1.0F - static_cast<float>(pixel.y) * 2.0F / height,
        color.r, color.g, color.b, color.a};
}

void triangle(std::vector<SceneVertex>& out, SceneVertex a, SceneVertex b, SceneVertex c, std::size_t& counter) {
    out.push_back(a); out.push_back(b); out.push_back(c); ++counter;
}

void quad(std::vector<SceneVertex>& out, SceneVertex a, SceneVertex b, SceneVertex c, SceneVertex d, std::size_t& counter) {
    triangle(out, a, b, c, counter);
    triangle(out, a, c, d, counter);
}

Color blend(Color a, Color b, float amount) noexcept {
    amount = std::clamp(amount, 0.0F, 1.0F);
    const float inverse = 1.0F - amount;
    return {
        a.r * inverse + b.r * amount,
        a.g * inverse + b.g * amount,
        a.b * inverse + b.b * amount,
        a.a * inverse + b.a * amount,
    };
}

Color terrainBiomeColor(TerrainBiome biome) noexcept {
    switch (biome) {
        case TerrainBiome::Rock: return {0.43F,0.42F,0.40F,1.0F};
        case TerrainBiome::Gravel: return {0.55F,0.53F,0.48F,1.0F};
        case TerrainBiome::Sand: return {0.72F,0.66F,0.48F,1.0F};
        case TerrainBiome::Clay: return {0.55F,0.38F,0.31F,1.0F};
        case TerrainBiome::Water: return {0.29F,0.52F,0.70F,1.0F};
        case TerrainBiome::Wetland: return {0.38F,0.53F,0.43F,1.0F};
        case TerrainBiome::Forest: return {0.27F,0.45F,0.27F,1.0F};
        case TerrainBiome::Peat: return {0.32F,0.29F,0.24F,1.0F};
        case TerrainBiome::Fill: return {0.56F,0.50F,0.42F,1.0F};
        case TerrainBiome::Alluvium: return {0.52F,0.57F,0.38F,1.0F};
        case TerrainBiome::Hills: return {0.55F,0.51F,0.39F,1.0F};
        case TerrainBiome::Loam:
        case TerrainBiome::Plains:
        case TerrainBiome::Grassland:
        default: return {0.43F,0.57F,0.32F,1.0F};
    }
}

Color terrainColor(const TerrainRenderRecord& cell) noexcept {
    Color color = terrainBiomeColor(cell.biome);
    if (cell.water || cell.flood_depth_m > 0.0F) {
        const float depth = std::clamp(cell.flood_depth_m / 2.0F, 0.0F, 1.0F);
        const float water_strength = cell.water ? std::max(0.58F, depth) : 0.28F + depth * 0.52F;
        color = blend(color, {0.20F,0.48F,0.76F,1.0F}, water_strength);
    }
    return color;
}

Color roadColor(RoadClass road_class, float condition) noexcept {
    const float wear = std::clamp(condition, 0.0F, 1.0F);
    float base = 0.24F + 0.10F * wear;
    if (road_class == RoadClass::Highway || road_class == RoadClass::Expressway) base += 0.05F;
    return {base, base * 0.96F, base * 0.92F, 1.0F};
}

Color buildingColor(const BuildingRenderRecord& building) noexcept {
    BuildingUse use = BuildingUse::Mixed;
    float best = -1.0F;
    for (const auto& component : building.uses) if (component.share > best) { best = component.share; use = component.use; }
    Color color{0.70F,0.72F,0.68F,1.0F};
    switch (use) {
        case BuildingUse::Residential: color = {0.76F,0.76F,0.66F,1.0F}; break;
        case BuildingUse::Commercial:
        case BuildingUse::Office: color = {0.61F,0.70F,0.76F,1.0F}; break;
        case BuildingUse::Industrial: color = {0.68F,0.59F,0.45F,1.0F}; break;
        case BuildingUse::Healthcare: color = {0.70F,0.80F,0.79F,1.0F}; break;
        case BuildingUse::Education: color = {0.74F,0.64F,0.55F,1.0F}; break;
        default: break;
    }
    const float condition = 0.62F + 0.38F * std::clamp(building.condition, 0.0F, 1.0F);
    color.r *= condition; color.g *= condition; color.b *= condition;
    return color;
}

Color vehicleColor(VehicleKind kind) noexcept {
    switch (kind) {
        case VehicleKind::Freight: return {0.82F,0.56F,0.30F,1.0F};
        case VehicleKind::Service: return {0.30F,0.72F,0.78F,1.0F};
        case VehicleKind::Emergency: return {0.90F,0.25F,0.24F,1.0F};
        case VehicleKind::Bus:
        case VehicleKind::Brt: return {0.35F,0.60F,0.83F,1.0F};
        case VehicleKind::Tram: return {0.63F,0.45F,0.82F,1.0F};
        case VehicleKind::Metro:
        case VehicleKind::Rail: return {0.50F,0.35F,0.75F,1.0F};
        default: return {0.90F,0.90F,0.87F,1.0F};
    }
}

Color overlayColor(OverlayMetric metric, float value) noexcept {
    const float intensity = std::clamp(value, 0.0F, 1.0F);
    switch (metric) {
        case OverlayMetric::TrafficCongestion: return {0.90F,0.24F + 0.35F*(1.0F-intensity),0.20F,0.72F};
        case OverlayMetric::TrafficSpeed: return {0.20F,0.55F + 0.35F*intensity,0.76F,0.68F};
        case OverlayMetric::TrafficVolume: return {0.92F,0.58F,0.18F,0.68F};
        case OverlayMetric::TransitAccess: return {0.22F,0.66F,0.74F,0.68F};
        case OverlayMetric::TransitRidership: return {0.35F,0.57F,0.88F,0.70F};
        case OverlayMetric::TransitReliability: return {0.30F,0.72F,0.55F,0.70F};
        case OverlayMetric::TransitCrowding: return {0.73F,0.33F,0.78F,0.70F};
        case OverlayMetric::ServiceAccess: return {0.30F,0.72F,0.63F,0.68F};
        case OverlayMetric::EconomyActivity: return {0.82F,0.67F,0.24F,0.68F};
        case OverlayMetric::FreightFlow: return {0.80F,0.48F,0.24F,0.70F};
        case OverlayMetric::FloodExposure: return {0.17F,0.48F,0.82F,0.72F};
        case OverlayMetric::Cadastre: return {0.94F,0.82F,0.27F,0.72F};
        case OverlayMetric::Zoning: return {0.45F,0.72F,0.40F,0.70F};
        case OverlayMetric::BuildableEnvelope: return {0.56F,0.73F,0.34F,0.68F};
        default: return {0.34F,0.68F,0.84F,0.68F};
    }
}

int overlaySegments(OverlayMetric metric) noexcept {
    static constexpr std::array<int, 14> segments{4,3,6,8,5,7,6,4,5,3,4,6,8,7};
    return segments.at(static_cast<std::size_t>(metric));
}

double overlayPhase(OverlayMetric metric) noexcept {
    return static_cast<double>(static_cast<std::uint8_t>(metric) % 4U) * std::numbers::pi / 8.0;
}

double overlayPulse(OverlayMetric metric, int index) noexcept {
    const auto value = static_cast<std::uint8_t>(metric);
    if ((value % 3U) == 0U && (index % 2) != 0) return 0.62;
    if ((value % 3U) == 1U && (index % 3) == 1) return 0.76;
    return 1.0;
}

Point2 shifted(Point2 point, double dx, double dy) noexcept { return {point.x + dx, point.y + dy}; }

bool pixelBoundsVisible(
    double min_x,
    double min_y,
    double max_x,
    double max_y,
    PixelViewport viewport,
    double margin = 0.0) noexcept {
    const double width = static_cast<double>(viewport.width);
    const double height = static_cast<double>(viewport.height);
    return max_x >= -margin && min_x <= width + margin && max_y >= -margin && min_y <= height + margin;
}

bool pointVisible(Point2 point, PixelViewport viewport, double margin = 0.0) noexcept {
    return pixelBoundsVisible(point.x, point.y, point.x, point.y, viewport, margin);
}

bool polygonVisible(const std::vector<Point2>& polygon, PixelViewport viewport, double margin = 0.0) noexcept {
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
    return pixelBoundsVisible(min_x, min_y, max_x, max_y, viewport, margin);
}

std::optional<Point2> selectedWorldPoint(const RenderPacket& packet) {
    if (!packet.selection.active) return std::nullopt;
    const auto& selected = packet.selection.entity;
    if (selected.kind == EntityKind::Terrain) {
        for (const auto& cell : packet.terrain) if (cell.entity == selected) return Point2{static_cast<double>(cell.x), static_cast<double>(cell.y)};
    }
    if (selected.kind == EntityKind::Road) {
        for (const auto& road : packet.roads) if (road.entity == selected) return Point2{(road.from.x + road.to.x) * 0.5, (road.from.y + road.to.y) * 0.5};
    }
    if (selected.kind == EntityKind::Building) {
        for (const auto& building : packet.buildings) if (building.entity == selected && !building.footprint.empty()) {
            Point2 center{};
            for (const auto point : building.footprint) { center.x += point.x; center.y += point.y; }
            const double denominator = static_cast<double>(building.footprint.size());
            return Point2{center.x / denominator, center.y / denominator};
        }
    }
    if (selected.kind == EntityKind::Vehicle) {
        for (const auto& vehicle : packet.vehicles) if (vehicle.entity == selected) return vehicle.position;
    }
    if (selected.kind == EntityKind::TransitStop) {
        for (const auto& stop : packet.transit_stops) if (stop.entity == selected) return stop.position;
    }
    return std::nullopt;
}

void addRoadDetail(
    SceneGeometry& scene,
    const RoadRenderRecord& road,
    const IsometricCamera& camera,
    PixelViewport viewport,
    Point2 a,
    Point2 b,
    double nx,
    double ny,
    double half_width) {
    if (camera.zoom() < 1.15) return;
    const Color marking{0.82F,0.80F,0.70F,0.90F};
    const double thickness = std::max(0.45, 0.42 * camera.zoom());
    if (road.lanes > 1U) {
        for (std::uint8_t divider = 1U; divider < road.lanes; ++divider) {
            const double fraction = static_cast<double>(divider) / static_cast<double>(road.lanes);
            const double offset = -half_width + 2.0 * half_width * fraction;
            const double ox = nx * (offset / half_width);
            const double oy = ny * (offset / half_width);
            const double tx = nx * (thickness / half_width);
            const double ty = ny * (thickness / half_width);
            quad(scene.opaque,
                vertex(shifted(a, ox + tx, oy + ty), viewport, marking),
                vertex(shifted(b, ox + tx, oy + ty), viewport, marking),
                vertex(shifted(b, ox - tx, oy - ty), viewport, marking),
                vertex(shifted(a, ox - tx, oy - ty), viewport, marking),
                scene.stats.road_triangles);
        }
    }
    if (road.one_way) {
        const double dx = b.x - a.x;
        const double dy = b.y - a.y;
        const double length = std::hypot(dx, dy);
        if (length <= 1e-6) return;
        const Point2 center{(a.x + b.x) * 0.5, (a.y + b.y) * 0.5};
        const double ux = dx / length;
        const double uy = dy / length;
        const double arrow = std::max(4.0, 5.0 * camera.zoom());
        const Point2 tip{center.x + ux * arrow, center.y + uy * arrow};
        const Point2 left{center.x - ux * arrow * 0.55 + nx * 0.55, center.y - uy * arrow * 0.55 + ny * 0.55};
        const Point2 right{center.x - ux * arrow * 0.55 - nx * 0.55, center.y - uy * arrow * 0.55 - ny * 0.55};
        triangle(scene.opaque, vertex(tip, viewport, marking), vertex(left, viewport, marking), vertex(right, viewport, marking), scene.stats.road_triangles);
    }
}

} // namespace

SceneGeometry SceneGeometryBuilder::build(const RenderPacket& packet, const IsometricCamera& camera, WorldSize world, PixelViewport viewport) const {
    SceneGeometry scene{};
    scene.revision = packet.revision;
    if (viewport.width == 0 || viewport.height == 0) return scene;

    for (const auto& cell : packet.terrain) {
        const auto polygon = camera.tilePolygon(cell.x, cell.y, world);
        if (polygon.size() != 4 || !polygonVisible(polygon, viewport)) continue;
        const auto color = terrainColor(cell);
        quad(scene.opaque, vertex(polygon[0],viewport,color), vertex(polygon[1],viewport,color), vertex(polygon[2],viewport,color), vertex(polygon[3],viewport,color), scene.stats.terrain_triangles);
    }

    for (const auto& road : packet.roads) {
        const auto a = camera.worldToCanvas(road.from.x, road.from.y, world);
        const auto b = camera.worldToCanvas(road.to.x, road.to.y, world);
        const double dx = b.x - a.x, dy = b.y - a.y;
        const double length = std::hypot(dx,dy);
        if (length <= 1e-6) continue;
        const double half_width = std::max(2.0, static_cast<double>(road.lanes) * 1.25 * camera.zoom());
        if (!pixelBoundsVisible(
                std::min(a.x, b.x), std::min(a.y, b.y),
                std::max(a.x, b.x), std::max(a.y, b.y),
                viewport, half_width + 12.0)) continue;
        const double nx = -dy / length * half_width, ny = dx / length * half_width;
        const auto color = roadColor(road.road_class, road.condition);
        quad(scene.opaque,
            vertex(shifted(a,nx,ny),viewport,color), vertex(shifted(b,nx,ny),viewport,color),
            vertex(shifted(b,-nx,-ny),viewport,color), vertex(shifted(a,-nx,-ny),viewport,color), scene.stats.road_triangles);
        addRoadDetail(scene, road, camera, viewport, a, b, nx, ny, half_width);
    }

    for (const auto& building : packet.buildings) {
        if (building.footprint.size() < 3) continue;
        const double height_px = std::max(2.0, static_cast<double>(building.height_m) * 0.9 * camera.zoom());
        std::vector<Point2> ground; ground.reserve(building.footprint.size());
        std::vector<Point2> roof; roof.reserve(building.footprint.size());
        for (const auto point : building.footprint) {
            const auto projected = camera.worldToCanvas(point.x,point.y,world);
            ground.push_back(projected); roof.push_back(shifted(projected,0.0,-height_px));
        }
        if (!polygonVisible(ground, viewport, height_px)) continue;
        ++scene.stats.canonical_buildings;
        scene.stats.max_building_height_m = std::max(scene.stats.max_building_height_m, building.height_m);
        const auto base_color = buildingColor(building);
        const Color roof_color{std::min(1.0F,base_color.r*1.12F),std::min(1.0F,base_color.g*1.12F),std::min(1.0F,base_color.b*1.12F),1.0F};
        const Color wall_color{base_color.r*0.82F,base_color.g*0.82F,base_color.b*0.82F,1.0F};
        for (std::size_t i=1;i+1<roof.size();++i) triangle(scene.opaque,vertex(roof[0],viewport,roof_color),vertex(roof[i],viewport,roof_color),vertex(roof[i+1],viewport,roof_color),scene.stats.building_triangles);
        for (std::size_t i=0;i<ground.size();++i) {
            const std::size_t next=(i+1)%ground.size();
            quad(scene.opaque,vertex(ground[i],viewport,wall_color),vertex(ground[next],viewport,wall_color),vertex(roof[next],viewport,wall_color),vertex(roof[i],viewport,wall_color),scene.stats.building_triangles);
        }
    }

    for (const auto& vehicle : packet.vehicles) {
        if (vehicle.out_of_service) continue;
        const auto center = camera.worldToCanvas(vehicle.position.x,vehicle.position.y,world);
        const double length = (vehicle.kind==VehicleKind::Metro || vehicle.kind==VehicleKind::Rail) ? 11.0 : 5.0;
        const double width = (vehicle.kind==VehicleKind::Metro || vehicle.kind==VehicleKind::Rail) ? 4.0 : 3.0;
        if (!pointVisible(center, viewport, length + width + 2.0)) continue;
        const Point2 forward_world{
            vehicle.position.x + std::cos(static_cast<double>(vehicle.heading_radians)) * 0.5,
            vehicle.position.y + std::sin(static_cast<double>(vehicle.heading_radians)) * 0.5,
        };
        const auto forward_screen = camera.worldToCanvas(forward_world.x, forward_world.y, world);
        double ux = forward_screen.x - center.x;
        double uy = forward_screen.y - center.y;
        double heading_length = std::hypot(ux, uy);
        if (heading_length <= 1e-6) { ux = 1.0; uy = 0.0; heading_length = 1.0; }
        ux /= heading_length; uy /= heading_length;
        const double px = -uy, py = ux;
        const auto color=vehicleColor(vehicle.kind);
        quad(scene.opaque,
            vertex(shifted(center,-ux*length-px*width,-uy*length-py*width),viewport,color),
            vertex(shifted(center, ux*length-px*width, uy*length-py*width),viewport,color),
            vertex(shifted(center, ux*length+px*width, uy*length+py*width),viewport,color),
            vertex(shifted(center,-ux*length+px*width,-uy*length+py*width),viewport,color),
            scene.stats.vehicle_triangles);
    }

    for (const auto& stop : packet.transit_stops) {
        const auto center = camera.worldToCanvas(stop.position.x,stop.position.y,world);
        const double radius = stop.kind==TransitStopKind::MetroStation ? 7.0 : 5.0;
        if (!pointVisible(center, viewport, radius)) continue;
        const Color color = stop.kind==TransitStopKind::MetroStation ? Color{0.55F,0.40F,0.80F,1.0F} : Color{0.30F,0.65F,0.82F,1.0F};
        constexpr int segments=8;
        for(int i=0;i<segments;++i){
            const double a=2.0*std::numbers::pi*static_cast<double>(i)/segments;
            const double b=2.0*std::numbers::pi*static_cast<double>(i+1)/segments;
            triangle(scene.opaque,vertex(center,viewport,color),vertex(shifted(center,std::cos(a)*radius,std::sin(a)*radius),viewport,color),vertex(shifted(center,std::cos(b)*radius,std::sin(b)*radius),viewport,color),scene.stats.transit_triangles);
        }
    }

    for (const auto& sample : packet.overlays) {
        const auto center = camera.worldToCanvas(sample.position.x,sample.position.y,world);
        const double radius=6.0+8.0*std::clamp(static_cast<double>(sample.value),0.0,1.0);
        if (!pointVisible(center, viewport, radius)) continue;
        ++scene.stats.overlay_samples;
        const auto color=overlayColor(sample.metric,sample.value);
        const int segments = overlaySegments(sample.metric);
        const double phase = overlayPhase(sample.metric);
        for(int i=0;i<segments;++i){
            const double a=phase+2.0*std::numbers::pi*static_cast<double>(i)/segments;
            const double b=phase+2.0*std::numbers::pi*static_cast<double>(i+1)/segments;
            const double ra=radius*overlayPulse(sample.metric,i);
            const double rb=radius*overlayPulse(sample.metric,i+1);
            triangle(scene.overlay,vertex(center,viewport,color),vertex(shifted(center,std::cos(a)*ra,std::sin(a)*ra),viewport,color),vertex(shifted(center,std::cos(b)*rb,std::sin(b)*rb),viewport,color),scene.stats.overlay_triangles);
        }
    }

    if (const auto selected = selectedWorldPoint(packet); selected) {
        const auto center = camera.worldToCanvas(selected->x, selected->y, world);
        const double radius = std::max(8.0, 10.0 * camera.zoom());
        if (!pointVisible(center, viewport, radius)) return scene;
        const double inner = radius * 0.48;
        const Color cue{1.0F,0.94F,0.34F,0.96F};
        const std::array<Point2,4> outer{
            shifted(center,0.0,-radius), shifted(center,radius,0.0), shifted(center,0.0,radius), shifted(center,-radius,0.0)};
        const std::array<Point2,4> inside{
            shifted(center,0.0,-inner), shifted(center,inner,0.0), shifted(center,0.0,inner), shifted(center,-inner,0.0)};
        for (std::size_t i=0;i<outer.size();++i) {
            const auto next=(i+1U)%outer.size();
            quad(scene.overlay,
                vertex(outer[i],viewport,cue), vertex(outer[next],viewport,cue),
                vertex(inside[next],viewport,cue), vertex(inside[i],viewport,cue),
                scene.stats.selection_triangles);
        }
    }
    return scene;
}

} // namespace civic::presentation
