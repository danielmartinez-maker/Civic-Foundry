#include <civic/presentation/AssetRuntime.hpp>

#include <json-c/json.h>

#include <cstring>
#include <utility>

namespace civic::presentation {
namespace {
constexpr std::uint32_t kGlbMagic = 0x46546c67U;
constexpr std::uint32_t kJsonChunk = 0x4e4f534aU;
constexpr std::uint32_t kBinChunk = 0x004e4942U;

std::uint32_t read32(std::span<const std::byte> bytes, std::size_t offset) noexcept {
    const auto b0 = std::to_integer<std::uint32_t>(bytes[offset]);
    const auto b1 = std::to_integer<std::uint32_t>(bytes[offset + 1]);
    const auto b2 = std::to_integer<std::uint32_t>(bytes[offset + 2]);
    const auto b3 = std::to_integer<std::uint32_t>(bytes[offset + 3]);
    return b0 | (b1 << 8U) | (b2 << 16U) | (b3 << 24U);
}

std::size_t arrayLength(json_object* root, const char* key) noexcept {
    json_object* value = nullptr;
    if (!json_object_object_get_ex(root, key, &value) || !json_object_is_type(value, json_type_array)) return 0;
    return json_object_array_length(value);
}
} // namespace

std::expected<GlbAsset, std::string> GlbLoader::load(std::span<const std::byte> bytes, std::string source_name) const {
    if (bytes.size() < 20) return std::unexpected("GLB is smaller than the mandatory header and JSON chunk");
    if (read32(bytes, 0) != kGlbMagic) return std::unexpected("GLB magic is invalid");
    if (read32(bytes, 4) != 2U) return std::unexpected("only glTF 2.0 GLB assets are supported");
    const auto declared_length = static_cast<std::size_t>(read32(bytes, 8));
    if (declared_length != bytes.size()) return std::unexpected("GLB declared length does not match file length");

    GlbAsset asset{};
    asset.source_name = std::move(source_name);
    std::size_t cursor = 12;
    bool saw_json = false;
    while (cursor + 8 <= bytes.size()) {
        const auto chunk_length = static_cast<std::size_t>(read32(bytes, cursor));
        const auto chunk_type = read32(bytes, cursor + 4);
        cursor += 8;
        if (chunk_length > bytes.size() - cursor) return std::unexpected("GLB chunk extends beyond file length");
        if (chunk_type == kJsonChunk) {
            if (saw_json) return std::unexpected("GLB contains multiple JSON chunks");
            asset.json_chunk.assign(reinterpret_cast<const char*>(bytes.data() + cursor), chunk_length);
            saw_json = true;
        } else if (chunk_type == kBinChunk) {
            asset.binary_chunk.assign(bytes.begin() + static_cast<std::ptrdiff_t>(cursor), bytes.begin() + static_cast<std::ptrdiff_t>(cursor + chunk_length));
        }
        cursor += chunk_length;
    }
    if (!saw_json) return std::unexpected("GLB JSON chunk is missing");
    while (!asset.json_chunk.empty() && (asset.json_chunk.back() == ' ' || asset.json_chunk.back() == '\0')) asset.json_chunk.pop_back();

    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected("failed to allocate GLB JSON parser");
    json_object* root = json_tokener_parse_ex(tokener, asset.json_chunk.data(), static_cast<int>(asset.json_chunk.size()));
    const auto error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    if (!root || error != json_tokener_success || !json_object_is_type(root, json_type_object)) {
        if (root) json_object_put(root);
        return std::unexpected("GLB JSON chunk is invalid");
    }
    json_object* asset_object = nullptr;
    json_object* version = nullptr;
    if (!json_object_object_get_ex(root, "asset", &asset_object) || !json_object_is_type(asset_object, json_type_object) ||
        !json_object_object_get_ex(asset_object, "version", &version) || std::strcmp(json_object_get_string(version), "2.0") != 0) {
        json_object_put(root);
        return std::unexpected("GLB asset.version must be 2.0");
    }
    asset.material_count = arrayLength(root, "materials");
    asset.texture_count = arrayLength(root, "textures");
    json_object* meshes = nullptr;
    if (json_object_object_get_ex(root, "meshes", &meshes) && json_object_is_type(meshes, json_type_array)) {
        const auto mesh_count = json_object_array_length(meshes);
        for (std::size_t index = 0; index < mesh_count; ++index) {
            json_object* mesh = json_object_array_get_idx(meshes, index);
            json_object* primitives = nullptr;
            if (mesh && json_object_object_get_ex(mesh, "primitives", &primitives) && json_object_is_type(primitives, json_type_array)) {
                asset.primitive_count += json_object_array_length(primitives);
            }
        }
    }
    json_object_put(root);
    return asset;
}

GlbAsset GlbLoader::loadOrPlaceholder(std::span<const std::byte> bytes, std::string source_name) const {
    auto loaded = load(bytes, source_name);
    if (loaded) return std::move(*loaded);
    GlbAsset placeholder{};
    placeholder.source_name = std::move(source_name);
    placeholder.diagnostic_placeholder = true;
    placeholder.diagnostic_message = loaded.error();
    return placeholder;
}

} // namespace civic::presentation
