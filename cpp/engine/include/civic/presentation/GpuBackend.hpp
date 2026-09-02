#pragma once

#include <cstddef>
#include <cstdint>
#include <expected>
#include <span>
#include <string>
#include <vector>

namespace civic::presentation {

template <class Tag>
struct GpuHandle {
    std::uint64_t value{};
    [[nodiscard]] bool valid() const noexcept { return value != 0; }
    friend bool operator==(const GpuHandle&, const GpuHandle&) = default;
};

using BufferHandle = GpuHandle<struct BufferTag>;
using TextureHandle = GpuHandle<struct TextureTag>;
using ShaderHandle = GpuHandle<struct ShaderTag>;
using PipelineHandle = GpuHandle<struct PipelineTag>;
using SwapchainHandle = GpuHandle<struct SwapchainTag>;

enum class BufferUsage : std::uint8_t { Vertex, Index, Uniform, Upload, Readback };
enum class TextureFormat : std::uint8_t { Bgra8Unorm, Rgba8Unorm, Depth32Float };
enum class ShaderStage : std::uint8_t { Vertex, Pixel };

struct BufferDesc {
    std::size_t size_bytes{};
    BufferUsage usage{BufferUsage::Vertex};
    bool cpu_visible{};
    std::string debug_name;
};

struct TextureDesc {
    std::uint32_t width{};
    std::uint32_t height{};
    TextureFormat format{TextureFormat::Bgra8Unorm};
    bool render_target{};
    std::string debug_name;
};

struct ShaderDesc {
    ShaderStage stage{ShaderStage::Vertex};
    std::vector<std::byte> bytecode;
    std::string debug_name;
};

struct PipelineDesc {
    ShaderHandle vertex_shader{};
    ShaderHandle pixel_shader{};
    TextureFormat color_format{TextureFormat::Bgra8Unorm};
    bool depth_test{};
    std::string debug_name;
};

struct GpuCapabilities {
    std::string adapter_name;
    std::uint64_t dedicated_video_memory{};
    bool debug_layer{};
    bool tearing{};
};

struct FrameToken {
    std::uint64_t frame_index{};
    TextureHandle backbuffer{};
};

class IGpuBackend {
public:
    virtual ~IGpuBackend() = default;
    virtual std::expected<void, std::string> initialize(void* native_window, std::uint32_t width, std::uint32_t height) = 0;
    virtual std::expected<void, std::string> resize(std::uint32_t width, std::uint32_t height) = 0;
    virtual std::expected<BufferHandle, std::string> createBuffer(const BufferDesc&, std::span<const std::byte> initial_data) = 0;
    virtual std::expected<TextureHandle, std::string> createTexture(const TextureDesc&) = 0;
    virtual std::expected<ShaderHandle, std::string> createShader(const ShaderDesc&) = 0;
    virtual std::expected<PipelineHandle, std::string> createPipeline(const PipelineDesc&) = 0;
    virtual std::expected<FrameToken, std::string> beginFrame() = 0;
    virtual std::expected<std::uint64_t, std::string> submit(const FrameToken&) = 0;
    virtual std::expected<void, std::string> present(const FrameToken&) = 0;
    virtual std::expected<void, std::string> waitForFence(std::uint64_t value) = 0;
    [[nodiscard]] virtual GpuCapabilities capabilities() const = 0;
    [[nodiscard]] virtual std::string deviceLostReason() const = 0;
};

} // namespace civic::presentation
