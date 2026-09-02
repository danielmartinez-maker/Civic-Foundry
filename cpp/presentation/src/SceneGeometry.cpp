#include <civic/presentation/SceneGeometry.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>

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

Color terrainColor(TerrainBiome biome) noexcept {
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
        case OverlayMetric::TransitReliability: return {0.30F,0.72F,0.55F,0.70F};
        case OverlayMetric::TransitCrowding: return {0.73F,0.33F,0.78F,0.70F};
        case OverlayMetric::FloodExposure: return {0.17F,0.48F,0.82F,0.72F};
        case OverlayMetric::Cadastre: return {0.94F,0.82F,0.27F,0.72F};
        case OverlayMetric::Zoning: return {0.45F,0.72F,0.40F,0.70F};
        default: return {0.34F,0.68F,0.84F,0.68F};
    }
}

Point2 shifted(Point2 point, double dx, double dy) noexcept { return {point.x + dx, point.y + dy}; }

} // namespace

SceneGeometry SceneGeometryBuilder::build(const RenderPacket& packet, const IsometricCamera& camera, WorldSize world, PixelViewport viewport) const {
    SceneGeometry scene{};
    scene.revision = packet.revision;
    if (viewport.width == 0 || viewport.height == 0) return scene;

    for (const auto& cell : packet.terrain) {
        const auto polygon = camera.tilePolygon(cell.x, cell.y, world);
        if (polygon.size() != 4) continue;
        const auto color = terrainColor(cell.biome);
        quad(scene.opaque, vertex(polygon[0],viewport,color), vertex(polygon[1],viewport,color), vertex(polygon[2],viewport,color), vertex(polygon[3],viewport,color), scene.stats.terrain_triangles);
    }

    for (const auto& road : packet.roads) {
        const auto a = camera.worldToCanvas(road.from.x, road.from.y, world);
        const auto b = camera.worldToCanvas(road.to.x, road.to.y, world);
        const double dx = b.x - a.x, dy = b.y - a.y;
        const double length = std::hypot(dx,dy);
        if (length <= 1e-6) continue;
        const double half_width = std::max(2.0, static_cast<double>(road.lanes) * 1.25 * camera.zoom());
        const double nx = -dy / length * half_width, ny = dx / length * half_width;
        const auto color = roadColor(road.road_class, road.condition);
        quad(scene.opaque,
            vertex(shifted(a,nx,ny),viewport,color), vertex(shifted(b,nx,ny),viewport,color),
            vertex(shifted(b,-nx,-ny),viewport,color), vertex(shifted(a,-nx,-ny),viewport,color), scene.stats.road_triangles);
    }

    for (const auto& building : packet.buildings) {
        if (building.footprint.size() < 3) continue;
        ++scene.stats.canonical_buildings;
        scene.stats.max_building_height_m = std::max(scene.stats.max_building_height_m, building.height_m);
        const auto base_color = buildingColor(building);
        const Color roof_color{std::min(1.0F,base_color.r*1.12F),std::min(1.0F,base_color.g*1.12F),std::min(1.0F,base_color.b*1.12F),1.0F};
        const Color wall_color{base_color.r*0.82F,base_color.g*0.82F,base_color.b*0.82F,1.0F};
        const double height_px = std::max(2.0, static_cast<double>(building.height_m) * 0.9 * camera.zoom());
        std::vector<Point2> ground; ground.reserve(building.footprint.size());
        std::vector<Point2> roof; roof.reserve(building.footprint.size());
        for (const auto point : building.footprint) {
            const auto projected = camera.worldToCanvas(point.x,point.y,world);
            ground.push_back(projected); roof.push_back(shifted(projected,0.0,-height_px));
        }
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
        const auto color=vehicleColor(vehicle.kind);
        quad(scene.opaque,vertex(shifted(center,-length,-width),viewport,color),vertex(shifted(center,length,-width),viewport,color),vertex(shifted(center,length,width),viewport,color),vertex(shifted(center,-length,width),viewport,color),scene.stats.vehicle_triangles);
    }

    for (const auto& stop : packet.transit_stops) {
        const auto center = camera.worldToCanvas(stop.position.x,stop.position.y,world);
        const double radius = stop.kind==TransitStopKind::MetroStation ? 7.0 : 5.0;
        const Color color = stop.kind==TransitStopKind::MetroStation ? Color{0.55F,0.40F,0.80F,1.0F} : Color{0.30F,0.65F,0.82F,1.0F};
        constexpr int segments=8;
        for(int i=0;i<segments;++i){
            const double a=2.0*std::numbers::pi*static_cast<double>(i)/segments;
            const double b=2.0*std::numbers::pi*static_cast<double>(i+1)/segments;
            triangle(scene.opaque,vertex(center,viewport,color),vertex(shifted(center,std::cos(a)*radius,std::sin(a)*radius),viewport,color),vertex(shifted(center,std::cos(b)*radius,std::sin(b)*radius),viewport,color),scene.stats.transit_triangles);
        }
    }

    for (const auto& sample : packet.overlays) {
        ++scene.stats.overlay_samples;
        const auto center = camera.worldToCanvas(sample.position.x,sample.position.y,world);
        const auto color=overlayColor(sample.metric,sample.value);
        const double radius=6.0+8.0*std::clamp(static_cast<double>(sample.value),0.0,1.0);
        const int segments = sample.metric==OverlayMetric::TrafficCongestion ? 4 : 6;
        for(int i=0;i<segments;++i){
            const double a=2.0*std::numbers::pi*static_cast<double>(i)/segments;
            const double b=2.0*std::numbers::pi*static_cast<double>(i+1)/segments;
            triangle(scene.overlay,vertex(center,viewport,color),vertex(shifted(center,std::cos(a)*radius,std::sin(a)*radius),viewport,color),vertex(shifted(center,std::cos(b)*radius,std::sin(b)*radius),viewport,color),scene.stats.overlay_triangles);
        }
    }
    return scene;
}

} // namespace civic::presentation
