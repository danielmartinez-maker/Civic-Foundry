#pragma once
#ifdef _WIN32
#include <civic/presentation/GpuBackend.hpp>
#include <memory>
namespace civic::presentation {
class D3D12Backend final : public IGpuBackend {
public:
    D3D12Backend(); ~D3D12Backend() override;
    D3D12Backend(const D3D12Backend&) = delete; D3D12Backend& operator=(const D3D12Backend&) = delete;
    std::expected<void,std::string> initialize(void*,std::uint32_t,std::uint32_t) override;
    std::expected<void,std::string> resize(std::uint32_t,std::uint32_t) override;
    std::expected<BufferHandle,std::string> createBuffer(const BufferDesc&,std::span<const std::byte>) override;
    std::expected<void,std::string> updateBuffer(BufferHandle,std::span<const std::byte>) override;
    void destroyBuffer(BufferHandle) noexcept override;
    std::expected<TextureHandle,std::string> createTexture(const TextureDesc&) override;
    std::expected<ShaderHandle,std::string> createShader(const ShaderDesc&) override;
    std::expected<PipelineHandle,std::string> createPipeline(const PipelineDesc&) override;
    std::expected<FrameToken,std::string> beginFrame() override;
    std::expected<void,std::string> recordDraw(const FrameToken&,const DrawCommand&) override;
    [[nodiscard]] bool supportsMiniatureComposite() const noexcept override { return true; }
    std::expected<void,std::string> beginMiniatureWorldPass(const FrameToken&,const MiniatureCompositeDesc&) override;
    std::expected<void,std::string> compositeMiniatureWorld(const FrameToken&,const MiniatureCompositeDesc&) override;
    std::expected<std::uint64_t,std::string> submit(const FrameToken&) override;
    std::expected<void,std::string> present(const FrameToken&) override;
    std::expected<void,std::string> waitForFence(std::uint64_t) override;
    [[nodiscard]] GpuCapabilities capabilities() const override;
    [[nodiscard]] std::string deviceLostReason() const override;
private: struct Impl; std::unique_ptr<Impl> impl_;
};
}
#endif
