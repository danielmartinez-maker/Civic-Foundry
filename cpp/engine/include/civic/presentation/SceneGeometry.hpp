#pragma once

#include <civic/presentation/RenderPipeline.hpp>

#include <cstddef>
#include <cstdint>
#include <vector>

namespace civic::presentation {

struct PixelViewport { std::uint32_t width{}; std::uint32_t height{}; };
struct SceneVertex { float x{}; float y{}; float r{1.0F}; float g{1.0F}; float b{1.0F}; float a{1.0F}; };
struct SceneGeometryStats {
    std::size_t terrain_triangles{}; std::size_t road_triangles{}; std::size_t building_triangles{};
    std::size_t vehicle_triangles{}; std::size_t transit_triangles{}; std::size_t overlay_triangles{};
    std::size_t canonical_buildings{}; std::size_t overlay_samples{}; float max_building_height_m{};
};
struct SceneGeometry {
    RenderRevision revision{};
    std::uint64_t geometry_key{};
    std::vector<SceneVertex> opaque;
    std::vector<SceneVertex> overlay;
    SceneGeometryStats stats;
};
class SceneGeometryBuilder {
public:
    [[nodiscard]] SceneGeometry build(const RenderPacket& packet, const IsometricCamera& camera, WorldSize world, PixelViewport viewport) const;
};

} // namespace civic::presentation
