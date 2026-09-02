#include <civic/presentation/NativeRenderer.hpp>

#include <algorithm>
#include <limits>
#include <span>

namespace civic::presentation {
namespace {
constexpr const char* kVertexShader = R"(
struct VSInput { float2 position : POSITION; float4 color : COLOR0; };
struct VSOutput { float4 position : SV_POSITION; float4 color : COLOR0; };
VSOutput main(VSInput input) { VSOutput output; output.position=float4(input.position,0.0,1.0); output.color=input.color; return output; }
)";
constexpr const char* kPixelShader = R"(
struct PSInput { float4 position : SV_POSITION; float4 color : COLOR0; };
float4 main(PSInput input) : SV_TARGET { return input.color; }
)";
std::size_t nextCapacity(std::size_t required) noexcept { std::size_t capacity=4096; while(capacity<required&&capacity<=std::numeric_limits<std::size_t>::max()/2)capacity*=2; return std::max(capacity,required); }
std::span<const std::byte> bytesOf(const std::vector<SceneVertex>& vertices) noexcept { return {reinterpret_cast<const std::byte*>(vertices.data()),vertices.size()*sizeof(SceneVertex)}; }
std::uint64_t fnv1a(std::uint64_t hash,std::span<const std::byte> bytes) noexcept { for(const auto byte:bytes){hash^=std::to_integer<std::uint8_t>(byte);hash*=1099511628211ULL;}return hash; }
std::uint64_t effectiveGeometryKey(const SceneGeometry& geometry) noexcept {
    if(geometry.geometry_key!=0)return geometry.geometry_key;
    std::uint64_t hash=14695981039346656037ULL;
    hash^=geometry.revision;hash*=1099511628211ULL;
    hash=fnv1a(hash,bytesOf(geometry.opaque));hash=fnv1a(hash,bytesOf(geometry.overlay));return hash;
}
MiniatureCompositeDesc compositeDesc(const MiniatureTreatment& treatment) noexcept {
    return MiniatureCompositeDesc{
        treatment.focus_center,
        treatment.focus_width,
        treatment.blur_radius_px,
        treatment.scale_cue_strength,
        treatment.material_softness,
        treatment.saturation,
        treatment.contrast,
    };
}
}

NativeRenderer::~NativeRenderer(){if(opaque_buffer_.valid())backend_.destroyBuffer(opaque_buffer_);if(overlay_buffer_.valid())backend_.destroyBuffer(overlay_buffer_);}
std::expected<void,std::string> NativeRenderer::initialize(){if(initialized_)return {};auto vs=backend_.createShader({ShaderStage::Vertex,{},kVertexShader,"main","vs_5_0","civic scene vertex"});if(!vs)return std::unexpected(vs.error());auto ps=backend_.createShader({ShaderStage::Pixel,{},kPixelShader,"main","ps_5_0","civic scene pixel"});if(!ps)return std::unexpected(ps.error());vertex_shader_=*vs;pixel_shader_=*ps;auto opaque=backend_.createPipeline({vertex_shader_,pixel_shader_,TextureFormat::Bgra8Unorm,false,false,"civic opaque"});if(!opaque)return std::unexpected(opaque.error());auto overlay=backend_.createPipeline({vertex_shader_,pixel_shader_,TextureFormat::Bgra8Unorm,false,true,"civic overlay"});if(!overlay)return std::unexpected(overlay.error());opaque_pipeline_=*opaque;overlay_pipeline_=*overlay;initialized_=true;last_geometry_key_=std::numeric_limits<std::uint64_t>::max();return {};}
std::expected<void,std::string> NativeRenderer::ensureBuffer(BufferHandle& handle,std::size_t& capacity,std::size_t required,const char* name){if(required==0)return {};if(handle.valid()&&capacity>=required)return {};if(handle.valid())backend_.destroyBuffer(handle);capacity=nextCapacity(required);auto created=backend_.createBuffer({capacity,BufferUsage::Vertex,true,name},{});if(!created){handle={};capacity=0;return std::unexpected(created.error());}handle=*created;return {};}
std::expected<void,std::string> NativeRenderer::uploadIfChanged(const SceneGeometry& geometry){const auto key=effectiveGeometryKey(geometry);if(key==last_geometry_key_)return {};const auto opaque=bytesOf(geometry.opaque);const auto overlay=bytesOf(geometry.overlay);if(auto ready=ensureBuffer(opaque_buffer_,stats_.opaque_capacity_bytes,opaque.size(),"civic opaque vertices");!ready)return ready;if(auto ready=ensureBuffer(overlay_buffer_,stats_.overlay_capacity_bytes,overlay.size(),"civic overlay vertices");!ready)return ready;if(!opaque.empty())if(auto updated=backend_.updateBuffer(opaque_buffer_,opaque);!updated)return updated;if(!overlay.empty())if(auto updated=backend_.updateBuffer(overlay_buffer_,overlay);!updated)return updated;last_geometry_key_=key;++stats_.geometry_uploads;return {};}
std::expected<void,std::string> NativeRenderer::drawOpaque(const SceneGeometry& geometry,const FrameToken& frame){if(geometry.opaque.empty())return {};if(geometry.opaque.size()>std::numeric_limits<std::uint32_t>::max())return std::unexpected("opaque scene exceeds draw vertex limit");DrawCommand draw{opaque_pipeline_,opaque_buffer_,static_cast<std::uint32_t>(geometry.opaque.size()),static_cast<std::uint32_t>(sizeof(SceneVertex)),0};if(auto recorded=backend_.recordDraw(frame,draw);!recorded)return recorded;++stats_.draw_calls;return {};}
std::expected<void,std::string> NativeRenderer::drawOverlay(const SceneGeometry& geometry,const FrameToken& frame){if(geometry.overlay.empty())return {};if(geometry.overlay.size()>std::numeric_limits<std::uint32_t>::max())return std::unexpected("overlay scene exceeds draw vertex limit");DrawCommand draw{overlay_pipeline_,overlay_buffer_,static_cast<std::uint32_t>(geometry.overlay.size()),static_cast<std::uint32_t>(sizeof(SceneVertex)),0};if(auto recorded=backend_.recordDraw(frame,draw);!recorded)return recorded;++stats_.draw_calls;return {};}
std::expected<void,std::string> NativeRenderer::render(const SceneGeometry& geometry,const FrameToken& frame){return render(geometry,frame,MiniatureTreatment{});}
std::expected<void,std::string> NativeRenderer::render(const SceneGeometry& geometry,const FrameToken& frame,const MiniatureTreatment& treatment){
    if(!initialized_)if(auto result=initialize();!result)return result;
    if(auto uploaded=uploadIfChanged(geometry);!uploaded)return uploaded;
    const bool miniature=treatment.enabled&&backend_.supportsMiniatureComposite();
    if(miniature){const auto desc=compositeDesc(treatment);if(auto begun=backend_.beginMiniatureWorldPass(frame,desc);!begun)return begun;if(auto opaque=drawOpaque(geometry,frame);!opaque)return opaque;if(auto composited=backend_.compositeMiniatureWorld(frame,desc);!composited)return composited;}else if(auto opaque=drawOpaque(geometry,frame);!opaque)return opaque;
    return drawOverlay(geometry,frame);
}

} // namespace civic::presentation
