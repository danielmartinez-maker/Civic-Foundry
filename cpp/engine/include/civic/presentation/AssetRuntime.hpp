#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <expected>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include <civic/presentation/GpuBackend.hpp>

namespace civic::presentation {

struct GlbVec3 final {
    float x{};
    float y{};
    float z{};
    friend bool operator==(const GlbVec3&, const GlbVec3&) = default;
};

struct GlbPrimitive final {
    std::vector<GlbVec3> positions;
    std::vector<std::uint32_t> indices;
    std::optional<std::size_t> material_index;
    std::uint32_t mode{4U};
};

struct GlbMaterial final {
    std::array<float, 4> base_color_factor{1.0F, 1.0F, 1.0F, 1.0F};
    float metallic_factor{1.0F};
    float roughness_factor{1.0F};
    std::optional<std::size_t> base_color_texture;
};

struct GlbTexture final {
    std::optional<std::size_t> source_image;
};

struct GlbImage final {
    std::string mime_type;
    std::vector<std::byte> bytes;
};

struct GlbNode final {
    std::optional<std::size_t> mesh_index;
    std::array<float, 16> local_transform{
        1.0F, 0.0F, 0.0F, 0.0F,
        0.0F, 1.0F, 0.0F, 0.0F,
        0.0F, 0.0F, 1.0F, 0.0F,
        0.0F, 0.0F, 0.0F, 1.0F,
    };
    std::vector<std::size_t> lod_node_ids;

    [[nodiscard]] GlbVec3 transformPoint(GlbVec3 point) const noexcept;
};

struct GlbAsset final {
    std::string source_name;
    std::size_t primitive_count{};
    std::size_t material_count{};
    std::size_t texture_count{};
    std::vector<std::byte> binary_chunk;
    std::string json_chunk;
    std::vector<GlbPrimitive> primitives;
    std::vector<GlbMaterial> materials;
    std::vector<GlbTexture> textures;
    std::vector<GlbImage> images;
    std::vector<GlbNode> nodes;
    bool diagnostic_placeholder{false};
    std::string diagnostic_message;
};

class GlbLoader final {
public:
    [[nodiscard]] std::expected<GlbAsset, std::string> load(std::span<const std::byte> bytes, std::string source_name) const;
    [[nodiscard]] GlbAsset loadOrPlaceholder(std::span<const std::byte> bytes, std::string source_name) const;
};

struct GlbGpuResources final {
    BufferHandle vertex_buffer{};
    BufferHandle index_buffer{};
    std::vector<TextureHandle> textures;
    friend bool operator==(const GlbGpuResources&, const GlbGpuResources&) = default;
};

class GlbGpuResourceCache final {
public:
    [[nodiscard]] std::expected<void, std::string> store(std::string asset_id, GlbGpuResources resources);
    [[nodiscard]] std::optional<GlbGpuResources> resolve(std::string_view asset_id) const;
    [[nodiscard]] std::size_t size() const noexcept { return resources_.size(); }
    void erase(std::string_view asset_id);
    void clear() noexcept { resources_.clear(); }
private:
    std::map<std::string, GlbGpuResources, std::less<>> resources_;
};

} // namespace civic::presentation
