#pragma once

#include <civic/presentation/GpuBackend.hpp>
#include <civic/presentation/MiniaturePresentation.hpp>
#include <civic/presentation/SceneGeometry.hpp>

#include <cstddef>
#include <cstdint>
#include <expected>
#include <string>

namespace civic::presentation {

struct NativeRendererStats {
    std::uint64_t geometry_uploads{};
    std::uint64_t draw_calls{};
    std::size_t opaque_capacity_bytes{};
    std::size_t overlay_capacity_bytes{};
};

class NativeRenderer {
public:
    explicit NativeRenderer(IGpuBackend& backend) : backend_(backend) {}
    ~NativeRenderer();
    NativeRenderer(const NativeRenderer&) = delete;
    NativeRenderer& operator=(const NativeRenderer&) = delete;
    [[nodiscard]] std::expected<void, std::string> initialize();
    [[nodiscard]] std::expected<void, std::string> render(const SceneGeometry& geometry, const FrameToken& frame);
    [[nodiscard]] std::expected<void, std::string> render(const SceneGeometry& geometry, const FrameToken& frame, const MiniatureTreatment& treatment);
    [[nodiscard]] const NativeRendererStats& stats() const noexcept { return stats_; }
private:
    [[nodiscard]] std::expected<void, std::string> uploadIfChanged(const SceneGeometry& geometry);
    [[nodiscard]] std::expected<void, std::string> ensureBuffer(BufferHandle& handle, std::size_t& capacity, std::size_t required, const char* name);
    [[nodiscard]] std::expected<void, std::string> drawOpaque(const SceneGeometry& geometry, const FrameToken& frame);
    [[nodiscard]] std::expected<void, std::string> drawOverlay(const SceneGeometry& geometry, const FrameToken& frame);
    IGpuBackend& backend_;
    ShaderHandle vertex_shader_{};
    ShaderHandle pixel_shader_{};
    PipelineHandle opaque_pipeline_{};
    PipelineHandle overlay_pipeline_{};
    BufferHandle opaque_buffer_{};
    BufferHandle overlay_buffer_{};
    std::uint64_t last_geometry_key_{};
    bool initialized_{};
    NativeRendererStats stats_{};
};

} // namespace civic::presentation
