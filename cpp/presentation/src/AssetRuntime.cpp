#include <civic/presentation/AssetRuntime.hpp>

#include <json-c/json.h>

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <limits>
#include <utility>

namespace civic::presentation {
namespace {
constexpr std::uint32_t kGlbMagic = 0x46546c67U;
constexpr std::uint32_t kJsonChunk = 0x4e4f534aU;
constexpr std::uint32_t kBinChunk = 0x004e4942U;
constexpr std::uint32_t kTriangles = 4U;

struct JsonGuard final {
    json_object* value{};
    ~JsonGuard() { if (value) json_object_put(value); }
    JsonGuard(const JsonGuard&) = delete;
    JsonGuard& operator=(const JsonGuard&) = delete;
};

struct BufferView final {
    std::size_t offset{};
    std::size_t length{};
    std::size_t stride{};
};

struct Accessor final {
    std::size_t buffer_view{};
    std::size_t byte_offset{};
    std::size_t count{};
    std::uint32_t component_type{};
    std::string type;
    std::size_t component_count{};
    std::size_t component_size{};
};

std::uint32_t read32(std::span<const std::byte> bytes, std::size_t offset) noexcept {
    const auto b0 = std::to_integer<std::uint32_t>(bytes[offset]);
    const auto b1 = std::to_integer<std::uint32_t>(bytes[offset + 1]);
    const auto b2 = std::to_integer<std::uint32_t>(bytes[offset + 2]);
    const auto b3 = std::to_integer<std::uint32_t>(bytes[offset + 3]);
    return b0 | (b1 << 8U) | (b2 << 16U) | (b3 << 24U);
}

std::uint16_t read16(std::span<const std::byte> bytes, std::size_t offset) noexcept {
    const auto b0 = std::to_integer<std::uint16_t>(bytes[offset]);
    const auto b1 = std::to_integer<std::uint16_t>(bytes[offset + 1]);
    return static_cast<std::uint16_t>(b0 | static_cast<std::uint16_t>(b1 << 8U));
}

float readFloat32(std::span<const std::byte> bytes, std::size_t offset) noexcept {
    return std::bit_cast<float>(read32(bytes, offset));
}

bool checkedAdd(std::size_t left, std::size_t right, std::size_t& result) noexcept {
    if (right > std::numeric_limits<std::size_t>::max() - left) return false;
    result = left + right;
    return true;
}

bool checkedMul(std::size_t left, std::size_t right, std::size_t& result) noexcept {
    if (left != 0U && right > std::numeric_limits<std::size_t>::max() / left) return false;
    result = left * right;
    return true;
}

json_object* member(json_object* object, const char* key) noexcept {
    json_object* value = nullptr;
    if (!object || !json_object_is_type(object, json_type_object) || !json_object_object_get_ex(object, key, &value)) return nullptr;
    return value;
}

std::expected<std::size_t, std::string> nonNegativeSize(json_object* object, const char* key, bool required = true, std::size_t fallback = 0U) {
    json_object* value = member(object, key);
    if (!value) {
        if (required) return std::unexpected(std::string{"missing integer field: "} + key);
        return fallback;
    }
    if (!json_object_is_type(value, json_type_int)) return std::unexpected(std::string{"field must be a non-negative integer: "} + key);
    const auto integer = json_object_get_int64(value);
    if (integer < 0) return std::unexpected(std::string{"field must be a non-negative integer: "} + key);
    return static_cast<std::size_t>(integer);
}

std::expected<float, std::string> finiteFloat(json_object* value, std::string_view label) {
    if (!value || (!json_object_is_type(value, json_type_double) && !json_object_is_type(value, json_type_int))) {
        return std::unexpected(std::string{label} + " must be numeric");
    }
    const auto number = json_object_get_double(value);
    if (!std::isfinite(number) || number < -static_cast<double>(std::numeric_limits<float>::max()) || number > static_cast<double>(std::numeric_limits<float>::max())) {
        return std::unexpected(std::string{label} + " must be a finite float");
    }
    return static_cast<float>(number);
}

std::expected<std::vector<float>, std::string> floatArray(json_object* object, const char* key, std::size_t expected_size) {
    json_object* value = member(object, key);
    if (!value || !json_object_is_type(value, json_type_array) || json_object_array_length(value) != expected_size) {
        return std::unexpected(std::string{key} + " must contain exactly " + std::to_string(expected_size) + " numeric values");
    }
    std::vector<float> result;
    result.reserve(expected_size);
    for (std::size_t index = 0; index < expected_size; ++index) {
        auto number = finiteFloat(json_object_array_get_idx(value, index), key);
        if (!number) return std::unexpected(number.error());
        result.push_back(*number);
    }
    return result;
}

std::size_t componentSize(std::uint32_t component_type) noexcept {
    switch (component_type) {
        case 5120U:
        case 5121U: return 1U;
        case 5122U:
        case 5123U: return 2U;
        case 5125U:
        case 5126U: return 4U;
        default: return 0U;
    }
}

std::size_t componentCount(std::string_view type) noexcept {
    if (type == "SCALAR") return 1U;
    if (type == "VEC2") return 2U;
    if (type == "VEC3") return 3U;
    if (type == "VEC4" || type == "MAT2") return 4U;
    if (type == "MAT3") return 9U;
    if (type == "MAT4") return 16U;
    return 0U;
}

std::expected<std::vector<BufferView>, std::string> parseBufferViews(json_object* root, std::span<const std::byte> binary, std::size_t declared_binary_length) {
    std::vector<BufferView> views;
    json_object* array = member(root, "bufferViews");
    if (!array) return views;
    if (!json_object_is_type(array, json_type_array)) return std::unexpected("bufferViews must be an array");
    const auto count = json_object_array_length(array);
    views.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        json_object* object = json_object_array_get_idx(array, index);
        if (!object || !json_object_is_type(object, json_type_object)) return std::unexpected("bufferView must be an object");
        auto buffer = nonNegativeSize(object, "buffer");
        auto offset = nonNegativeSize(object, "byteOffset", false, 0U);
        auto length = nonNegativeSize(object, "byteLength");
        auto stride = nonNegativeSize(object, "byteStride", false, 0U);
        if (!buffer || !offset || !length || !stride) return std::unexpected("invalid bufferView integer field");
        if (*buffer != 0U) return std::unexpected("native GLB runtime supports only the embedded buffer at index 0");
        std::size_t end{};
        if (!checkedAdd(*offset, *length, end) || end > declared_binary_length || end > binary.size()) {
            return std::unexpected("bufferView extends beyond the embedded GLB buffer");
        }
        views.push_back(BufferView{*offset, *length, *stride});
    }
    return views;
}

std::expected<std::vector<Accessor>, std::string> parseAccessors(json_object* root, const std::vector<BufferView>& views) {
    std::vector<Accessor> accessors;
    json_object* array = member(root, "accessors");
    if (!array) return accessors;
    if (!json_object_is_type(array, json_type_array)) return std::unexpected("accessors must be an array");
    const auto count = json_object_array_length(array);
    accessors.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        json_object* object = json_object_array_get_idx(array, index);
        if (!object || !json_object_is_type(object, json_type_object)) return std::unexpected("accessor must be an object");
        if (member(object, "sparse")) return std::unexpected("sparse accessors are not supported by the native GLB runtime");
        auto view_index = nonNegativeSize(object, "bufferView");
        auto byte_offset = nonNegativeSize(object, "byteOffset", false, 0U);
        auto component_type = nonNegativeSize(object, "componentType");
        auto element_count = nonNegativeSize(object, "count");
        json_object* type_value = member(object, "type");
        if (!view_index || !byte_offset || !component_type || !element_count || !type_value || !json_object_is_type(type_value, json_type_string)) {
            return std::unexpected("accessor is missing required fields");
        }
        if (*view_index >= views.size()) return std::unexpected("accessor references a missing bufferView");
        const auto components = componentCount(json_object_get_string(type_value));
        const auto bytes_per_component = componentSize(static_cast<std::uint32_t>(*component_type));
        if (components == 0U || bytes_per_component == 0U) return std::unexpected("accessor uses an unsupported componentType or type");
        std::size_t element_size{};
        if (!checkedMul(components, bytes_per_component, element_size)) return std::unexpected("accessor element size overflows");
        const auto& view = views[*view_index];
        const auto stride = view.stride == 0U ? element_size : view.stride;
        if (stride < element_size) return std::unexpected("accessor byteStride is smaller than its element size");
        std::size_t required = *byte_offset;
        if (*element_count > 0U) {
            std::size_t prior_stride{};
            if (!checkedMul(*element_count - 1U, stride, prior_stride) || !checkedAdd(required, prior_stride, required) || !checkedAdd(required, element_size, required)) {
                return std::unexpected("accessor byte range overflows");
            }
        }
        if (required > view.length) return std::unexpected("accessor extends beyond its bufferView");
        accessors.push_back(Accessor{*view_index, *byte_offset, *element_count, static_cast<std::uint32_t>(*component_type), json_object_get_string(type_value), components, bytes_per_component});
    }
    return accessors;
}

std::size_t accessorStride(const Accessor& accessor, const BufferView& view) noexcept {
    const auto element_size = accessor.component_count * accessor.component_size;
    return view.stride == 0U ? element_size : view.stride;
}

std::size_t accessorElementOffset(const Accessor& accessor, const BufferView& view, std::size_t element) noexcept {
    return view.offset + accessor.byte_offset + element * accessorStride(accessor, view);
}

std::expected<std::vector<GlbVec3>, std::string> decodePositions(
    std::size_t accessor_index,
    const std::vector<Accessor>& accessors,
    const std::vector<BufferView>& views,
    std::span<const std::byte> binary) {
    if (accessor_index >= accessors.size()) return std::unexpected("POSITION references a missing accessor");
    const auto& accessor = accessors[accessor_index];
    if (accessor.component_type != 5126U || accessor.type != "VEC3") return std::unexpected("POSITION accessor must use FLOAT VEC3");
    const auto& view = views[accessor.buffer_view];
    std::vector<GlbVec3> positions;
    positions.reserve(accessor.count);
    for (std::size_t index = 0; index < accessor.count; ++index) {
        const auto offset = accessorElementOffset(accessor, view, index);
        const GlbVec3 position{readFloat32(binary, offset), readFloat32(binary, offset + 4U), readFloat32(binary, offset + 8U)};
        if (!std::isfinite(position.x) || !std::isfinite(position.y) || !std::isfinite(position.z)) return std::unexpected("POSITION accessor contains a non-finite coordinate");
        positions.push_back(position);
    }
    return positions;
}

std::expected<std::vector<std::uint32_t>, std::string> decodeIndices(
    std::size_t accessor_index,
    const std::vector<Accessor>& accessors,
    const std::vector<BufferView>& views,
    std::span<const std::byte> binary,
    std::size_t vertex_count) {
    if (accessor_index >= accessors.size()) return std::unexpected("indices reference a missing accessor");
    const auto& accessor = accessors[accessor_index];
    if (accessor.type != "SCALAR" || (accessor.component_type != 5121U && accessor.component_type != 5123U && accessor.component_type != 5125U)) {
        return std::unexpected("index accessor must use unsigned SCALAR components");
    }
    const auto& view = views[accessor.buffer_view];
    std::vector<std::uint32_t> indices;
    indices.reserve(accessor.count);
    for (std::size_t index = 0; index < accessor.count; ++index) {
        const auto offset = accessorElementOffset(accessor, view, index);
        std::uint32_t value{};
        if (accessor.component_type == 5121U) value = std::to_integer<std::uint8_t>(binary[offset]);
        else if (accessor.component_type == 5123U) value = read16(binary, offset);
        else value = read32(binary, offset);
        if (value >= vertex_count) return std::unexpected("index accessor references a vertex outside POSITION");
        indices.push_back(value);
    }
    return indices;
}

std::expected<std::size_t, std::string> parseEmbeddedBufferLength(json_object* root, std::span<const std::byte> binary) {
    json_object* buffers = member(root, "buffers");
    if (!buffers) return binary.empty() ? std::expected<std::size_t, std::string>{0U} : std::expected<std::size_t, std::string>{binary.size()};
    if (!json_object_is_type(buffers, json_type_array) || json_object_array_length(buffers) != 1U) {
        return std::unexpected("native GLB runtime requires exactly one embedded buffer when buffers are declared");
    }
    json_object* buffer = json_object_array_get_idx(buffers, 0U);
    if (!buffer || !json_object_is_type(buffer, json_type_object)) return std::unexpected("buffer must be an object");
    if (member(buffer, "uri")) return std::unexpected("external buffer URI is not supported in the native GLB runtime");
    auto byte_length = nonNegativeSize(buffer, "byteLength");
    if (!byte_length) return std::unexpected(byte_length.error());
    if (*byte_length > binary.size()) return std::unexpected("embedded buffer byteLength exceeds the GLB BIN chunk");
    return *byte_length;
}

std::expected<std::vector<GlbImage>, std::string> parseImages(json_object* root, const std::vector<BufferView>& views, std::span<const std::byte> binary) {
    std::vector<GlbImage> images;
    json_object* array = member(root, "images");
    if (!array) return images;
    if (!json_object_is_type(array, json_type_array)) return std::unexpected("images must be an array");
    const auto count = json_object_array_length(array);
    images.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        json_object* object = json_object_array_get_idx(array, index);
        if (!object || !json_object_is_type(object, json_type_object)) return std::unexpected("image must be an object");
        if (member(object, "uri")) return std::unexpected("external or data-URI images are not supported by the native GLB runtime");
        auto view_index = nonNegativeSize(object, "bufferView");
        json_object* mime = member(object, "mimeType");
        if (!view_index || *view_index >= views.size() || !mime || !json_object_is_type(mime, json_type_string)) {
            return std::unexpected("embedded GLB image requires a valid bufferView and mimeType");
        }
        const auto& view = views[*view_index];
        GlbImage image{};
        image.mime_type = json_object_get_string(mime);
        image.bytes.assign(binary.begin() + static_cast<std::ptrdiff_t>(view.offset), binary.begin() + static_cast<std::ptrdiff_t>(view.offset + view.length));
        images.push_back(std::move(image));
    }
    return images;
}

std::expected<std::vector<GlbTexture>, std::string> parseTextures(json_object* root, std::size_t image_count) {
    std::vector<GlbTexture> textures;
    json_object* array = member(root, "textures");
    if (!array) return textures;
    if (!json_object_is_type(array, json_type_array)) return std::unexpected("textures must be an array");
    const auto count = json_object_array_length(array);
    textures.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        json_object* object = json_object_array_get_idx(array, index);
        if (!object || !json_object_is_type(object, json_type_object)) return std::unexpected("texture must be an object");
        GlbTexture texture{};
        if (member(object, "source")) {
            auto source = nonNegativeSize(object, "source");
            if (!source || *source >= image_count) return std::unexpected("texture references a missing source image");
            texture.source_image = *source;
        }
        textures.push_back(texture);
    }
    return textures;
}

std::expected<std::vector<GlbMaterial>, std::string> parseMaterials(json_object* root, std::size_t texture_count) {
    std::vector<GlbMaterial> materials;
    json_object* array = member(root, "materials");
    if (!array) return materials;
    if (!json_object_is_type(array, json_type_array)) return std::unexpected("materials must be an array");
    const auto count = json_object_array_length(array);
    materials.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        json_object* object = json_object_array_get_idx(array, index);
        if (!object || !json_object_is_type(object, json_type_object)) return std::unexpected("material must be an object");
        GlbMaterial material{};
        json_object* pbr = member(object, "pbrMetallicRoughness");
        if (pbr) {
            if (!json_object_is_type(pbr, json_type_object)) return std::unexpected("pbrMetallicRoughness must be an object");
            if (member(pbr, "baseColorFactor")) {
                auto factor = floatArray(pbr, "baseColorFactor", 4U);
                if (!factor) return std::unexpected(factor.error());
                std::copy(factor->begin(), factor->end(), material.base_color_factor.begin());
            }
            if (json_object* metallic = member(pbr, "metallicFactor")) {
                auto value = finiteFloat(metallic, "metallicFactor");
                if (!value) return std::unexpected(value.error());
                material.metallic_factor = *value;
            }
            if (json_object* roughness = member(pbr, "roughnessFactor")) {
                auto value = finiteFloat(roughness, "roughnessFactor");
                if (!value) return std::unexpected(value.error());
                material.roughness_factor = *value;
            }
            if (json_object* texture_info = member(pbr, "baseColorTexture")) {
                if (!json_object_is_type(texture_info, json_type_object)) return std::unexpected("baseColorTexture must be an object");
                auto texture_index = nonNegativeSize(texture_info, "index");
                if (!texture_index || *texture_index >= texture_count) return std::unexpected("material references a missing baseColor texture");
                material.base_color_texture = *texture_index;
            }
        }
        materials.push_back(material);
    }
    return materials;
}

std::expected<std::vector<GlbPrimitive>, std::string> parsePrimitives(
    json_object* root,
    const std::vector<Accessor>& accessors,
    const std::vector<BufferView>& views,
    std::span<const std::byte> binary,
    std::size_t material_count) {
    std::vector<GlbPrimitive> result;
    json_object* meshes = member(root, "meshes");
    if (!meshes) return result;
    if (!json_object_is_type(meshes, json_type_array)) return std::unexpected("meshes must be an array");
    const auto mesh_count = json_object_array_length(meshes);
    for (std::size_t mesh_index = 0; mesh_index < mesh_count; ++mesh_index) {
        json_object* mesh = json_object_array_get_idx(meshes, mesh_index);
        json_object* primitives = member(mesh, "primitives");
        if (!mesh || !json_object_is_type(mesh, json_type_object) || !primitives || !json_object_is_type(primitives, json_type_array)) {
            return std::unexpected("mesh primitives must be an array");
        }
        const auto primitive_count = json_object_array_length(primitives);
        for (std::size_t primitive_index = 0; primitive_index < primitive_count; ++primitive_index) {
            json_object* primitive = json_object_array_get_idx(primitives, primitive_index);
            if (!primitive || !json_object_is_type(primitive, json_type_object)) return std::unexpected("mesh primitive must be an object");
            const auto mode = nonNegativeSize(primitive, "mode", false, kTriangles);
            if (!mode || *mode != kTriangles) return std::unexpected("native GLB runtime currently supports TRIANGLES primitives only");
            json_object* attributes = member(primitive, "attributes");
            if (!attributes || !json_object_is_type(attributes, json_type_object)) return std::unexpected("mesh primitive attributes must be an object");
            auto position_accessor = nonNegativeSize(attributes, "POSITION");
            if (!position_accessor) return std::unexpected("mesh primitive requires a POSITION accessor");
            auto positions = decodePositions(*position_accessor, accessors, views, binary);
            if (!positions) return std::unexpected(positions.error());

            GlbPrimitive decoded{};
            decoded.positions = std::move(*positions);
            decoded.mode = static_cast<std::uint32_t>(*mode);
            if (member(primitive, "indices")) {
                auto index_accessor = nonNegativeSize(primitive, "indices");
                if (!index_accessor) return std::unexpected(index_accessor.error());
                auto indices = decodeIndices(*index_accessor, accessors, views, binary, decoded.positions.size());
                if (!indices) return std::unexpected(indices.error());
                decoded.indices = std::move(*indices);
            } else {
                decoded.indices.reserve(decoded.positions.size());
                for (std::size_t vertex = 0; vertex < decoded.positions.size(); ++vertex) {
                    if (vertex > std::numeric_limits<std::uint32_t>::max()) return std::unexpected("primitive vertex count exceeds native index range");
                    decoded.indices.push_back(static_cast<std::uint32_t>(vertex));
                }
            }
            if (decoded.indices.size() % 3U != 0U) return std::unexpected("TRIANGLES primitive index count must be divisible by three");
            if (member(primitive, "material")) {
                auto material_index = nonNegativeSize(primitive, "material");
                if (!material_index || *material_index >= material_count) return std::unexpected("primitive references a missing material");
                decoded.material_index = *material_index;
            }
            result.push_back(std::move(decoded));
        }
    }
    return result;
}

std::array<float, 16> composeTrs(json_object* node, std::expected<void, std::string>& status) {
    std::array<float, 3> translation{0.0F, 0.0F, 0.0F};
    std::array<float, 4> rotation{0.0F, 0.0F, 0.0F, 1.0F};
    std::array<float, 3> scale{1.0F, 1.0F, 1.0F};
    if (member(node, "translation")) {
        auto values = floatArray(node, "translation", 3U);
        if (!values) { status = std::unexpected(values.error()); return {}; }
        std::copy(values->begin(), values->end(), translation.begin());
    }
    if (member(node, "rotation")) {
        auto values = floatArray(node, "rotation", 4U);
        if (!values) { status = std::unexpected(values.error()); return {}; }
        std::copy(values->begin(), values->end(), rotation.begin());
        const auto length_sq = rotation[0] * rotation[0] + rotation[1] * rotation[1] + rotation[2] * rotation[2] + rotation[3] * rotation[3];
        if (!(length_sq > 0.0F) || !std::isfinite(length_sq)) { status = std::unexpected("node rotation quaternion must be finite and non-zero"); return {}; }
        const auto inverse_length = 1.0F / std::sqrt(length_sq);
        for (auto& component : rotation) component *= inverse_length;
    }
    if (member(node, "scale")) {
        auto values = floatArray(node, "scale", 3U);
        if (!values) { status = std::unexpected(values.error()); return {}; }
        std::copy(values->begin(), values->end(), scale.begin());
    }

    const float x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3];
    const float xx = x * x, yy = y * y, zz = z * z;
    const float xy = x * y, xz = x * z, yz = y * z;
    const float wx = w * x, wy = w * y, wz = w * z;
    status = {};
    return {
        (1.0F - 2.0F * (yy + zz)) * scale[0], (2.0F * (xy + wz)) * scale[0], (2.0F * (xz - wy)) * scale[0], 0.0F,
        (2.0F * (xy - wz)) * scale[1], (1.0F - 2.0F * (xx + zz)) * scale[1], (2.0F * (yz + wx)) * scale[1], 0.0F,
        (2.0F * (xz + wy)) * scale[2], (2.0F * (yz - wx)) * scale[2], (1.0F - 2.0F * (xx + yy)) * scale[2], 0.0F,
        translation[0], translation[1], translation[2], 1.0F,
    };
}

std::expected<std::vector<GlbNode>, std::string> parseNodes(json_object* root, std::size_t mesh_count) {
    std::vector<GlbNode> nodes;
    json_object* array = member(root, "nodes");
    if (!array) return nodes;
    if (!json_object_is_type(array, json_type_array)) return std::unexpected("nodes must be an array");
    const auto count = json_object_array_length(array);
    nodes.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        json_object* object = json_object_array_get_idx(array, index);
        if (!object || !json_object_is_type(object, json_type_object)) return std::unexpected("node must be an object");
        GlbNode node{};
        if (member(object, "mesh")) {
            auto mesh_index = nonNegativeSize(object, "mesh");
            if (!mesh_index || *mesh_index >= mesh_count) return std::unexpected("node references a missing mesh");
            node.mesh_index = *mesh_index;
        }
        if (member(object, "matrix")) {
            if (member(object, "translation") || member(object, "rotation") || member(object, "scale")) return std::unexpected("node matrix cannot be combined with TRS fields");
            auto values = floatArray(object, "matrix", 16U);
            if (!values) return std::unexpected(values.error());
            std::copy(values->begin(), values->end(), node.local_transform.begin());
        } else {
            std::expected<void, std::string> status{};
            node.local_transform = composeTrs(object, status);
            if (!status) return std::unexpected(status.error());
        }
        if (json_object* extensions = member(object, "extensions")) {
            if (!json_object_is_type(extensions, json_type_object)) return std::unexpected("node extensions must be an object");
            if (json_object* lod = member(extensions, "MSFT_lod")) {
                json_object* ids = member(lod, "ids");
                if (!lod || !json_object_is_type(lod, json_type_object) || !ids || !json_object_is_type(ids, json_type_array)) return std::unexpected("MSFT_lod node extension requires an ids array");
                const auto lod_count = json_object_array_length(ids);
                node.lod_node_ids.reserve(lod_count);
                for (std::size_t lod_index = 0; lod_index < lod_count; ++lod_index) {
                    json_object* value = json_object_array_get_idx(ids, lod_index);
                    if (!value || !json_object_is_type(value, json_type_int) || json_object_get_int64(value) < 0) return std::unexpected("MSFT_lod ids must be non-negative node indices");
                    node.lod_node_ids.push_back(static_cast<std::size_t>(json_object_get_int64(value)));
                }
            }
        }
        nodes.push_back(std::move(node));
    }
    for (const auto& node : nodes) {
        for (const auto lod_id : node.lod_node_ids) if (lod_id >= nodes.size()) return std::unexpected("MSFT_lod references a missing node");
    }
    return nodes;
}
} // namespace

GlbVec3 GlbNode::transformPoint(GlbVec3 point) const noexcept {
    return {
        local_transform[0] * point.x + local_transform[4] * point.y + local_transform[8] * point.z + local_transform[12],
        local_transform[1] * point.x + local_transform[5] * point.y + local_transform[9] * point.z + local_transform[13],
        local_transform[2] * point.x + local_transform[6] * point.y + local_transform[10] * point.z + local_transform[14],
    };
}

std::expected<GlbAsset, std::string> GlbLoader::load(std::span<const std::byte> bytes, std::string source_name) const {
    if (bytes.size() < 20U) return std::unexpected("GLB is smaller than the mandatory header and JSON chunk");
    if (read32(bytes, 0U) != kGlbMagic) return std::unexpected("GLB magic is invalid");
    if (read32(bytes, 4U) != 2U) return std::unexpected("only glTF 2.0 GLB assets are supported");
    const auto declared_length = static_cast<std::size_t>(read32(bytes, 8U));
    if (declared_length != bytes.size()) return std::unexpected("GLB declared length does not match file length");

    GlbAsset asset{};
    asset.source_name = std::move(source_name);
    std::size_t cursor = 12U;
    bool saw_json = false;
    bool saw_binary = false;
    while (cursor + 8U <= bytes.size()) {
        const auto chunk_length = static_cast<std::size_t>(read32(bytes, cursor));
        const auto chunk_type = read32(bytes, cursor + 4U);
        cursor += 8U;
        if (chunk_length > bytes.size() - cursor) return std::unexpected("GLB chunk extends beyond file length");
        if (chunk_type == kJsonChunk) {
            if (saw_json) return std::unexpected("GLB contains multiple JSON chunks");
            asset.json_chunk.assign(reinterpret_cast<const char*>(bytes.data() + cursor), chunk_length);
            saw_json = true;
        } else if (chunk_type == kBinChunk) {
            if (saw_binary) return std::unexpected("GLB contains multiple BIN chunks");
            asset.binary_chunk.assign(bytes.begin() + static_cast<std::ptrdiff_t>(cursor), bytes.begin() + static_cast<std::ptrdiff_t>(cursor + chunk_length));
            saw_binary = true;
        }
        cursor += chunk_length;
    }
    if (cursor != bytes.size()) return std::unexpected("GLB has trailing bytes outside complete chunks");
    if (!saw_json) return std::unexpected("GLB JSON chunk is missing");
    while (!asset.json_chunk.empty() && (asset.json_chunk.back() == ' ' || asset.json_chunk.back() == '\0')) asset.json_chunk.pop_back();

    json_tokener* tokener = json_tokener_new();
    if (!tokener) return std::unexpected("failed to allocate GLB JSON parser");
    JsonGuard root{json_tokener_parse_ex(tokener, asset.json_chunk.data(), static_cast<int>(asset.json_chunk.size()))};
    const auto parse_error = json_tokener_get_error(tokener);
    json_tokener_free(tokener);
    if (!root.value || parse_error != json_tokener_success || !json_object_is_type(root.value, json_type_object)) return std::unexpected("GLB JSON chunk is invalid");

    json_object* asset_object = member(root.value, "asset");
    json_object* version = member(asset_object, "version");
    if (!asset_object || !version || !json_object_is_type(version, json_type_string) || std::strcmp(json_object_get_string(version), "2.0") != 0) {
        return std::unexpected("GLB asset.version must be 2.0");
    }

    auto declared_binary_length = parseEmbeddedBufferLength(root.value, asset.binary_chunk);
    if (!declared_binary_length) return std::unexpected(declared_binary_length.error());
    auto views = parseBufferViews(root.value, asset.binary_chunk, *declared_binary_length);
    if (!views) return std::unexpected(views.error());
    auto accessors = parseAccessors(root.value, *views);
    if (!accessors) return std::unexpected(accessors.error());
    auto images = parseImages(root.value, *views, asset.binary_chunk);
    if (!images) return std::unexpected(images.error());
    asset.images = std::move(*images);
    auto textures = parseTextures(root.value, asset.images.size());
    if (!textures) return std::unexpected(textures.error());
    asset.textures = std::move(*textures);
    auto materials = parseMaterials(root.value, asset.textures.size());
    if (!materials) return std::unexpected(materials.error());
    asset.materials = std::move(*materials);
    auto primitives = parsePrimitives(root.value, *accessors, *views, asset.binary_chunk, asset.materials.size());
    if (!primitives) return std::unexpected(primitives.error());
    asset.primitives = std::move(*primitives);
    const auto mesh_count = member(root.value, "meshes") && json_object_is_type(member(root.value, "meshes"), json_type_array)
        ? json_object_array_length(member(root.value, "meshes")) : 0U;
    auto nodes = parseNodes(root.value, mesh_count);
    if (!nodes) return std::unexpected(nodes.error());
    asset.nodes = std::move(*nodes);

    asset.primitive_count = asset.primitives.size();
    asset.material_count = asset.materials.size();
    asset.texture_count = asset.textures.size();
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

std::expected<void, std::string> GlbGpuResourceCache::store(std::string asset_id, GlbGpuResources resources) {
    if (asset_id.empty()) return std::unexpected("GLB GPU cache requires a stable non-empty asset ID");
    if (!resources.vertex_buffer.valid()) return std::unexpected("GLB GPU cache requires a valid vertex buffer");
    for (const auto texture : resources.textures) if (!texture.valid()) return std::unexpected("GLB GPU cache cannot store an invalid texture handle");
    const auto [iterator, inserted] = resources_.emplace(std::move(asset_id), std::move(resources));
    (void)iterator;
    if (!inserted) return std::unexpected("GLB GPU resource already exists for this stable asset ID");
    return {};
}

std::optional<GlbGpuResources> GlbGpuResourceCache::resolve(std::string_view asset_id) const {
    const auto iterator = resources_.find(asset_id);
    if (iterator == resources_.end()) return std::nullopt;
    return iterator->second;
}

void GlbGpuResourceCache::erase(std::string_view asset_id) {
    resources_.erase(std::string{asset_id});
}

} // namespace civic::presentation
