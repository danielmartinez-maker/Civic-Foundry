#include <gtest/gtest.h>

#include <civic/presentation/AssetRuntime.hpp>

#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

using namespace civic::presentation;

namespace {
void append32(std::vector<std::byte>& bytes, std::uint32_t value) {
    bytes.push_back(static_cast<std::byte>(value & 0xffU));
    bytes.push_back(static_cast<std::byte>((value >> 8U) & 0xffU));
    bytes.push_back(static_cast<std::byte>((value >> 16U) & 0xffU));
    bytes.push_back(static_cast<std::byte>((value >> 24U) & 0xffU));
}

void append16(std::vector<std::byte>& bytes, std::uint16_t value) {
    bytes.push_back(static_cast<std::byte>(value & 0xffU));
    bytes.push_back(static_cast<std::byte>((value >> 8U) & 0xffU));
}

void appendFloat(std::vector<std::byte>& bytes, float value) {
    append32(bytes, std::bit_cast<std::uint32_t>(value));
}

std::vector<std::byte> makeGlb(std::string json, std::vector<std::byte> binary) {
    while (json.size() % 4U != 0U) json.push_back(' ');
    while (binary.size() % 4U != 0U) binary.push_back(std::byte{0});

    const auto total = static_cast<std::uint32_t>(12U + 8U + json.size() + (binary.empty() ? 0U : 8U + binary.size()));
    std::vector<std::byte> bytes;
    bytes.reserve(total);
    append32(bytes, 0x46546c67U);
    append32(bytes, 2U);
    append32(bytes, total);
    append32(bytes, static_cast<std::uint32_t>(json.size()));
    append32(bytes, 0x4e4f534aU);
    for (const char ch : json) bytes.push_back(static_cast<std::byte>(static_cast<unsigned char>(ch)));
    if (!binary.empty()) {
        append32(bytes, static_cast<std::uint32_t>(binary.size()));
        append32(bytes, 0x004e4942U);
        bytes.insert(bytes.end(), binary.begin(), binary.end());
    }
    return bytes;
}

std::vector<std::byte> decodedFixture() {
    std::vector<std::byte> binary;
    for (const float value : std::array<float, 9>{0.0F, 0.0F, 0.0F, 1.0F, 0.0F, 0.0F, 0.0F, 1.0F, 0.0F}) appendFloat(binary, value);
    append16(binary, 0U);
    append16(binary, 1U);
    append16(binary, 2U);
    binary.push_back(std::byte{0x89});
    binary.push_back(std::byte{0x50});
    binary.push_back(std::byte{0x4e});
    binary.push_back(std::byte{0x47});

    const std::string json = R"({
      "asset":{"version":"2.0"},
      "buffers":[{"byteLength":46}],
      "bufferViews":[
        {"buffer":0,"byteOffset":0,"byteLength":36},
        {"buffer":0,"byteOffset":36,"byteLength":6},
        {"buffer":0,"byteOffset":42,"byteLength":4}
      ],
      "accessors":[
        {"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},
        {"bufferView":1,"componentType":5123,"count":3,"type":"SCALAR"}
      ],
      "images":[{"bufferView":2,"mimeType":"image/png"}],
      "textures":[{"source":0}],
      "materials":[{"pbrMetallicRoughness":{
        "baseColorFactor":[0.2,0.4,0.6,1.0],
        "metallicFactor":0.1,
        "roughnessFactor":0.7,
        "baseColorTexture":{"index":0}
      }}],
      "meshes":[{"primitives":[{
        "attributes":{"POSITION":0},"indices":1,"material":0,"mode":4
      }]}],
      "nodes":[
        {"mesh":0,"translation":[10,20,30],"scale":[2,2,2],"extensions":{"MSFT_lod":{"ids":[1,2]}}},
        {},{}
      ]
    })";
    return makeGlb(json, std::move(binary));
}
} // namespace

TEST(GlbRuntime, DecodesPrimitiveMaterialTextureAndDeterministicNodeTransform) {
    GlbLoader loader{};
    const auto loaded = loader.load(decodedFixture(), "miniature-house.glb");
    ASSERT_TRUE(loaded.has_value()) << loaded.error();
    ASSERT_EQ(loaded->primitives.size(), 1U);
    ASSERT_EQ(loaded->primitives[0].positions.size(), 3U);
    EXPECT_FLOAT_EQ(loaded->primitives[0].positions[1].x, 1.0F);
    ASSERT_EQ(loaded->primitives[0].indices, (std::vector<std::uint32_t>{0U, 1U, 2U}));
    ASSERT_TRUE(loaded->primitives[0].material_index.has_value());
    EXPECT_EQ(*loaded->primitives[0].material_index, 0U);

    ASSERT_EQ(loaded->materials.size(), 1U);
    EXPECT_FLOAT_EQ(loaded->materials[0].base_color_factor[0], 0.2F);
    EXPECT_FLOAT_EQ(loaded->materials[0].metallic_factor, 0.1F);
    EXPECT_FLOAT_EQ(loaded->materials[0].roughness_factor, 0.7F);
    ASSERT_TRUE(loaded->materials[0].base_color_texture.has_value());
    EXPECT_EQ(*loaded->materials[0].base_color_texture, 0U);

    ASSERT_EQ(loaded->textures.size(), 1U);
    ASSERT_TRUE(loaded->textures[0].source_image.has_value());
    EXPECT_EQ(*loaded->textures[0].source_image, 0U);
    ASSERT_EQ(loaded->images.size(), 1U);
    EXPECT_EQ(loaded->images[0].mime_type, "image/png");
    EXPECT_EQ(loaded->images[0].bytes.size(), 4U);

    ASSERT_EQ(loaded->nodes.size(), 3U);
    const auto transformed = loaded->nodes[0].transformPoint({1.0F, 0.0F, 0.0F});
    EXPECT_FLOAT_EQ(transformed.x, 12.0F);
    EXPECT_FLOAT_EQ(transformed.y, 20.0F);
    EXPECT_FLOAT_EQ(transformed.z, 30.0F);
    EXPECT_EQ(loaded->nodes[0].lod_node_ids, (std::vector<std::size_t>{1U, 2U}));
}

TEST(GlbRuntime, RejectsAccessorThatEscapesItsBufferView) {
    const std::string json = R"({
      "asset":{"version":"2.0"},
      "buffers":[{"byteLength":4}],
      "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":4}],
      "accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"}],
      "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}]
    })";
    const auto bytes = makeGlb(json, std::vector<std::byte>(4));
    GlbLoader loader{};
    const auto loaded = loader.load(bytes, "bad-accessor.glb");
    ASSERT_FALSE(loaded.has_value());
    EXPECT_NE(loaded.error().find("accessor"), std::string::npos);
}

TEST(GlbGpuResourceCache, CachesResourcesByStableAssetIdWithoutAliasing) {
    GlbGpuResourceCache cache{};
    const GlbGpuResources house{BufferHandle{11}, BufferHandle{12}, {TextureHandle{13}}};
    const GlbGpuResources bus{BufferHandle{21}, BufferHandle{22}, {TextureHandle{23}}};
    ASSERT_TRUE(cache.store("building.residential.house-a", house).has_value());
    ASSERT_TRUE(cache.store("vehicle.bus.standard-a", bus).has_value());
    ASSERT_EQ(cache.size(), 2U);

    const auto resolved_house = cache.resolve("building.residential.house-a");
    const auto resolved_bus = cache.resolve("vehicle.bus.standard-a");
    ASSERT_TRUE(resolved_house.has_value());
    ASSERT_TRUE(resolved_bus.has_value());
    EXPECT_EQ(resolved_house->vertex_buffer, BufferHandle{11});
    EXPECT_EQ(resolved_house->textures[0], TextureHandle{13});
    EXPECT_EQ(resolved_bus->vertex_buffer, BufferHandle{21});
    EXPECT_FALSE(cache.resolve("missing").has_value());

    EXPECT_FALSE(cache.store("building.residential.house-a", bus).has_value());
    EXPECT_EQ(cache.size(), 2U);
}
