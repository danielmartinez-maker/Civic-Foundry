#include <gtest/gtest.h>

#include <civic/presentation/MiniaturePresentation.hpp>
#include <civic/presentation/NativeRenderer.hpp>

#include <cstring>
#include <map>
#include <string>
#include <vector>

using namespace civic::presentation;

namespace {
class RecordingBackend final : public IGpuBackend {
public:
    int creates{};
    int updates{};
    int draws{};
    std::uint64_t next{10};
    std::map<std::uint64_t,std::vector<std::byte>> buffers;

    std::expected<void,std::string> initialize(void*,std::uint32_t,std::uint32_t) override { return {}; }
    std::expected<void,std::string> resize(std::uint32_t,std::uint32_t) override { return {}; }
    std::expected<BufferHandle,std::string> createBuffer(const BufferDesc&,std::span<const std::byte> data) override { BufferHandle h{next++}; buffers[h.value]={data.begin(),data.end()}; ++creates; return h; }
    std::expected<void,std::string> updateBuffer(BufferHandle h,std::span<const std::byte> data) override { buffers[h.value]={data.begin(),data.end()}; ++updates; return {}; }
    void destroyBuffer(BufferHandle h) noexcept override { buffers.erase(h.value); }
    std::expected<TextureHandle,std::string> createTexture(const TextureDesc&) override { return TextureHandle{next++}; }
    std::expected<ShaderHandle,std::string> createShader(const ShaderDesc&) override { return ShaderHandle{next++}; }
    std::expected<PipelineHandle,std::string> createPipeline(const PipelineDesc&) override { return PipelineHandle{next++}; }
    std::expected<FrameToken,std::string> beginFrame() override { return FrameToken{1,TextureHandle{1}}; }
    std::expected<void,std::string> recordDraw(const FrameToken&,const DrawCommand&) override { ++draws; return {}; }
    std::expected<std::uint64_t,std::string> submit(const FrameToken&) override { return 1U; }
    std::expected<void,std::string> present(const FrameToken&) override { return {}; }
    std::expected<void,std::string> waitForFence(std::uint64_t) override { return {}; }
    GpuCapabilities capabilities() const override { return {}; }
    std::string deviceLostReason() const override { return {}; }
};

class MiniatureRecordingBackend final : public IGpuBackend {
public:
    std::uint64_t next{50};
    std::vector<std::string> events;
    std::map<std::uint64_t,std::vector<std::byte>> buffers;
    MiniatureCompositeDesc last_desc{};

    std::expected<void,std::string> initialize(void*,std::uint32_t,std::uint32_t) override { return {}; }
    std::expected<void,std::string> resize(std::uint32_t,std::uint32_t) override { return {}; }
    std::expected<BufferHandle,std::string> createBuffer(const BufferDesc&,std::span<const std::byte> data) override { BufferHandle h{next++}; buffers[h.value]={data.begin(),data.end()}; return h; }
    std::expected<void,std::string> updateBuffer(BufferHandle h,std::span<const std::byte> data) override { buffers[h.value]={data.begin(),data.end()}; return {}; }
    void destroyBuffer(BufferHandle h) noexcept override { buffers.erase(h.value); }
    std::expected<TextureHandle,std::string> createTexture(const TextureDesc&) override { return TextureHandle{next++}; }
    std::expected<ShaderHandle,std::string> createShader(const ShaderDesc&) override { return ShaderHandle{next++}; }
    std::expected<PipelineHandle,std::string> createPipeline(const PipelineDesc&) override { return PipelineHandle{next++}; }
    std::expected<FrameToken,std::string> beginFrame() override { return FrameToken{2,TextureHandle{1}}; }
    std::expected<void,std::string> recordDraw(const FrameToken&,const DrawCommand&) override { events.emplace_back("draw"); return {}; }
    bool supportsMiniatureComposite() const noexcept override { return true; }
    std::expected<void,std::string> beginMiniatureWorldPass(const FrameToken&,const MiniatureCompositeDesc& desc) override { last_desc=desc; events.emplace_back("world-pass"); return {}; }
    std::expected<void,std::string> compositeMiniatureWorld(const FrameToken&,const MiniatureCompositeDesc& desc) override { last_desc=desc; events.emplace_back("composite"); return {}; }
    std::expected<std::uint64_t,std::string> submit(const FrameToken&) override { return 2U; }
    std::expected<void,std::string> present(const FrameToken&) override { return {}; }
    std::expected<void,std::string> waitForFence(std::uint64_t) override { return {}; }
    GpuCapabilities capabilities() const override { return {}; }
    std::string deviceLostReason() const override { return {}; }
};

SceneGeometry simpleScene(std::uint64_t key) {
    SceneGeometry scene{};
    scene.revision=7;
    scene.geometry_key=key;
    scene.opaque = {{-0.5F,-0.5F,1,0,0,1},{0.5F,-0.5F,1,0,0,1},{0,0.5F,1,0,0,1}};
    scene.overlay = {{-0.1F,-0.1F,0,1,0,0.5F},{0.1F,-0.1F,0,1,0,0.5F},{0,0.1F,0,1,0,0.5F}};
    return scene;
}
}

TEST(NativeRenderer, UploadsOnlyWhenGeometryKeyChangesButDrawsEveryFrame) {
    RecordingBackend backend{};
    NativeRenderer renderer(backend);
    ASSERT_TRUE(renderer.initialize().has_value());
    auto frame=backend.beginFrame(); ASSERT_TRUE(frame.has_value());
    ASSERT_TRUE(renderer.render(simpleScene(100),*frame).has_value());
    const int first_updates=backend.updates;
    EXPECT_GT(first_updates,0);
    const int first_draws=backend.draws;
    ASSERT_TRUE(renderer.render(simpleScene(100),*frame).has_value());
    EXPECT_EQ(backend.updates,first_updates);
    EXPECT_GT(backend.draws,first_draws);
    ASSERT_TRUE(renderer.render(simpleScene(101),*frame).has_value());
    EXPECT_GT(backend.updates,first_updates);
}

TEST(NativeRenderer, MiniatureTreatmentRendersWorldOffscreenThenCompositesBeforeCrispOverlay) {
    MiniatureRecordingBackend backend{};
    NativeRenderer renderer(backend);
    ASSERT_TRUE(renderer.initialize().has_value());
    auto frame=backend.beginFrame(); ASSERT_TRUE(frame.has_value());
    PresentationSettings settings{};
    settings.tilt_shift_strength=0.8F;
    const auto treatment=deriveMiniatureTreatment(settings,PixelViewport{1600,900});
    ASSERT_TRUE(treatment.enabled);

    ASSERT_TRUE(renderer.render(simpleScene(200),*frame,treatment).has_value());
    ASSERT_EQ(backend.events,(std::vector<std::string>{"world-pass","draw","composite","draw"}));
    EXPECT_GT(backend.last_desc.blur_radius_px,0.0F);
    EXPECT_FLOAT_EQ(backend.last_desc.focus_center,treatment.focus_center);
    EXPECT_FLOAT_EQ(backend.last_desc.focus_width,treatment.focus_width);
}

TEST(NativeRenderer, DisabledMiniatureTreatmentUsesDirectWorldAndOverlayPath) {
    MiniatureRecordingBackend backend{};
    NativeRenderer renderer(backend);
    ASSERT_TRUE(renderer.initialize().has_value());
    auto frame=backend.beginFrame(); ASSERT_TRUE(frame.has_value());
    MiniatureTreatment treatment{};

    ASSERT_TRUE(renderer.render(simpleScene(201),*frame,treatment).has_value());
    EXPECT_EQ(backend.events,(std::vector<std::string>{"draw","draw"}));
}
